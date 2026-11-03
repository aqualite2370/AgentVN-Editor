"use strict";
// Shared native-library acceptance session. No UI/store/native-result mocks.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net"), assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const JSZip = require("../../editor/node_modules/jszip"), { chromium } = require("../../editor/node_modules/playwright");
const { sha256, settleRuntime } = require("./installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./installed-webview-capture.cjs");
const sha = f => sha256(fs.readFileSync(f));
const pause = ms => new Promise(r => setTimeout(r, ms));
function processIdentity(pid) {
  const value = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);` +
    `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate|ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true });
  return value.trim() ? JSON.parse(value.replace(/^\uFEFF/, "")) : null;
}
class InstalledRuntimeSession {
  constructor({ prep, fixture, cartridges, out, report, save, installId, currentNative = false }) {
    Object.assign(this, { prep, fixture, cartridges, out, report, save, installId, currentNative });
    assert(prep.profiles.every(p => fs.existsSync(p.held)));
    this.exe = currentNative ? prep.executable.path : path.join(prep.installRoot, "agentvn-player.exe");
    if (currentNative) {
      assert.equal(prep.status, "PASS");
      if (prep.current1922Library) {
        require("./installed-runtime-quick-1922-preparation.cjs").validateQuickPreparation(prep, out);
      } else assert.equal(prep.defaultStorage, prep.current1922Preview
        ? "CODEX_EXPLICIT_PROFILE_JUNCTION_PREVIEW" : "PHYSICAL_DEFAULT_PATH");
      assert.equal(sha(fixture.input), fixture.inputSha256);
      assert.equal(path.resolve(out), path.resolve(prep.sessionRoot));
      assert(path.resolve(out).startsWith("F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01\\"));
    }
    assert.equal(sha(this.exe), currentNative ? prep.executable.sha256
      : "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    this.capture = currentNative ? require("./current-native-capture.cjs")
      : { captureInstalledWebview, readInstalledViewport };
    this.expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  }
  async native(command, args = {}) {
    return this.page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  }
  saves() { return this.native("list_saves", { installId: this.installId }); }
  files() {
    const dir = this.storage.targetDirectory;
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith(".json")).sort()
      .map(name => ({ name, path: path.join(dir, name), sha256: sha(path.join(dir, name)), bytes: fs.statSync(path.join(dir, name)).size })) : [];
  }
  prefs() {
    return this.page.evaluate(id => JSON.parse(localStorage.getItem(`vn.runtime.settings.${id}`)), this.installId);
  }
  async viewport(expected) {
    this.expected = expected;
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: expected.width, height: expected.height,
      deviceScaleFactor: expected.dpr, mobile: false });
    await this.page.emulateMedia({ reducedMotion: expected.reduced ? "reduce" : "no-preference" });
    await this.capture.readInstalledViewport(this.page, expected);
  }
  async shot(name) {
    this.report.screenshots.push(await this.capture.captureInstalledWebview(this.page, this.cdp,
      path.join(this.out, `${this.layout}-${name}.png`), this.expected)); this.save();
  }
  async ready(screen) {
    await this.page.waitForFunction(s => {
      const n = document.querySelector("[data-runtime-screen-transition]");
      return n?.getAttribute("data-runtime-presented-screen") === s && n?.getAttribute("data-runtime-screen-transition") === "idle"
        && !document.querySelector('[data-testid="game-launch-blackout"]');
    }, screen);
    await settleRuntime(this.page);
  }
  async screen() {
    return this.page.locator("[data-runtime-screen-transition]").getAttribute("data-runtime-presented-screen");
  }
  async command(scene, index, done = true) {
    await this.page.waitForFunction(({ scene, index }) => {
      const n = document.querySelector('[data-testid="game-state-playing"]');
      return n?.getAttribute("data-current-scene-id") === scene && Number(n.getAttribute("data-current-command-index")) === index;
    }, { scene, index });
    if (done) await this.page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  }
  async newGame() {
    if (await this.screen() === "playing") { await this.page.keyboard.press("Escape"); await this.ready("main_menu"); }
    await this.page.getByTestId("start-new-game").click(); await this.ready("playing"); await this.command("qa_entry", 1);
  }
  async branch(name, scene) {
    await this.command("qa_entry", 1); await this.page.locator(".dialog-box").click();
    await this.page.getByRole("button", { name: `选择：${name}`, exact: true }).click();
    await this.command(scene, 0);
  }
  async openSettings() {
    const screen = await this.screen();
    if (screen === "playing" && this.layout === "renpy") await this.page.getByTestId("renpy-quick-settings").click();
    else {
      if (screen === "playing") { await this.page.keyboard.press("Escape"); await this.ready("main_menu"); }
      await this.page.getByTestId("open-settings").click();
    }
    await this.ready("settings");
  }
  async finishSettings() {
    await this.page.getByTestId("settings-finish").click();
    await this.page.waitForFunction(() => {
      const n = document.querySelector("[data-runtime-screen-transition]");
      return n?.getAttribute("data-runtime-screen-transition") === "idle"
        && ["playing", "main_menu", "title_menu"].includes(n.getAttribute("data-runtime-presented-screen"));
    });
    if (await this.screen() === "main_menu") {
      await this.page.getByTestId("continue-game").click(); await this.ready("playing");
    }
  }
  async system() {
    await this.page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    await this.page.locator('[data-settings-tab-current="system"]').waitFor();
  }
  async setAuto(enabled, instant = false) {
    await this.openSettings(); await this.system();
    const before = await this.page.getByRole("checkbox", { name: "自动存档", exact: true }).isChecked();
    await this.page.getByRole("checkbox", { name: "自动存档", exact: true }).setChecked(enabled);
    if (instant) {
      await this.page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
      await this.page.locator('[data-settings-tab-current="text"]').waitFor();
      await this.page.getByRole("slider", { name: "Text speed", exact: true }).focus();
      await this.page.keyboard.press("Home");
      assert.equal(await this.page.getByRole("slider", { name: "Text speed", exact: true }).inputValue(), "0");
    }
    await this.finishSettings(); assert.equal((await this.prefs()).autoSaveEnabled, enabled);
    return { before, after: await this.prefs() };
  }
  async start(layout, play = true) {
    assert(!this.child); this.layout = layout;
    const port = await new Promise(resolve => {
      const server = net.createServer(); server.listen(0, "127.0.0.1", () => {
        const p = server.address().port; server.close(() => resolve(p));
      });
    });
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(k)) delete env[k];
    env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
    if (this.currentNative) Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: this.prep.webview,
      TEMP: this.prep.temporary, TMP: this.prep.temporary });
    this.child = spawn(this.exe, ["--mode", "library"], {
      cwd: this.currentNative ? path.dirname(this.exe) : this.prep.installRoot, env, windowsHide: true, stdio: "ignore" });
    this.exited = new Promise(resolve => this.child.once("exit", resolve));
    this.identity = processIdentity(this.child.pid);
    assert(this.identity && path.resolve(this.identity.ExecutablePath).toLowerCase() === path.resolve(this.exe).toLowerCase());
    this.launch = { pid: this.child.pid, port, layout, installId: this.installId, identity: this.identity };
    if (this.currentNative) Object.assign(this.launch, {
      scope: this.prep.current1922Library ? "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_NOT_STANDALONE_ANDROID"
        : "CURRENT_NATIVE_NOT_RELEASE_INSTALL", executableSha256: sha(this.exe),
      webview: this.prep.webview, libraryStorage: this.prep.defaultStorage });
    this.report.launches.push(this.launch); this.save();
    let online = false; const deadline = Date.now() + 45000;
    while (Date.now() < deadline && this.child.exitCode === null) {
      try { online = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (online) break; await pause(100);
    }
    assert(online); this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    if (typeof this.resolveRuntimePage === "function") this.page = await this.resolveRuntimePage();
    else {
    this.page = this.browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(this.page);
    }
    this.page.setDefaultTimeout(20000);
    this.page.on("pageerror", e => this.report.pageErrors.push({ layout, error: String(e) }));
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await this.page.getByTestId("game-state-library").waitFor();
    const c = this.cartridges.find(c => c.layout === layout); assert.equal(sha(c.path), c.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(c.path)), m = JSON.parse(await zip.file("manifest.json").async("string"));
    const existing = (await this.native("list_installed_cartridges")).find(r => r.installId === this.installId);
    const before = await this.saves(), now = new Date().toISOString();
    const record = await this.native("import_cartridge_from_path", { sourcePath: c.path, record: {
      installId: this.installId, gameId: m.game_id, title: m.title, author: m.author, version: m.version,
      language: m.language, description: m.description, sourceFileName: path.basename(c.path),
      installedAt: existing?.installedAt || now, updatedAt: now, cartridgePath: existing?.cartridgePath || "" } });
    assert.equal(sha(record.cartridgePath), c.sha256); assert.deepEqual(await this.saves(), before);
    this.storage = await this.native("get_save_storage_info", { installId: this.installId });
    assert.equal(this.storage.portable, false);
    assert.equal(path.resolve(this.storage.targetDirectory),
      path.resolve(`C:/Users/1/AppData/Roaming/com.agentvn.player/saves/${this.installId}`));
    this.launch.library = { controlledPublicNativePreparation: true, record, savesBefore: before, storage: this.storage }; this.save();
    await this.page.reload({ waitUntil: "domcontentloaded" });
    // Titles are not identities. Map the native index's confirmed rendering
    // order to real buttons so two QA installations may share one title.
    const ordered = await this.native("list_installed_cartridges");
    await this.page.waitForFunction(count => document.querySelectorAll(".cartridge-spine").length === count, ordered.length);
    const actualTitles = await this.page.locator(".cartridge-spine strong").allTextContents();
    assert.deepEqual(actualTitles, ordered.map(r => r.title));
    const selectedIndex = ordered.findIndex(r => r.installId === this.installId); assert(selectedIndex >= 0);
    this.launch.library.selectedIndex = selectedIndex; this.launch.library.orderedInstallIds = ordered.map(r => r.installId); this.save();
    await this.page.locator(".cartridge-spine").nth(selectedIndex).click();
    await this.page.getByRole("button", { name: "启动卡带", exact: true }).click(); await this.ready("title_menu");
    if (play) await this.newGame();
  }
  async stop(nativeExit = false) {
    if (!this.child) return;
    if (nativeExit) {
      let timer;
      try { await Promise.race([this.exited, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Confirmed native window exit did not finish")), 20000);
      })]); } finally { clearTimeout(timer); }
    }
    await this.browser?.close().catch(() => {});
    this.browser = null; this.page = null; this.cdp = null;
    if (this.child.exitCode === null && this.child.signalCode === null) {
      assert.deepEqual(processIdentity(this.child.pid), this.identity);
      this.child.kill(); await this.exited;
    }
    let listening = true; const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try { await fetch(`http://127.0.0.1:${this.launch.port}/json/version`, { signal: AbortSignal.timeout(250) }); }
      catch { listening = false; break; } await pause(100);
    }
    assert(!processIdentity(this.launch.pid) && !listening);
    this.launch.cleanup = { status: "PASS", method: nativeExit ? "REAL_UI_CONFIRMED_NATIVE_DESTROY" : "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE" };
    this.child = null; this.identity = null; this.save();
  }
}
module.exports = { InstalledRuntimeSession, processIdentity, sha, pause };
