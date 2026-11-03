"use strict";
// Native WM_CLOSE via Process.CloseMainWindow, not physical input and not an
// installer/default-profile acceptance. No manually started backend in owned mode.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const [exeArg, outArg, portArg = "8431", cdpArg = "9431", mode = "owned", scenario = "normal"] = process.argv.slice(2);
assert(exeArg && outArg && ["owned", "reuse", "workspace"].includes(mode));
assert(["normal", "cancel"].includes(scenario));
const exe = path.resolve(exeArg), output = path.resolve(outArg);
assert(!fs.existsSync(output), "Fresh evidence directory required");
assert(output.toLowerCase().startsWith("f:\\agentvn\\qa\\host-lifecycle-20261019-01\\")
  || output.toLowerCase().startsWith(path.resolve(__dirname, "../output").toLowerCase() + path.sep));
fs.mkdirSync(output, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const port = Number(portArg), cdp = Number(cdpArg);
const ps = script => {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script],
    { encoding: "utf8", windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replace(/^\uFEFF/, "").trim();
};
const processes = () => JSON.parse(ps(
  "ConvertTo-Json -Depth 4 -Compress -InputObject @(Get-CimInstance Win32_Process | " +
  "Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine," +
  "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"));
const identity = row => `${row.ProcessId}:${row.Created}`;
const same = (a, b) => identity(a) === identity(b);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(250); }
  throw Error(`Timeout: ${label}`);
}
async function json(url) {
  try { const res = await fetch(url, { signal: AbortSignal.timeout(1500) }); return res.ok ? await res.json() : null; }
  catch { return null; }
}
const report = { status: "RUNNING", at: new Date().toISOString(), exe, exeSha256: sha(exe),
  mode, scenario, port, cdp, physicalInputVerified: false,
  method: "Windows Process.CloseMainWindow (WM_CLOSE), not physical input",
  scope: "isolated native host lifecycle; not installed/default-profile/upgrade acceptance", assertions: [] };
let host, external, browser;
let known = [];
const runtime = path.join("F:/AgentVN/QA/Host-Lifecycle-20261019-01", path.basename(output));
assert(!fs.existsSync(runtime), "Fresh isolated runtime directory required");
const data = path.join(runtime, "data"), webview = path.join(runtime, "webview");
report.runtime = runtime;
fs.mkdirSync(path.join(data, "backend"), { recursive: true });
const testProject = path.join(runtime, "退出清理 隔离小工程.vnproj");
fs.writeFileSync(testProject, JSON.stringify(fixture(`host-lifecycle-${path.basename(output)}`)), { flag: "wx" });
report.testProject = { path: testProject, opened: false, reason: "Host lifecycle only; no project mutations" };
// Explicit test policy declines legacy DB import; never inspects/copies user DB.
fs.writeFileSync(path.join(data, "backend/database-migration-decision.json"),
  JSON.stringify({ approved: false, sources: [] }), { flag: "wx" });
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/.test(key)) delete env[key];
Object.assign(env, { AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_PORT: String(port),
  AGENTVN_TEST_PROJECT: testProject, AGENTVN_WORKSPACE_OUTPUT: output,
  WEBVIEW2_USER_DATA_FOLDER: webview,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdp}` });
if (mode === "workspace") env.AGENTVN_WORKSPACE_ROOT = path.resolve(__dirname, "..");
function check(condition, name, detail) {
  report.assertions.push({ name, status: condition ? "PASS" : "FAILED", detail });
}
function rememberTree(rows, rootPid) {
  const ids = new Set([rootPid]);
  let added = true;
  while (added) {
    added = false;
    for (const row of rows) if (ids.has(row.ParentProcessId) && !ids.has(row.ProcessId)) {
      ids.add(row.ProcessId); added = true;
    }
  }
  const tree = rows.filter(row => ids.has(row.ProcessId));
  for (const row of tree) if (!known.some(item => same(row, item))) known.push(row);
  return tree;
}
(async () => {
  assert.equal(await json(`http://127.0.0.1:${port}/api/health`), null, "Backend port occupied");
  assert.equal(await json(`http://127.0.0.1:${cdp}/json/version`), null, "CDP port occupied");
  assert.equal(ps(`(@(Get-NetTCPConnection -State Listen -LocalPort ${port},${cdp} -ErrorAction SilentlyContinue)).Count`), "0");
  if (mode === "workspace") assert.equal(ps(
    "(@(Get-NetTCPConnection -State Listen -LocalPort 6767 -ErrorAction SilentlyContinue)).Count"), "0",
  "Do not reuse someone else's Vite");
  if (mode === "reuse") {
    const externalData = path.join(runtime, "external");
    fs.mkdirSync(externalData);
    const backendExe = path.join(path.dirname(exe), "creator-backend.exe");
    external = spawn(backendExe, [], { cwd: path.dirname(exe), windowsHide: true, stdio: "ignore",
      env: { ...env, DATABASE_PATH: path.join(externalData, "vn_engine.db"),
        AGENTVN_BACKEND_DATA_DIR: externalData, AGENTVN_WORKSPACE_ROOT: externalData } });
    await until(() => json(`http://127.0.0.1:${port}/api/health`), "external backend health");
    report.externalTree = rememberTree(processes(), external.pid);
  }
  host = spawn(exe, [], { cwd: path.dirname(exe), env, windowsHide: true, stdio: "ignore" });
  host.on("error", error => { report.spawnError = String(error); });
  report.hostPid = host.pid;
  const health = await until(() => json(`http://127.0.0.1:${port}/api/health`), "auto-start backend");
  assert(health.project_container_protocol >= 2);
  await until(() => json(`http://127.0.0.1:${cdp}/json/version`), "owned WebView CDP");
  report.beforeTree = rememberTree(processes(), host.pid);
  const backendTree = report.beforeTree.filter(row => /creator-backend\.exe$/i.test(row.ExecutablePath || ""));
  check(mode === "owned" ? backendTree.length >= 2 : backendTree.length === 0,
    mode === "workspace" ? "Dev uses workspace launch chain, not packaged backend" : "real PyInstaller ownership chain",
    backendTree);
  report.listenerPid = Number(ps(`(Get-NetTCPConnection -State Listen -LocalPort ${port} | ` +
    "Select-Object -First 1).OwningProcess"));
  const expectedTree = mode === "owned" ? backendTree
    : mode === "workspace" ? report.beforeTree : report.externalTree;
  check(expectedTree.some(row => row.ProcessId === report.listenerPid),
    "backend listener belongs to recorded tree", report.listenerPid);
  report.backendChain = [];
  let ancestor = expectedTree.find(row => row.ProcessId === report.listenerPid);
  while (ancestor && ancestor.ProcessId !== host.pid) {
    report.backendChain.push(ancestor);
    ancestor = expectedTree.find(row => row.ProcessId === ancestor.ParentProcessId);
  }
  if (mode === "workspace") check(expectedTree.some(row => row.ProcessId === report.listenerPid
    && /python(?:w)?\.exe$/i.test(row.ExecutablePath || "")),
  "real Python backend owns Dev listener");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`);
  const page = await until(() => browser.contexts()[0].pages()
    .find(p => p.url().includes(mode === "workspace" ? "127.0.0.1:6767" : "tauri.localhost")),
  "native page ready");
  assert(page, "Real native bundled WebView missing");
  await until(() => page.title().then(title => title.includes("AgentVN")), "frontend document title");
  if (mode === "workspace") {
    report.beforeTree = rememberTree(processes(), host.pid);
    report.frontendListenerPid = Number(ps(
      "(Get-NetTCPConnection -State Listen -LocalPort 6767 | Select-Object -First 1).OwningProcess"));
    check(report.beforeTree.some(row => row.ProcessId === report.frontendListenerPid),
      "actual Vite listener belongs to host tree", report.frontendListenerPid);
  }
  report.page = await page.evaluate(() => ({ url: location.href, title: document.title,
    viewport: [innerWidth, innerHeight], dpr: devicePixelRatio }));
  const screenshot = path.join(runtime, "native-before-close.png");
  await page.screenshot({ path: screenshot });
  const png = fs.readFileSync(screenshot);
  report.screenshot = { path: screenshot, sha256: sha(screenshot),
    pixels: [png.readUInt32BE(16), png.readUInt32BE(20)] };
  check(report.screenshot.pixels.every((value, index) =>
    value === Math.round(report.page.viewport[index] * report.page.dpr)),
  "actual native screenshot dimensions match viewport/DPR");
  if (scenario === "cancel") {
    report.controlledBoundary = "Test-only native close-request listener prevents first close; no save UI claim";
    const listenerId = await page.evaluate(async () => {
      window.__hostLifecycleCloseObserved = 0;
      const handler = window.__TAURI_INTERNALS__.transformCallback(() => { window.__hostLifecycleCloseObserved++; });
      return window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
        event: "tauri://close-requested", target: { kind: "Window", label: "main" }, handler,
      });
    });
    assert.equal(ps(`(Get-Process -Id ${host.pid} -ErrorAction Stop).CloseMainWindow()`), "True");
    await until(() => page.evaluate(() => window.__hostLifecycleCloseObserved > 0),
      "actual close request reached listener", 15000);
    const cancelRows = processes();
    report.afterCancelledClose = {
      health: await json(`http://127.0.0.1:${port}/api/health`),
      survivingOwned: report.beforeTree.filter(item => cancelRows.some(row => same(item, row))),
    };
    check(report.afterCancelledClose.survivingOwned.some(row => row.ProcessId === host.pid),
      "cancelled close leaves actual host alive");
    check(!!report.afterCancelledClose.health, "cancelled close leaves backend healthy");
    check(report.backendChain.every(item => cancelRows.some(row => same(item, row))),
      "cancelled close preserves entire backend ownership chain");
    await page.evaluate(async eventId => {
      window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener("tauri://close-requested", eventId);
      await window.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", { event: "tauri://close-requested", eventId });
    }, listenerId);
  }
  const closed = page.waitForEvent("close", { timeout: 20000 });
  closed.catch(() => {});
  const closeResult = ps(`$p=Get-Process -Id ${host.pid} -ErrorAction Stop; ` +
    "if($p.MainWindowHandle -eq 0){throw 'Native window handle missing'}; $p.CloseMainWindow()");
  report.nativeCloseResult = closeResult;
  assert.equal(closeResult, "True", "Native window close request was not accepted");
  await closed;
  await until(() => host.exitCode !== null || host.signalCode !== null, "host normal exit", 20000);
  // Bounded observation after genuine host exit, not a fake timeout-based close.
  await sleep(1200);
  const after = processes();
  report.survivors = known.filter(item => after.some(row => same(item, row)));
  report.backendAfterClose = await json(`http://127.0.0.1:${port}/api/health`);
  check(!after.some(row => row.ProcessId === host.pid && known.some(item => same(item, row))),
    "host exited normally", { exitCode: host.exitCode });
  if (mode !== "reuse") {
    check(!report.survivors.length, "all owned descendants exited", report.survivors);
    check(!report.backendAfterClose, "owned backend listener released");
    if (mode === "workspace") check(ps(
      "(@(Get-NetTCPConnection -State Listen -LocalPort 6767 -ErrorAction SilentlyContinue)).Count") === "0",
    "owned Vite listener released");
  } else {
    check(!report.beforeTree.some(item => after.some(row => same(item, row))),
      "reusing host and WebView exited without affecting external backend");
    check(!!report.backendAfterClose, "reused external backend remains healthy");
    check(report.externalTree.every(item => after.some(row => same(item, row))), "external identity unchanged");
  }
  report.status = report.assertions.every(row => row.status === "PASS") ? "PASS" : "FAILED";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); })
  .finally(async () => {
    await browser?.close().catch(() => {});
    // Record before cleanup; cleanup cannot turn a product failure into PASS.
    report.cleanup = [];
    try {
      let rows = processes();
      for (const child of [host, external].filter(Boolean)) rememberTree(rows, child.pid);
      for (const item of [...known].reverse()) {
        const current = processes().find(row => same(row, item));
        if (!current) continue;
        assert(current.ProcessId !== process.pid);
        const created = current.Created.replaceAll("'", "''");
        ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${current.ProcessId}'; ` +
          `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${created}') { ` +
          `Stop-Process -Id ${current.ProcessId} -Force -ErrorAction Stop }`);
        report.cleanup.push(identity(current));
      }
      rows = processes();
      report.cleanupSurvivors = known.filter(item => rows.some(row => same(row, item)));
      assert.equal(report.cleanupSurvivors.length, 0, "Owned processes left after cleanup");
    } catch (error) { report.cleanupError = String(error.stack || error); report.status = "FAILED"; }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  });
