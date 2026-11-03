"use strict";
// Run only the new clean-source packaged backend. Real HTTP/SQLite; no model.
const assert = require("node:assert/strict"), fs = require("node:fs");
const path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const base = "F:/AgentVN/QA/Source-Delivery-20261103-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(base, `native-backend-smoke-${attempt}`);
assert(!fs.existsSync(out), "Never overwrite evidence");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sourceFile = path.join(base, "native-clean-04", "report.json");
const source = read(sourceFile); assert.equal(source.status, "PASS");
const built = source.artifacts.find(a => a.path.endsWith("creator-backend.exe"));
assert(built && sha(built.path) === built.sha256);
const auditFile = path.join(base, "native-clean-04", "audit-02.json");
assert.equal(read(auditFile).status, "PASS");
assert.equal(read(auditFile).reportSha256, sha(sourceFile));
fs.mkdirSync(out);
for (const name of ["executable", "temporary", "data", "local-app-data", "roaming-app-data"])
  fs.mkdirSync(path.join(out, name));
const exe = path.join(out, "executable", "creator-backend.exe");
fs.copyFileSync(built.path, exe, fs.constants.COPYFILE_EXCL);
const database = path.join(out, "data", "isolated.sqlite");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "CLEAN_SOURCE_PACKAGED_BACKEND_REAL_HTTP_SQLITE_RESTART_ONLY",
  build: describe(sourceFile), buildAudit: describe(auditFile), executable: describe(exe),
  database, cases: [], launches: [], http: [], cleanups: [],
  modelRequests: 0, deviceLaunches: 0, productChanges: 0,
  boundaries: ["Isolated explicit DB/profile; not default-path installation acceptance.",
    "Exact-owned forced backend restart; not normal Editor exit.",
    "No generation route or configured real provider; no OS-level network sandbox claim."],
};
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const identity = p => `${p.ProcessId}:${p.Created}`;
const known = new Map();
let child, launch, address;
function remember() {
  const current = rows();
  if (child) for (const p of ownedProcessTree(current, child.pid, launch.created)) {
    if (p.ProcessId === child.pid) launch.created = p.Created;
    assert.equal(path.resolve(p.ExecutablePath).toLowerCase(), path.resolve(exe).toLowerCase());
    known.set(identity(p), p);
  }
  report.knownProcesses = [...known.values()]; save(); return current;
}
async function port() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const p = server.address().port; server.close(e => e ? reject(e) : resolve(p));
    });
  });
}
function environment() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(?:AGENTVN_|WEBVIEW2_|OPENAI_|DEEPSEEK_|ANTHROPIC_|LLM_|EMBEDDING_|VITE_|PYTHON|PYTEST)/i.test(key)
      || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PROXY)$/i.test(key)
      || ["DATABASE_PATH", "VIRTUAL_ENV"].includes(key)) delete env[key];
  return Object.assign(env, { DATABASE_PATH: database,
    AGENTVN_EDITOR_DATA_DIR: path.join(out, "data"), AGENTVN_BACKEND_DATA_DIR: path.join(out, "data"),
    AGENTVN_LEGACY_DATABASE_PATHS: "", AGENTVN_BACKEND_HOST: "127.0.0.1",
    AGENTVN_BACKEND_PORT: String(launch.port), AGENTVN_BACKEND_LOG: path.join(out, `backend-${report.launches.length}.log`),
    AGENTVN_ERROR_LOG_DIR: path.join(out, "data", "logs"),
    LOCALAPPDATA: path.join(out, "local-app-data"), APPDATA: path.join(out, "roaming-app-data"),
    TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") });
}
async function start() {
  launch = { port: await port(), startedAt: new Date().toISOString() };
  assert.deepEqual(listeners([launch.port]), []);
  report.launches.push(launch);
  const fd = fs.openSync(path.join(out, `process-${report.launches.length}.log`), "wx");
  child = spawn(exe, [], { cwd: path.dirname(exe), env: environment(), windowsHide: true,
    stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  launch.pid = child.pid; let spawnError;
  child.once("error", e => { spawnError = e; });
  save(); remember(); address = `http://127.0.0.1:${launch.port}`;
  await until(async () => {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, "Owned packaged backend exited");
    const r = await fetch(address + "/api/health", { signal: AbortSignal.timeout(1000) });
    return r.ok && (await r.json()).service === "agentvn-backend";
  }, "clean packaged backend readiness", 60000);
  remember(); launch.listeners = listeners([launch.port]);
  assert.equal(launch.listeners.length, 1);
  assert(launch.listeners.every(l => [...known.values()].some(p => p.ProcessId === l.OwningProcess)));
  launch.readyAt = new Date().toISOString(); save();
}
async function stop() {
  if (!child) return;
  remember(); const killed = [];
  for (const p of [...known.values()].reverse()) {
    if (!rows().some(n => identity(n) === identity(p))) continue;
    ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
      `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}')` +
      `{Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
    killed.push(identity(p));
  }
  await until(() => child.exitCode !== null || child.signalCode !== null, "owned backend exit", 10000);
  const current = rows();
  const cleanup = { port: launch.port, killed, normalExitClaimed: false,
    survivors: [...known.values()].filter(p => current.some(n => identity(n) === identity(p))),
    listeners: listeners([launch.port]), finishedAt: new Date().toISOString() };
  report.cleanups.push(cleanup); save();
  assert.deepEqual(cleanup.survivors, []); assert.deepEqual(cleanup.listeners, []);
  child = null;
}
const secret = "synthetic-clean-smoke-" + crypto.randomUUID();
async function api(route, body, method = "GET", secrets = false) {
  assert(child && child.exitCode === null && child.signalCode === null);
  const response = await fetch(address + route, { method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000) });
  const text = await response.text();
  report.http.push({ method, route, status: response.status }); save();
  assert.equal(response.status, 200, `Unexpected HTTP status for ${route}`);
  if (!secrets) assert(!text.includes(secret), "Public response must not expose synthetic key");
  if (route.includes("/state") || secrets)
    assert.match(response.headers.get("cache-control") || "", /no-store/);
  return JSON.parse(text);
}
async function step(name, callback) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() };
  report.cases.push(row); save(); console.log("START", name);
  try { row.result = await callback(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
const projects = ["qa-clean-agentvn", "qa-clean-renpy"].map((id, index) => ({
  schema_version: "1.0.0", project_id: id, title: `隔离原生 ${index}`, author: "QA",
  nodes: [{ id: "start", data: { nodeKind: "start" } }], edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }, memory_mode: "hybrid", asset_manifest: [],
  editor_settings: { qa: { layoutType: index ? "renpy" : "agentvn", aspect: index ? "4:3" : "16:9" } },
  created_at: "2026-11-03T00:00:00.000Z", updated_at: "2026-11-03T00:00:00.000Z",
}));
let persisted;
(async () => {
  save();
  await step("isolated-executable-start-and-owned-http", async () => {
    await start(); const health = await api("/api/health");
    assert.equal(health.status, "ok"); assert.equal(health.project_container_protocol, 2);
    assert.deepEqual((await api("/api/project/catalog")).data, []);
    return { actualOwnerVerified: true, initialCatalogEmpty: true };
  });
  await step("real-sqlite-project-roundtrip-and-synthetic-secret-boundary", async () => {
    persisted = [];
    for (const p of projects) {
      const saved = await api(`/api/project/projects/${p.project_id}`, p, "PUT");
      assert.deepEqual(saved.data.nodes, p.nodes);
      assert.deepEqual(saved.data.editor_settings, p.editor_settings);
      persisted.push(saved.data);
    }
    const saved = await api("/api/project/state", { provider_secrets: { "qa-clean": secret },
      project_metadata: { title: "隔离状态保存" } }, "POST");
    assert.deepEqual(saved.data.provider_secrets, {});
    const keys = await api("/api/providers/secrets", undefined, "GET", true);
    assert.equal(keys.data["qa-clean"], secret);
    const catalog = (await api("/api/project/catalog")).data;
    assert.equal(catalog.length, 2);
    for (const p of persisted) {
      const item = catalog.find(c => c.project_id === p.project_id);
      assert(item.has_detail && item.node_count === 1 && item.edge_count === 0);
      assert(item.size_bytes > 0 && item.size_source === "storage");
    }
    assert(fs.existsSync(database));
    return { projects: persisted.map(p => p.project_id), keyResponseRedacted: true,
      syntheticKeyRecoveredOnlyByDedicatedRoute: true };
  });
  await step("actual-exe-restart-restores-projects-and-secret", async () => {
    await stop(); await start();
    for (const expected of persisted) {
      const actual = (await api(`/api/project/projects/${expected.project_id}`)).data;
      assert.deepEqual(actual, expected);
    }
    const state = (await api("/api/project/state?include_project=false&include_recent_projects=false")).data;
    assert.deepEqual(state.provider_secrets, {});
    assert.deepEqual(state.project_metadata, {}, "Lightweight state intentionally omits project metadata");
    const full = (await api("/api/project/state")).data;
    assert.equal(full.project_metadata.title, "隔离状态保存");
    assert.equal((await api("/api/providers/secrets", undefined, "GET", true)).data["qa-clean"], secret);
    return { projectsRestored: persisted.length, readFromActualDatabase: true };
  });
  await step("erase-synthetic-key-before-final-shutdown", async () => {
    await api("/api/project/state", { provider_secrets: {} }, "POST");
    assert.deepEqual((await api("/api/providers/secrets", undefined, "GET", true)).data, {});
    await stop();
    report.databaseArtifact = describe(database);
    return { storedSyntheticKeysRemoved: true, processesStopped: true };
  });
  assert.equal(sha(exe), built.sha256);
  assert.equal(sha(built.path), built.sha256);
  assert.equal(sha(sourceFile), report.build.sha256);
  const python = path.join(base, "backend-clean-01/python-env/Scripts/python.exe");
  const inspected = spawnSync(python, ["-c",
    "import sqlite3,sys,json; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); " +
    "print(json.dumps({'integrity':c.execute('PRAGMA integrity_check').fetchone()[0]," +
    "'projects':c.execute('SELECT COUNT(*) FROM editor_project_summaries').fetchone()[0]})); c.close()",
    database], { cwd: out, env: { ...environment(), PYTHONNOUSERSITE: "1" },
    encoding: "utf8", windowsHide: true });
  assert.equal(inspected.status, 0);
  report.databaseCheck = JSON.parse(inspected.stdout);
  assert.deepEqual(report.databaseCheck, { integrity: "ok", projects: 2 });
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED";
  report.error = String(error.stack || error).replaceAll(secret, "[SYNTHETIC-REDACTED]");
  process.exitCode = 1;
}).finally(async () => {
  try { await stop(); report.cleanup = "PASS"; }
  catch (error) { report.cleanup = "FAILED"; report.cleanupError = String(error);
    report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
