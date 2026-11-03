"use strict";
// Actual newly packaged backend, independent database and owned process tree.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), net = require("node:net"), { spawn, spawnSync, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Data-URL-Repair-20261020-01";
const out = path.join(qa, "sidecar-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
const exe = path.join(root, "editor/src-tauri/binaries/creator-backend.exe");
const input = path.join(qa, "charset素材临时工程.vnproj"), project = JSON.parse(fs.readFileSync(input));
const report = { status: "RUNNING", at: new Date().toISOString(), executable: { path: exe, sha256: sha(exe) },
  input: { path: input, sha256: sha(input) }, sessions: [], checks: [],
  scope: "REAL_NEW_PACKAGED_BACKEND_HTTP_NOT_NATIVE_EDITOR_OR_RELEASE_INSTALLATION", modelRequests: 0 };
const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const expected = new Map(project.asset_manifest.map(a => [a.asset_id,
  Buffer.from(decodeURIComponent(a.metadata.data_url.slice(a.metadata.data_url.indexOf(",") + 1)), "utf8")]));
let child, active;
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}
async function stop() {
  if (!child) return;
  const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
  active.stop = { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(resolve, 3000).unref();
  });
  const listeners = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `@(Get-NetTCPConnection -LocalPort ${active.port} -State Listen -ErrorAction SilentlyContinue|Select-Object LocalPort,OwningProcess)|ConvertTo-Json -Compress`],
  { encoding: "utf8", windowsHide: true }) || "[]");
  assert.equal(listeners.length, 0, "Owned packaged backend port still listening");
  active.cleanup = "PASS"; child = null; persist();
}
async function start() {
  const port = await freePort(), data = path.join(out, "isolated-data");
  active = { port, status: "RUNNING" }; report.sessions.push(active);
  child = spawn(exe, [], { cwd: out, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, AGENTVN_BACKEND_PORT: String(port), AGENTVN_BACKEND_DATA_DIR: data,
    AGENTVN_EDITOR_DATA_DIR: data, DATABASE_PATH: path.join(data, "vn_engine.db"),
    AGENTVN_LEGACY_DATABASE_PATHS: "", AGENTVN_BACKEND_LOG: path.join(out, `backend-${port}.log`),
    TEMP: path.join(qa, "temp"), TMP: path.join(qa, "temp"),
  } });
  active.pid = child.pid; persist();
  let healthy = false;
  for (const deadline = Date.now() + 90000; Date.now() < deadline;) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error(`Owned sidecar exited: ${child.exitCode}`);
    try { healthy = (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(healthy, "Sidecar readiness timeout");
  active.identity = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$all=@(Get-CimInstance Win32_Process);$owned=@($all|Where-Object {$_.ProcessId -eq ${child.pid} -or $_.ParentProcessId -eq ${child.pid}}|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate);` +
    `$listeners=@(Get-NetTCPConnection -State Listen -LocalPort ${port}|Select-Object OwningProcess,LocalPort);` +
    `@{processes=$owned;listeners=$listeners}|ConvertTo-Json -Compress -Depth 5`],
  { encoding: "utf8", windowsHide: true }));
  assert(active.identity.listeners.every(l => active.identity.processes.some(p => p.ProcessId === l.OwningProcess)));
  for (const p of active.identity.processes) assert.equal(path.resolve(p.ExecutablePath).toLowerCase(), exe.toLowerCase());
  return `http://127.0.0.1:${port}`;
}
async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).data;
}
async function checkAssets(base, saved) {
  const assets = [];
  for (const a of saved.asset_manifest) {
    const response = await fetch(a.metadata.url, { signal: AbortSignal.timeout(10000) });
    assert(response.ok); assert(a.metadata.url.startsWith(base + "/api/project/assets/"));
    const bytes = Buffer.from(await response.arrayBuffer()); assert.deepEqual(bytes, expected.get(a.asset_id));
    assert.equal(sha(a.metadata.filePath), digest(expected.get(a.asset_id)));
    assets.push({ id: a.asset_id, sha256: digest(bytes), path: a.metadata.filePath, bytes: bytes.length });
  }
  assert.equal(assets.length, 7); return assets;
}
(async () => {
  let base = await start();
  const saved = await json(base + "/api/project/projects/import", {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: fs.readFileSync(input),
  });
  report.checks.push({ name: "Raw original charset file imported by actual packaged EXE", assets: await checkAssets(base, saved) });
  const bad = structuredClone(project);
  bad.asset_manifest[0].metadata.data_url = "data:image/svg+xml;base64,PRIVATE-INVALID!";
  bad.asset_manifest[0].metadata.blob_url = bad.asset_manifest[0].metadata.data_url;
  const failure = await fetch(base + `/api/project/projects/${project.project_id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bad), signal: AbortSignal.timeout(10000),
  });
  const error = await failure.text();
  assert.equal(failure.status, 422); assert(error.includes("PROJECT_ASSET_DATA_URL_INVALID")); assert(!error.includes("PRIVATE-INVALID"));
  const preserved = await json(base + `/api/project/projects/${project.project_id}`);
  assert.deepEqual(preserved, saved);
  report.checks.push({ name: "Actual EXE rejects invalid update with 422 and preserves prior project", status: 422 });
  active.status = "PASS"; await stop();
  base = await start();
  const reopened = await json(base + `/api/project/projects/${project.project_id}`);
  report.checks.push({ name: "Actual EXE restart reopens same project and exact seven asset bytes", assets: await checkAssets(base, reopened) });
  active.status = "PASS"; report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try { await stop(); } catch (e) { report.status = "FAILED"; report.cleanupError = String(e); process.exitCode = 1; }
  assert.equal(sha(exe), report.executable.sha256); assert.equal(sha(input), report.input.sha256);
  report.finishedAt = new Date().toISOString(); report.testSource = { path: __filename, sha256: sha(__filename) }; persist();
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
