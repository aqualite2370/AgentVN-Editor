"use strict";
// Actual installed bundled Player in its public preview launch mode. No Vite,
// source UI, substitute runtime, store mutations or native-result mocks.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { chromium } = require("../../editor/node_modules/playwright");
const { rows, listeners, until, ps } = require("./current-native-editor-session.cjs");
const { ownedProcessTree } = require("./owned-process-tree.cjs");
const { stopOwnedProcess } = require("./owned-process-stop.cjs");
const { sha } = require("./installed-runtime-session.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./current-native-capture.cjs");
const { openingNativeBuildEvidence } = require("./opening-native-build-evidence.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
async function installedOpeningPreview({ installationFile, nativeBuildFile, out, report, save, viewport, index, input }) {
  assert(!(installationFile && nativeBuildFile));
  let executable, buildReceipt;
  if (nativeBuildFile) {
    ({ executable, receipt: buildReceipt } = openingNativeBuildEvidence(nativeBuildFile, out));
  } else {
  assert.equal(path.resolve(installationFile),
    path.resolve("F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json"));
  assert.equal(path.dirname(path.resolve(out)),
    path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
  assert.match(path.basename(out), /^opening-installed-1923-\d{2}$/);
  assert.equal(path.dirname(path.resolve(input)), path.resolve(out));
  assert(fs.existsSync(input));
  const installation = read(installationFile);
  assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, "1.9.23");
  executable = installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
  }
  assert.equal(path.dirname(path.resolve(input)), path.resolve(out));
  assert(fs.existsSync(input));
  assert(executable); assert.equal(sha(executable.path), executable.sha256);
  assert(!rows().some(p => p.Name === "agentvn-player.exe"), "Do not share a live Player");
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
  });
  assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(k)) delete env[k];
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary, { recursive: true });
  Object.assign(env, {
    WEBVIEW2_USER_DATA_FOLDER: path.join(out, `webview-${index}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_WORKSPACE_OUTPUT: out, AGENTVN_TEST_PROJECT: input, TEMP: temporary, TMP: temporary,
  });
  const child = spawn(executable.path, ["--mode", "preview"], {
    cwd: path.dirname(executable.path), env, windowsHide: true, stdio: "ignore",
  });
  const known = new Map();
  const launch = { pid: child.pid, port, executable, buildReceipt, mode: "preview", index, viewport,
    normalCloseClaimed: false, isolation: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out } };
  (report.launches ??= []).push(launch);
  let browser, cdp, page;
  const remember = () => {
    const tree = ownedProcessTree(rows(), child.pid, launch.identity?.Created);
    if (tree.length) assert.equal(path.resolve(tree[0].ExecutablePath), path.resolve(executable.path));
    if (tree.length && !launch.identity) launch.identity = tree[0];
    for (const p of tree) known.set(`${p.ProcessId}:${p.Created}`, p);
    launch.knownProcesses = [...known.values()]; save();
  };
  async function close() {
    remember(); await browser?.close().catch(() => {});
    const killed = [];
    for (const p of [...known.values()].reverse()) {
      if (!rows().some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)) continue;
      stopOwnedProcess(p, ps); killed.push(`${p.ProcessId}:${p.Created}`);
    }
    await until(() => !rows().some(n => known.has(`${n.ProcessId}:${n.Created}`))
      && listeners([port]).length === 0, "installed opening owned cleanup", 15000);
    launch.cleanup = { status: "PASS", killed, normalCloseClaimed: false };
    assert.equal(sha(executable.path), executable.sha256); save();
  }
  try {
    remember();
    await until(async () => {
      assert.equal(child.exitCode, null);
      try {
        return (await fetch(`http://127.0.0.1:${port}/json/version`,
          { signal: AbortSignal.timeout(700) })).ok;
      } catch { return false; }
    }, "installed opening WebView", 45000);
    remember();
    const socket = listeners([port]); assert.equal(socket.length, 1);
    assert([...known.values()].some(p => p.ProcessId === socket[0].OwningProcess));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const browserDiagnostic = await browser.newBrowserCDPSession();
    const { gpu } = await browserDiagnostic.send("SystemInfo.getInfo");
    launch.renderer = { features: gpu.featureStatus, devices: gpu.devices, renderer: gpu.auxAttributes.glRenderer };
    await browserDiagnostic.detach();
    page = await until(() => browser.contexts().flatMap(c => c.pages())
      .find(p => /tauri\.localhost/.test(p.url())), "installed opening page");
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.dpr, mobile: false,
    });
    await page.emulateMedia({ reducedMotion: viewport.reduced ? "reduce" : "no-preference" });
    await readInstalledViewport(page, viewport);
    return { page, close, shot: file => captureInstalledWebview(page, cdp, file, viewport) };
  } catch (error) {
    try { await close(); } catch (cleanup) { launch.cleanupError = String(cleanup.stack || cleanup); save(); }
    throw error;
  }
}
module.exports = { installedOpeningPreview };
