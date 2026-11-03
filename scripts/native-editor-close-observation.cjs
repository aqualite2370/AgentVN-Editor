"use strict";
// Read-only native/WebView observations; never send WM_CLOSE or bypass ACL.
// A human can close the isolated window. Timeout is NOT a product failure.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Editor-Close-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-editor-close-20261020-01");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = relative => {
  const file = path.resolve(root, relative);
  return { path: file, sha256: sha(file), bytes: fs.statSync(file).size };
};
const writeNew = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), { flag: "wx" });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const productFiles = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"];
const sourceFiles = ["editor/src-tauri/src/main.rs", "editor/src-tauri/src/owned_process.rs",
  "editor/src-tauri/capabilities/default.json", "editor/src/app/App.tsx"];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function ps(command) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + command],
  { encoding: "utf8", timeout: 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.replace(/^\uFEFF/, "").trim();
}
const rows = () => JSON.parse(ps("ConvertTo-Json -Depth 4 -Compress -InputObject @(" +
  "Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine," +
  "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"));
const identity = p => `${p.ProcessId}:${p.Created}`;
const listeners = ports => JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(" +
  `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}` +
  "|Select-Object LocalPort,OwningProcess)"));
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
  });
}
async function until(fn, name, timeout = 90000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { if (await fn()) return; } catch (e) { last = String(e); }
    await sleep(300);
  }
  throw Error(`Timeout ${name}: ${last || "not ready"}`);
}
async function prepare() {
  for (const dir of [qa, checkpoint, summary]) {
    assert(!fs.existsSync(dir), "Never overwrite evidence"); fs.mkdirSync(dir, { recursive: true });
  }
  const files = ["scripts/native-editor-close-observation.cjs", "scripts/native-editor-motion-session.cjs",
    "scripts/lib/owned-process-tree.cjs", "scripts/lib/current-native-capture.cjs",
    ...sourceFiles, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"];
  const snapshots = [];
  for (const f of files) {
    const target = path.join(checkpoint, f); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, f), target, fs.constants.COPYFILE_EXCL);
    snapshots.push({ path: target, sha256: sha(target) });
  }
  writeNew(path.join(summary, "preparation.json"), {
    status: "PASS", at: new Date().toISOString(), products: productFiles.map(desc),
    sources: sourceFiles.map(desc), snapshots,
    computerUse: { at: "2026-10-20T08:13:50.973Z", operation: "sky.list_apps", inputs: 0,
      error: "Computer Use native pipe unavailable; os error 2" },
    apiBoundary: "Existing core:default lacks allow-close; do not edit permissions or call destroy.",
  });
  console.log(`PREPARED ${qa}`);
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, `session-${iteration}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = read(path.join(summary, "preparation.json"));
  const input = path.join(out, "关闭观察 隔离小工程.vnproj");
  writeNew(input, fixture(`close-observation-${iteration}-20261020`));
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_DEV_READ_ONLY_CLOSE_OBSERVATION_NOT_INSTALLED_OR_AUTOMATED_PHYSICAL_INPUT",
    products: prep.products, sources: prep.sources, tool: desc("scripts/native-editor-close-observation.cjs"),
    project: { path: input, opened: false }, known: [], observations: [], physicalInputVerified: false,
    paidRequests: 0, productChanges: 0, devPublicationBuilds: 0,
    buildAccounting: "Dev startup itself invokes GameCLI preview build; not a zero-build launch.",
    apiCloseInvocations: 0, nativeInputInvocations: 0 };
  const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(report, null, 2));
  const known = new Map(), ports = [await freePort(), await freePort(), 6767];
  let host, browser, page;
  function remember() {
    const now = rows();
    if (host) {
      const tree = ownedProcessTree(now, host.pid, report.host.created);
      if (tree[0]) report.host.created = tree[0].Created;
      for (const p of tree) known.set(identity(p), p);
      report.known = [...known.values()];
    }
    return now;
  }
  try {
    for (const f of [...prep.products, ...prep.sources]) assert.equal(sha(f.path), f.sha256);
    assert.equal(prep.products[0].sha256, prep.products[1].sha256);
    assert(!rows().some(p => /^(AgentVN Dev|agentvn-editor)\.exe$/i.test(p.Name)), "Another Editor is active");
    assert.equal(listeners(ports).length, 0, "Unknown service must not be reused");
    const data = path.join(out, "data"), webview = path.join(out, "webview"), temporary = path.join(out, "temporary");
    fs.mkdirSync(path.join(data, "backend"), { recursive: true }); fs.mkdirSync(temporary);
    writeNew(path.join(data, "backend/database-migration-decision.json"), { approved: false, sources: [] });
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k)) delete env[k];
    Object.assign(env, { AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_PORT: String(ports[0]),
      AGENTVN_LEGACY_DATABASE_PATHS: "", VITE_BACKEND_URL: `http://127.0.0.1:${ports[0]}`,
      WEBVIEW2_USER_DATA_FOLDER: webview, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${ports[1]}`,
      TEMP: temporary, TMP: temporary, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out });
    const log = fs.openSync(path.join(out, "host.log"), "wx");
    host = spawn(prep.products[0].path, [], { cwd: out, env, windowsHide: true, stdio: ["ignore", log, log] });
    fs.closeSync(log); report.host = { pid: host.pid, data, webview, temporary }; save(); remember();
    await until(() => {
      assert.equal(host.exitCode, null, "Editor exited during readiness");
      remember();
      return listeners(ports).length === 3;
    }, "three owned services", 120000);
    report.listeners = listeners(ports);
    assert(report.listeners.every(l => [...known.values()].some(p => p.ProcessId === l.OwningProcess)));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${ports[1]}`);
    await until(() => {
      page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith("http://127.0.0.1:6767"));
      return Boolean(page);
    }, "owned native page");
    await page.locator(".project-home").waitFor({ timeout: 30000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    report.window = await page.evaluate(async () => {
      const api = await import("/node_modules/@tauri-apps/api/window.js");
      const current = api.getCurrentWindow();
      return { current: current.label, title: await current.title(), visible: await current.isVisible(),
        labels: (await api.getAllWindows()).map(w => w.label), url: location.href };
    });
    assert.equal(report.window.current, "main"); assert.equal(report.window.visible, true);
    report.screenshot = await captureInstalledWebview(page, cdp, path.join(out, "before-close.png"),
      { width: 1920, height: 1080, dpr: 1, reduced: false });
    report.request = { method: "Await human title-bar close; no synthetic input", requestedAt: new Date().toISOString(),
      title: report.window.title, ownerPid: host.pid, expectedWindowLabel: "main", timeoutMs: 90000 };
    save();
    console.log(`READY_FOR_MANUAL_CLOSE pid=${host.pid} title=${report.window.title}; observing for 90 seconds.`);
    const deadline = Date.now() + report.request.timeoutMs;
    while (Date.now() < deadline) {
      const now = remember(), live = now.some(p => identity(p) === `${host.pid}:${report.host.created}`);
      const native = live ? JSON.parse(ps(`$p=Get-Process -Id ${host.pid} -ErrorAction Stop;` +
        "$p|Select-Object Id,MainWindowTitle,@{n='MainWindowHandle';e={$_.MainWindowHandle.ToInt64()}},Responding|ConvertTo-Json -Compress")) : null;
      report.observations.push({ at: new Date().toISOString(), nodeExitCode: host.exitCode, rootLive: live,
        native, ownedAlive: [...known.values()].filter(p => now.some(a => identity(a) === identity(p))).map(identity) });
      save();
      if (!live) {
        await until(() => host.exitCode !== null, "Node exit observation", 10000);
        report.status = host.exitCode === 0 ? "OBSERVED_NORMAL_EXIT_INPUT_ORIGIN_UNVERIFIED" : "FAILED_NONZERO_EXIT";
        report.exitCode = host.exitCode; break;
      }
      await sleep(600);
    }
    if (report.status === "RUNNING") report.status = "BLOCKED_NO_MANUAL_CLOSE_OBSERVED";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    await browser?.close().catch(() => {});
    try {
      remember();
      const killed = [];
      for (const p of [...known.values()].reverse()) {
        if (!rows().some(a => identity(a) === identity(p))) continue;
        ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
          `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
        killed.push(identity(p));
      }
      const now = rows();
      report.cleanup = { killed, survivors: [...known.values()].filter(p => now.some(a => identity(a) === identity(p))),
        ports, listeners: listeners(ports) };
      assert.equal(report.cleanup.survivors.length, 0); assert.equal(report.cleanup.listeners.length, 0);
      for (const f of [...prep.products, ...prep.sources]) assert.equal(sha(f.path), f.sha256);
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
(async () => {
  if (process.argv[2] === "prepare") await prepare();
  else await run(process.argv[2]);
})().catch(e => { console.error(e); process.exitCode = 1; });
