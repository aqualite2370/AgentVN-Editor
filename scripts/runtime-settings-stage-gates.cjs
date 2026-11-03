"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/r1-runtime-settings-gates", runId);
fs.mkdirSync(output, { recursive: true });
const input = path.join(output, "isolated-r1.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture(`r1-${runId}`), null, 2));
const files = ["shared/cartridge/uiSkin.ts", "GameCli_framework/src/components/shell/MainMenu.tsx",
  "GameCli_framework/src/components/shell/SettingsScreen.tsx",
  "GameCli_framework/src/components/shell/useSettingsContentTransition.ts",
  "GameCli_framework/src/app/runtimePageCrossfade.ts", "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/components/shell/renpy-menu.css"];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { runId, scope: "R1-Runtime-settings-menu-behavior-and-Dev-not-Release-or-Android",
  status: "RUNNING", input, checks: [], sources: files.map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
async function execute(label, command, args, extra = {}) {
  const log = path.join(output, `${String(report.checks.length + 1).padStart(2, "0")}-${label}.log`);
  const env = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: path.join(output, label),
    RUNTIME_MOTION_VIEWPORTS: "1080p,1440p,4k", RUNTIME_MOTION_DPR: "1", RUNTIME_MOTION_REDUCED: "",
    RENPY_FADE_FAST: "", RENPY_CHROME_REDUCED: "", PROFILE_DPR: "1", PROFILE_REDUCED: "",
    AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd", ...extra };
  const item = { label, command: [command, ...args], env, log, startedAt: new Date().toISOString(), status: "RUNNING" };
  report.checks.push(item); persist(); console.log(`START ${label}`);
  item.exitCode = await new Promise(resolve => {
    const stream = fs.createWriteStream(log, { flags: "wx" });
    const child = spawn(command, args, { cwd: root, windowsHide: true,
      env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", data => stream.write(data));
    child.stderr.on("data", data => stream.write(data));
    child.on("error", error => { item.error = String(error); stream.write(String(error)); });
    child.on("close", code => stream.end(() => resolve(code)));
  });
  item.finishedAt = new Date().toISOString(); item.status = item.exitCode === 0 ? "PASS" : "FAILED";
  persist(); console.log(`${item.status} ${label}`);
  assert.equal(item.exitCode, 0, `Required R1 gate failed: ${label}; product build/delivery prohibited`);
}
const test = (name, extra) => execute(name, process.execPath, [`scripts/${name}.cjs`], extra);
const npm = (prefix, task) => execute(`${prefix}-${task}`, "cmd.exe", ["/d", "/s", "/c", `npm --prefix D:\\AgentVN\\${prefix} run ${task}`]);
(async () => {
  persist();
  await test("runtime-settings-flow-playwright");
  await execute("renpy-category-page-runtime", process.execPath,
    ["scripts/renpy-category-page-playwright.cjs", "--runtime"]);
  for (const name of ["title-button-label-sync-contract", "renpy-default-palette-contract", "ui-skin-legacy-compat-contract",
    "runtime-layout-profiles-test", "settings-exit-placement-contract", "settings-surface-contract",
    "runtime-screen-transition-contract", "runtime-save-queue-test", "runtime-exit-flow-test",
    "runtime-system-back-test", "runtime-window-close-test"]) await test(name);
  for (const [label, env] of [["normal-dpr1", {}], ["normal-dpr2", { RUNTIME_MOTION_DPR: "2" }],
    ["reduced-dpr1", { RUNTIME_MOTION_REDUCED: "1" }], ["reduced-dpr2", { RUNTIME_MOTION_REDUCED: "1", RUNTIME_MOTION_DPR: "2" }]])
    await execute(`runtime-menu-${label}`, process.execPath, ["scripts/runtime-menu-motion-playwright.cjs"], env);
  await test("renpy-page-crossfade-playwright");
  await test("runtime-agentvn-blackout-playwright");
  await test("renpy-page-button-chrome-playwright");
  await execute("renpy-page-button-chrome-reduced", process.execPath,
    ["scripts/renpy-page-button-chrome-playwright.cjs"], { RENPY_CHROME_REDUCED: "1" });
  await test("settings-exit-placement-playwright");
  await execute("settings-exit-placement-reduced-dpr2", process.execPath,
    ["scripts/settings-exit-placement-playwright.cjs"], { PROFILE_DPR: "2", PROFILE_REDUCED: "1" });
  await npm("editor", "typecheck"); await npm("editor", "build"); await npm("GameCli_framework", "build");
  await test("editor-workspace-contract"); await test("editor-workspace-playwright");
  if (process.argv.includes("--deliver-dev")) {
    const dev = path.join(root, "AgentVN Dev.exe");
    const before = { sha256: sha(dev), modifiedAt: fs.statSync(dev).mtime.toISOString() };
    fs.copyFileSync(dev, path.join(output, "AgentVN Dev-before.exe"), fs.constants.COPYFILE_EXCL);
    await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    report.dev = { path: dev, before, sha256: sha(dev), modifiedAt: fs.statSync(dev).mtime.toISOString(),
      compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")) };
    assert.equal(report.dev.sha256, report.dev.compiledSha256);
    assert.notEqual(report.dev.modifiedAt, before.modifiedAt, "Root Dev must actually be overwritten");
    report.resources = collectStageResourceEvidence(root, files);
  } else report.dev = "NOT_REQUESTED";
  assert(report.checks.length >= 27 && report.checks.every(c => c.status === "PASS"));
  report.status = "R1_SOURCE_AND_DEV_GATES_PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(() => { persist(); console.log(`Evidence: ${path.join(output, "report.json")}`); });
