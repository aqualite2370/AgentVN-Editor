"use strict";
// Actual retained legacy backend versus actual installed current host.
// Only the QA harness discovers the host-selected port; no product patch.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { spawn, spawnSync } = require("node:child_process");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const base = "F:/AgentVN/QA/Editor-1.9.34-20261029-01", out = path.join(base, "backend-conflict-02/session-01");
const reportFile = path.join(out, "report.json");
const installFile = path.join(base, "derived-installed-01.json");
const sampleFile = path.join(base, "historical-samples-01/report.json");
const helper = path.join(__dirname, "lib/installed-release-session.cjs");
function adaptedSource(input) {
  let source = input;
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, () => after);
  };
  one("beforeHostStart, preferredBackendPort })", "beforeHostStart, preferredBackendPort, discoverFallback })");
  one('AGENTVN_BACKEND_PORT: String(ports[0]),', "");
  one("report.launches.push(current); remember();",
    "report.launches.push(current); remember();\n      ports[0] = await discoverFallback(host, current); save();");
  new vm.Script(Module.wrap(source)); return source;
}
function bind() {
  assert.equal(sha(helper), "413b6237bdcf68ff97091f1d79cd9bdc9f1b8eda5b6794ae27404739e5f497c5");
  const receipt = read(installFile);
  assert.equal(receipt.version, "1.9.34");
  assert.equal(sha(receipt.actualInstallation.path), receipt.actualInstallation.sha256);
  const actual = read(receipt.actualInstallation.path);
  assert.equal(actual.status, "PASS"); assert.equal(actual.registryRestored, true);
  for (const f of [actual.installer, receipt.executable, ...receipt.resources]) assert.equal(sha(f.path), f.sha256);
  const sample = read(sampleFile).samples.find(s => s.version === "1.7.1");
  assert(sample); assert.equal(sha(sample.installer.path), sample.installer.sha256);
  const old = sample.files.find(f => path.basename(f.path) === "creator-backend.exe");
  assert.equal(old.sha256, "35d17ef89ba313bdabd30123a5b7aed9a97ad6744cbb926535b67a49eb669372");
  assert.equal(sha(old.path), old.sha256);
  return { receipt, old, sample };
}
async function run() {
  const binding = bind(); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  assert.equal(listeners([8278, ...Array.from({ length: 21 }, (_, i) => 8279 + i)]).length, 0);
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "REAL_1_7_1_BACKEND_ON_DEFAULT_PORT_CURRENT_INSTALLED_EDITOR_FALLBACK",
    cases: [], screenshots: [], launches: [], cleanups: [], errors: [], realModelRequests: 0, productChanges: 0,
    tools: [__filename, helper].map(p => ({ path: p, sha256: sha(p) })),
    currentInstallation: { path: installFile, sha256: sha(installFile) },
    oldSample: { path: sampleFile, sha256: sha(sampleFile), backend: binding.old, installer: binding.sample.installer },
    limitations: ["Isolated database and WebView, not default-path upgrade", "Legacy backend intentionally started by QA",
      "Owned-process termination is not normal-window-close evidence", "1080p DPR1 only", "Not installer live-process replacement"] };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  let legacy, host, cachePrepared = false;
  const legacyKnown = new Map();
  function cache(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
      "-AllowedRunRoot", path.dirname(out), "-CodexCacheView"],
    { windowsHide: true, encoding: "utf8", timeout: 60000 });
    (report.cache ??= []).push({ action, code: r.status, stdout: r.stdout, stderr: r.stderr }); save();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  async function stage(name, fn) {
    const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(row); save();
    console.log("START", name);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
    finally { row.finishedAt = new Date().toISOString(); save(); console.log(row.status, name); }
  }
  function rememberOld() {
    if (!legacy) return;
    const tree = ownedProcessTree(rows(), legacy.pid, report.legacy?.created);
    if (!report.legacy.created && tree.length) report.legacy.created = tree[0].Created;
    for (const p of tree) legacyKnown.set(`${p.ProcessId}:${p.Created}`, p);
    report.legacyKnown = [...legacyKnown.values()]; save();
  }
  async function oldApi(route) {
    const r = await fetch("http://127.0.0.1:8278" + route, { signal: AbortSignal.timeout(3000) });
    assert(r.ok); return r.json();
  }
  try {
    save(); cache("SelfTest"); cachePrepared = true; cache("Prepare");
    const m = new Module(helper, module); m.filename = helper; m.paths = Module._nodeModulePaths(path.dirname(helper));
    const source = adaptedSource(fs.readFileSync(helper, "utf8"));
    fs.writeFileSync(path.join(out, "executed-session.cjs"), source, { flag: "wx" }); m._compile(source, helper);
    host = m.exports.installedReleaseSession({
      installationFile: installFile, out, report, save, input: path.join(out, "temporary-project.vnproj"), preferredBackendPort: 8278,
      beforeHostStart: async () => {
        const data = path.join(out, "legacy"); fs.mkdirSync(data);
        const env = { ...process.env };
        for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$|LLM_)/i.test(k)) delete env[k];
        Object.assign(env, { DATABASE_PATH: path.join(data, "vn_engine.db"), AGENTVN_BACKEND_DATA_DIR: data,
          AGENTVN_BACKEND_HOST: "127.0.0.1", AGENTVN_BACKEND_PORT: "8278", TEMP: data, TMP: data });
        const fd = fs.openSync(path.join(out, "legacy.log"), "wx");
        legacy = spawn(binding.old.path, [], { cwd: data, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
        report.legacy = { pid: legacy.pid, executable: binding.old, port: 8278, isolation: data }; rememberOld();
        await until(async () => {
          assert.equal(legacy.exitCode, null); rememberOld();
          try { return (await oldApi("/api/health")).service === "agentvn-backend"; } catch { return false; }
        }, "real old backend readiness", 45000);
        report.oldHealthBefore = await oldApi("/api/health");
        assert(!(report.oldHealthBefore.project_container_protocol >= 2), "Legacy sample must actually be incompatible");
        assert(listeners([8278]).every(l => [...legacyKnown.values()].some(p => p.ProcessId === l.OwningProcess)));
        report.oldStateBefore = await oldApi("/api/project/state"); save();
      },
      discoverFallback: async (child, current) => {
        const chosen = await until(() => {
          assert.equal(child.exitCode, null);
          const tree = ownedProcessTree(rows(), child.pid, current.created);
          const backends = tree.filter(p => p.Name === "creator-backend.exe");
          const candidates = listeners(Array.from({ length: 21 }, (_, i) => i + 8279))
            .filter(l => backends.some(p => p.ProcessId === l.OwningProcess));
          return candidates.length === 1 && candidates[0];
        }, "current host auto-started fallback listener", 60000);
        report.fallback = { requestedDefault: 8278, selected: chosen.LocalPort,
          owningProcess: chosen.OwningProcess, backendPortOverride: false };
        save(); return chosen.LocalPort;
      },
    });
    let page;
    await stage("genuine-old-incompatible-backend-kept-current-host-selects-owned-fallback", async () => {
      page = await host.start(); assert.notEqual(host.current.ports[0], 8278);
      assert(report.fallback.selected >= 8279 && report.fallback.selected <= 8299);
      assert((await host.rawApi("/api/health")).project_container_protocol >= 2);
      assert.equal(legacy.exitCode, null); assert.deepEqual(await oldApi("/api/health"), report.oldHealthBefore);
      return { oldPID: legacy.pid, oldHealth: report.oldHealthBefore, currentBackend: host.current.backend,
        fallback: report.fallback, oldBackendNotTerminated: true };
    });
    await stage("real-new-project-UI-routes-writes-only-to-current-owned-backend", async () => {
      const observed = [];
      page.on("request", req => {
        const u = new URL(req.url());
        if (u.hostname === "127.0.0.1" && u.pathname.startsWith("/api/"))
          observed.push({ origin: u.origin, path: u.pathname, method: req.method() });
      });
      await page.getByRole("region", { name: "创建或打开项目", exact: true })
        .getByRole("button", { name: "新建项目", exact: true }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      await page.locator('[data-workspace-surface="options"]:visible').click(); await settleEditor(page);
      await page.getByRole("textbox", { name: "项目名称", exact: true }).fill("旧后台冲突隔离工程");
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
      await until(async () => {
        const value = await host.rawApi("/api/project/state");
        if (value.data.project_metadata.title === "旧后台冲突隔离工程") return value;
        return false;
      }, "current backend receives actual UI authoring");
      assert(observed.length > 0);
      assert(observed.every(r => r.origin === `http://127.0.0.1:${host.current.ports[0]}`));
      assert.deepEqual(await oldApi("/api/project/state"), report.oldStateBefore, "Old database must not receive current UI writes");
      report.observedRequests = observed; report.newState = await host.rawApi("/api/project/state");
      await host.shot("actual-installed-fallback-project"); save();
      return { actualUI: true, currentRequests: observed.length, oldStateUnchanged: true, modelRequests: 0 };
    });
    assert.equal(report.cases.length, 2); assert(report.cases.every(c => c.status === "PASS"));
    assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests || 0, 0);
    report.status = "PASS_LIMITED_BACKEND_CONFLICT";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      await host?.stop("QA conflict completion; exact owned termination, not normal-close evidence");
      rememberOld();
      for (const p of [...legacyKnown.values()].reverse())
        if (rows().some(q => q.ProcessId === p.ProcessId && q.Created === p.Created)) stopOwnedProcess(p, ps);
      await until(() => !rows().some(p => legacyKnown.has(`${p.ProcessId}:${p.Created}`)) &&
        listeners([8278, ...(report.launches.flatMap(l => l.ports))]).length === 0, "both backend families clean");
      report.ownedCleanup = "PASS";
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    try {
      if (cachePrepared) {
        cache("Restore"); assert.equal(read(path.join(out, "native-cache-restoration.json")).status, "PASS");
      }
      for (const f of report.tools) assert.equal(sha(f.path), f.sha256);
      bind(); report.restoration = "PASS";
    } catch (e) { report.restoreError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError, restoreError: report.restoreError }));
  }
}
function audit() {
  bind(); const r = read(reportFile);
  assert.equal(r.status, "PASS_LIMITED_BACKEND_CONFLICT"); assert.equal(r.cases.length, 2);
  assert(r.cases.every(c => c.status === "PASS")); assert.equal(r.ownedCleanup, "PASS"); assert.equal(r.restoration, "PASS");
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0);
  assert.equal(r.launches.length, 1); assert.equal(r.screenshots.length, 1);
  assert.equal(r.fallback.backendPortOverride, false); assert.notEqual(r.fallback.selected, 8278);
  assert(r.observedRequests.length > 0 && r.observedRequests.every(q => q.origin === `http://127.0.0.1:${r.fallback.selected}`));
  assert(!(r.oldHealthBefore.project_container_protocol >= 2));
  const screenshot = r.screenshots[0], p = screenshot.path || screenshot.file, png = fs.readFileSync(p);
  assert.equal(sha(p), screenshot.sha256); assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
  assert(!rows().some(p => [...r.knownProcesses, ...r.legacyKnown].some(q => q.ProcessId === p.ProcessId && q.Created === p.Created)));
  assert.equal(listeners([8278, ...r.launches.flatMap(l => l.ports)]).length, 0);
  for (const f of r.tools) assert.equal(sha(f.path), f.sha256);
  const result = { status: "PASS", scope: "INDEPENDENT_LIMITED_CONFLICT_AUDIT",
    source: { path: reportFile, sha256: sha(reportFile) }, cases: 2, screenshot: { path: p, sha256: sha(p) },
    newBackendPort: r.fallback.selected, restored: true, realModelRequests: 0, at: new Date().toISOString() };
  fs.writeFileSync(path.join(out, "audit-01.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
}
const action = process.argv[2];
if (action === "self-test") {
  bind();
  const source = fs.readFileSync(helper, "utf8"); adaptedSource(source);
  for (const marker of ["beforeHostStart, preferredBackendPort })", 'AGENTVN_BACKEND_PORT: String(ports[0]),', "report.launches.push(current); remember();"])
    assert.throws(() => adaptedSource(source.replace(marker, "")));
  const test = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "installed-layout-cache-session.ps1"), "-Action", "SelfTest",
    "-RunDirectory", out, "-AllowedRunRoot", path.dirname(out), "-CodexCacheView"],
  { windowsHide: true, encoding: "utf8", timeout: 30000 });
  assert.equal(test.status, 0, test.stdout + test.stderr);
  console.log("PASS: actual source/old/current hashes and three missing-hook rejections; zero product starts");
} else if (action === "run") run();
else if (action === "audit") audit();
else throw Error("Expected self-test/run/audit");
