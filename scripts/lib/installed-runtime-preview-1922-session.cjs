"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), net = require("node:net");
const { chromium } = require("../../editor/node_modules/playwright");
const { InstalledRuntimeSession, sha } = require("./installed-runtime-session.cjs");
const { rows, ps, until, listeners } = require("./current-native-editor-session.cjs");
const { ownedProcessTree } = require("./owned-process-tree.cjs");
const { stopOwnedProcess } = require("./owned-process-stop.cjs");
function previewProfileDirectory(out, layout, sharedProfile = undefined) {
  assert(["agentvn", "renpy"].includes(layout));
  if (sharedProfile !== undefined)
    assert(typeof sharedProfile === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(sharedProfile),
      "Explicit preview profile must be a local QA directory name");
  return path.join(out, `webview-${sharedProfile ?? layout}`);
}
class InstalledPreview1922Session extends InstalledRuntimeSession {
  remember() {
    if (!this.child || !this.identity) return;
    for (const r of ownedProcessTree(rows(), this.child.pid, this.identity.Created))
      this.known.set(`${r.ProcessId}:${r.Created}`, r);
    this.launch.knownProcesses = [...this.known.values()]; this.save();
  }
  async start(layout) {
    this.layout = layout; this.known = new Map();
    const c = this.cartridges.find(c => c.layout === layout); assert.equal(sha(c.path), c.sha256);
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer(); server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(e => e ? reject(e) : resolve(p)); });
    });
    assert.deepEqual(listeners([port]), []);
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(k)) delete env[k];
    const webview = previewProfileDirectory(this.out, layout, this.prep.previewWebviewProfile);
    Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: webview,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      TEMP: this.prep.temporary, TMP: this.prep.temporary });
    this.child = spawn(this.exe, ["--mode", "preview", "--cartridge", c.path], {
      cwd: path.dirname(this.exe), env, windowsHide: true, stdio: "ignore" });
    this.launch = { port, pid: this.child.pid, layout, scope: "CURRENT_NATIVE_NOT_RELEASE_INSTALL",
      provenance: "ACTUAL_1922_NSIS_SHIPPED_PLAYER_PREVIEW_NOT_STANDALONE", executableSha256: sha(this.exe),
      webview };
    this.report.launches.push(this.launch); this.save();
    await until(() => {
      this.identity = rows().find(p => p.ProcessId === this.child.pid);
      return this.identity;
    }, "owned current shipped Player");
    assert.equal(path.resolve(this.identity.ExecutablePath), path.resolve(this.exe));
    this.launch.identity = this.identity; this.remember();
    await until(async () => {
      assert.equal(this.child.exitCode, null); this.remember();
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(700) })).ok; }
      catch { return false; }
    }, "owned actual Player WebView", 45000);
    assert(listeners([port]).every(p => [...this.known.values()].some(r => r.ProcessId === p.OwningProcess)));
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    this.page = this.browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost"));
    assert(this.page); this.page.setDefaultTimeout(15000);
    this.page.on("pageerror", e => { this.report.pageErrors.push({ layout, error: String(e) }); this.save(); });
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await this.ready("title_menu");
  }
  async stop() {
    if (!this.child) return;
    this.remember(); await this.browser?.close().catch(() => {});
    for (const r of [...this.known.values()].reverse()) stopOwnedProcess(r, ps);
    await until(() => !rows().some(r => this.known.has(`${r.ProcessId}:${r.Created}`))
      && !listeners([this.launch.port]).length, "owned preview cleanup", 15000);
    this.launch.cleanup = { status: "PASS", method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE" };
    this.child = null; this.save();
  }
}
module.exports = { InstalledPreview1922Session, previewProfileDirectory };
