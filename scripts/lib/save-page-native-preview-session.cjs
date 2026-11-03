"use strict";
// Independent receipt-bound QA session. Keep opening's previously hashed
// session unchanged so its recorded tools remain reproducible.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { chromium } = require("../../editor/node_modules/playwright");
const { rows, listeners, until, ps } = require("./current-native-editor-session.cjs");
const { ownedProcessTree } = require("./owned-process-tree.cjs");
const { stopOwnedProcess } = require("./owned-process-stop.cjs");
const { sha } = require("./installed-runtime-session.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./current-native-capture.cjs");
const { savePageNativeBuildEvidence } = require("./save-page-native-build-evidence.cjs");
async function savePageNativePreview({ buildFile, out, report, save, viewport, input, layout }) {
  const { executable, receipt } = savePageNativeBuildEvidence(buildFile, out);
  assert.equal(path.dirname(path.resolve(input)), path.resolve(out)); assert(fs.existsSync(input));
  assert(!rows().some(p => p.Name === "agentvn-player.exe"), "Do not share a live Player");
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer(); socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const value = socket.address().port; socket.close(error => error ? reject(error) : resolve(value));
    });
  });
  assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(key)) delete env[key];
  const temporary = path.join(out, `temporary-${layout}`); fs.mkdirSync(temporary);
  Object.assign(env, {
    WEBVIEW2_USER_DATA_FOLDER: path.join(out, `webview-${layout}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_WORKSPACE_OUTPUT: out, AGENTVN_TEST_PROJECT: input, TEMP: temporary, TMP: temporary,
  });
  const child = spawn(executable.path, ["--mode", "preview"],
    { cwd: path.dirname(executable.path), env, windowsHide: true, stdio: "ignore" });
  const launch = { layout, pid: child.pid, port, executable, receipt, mode: "preview",
    normalCloseClaimed: false, isolation: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out } };
  report.launches.push(launch);
  const known = new Map();
  let browser, cdp, page, currentViewport = viewport;
  function remember() {
    const tree = ownedProcessTree(rows(), child.pid, launch.identity?.Created);
    if (tree.length) {
      assert.equal(path.resolve(tree[0].ExecutablePath), path.resolve(executable.path));
      launch.identity ??= tree[0];
    }
    for (const p of tree) known.set(`${p.ProcessId}:${p.Created}`, p);
    launch.knownProcesses = [...known.values()]; save();
  }
  async function close() {
    remember(); await browser?.close().catch(() => {});
    const killed = [];
    for (const p of [...known.values()].reverse()) {
      if (!rows().some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)) continue;
      stopOwnedProcess(p, ps); killed.push(`${p.ProcessId}:${p.Created}`);
    }
    await until(() => !rows().some(n => known.has(`${n.ProcessId}:${n.Created}`))
      && listeners([port]).length === 0, "save-page owned cleanup", 15000);
    launch.cleanup = { status: "PASS", killed, normalCloseClaimed: false };
    assert.equal(sha(executable.path), executable.sha256); save();
  }
  async function setViewport(value) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: value.width, height: value.height, deviceScaleFactor: value.dpr, mobile: false,
    });
    await page.emulateMedia({ reducedMotion: value.reduced ? "reduce" : "no-preference" });
    currentViewport = value;
    return readInstalledViewport(page, value);
  }
  try {
    remember();
    await until(async () => {
      assert.equal(child.exitCode, null);
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`,
        { signal: AbortSignal.timeout(700) })).ok; } catch { return false; }
    }, "save-page native WebView", 45000);
    remember();
    const socket = listeners([port]); assert.equal(socket.length, 1);
    assert([...known.values()].some(p => p.ProcessId === socket[0].OwningProcess));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const diagnostic = await browser.newBrowserCDPSession();
    const { gpu } = await diagnostic.send("SystemInfo.getInfo");
    launch.renderer = { features: gpu.featureStatus, devices: gpu.devices, renderer: gpu.auxAttributes.glRenderer };
    assert.equal(gpu.featureStatus.gpu_compositing, "enabled");
    await diagnostic.detach();
    page = await until(() => browser.contexts().flatMap(c => c.pages())
      .find(p => /tauri\.localhost/.test(p.url())), "save-page native page");
    cdp = await page.context().newCDPSession(page);
    await setViewport(viewport);
    return { page, close, setViewport, shot: file => captureInstalledWebview(page, cdp, file, currentViewport) };
  } catch (error) {
    try { await close(); } catch (cleanup) { launch.cleanupError = String(cleanup.stack || cleanup); save(); }
    throw error;
  }
}
module.exports = { savePageNativePreview };
