"use strict";
// Built Dev-resource Player in real native library mode, not installed acceptance.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { chromium } = require("../../editor/node_modules/playwright");
const JSZip = require("../../editor/node_modules/jszip");
const { rows, listeners, ps, until } = require("./current-native-editor-session.cjs");
const { ownedProcessTree } = require("./owned-process-tree.cjs");
const { stopOwnedProcess } = require("./owned-process-stop.cjs");
const { sha } = require("./installed-runtime-session.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./current-native-capture.cjs");
const { settleRuntime } = require("./installed-acceptance.cjs");
const { installActualVoiceObserver } = require("./voice-runtime-observer.cjs");
const { validateDevNarrativePreparation } = require("./dev-narrative-preparation.cjs");
class NarrativePlayer {
  constructor(prep, report, save, validatePreparation = validateDevNarrativePreparation) {
    validatePreparation(prep); Object.assign(this, { prep, report, save });
    this.known = new Map();
  }
  remember() {
    if (!this.child) return;
    const all = rows(), current = all.find(p => p.ProcessId === this.child.pid);
    if (!current || current.Created !== this.launch.identity.Created) return;
    assert.equal(path.resolve(current.ExecutablePath), path.resolve(this.prep.executable.path));
    for (const p of ownedProcessTree(all, current.ProcessId, current.Created)) {
      const key = `${p.ProcessId}:${p.Created}`, old = this.known.get(key);
      if (!p.ExecutablePath && old?.ExecutablePath) continue;
      this.known.set(key, p);
    }
    this.report.knownProcesses = [...this.known.values()]; this.save();
  }
  native(command, args = {}) {
    return this.page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  }
  saves() { return this.native("list_saves", { installId: this.installId }); }
  async ready(screen) {
    await this.page.waitForFunction(s => {
      const e = document.querySelector("[data-runtime-screen-transition]");
      return e?.getAttribute("data-runtime-presented-screen") === s &&
        e.getAttribute("data-runtime-screen-transition") === "idle" && !document.querySelector('[data-testid="game-launch-blackout"]');
    }, screen); await settleRuntime(this.page);
  }
  async metrics(viewport) {
    this.viewport = viewport;
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height,
      deviceScaleFactor: viewport.dpr, mobile: false });
    await this.page.emulateMedia({ reducedMotion: viewport.reduced ? "reduce" : "no-preference" });
    await readInstalledViewport(this.page, viewport);
  }
  async shot(name) {
    const result = await captureInstalledWebview(this.page, this.cdp,
      path.join(this.prep.sessionRoot, `${this.cell}-${name}.png`), this.viewport);
    this.report.screenshots.push(result); this.save(); return result;
  }
  async start({ layout, installId, cell, viewport, restart = false }) {
    assert(!this.child); Object.assign(this, { layout, installId, cell });
    const port = await new Promise(resolve => {
      const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
    assert.deepEqual(listeners([port]), []);
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(k)) delete env[k];
    Object.assign(env, { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: this.prep.webview, TEMP: this.prep.temporary, TMP: this.prep.temporary });
    this.child = spawn(this.prep.executable.path, ["--mode", "library"], {
      cwd: path.dirname(this.prep.executable.path), env, windowsHide: true, stdio: "ignore" });
    this.launch = { pid: this.child.pid, port, layout, installId, cell, restart,
      identity: rows().find(p => p.ProcessId === this.child.pid), executable: this.prep.executable };
    assert(this.launch.identity); assert.equal(path.resolve(this.launch.identity.ExecutablePath), path.resolve(this.prep.executable.path));
    this.report.launches.push(this.launch); this.remember();
    this.timer = setInterval(() => { try { this.remember(); } catch (e) {
      this.report.observerError = String(e.stack || e); this.save();
    } }, 3000);
    await until(async () => {
      assert.equal(this.child.exitCode, null);
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; }
      catch { return false; }
    }, "exact built Dev-resource Player WebView", 45000);
    this.remember();
    const listener = listeners([port]); assert.equal(listener.length, 1);
    assert([...this.known.values()].some(p => p.ProcessId === listener[0].OwningProcess));
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    this.page = this.browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost/.test(p.url())); assert(this.page);
    this.page.setDefaultTimeout(20000);
    this.page.on("pageerror", e => { this.report.pageErrors.push({ cell, error: String(e) }); this.save(); });
    await this.page.context().addInitScript(installActualVoiceObserver);
    await this.page.evaluate(installActualVoiceObserver);
    this.cdp = await this.page.context().newCDPSession(this.page); await this.metrics(viewport);
    await this.page.getByTestId("game-state-library").waitFor();
    const cartridge = this.prep.cartridges.find(c => c.layout === layout); assert.equal(sha(cartridge.path), cartridge.sha256);
    if (!restart) {
      const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path));
      const m = JSON.parse(await zip.file("manifest.json").async("string")), now = new Date().toISOString();
      assert(!(await this.native("list_installed_cartridges")).some(r => r.installId === installId));
      const record = await this.native("import_cartridge_from_path", { sourcePath: cartridge.path, record: {
        installId, gameId: m.game_id, title: m.title, author: m.author, version: m.version,
        language: m.language, sourceFileName: path.basename(cartridge.path), description: m.description,
        installedAt: now, updatedAt: now, cartridgePath: "",
      } });
      assert.equal(sha(record.cartridgePath), cartridge.sha256);
      this.launch.controlledPublicImport = record; this.save(); await this.page.reload({ waitUntil: "domcontentloaded" });
    }
    const ordered = await this.native("list_installed_cartridges"), index = ordered.findIndex(r => r.installId === installId);
    assert(index >= 0); assert.equal(sha(ordered[index].cartridgePath), cartridge.sha256);
    this.launch.persistedLibraryRecord = ordered[index]; this.save();
    await this.page.waitForFunction(n => document.querySelectorAll(".cartridge-spine").length === n, ordered.length);
    await this.page.locator(".cartridge-spine").nth(index).click();
    await this.page.getByRole("button", { name: "启动卡带", exact: true }).click(); await this.ready("title_menu");
    this.storage = await this.native("get_save_storage_info", { installId }); assert.equal(this.storage.portable, false);
    assert.equal(path.resolve(this.storage.targetDirectory),
      path.resolve(`C:/Users/1/AppData/Roaming/com.agentvn.player/saves/${installId}`));
    this.launch.storage = this.storage; this.save();
  }
  async stop() {
    if (!this.child) return;
    const alreadyExited = this.child.exitCode !== null || this.child.signalCode !== null;
    clearInterval(this.timer); this.remember();
    if (this.page) this.launch.voice = await this.page.evaluate(() => window.__QA_VOICE__).catch(() => null);
    await this.browser?.close().catch(() => {});
    for (const p of [...this.known.values()].reverse()) {
      if (rows().some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)) stopOwnedProcess(p, ps);
    }
    await until(() => !rows().some(p => this.known.has(`${p.ProcessId}:${p.Created}`)) &&
      listeners([this.launch.port]).length === 0, "owned Player identities and port gone", 15000);
    this.launch.cleanup = { status: "PASS", method: alreadyExited
      ? "PROCESS_ALREADY_EXITED_BEFORE_CLEANUP" : "OWNED_TERMINATION_NOT_NORMAL_CLOSE" };
    this.child = null; this.browser = null; this.page = null; this.cdp = null; this.save();
  }
}
module.exports = { NarrativePlayer };
