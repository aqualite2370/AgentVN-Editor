"use strict";
// Runs the production restoration coordinator/builder call against the pinned
// Wry cleanup body. This controls queue order; ART/device acceptance is separate.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = process.env.AGENTVN_RESTORED_WEBVIEW_OUTPUT;
assert(out && path.resolve(out).toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const registry = path.join(process.env.LOCALAPPDATA,
  "AgentVN/AndroidToolchain/cargo/registry/src/index.crates.io-1949cf8c6b5b557f");
const source = path.join(root, "GameCli_framework/src-tauri/src/android_activity.rs");
const state = path.join(root, "GameCli_framework/src-tauri/src/android_activity_state.rs");
const wry = path.join(registry, "wry-0.55.1/src/android/mod.rs");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "PRODUCTION_RESTORE_WITH_PINNED_WRY_CLEANUP_CONTROLLED_QUEUE_NOT_ANDROID_DEVICE",
  sources: [source, state, wry].map(file => ({
    file, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  })), cases: [], commands: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function body(text, signature) {
  const start = text.indexOf(signature); assert(start >= 0, signature);
  const open = text.indexOf("{", start); let depth = 1, end = open + 1;
  while (depth && end < text.length) {
    if (text[end] === "{") depth++;
    if (text[end] === "}") depth--;
    end++;
  }
  assert.equal(depth, 0); return text.slice(start, end);
}
function run(label, exe, args) {
  const r = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60000 });
  fs.writeFileSync(path.join(out, label + ".log"), (r.stdout || "") + "\n" + (r.stderr || ""));
  report.commands.push({ label, exe, args, exitCode: r.status, error: r.error?.message }); save();
  assert.equal(r.status, 0, `${label}: ${r.stderr}`); return r.stdout;
}
try {
  save();
  const restore = body(fs.readFileSync(source, "utf8"), "pub fn restore_pending(");
  const destroy = body(fs.readFileSync(wry, "utf8"), "pub fn destroy_webview(");
  const registries = ["IPC", "REQUEST_HANDLER", "TITLE_CHANGE_HANDLER", "URL_LOADING_OVERRIDE",
    "ON_LOAD_HANDLER", "WITH_ASSET_LOADER", "ASSET_LOADER_DOMAIN"];
  const fixture = path.join(out, "restoration.rs"), exe = path.join(out, "restoration.exe");
  fs.writeFileSync(fixture, `
#![allow(dead_code, non_snake_case)]
use std::{collections::HashMap, sync::{Mutex, LazyLock, MutexGuard}};
#[path = ${JSON.stringify(state.replaceAll("\\", "/"))}] mod android_activity_state;
use android_activity_state::{ActivityRestoration, RestoreTicket};
use tauri::AppHandle;
type ActivityId = i32;
type WebviewId = String;
${["WEBVIEW_ATTRIBUTES", ...registries].map(name => `static ${name}: LazyLock<Mutex<HashMap<${name === "WEBVIEW_ATTRIBUTES" ? "i32" : "String"}, bool>>> = LazyLock::new(Default::default);`).join("\n")}
${destroy}
#[derive(Default)] struct Activities { ownership: ActivityRestoration }
static ACTIVITIES: LazyLock<Mutex<Activities>> = LazyLock::new(Default::default);
fn activities() -> MutexGuard<'static, Activities> { ACTIVITIES.lock().unwrap() }
fn show_error(_ticket: RestoreTicket, error: &str) { panic!("restore error: {error}"); }
fn append_player_log(_line: &str) {}
mod tauri {
  use super::*;
  #[derive(Clone)] pub struct WindowConfig { pub create: bool, pub label: String }
  pub struct AppConfig { pub windows: Vec<WindowConfig> }
  pub struct Config { pub app: AppConfig }
  pub struct AppHandle { pub config: Config }
  static WINDOWS: LazyLock<Mutex<HashMap<String, WebviewWindow>>> = LazyLock::new(Default::default);
  #[derive(Clone)] pub struct WebviewWindow { pub label: String }
  impl WebviewWindow {
    pub fn destroy(&self) -> Result<(), String> { WINDOWS.lock().unwrap().remove(&self.label); Ok(()) }
  }
  impl AppHandle {
    pub fn config(&self) -> &Config { &self.config }
    pub fn webview_windows(&self) -> HashMap<String, WebviewWindow> { WINDOWS.lock().unwrap().clone() }
  }
  pub struct WebviewWindowBuilder { label: String }
  impl WebviewWindowBuilder {
    pub fn from_config(_app: &AppHandle, config: &WindowConfig) -> Result<Self, String> {
      Ok(Self { label: config.label.clone() })
    }
    pub fn build(self) -> Result<WebviewWindow, String> {
      // Actual Wry registration happens while building. The old Activity's
      // queued OnDestroy can execute after these new entries have been set.
      ${registries.map(name => `${name}.lock().unwrap().insert(self.label.clone(), true);`).join("\n")}
      if LATE_CLEANUP.load(std::sync::atomic::Ordering::SeqCst) {
        destroy_webview(1, &OLD_LABEL.lock().unwrap());
      }
      let window = WebviewWindow { label: self.label };
      WINDOWS.lock().unwrap().insert(window.label.clone(), window.clone());
      Ok(window)
    }
  }
}
static LATE_CLEANUP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static OLD_LABEL: LazyLock<Mutex<String>> = LazyLock::new(|| Mutex::new("main".into()));
mod crate_stub { pub fn unused() {} }
${restore.replaceAll("crate::append_player_log", "append_player_log")}
fn main() {
  let late = std::env::args().nth(1).unwrap() == "late";
  LATE_CLEANUP.store(late, std::sync::atomic::Ordering::SeqCst);
  let app = tauri::AppHandle { config: tauri::Config { app: tauri::AppConfig {
    windows: vec![tauri::WindowConfig { create: true, label: "main".into() }]
  }}};
  activities().ownership.initialize(1);
  let mut labels = std::collections::HashSet::new();
  labels.insert("main".to_string());
  for id in [2, 3, 2] {
    if !late { destroy_webview(1, &OLD_LABEL.lock().unwrap()); }
    activities().ownership.destroyed(if id == 2 && labels.len() == 1 { 1 } else if id == 3 { 2 } else { 3 }, false);
    activities().ownership.created(id);
    restore_pending(&app);
    let windows = app.webview_windows();
    assert_eq!(windows.len(), 1, "one functional restored window");
    let window = windows.values().next().unwrap();
    ${registries.map(name => `assert!(${name}.lock().unwrap().contains_key(&window.label), "new ${name} erased by old OnDestroy: {}", window.label);`).join("\n")}
    assert!(labels.insert(window.label.clone()), "restored WebView identity must never be reused, even for a repeated Activity id");
    restore_pending(&app);
    assert_eq!(app.webview_windows().len(), 1, "duplicate callback created a window");
    *OLD_LABEL.lock().unwrap() = window.label.clone();
    window.destroy().unwrap();
  }
  println!("three restores retain protocol and IPC handlers");
}
`);
  run("compile", "rustc.exe", ["--edition=2021", fixture, "-o", exe]);
  for (const ordering of ["late", "early"]) {
    const c = { name: `${ordering}-old-cleanup`, status: "RUNNING" };
    report.cases.push(c); save();
    run(ordering, exe, [ordering]); c.status = "PASS"; save();
  }
  const base = JSON.parse(fs.readFileSync(path.join(root, "GameCli_framework/src-tauri/capabilities/default.json")));
  const cap = JSON.parse(fs.readFileSync(path.join(root, "GameCli_framework/src-tauri/capabilities/android-restored.json")));
  assert.deepEqual(cap.platforms, ["android"]);
  assert.deepEqual(cap.windows, ["main-restored-*"]);
  assert.deepEqual(cap.permissions, base.permissions, "Restoration preserves existing permissions only");
  assert.deepEqual(base.windows, ["main"], "Desktop permission scope remains unchanged");
  report.cases.push({ name: "android-only-existing-permissions", status: "PASS" });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report)); }
