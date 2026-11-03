"use strict";
// Current native Dev only, isolated backend/WebView/TEMP; no Player profile moves.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Editor-Motion-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-editor-motion-20261020-01");
const input = path.join(qa, "当前Dev 工作区临时工程.vnproj");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: "wx" });
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"];
const tools = ["scripts/native-editor-motion-session.cjs", "scripts/native-editor-motion-playwright.cjs",
  "scripts/lib/installed-editor-motion-sampler.cjs", "scripts/lib/owned-process-tree.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/lib/native-editor-container-curve.cjs"];
const sources = ["editor/src/app/App.tsx", "editor/src/app/App.css", "editor/src/styles/layout.css",
  "editor/src/styles/variables.css", "editor/src/styles/editor-tokens.css",
  "editor/src/components/editor/EditorToolbar.tsx", "editor/src/components/advanced/AdvancedToolsPanel.tsx",
  "editor/src/components/common/GlassSelectionGroup.tsx"];
const pause = ms => new Promise(r => setTimeout(r, ms));
function ps(command) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + command],
  { encoding: "utf8", windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr); return r.stdout.replace(/^\uFEFF/, "").trim();
}
const processes = () => JSON.parse(ps("ConvertTo-Json -Depth 4 -Compress -InputObject @(" +
  "Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine," +
  "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"));
const identity = p => `${p.ProcessId}:${p.Created}`;
const listeners = ports => JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(" +
  `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}` +
  "|Select-Object LocalPort,OwningProcess)"));
async function port() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const n = s.address().port; s.close(e => e ? reject(e) : resolve(n)); }); });
}
async function until(fn, name, timeout = 60000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result; } catch (e) { last = String(e); }
    await pause(200);
  }
  throw Error(`Deadline ${name}: ${last || "condition false"}`);
}
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(2500) }); assert(r.ok); return r.json();
}
async function prepare() {
  for (const dir of [qa, checkpoint, summary]) { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  const snapshots = [];
  for (const f of [...tools, ...sources, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const target = path.join(checkpoint, f); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, f), target, fs.constants.COPYFILE_EXCL); snapshots.push(desc(target));
  }
  const project = fixture("native-editor-motion-20261020-01");
  project.title = "当前Dev 工作区与动效隔离回测";
  write(input, project);
  write(path.join(summary, "preparation.json"), { status: "PASS", at: new Date().toISOString(),
    products: products.map(f => desc(path.join(root, f))), sources: sources.map(f => desc(path.join(root, f))),
    snapshots, input: desc(input), productChanges: 0, builds: 0, modelRequests: 0 });
  console.log(`PASS prepared ${qa}`);
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, `session-${iteration}`), smoke = process.argv.includes("--smoke");
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const baseline = read(path.join(summary, "preparation.json"));
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_DEV_ISOLATED_MOTION_NOT_RELEASE_OR_PHYSICAL",
    smoke, products: baseline.products, sources: baseline.sources, tools: [],
    known: [], commands: [], modelRequests: 0, productChanges: 0,
    buildAccounting: { explicitBuildCommands: 0, devPublicationBuilds: 0,
      hostStartupPreviewBuild: "Dev startup invokes npm run build:gamecli-preview before serving frontend" },
    installs: 0, deviceOperations: 0 };
  for (const file of tools) {
    const target = path.join(out, path.basename(file));
    fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL); report.tools.push(desc(target));
  }
  const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(report, null, 2));
  let host, worker; const known = new Map();
  const ports = [await port(), await port(), 6767], [backendPort, cdpPort] = ports;
  const remember = () => {
    if (!host) return [];
    const tree = ownedProcessTree(processes(), host.pid, report.host.created);
    if (tree[0]) report.host.created = tree[0].Created;
    for (const p of tree) known.set(identity(p), p);
    report.known = [...known.values()]; save(); return tree;
  };
  try {
    for (const f of [...baseline.products, ...baseline.sources, baseline.input]) assert.equal(sha(f.path), f.sha256);
    assert.equal(baseline.products[0].sha256, baseline.products[1].sha256);
    assert(!processes().some(p => /^(AgentVN Dev|agentvn-editor)\.exe$/i.test(p.Name)), "Another Editor session is active");
    assert.equal(listeners(ports).length, 0, "Unknown service must not be reused");
    const data = path.join(out, "data"), webview = path.join(out, "webview"), temp = path.join(out, "temporary");
    fs.mkdirSync(path.join(data, "backend"), { recursive: true }); fs.mkdirSync(temp);
    write(path.join(data, "backend/database-migration-decision.json"), { approved: false, sources: [] });
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k)) delete env[k];
    Object.assign(env, { AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_PORT: String(backendPort),
      AGENTVN_LEGACY_DATABASE_PATHS: "", VITE_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
      WEBVIEW2_USER_DATA_FOLDER: webview, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
      TEMP: temp, TMP: temp, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out });
    const log = fs.openSync(path.join(out, "host.log"), "wx");
    host = spawn(baseline.products[0].path, [], { cwd: out, env, windowsHide: true, stdio: ["ignore", log, log] });
    fs.closeSync(log); report.host = { pid: host.pid, data, webview, temp }; save(); remember();
    await until(async () => { assert.equal(host.exitCode, null, "Owned Editor exited during readiness");
      return (await json(`http://127.0.0.1:${backendPort}/api/health`)).project_container_protocol >= 2; }, "auto backend");
    await until(() => json(`http://127.0.0.1:${cdpPort}/json/version`), "native WebView");
    // A WebView can exist while the owned frontend is still preparing Runtime
    // preview assets. Backend/CDP readiness alone does not imply Vite readiness.
    await until(() => {
      assert.equal(host.exitCode, null, "Owned Editor exited before frontend readiness");
      remember();
      return listeners(ports).length === 3;
    }, "all three owned services including frontend", 120000);
    const tree = remember();
    report.listeners = listeners(ports); assert.equal(report.listeners.length, 3);
    assert(report.listeners.every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
    assert(tree.some(p => p.Name === "msedgewebview2.exe" && p.CommandLine.includes(webview)));
    const prep = { scope: report.scope, run: out, smoke, fixture: { input, title: read(input).title, projects: [{ input }] },
      launch: { executable: baseline.products[0].path, executableSha256: baseline.products[0].sha256,
        backendUrl: `http://127.0.0.1:${backendPort}`, cdpPort } };
    const prepFile = path.join(out, "collector-preparation.json"); write(prepFile, prep);
    const command = { command: [process.execPath, "scripts/native-editor-motion-playwright.cjs", prepFile],
      at: new Date().toISOString(), status: "RUNNING" }; report.commands.push(command); save();
    const collectorLog = fs.openSync(path.join(out, "collector.log"), "wx");
    worker = spawn(process.execPath, command.command.slice(1), { cwd: root, env, windowsHide: true, stdio: ["ignore", collectorLog, collectorLog] });
    fs.closeSync(collectorLog); command.pid = worker.pid; save();
    command.exitCode = await new Promise((resolve, reject) => { worker.once("exit", resolve); worker.once("error", reject); });
    command.finishedAt = new Date().toISOString(); command.status = command.exitCode === 0 ? "PASS" : "FAILED"; save();
    assert.equal(command.exitCode, 0, `Collector failed: ${path.join(out, "collector.log")}`);
    const motion = read(path.join(out, "motion/report.json"));
    assert.equal(motion.status, "PASS"); assert.equal(motion.matrix.length, smoke ? 2 : 12);
    assert(motion.matrix.every(m => m.episodes.length === 16 && m.episodes.every(e => e.status === "PASS")));
    report.status = "CURRENT_NATIVE_EDITOR_MOTION_PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      remember();
      if (host && host.exitCode === null) {
        const owner = [...known.values()].find(p => p.ProcessId === host.pid && p.Created === report.host.created); assert(owner);
        const closed = ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${owner.ProcessId}';` +
          `if($p.CreationDate.ToUniversalTime().ToString('o') -ne '${owner.Created}'){throw 'PID reused'};` +
          `(Get-Process -Id ${owner.ProcessId}).CloseMainWindow()`);
        assert.equal(closed, "True"); report.closeMethod = "Process.CloseMainWindow WM_CLOSE_NOT_PHYSICAL";
        await until(() => host.exitCode !== null, "normal Editor shutdown", 30000);
      }
      await until(() => { const now = processes();
        return ![...known.values()].some(p => now.some(a => identity(a) === identity(p))); }, "natural descendant shutdown", 15000);
      report.normalExitCode = host?.exitCode;
    } catch (e) { report.closeError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    try {
      const killed = [];
      for (const p of [...known.values()].reverse()) {
        if (!processes().some(a => identity(a) === identity(p))) continue;
        ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
          `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
        killed.push(identity(p));
      }
      const now = processes(), survivors = [...known.values()].filter(p => now.some(a => identity(a) === identity(p)));
      report.cleanup = { killed, survivors, listeners: listeners(ports), ports };
      assert.equal(survivors.length, 0); assert.equal(report.cleanup.listeners.length, 0);
      for (const f of [...baseline.products, ...baseline.sources, baseline.input]) assert.equal(sha(f.path), f.sha256);
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, closeError: report.closeError,
      cleanupError: report.cleanupError }, null, 2));
  }
}
(async () => { if (process.argv[2] === "prepare") await prepare(); else await run(process.argv[2]); })()
  .catch(e => { console.error(e); process.exitCode = 1; });
