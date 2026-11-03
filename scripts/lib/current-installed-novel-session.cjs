"use strict";
// Actual frozen NSIS session with whole original profiles held at their default
// paths. This adapter deliberately does not impersonate the old override-based
// readInstalledSession contract.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process"), { promisify } = require("node:util");
const { sha256 } = require("./installed-acceptance.cjs");
const execute = promisify(execFile), run = "D:/AgentVN/output/installed-novel-session-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
function verify(owner) {
  const prep = read(path.join(run, "preparation.json")), launch = read(owner.launchFile);
  assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
  assert.equal(launch.status, "PASS"); assert.equal(launch.dataDirectoryOverride, false);
  assert.equal(launch.webviewDirectoryOverride, false); assert.equal(launch.manualBackendSpawn, false);
  const exe = path.join(launch.installRoot, "agentvn-editor.exe");
  assert.equal(sha(exe), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
  const current = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${launch.editorPid}"|ForEach-Object {@{Name=$_.Name;ProcessId=$_.ProcessId;ExecutablePath=$_.ExecutablePath;ParentProcessId=$_.ParentProcessId;createdUtc=$_.CreationDate.ToUniversalTime().ToString('o')}}|ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true, timeout: 15000 }).replace(/^\uFEFF/, ""));
  assert.deepEqual(current, launch.processes.find(p => p.ProcessId === launch.editorPid));
  return { state: owner.state, exeSha256: launch.executableSha256, verifiedDefaultPathsWithWholeProfilesProtected: true };
}
async function command(file, args) {
  const result = await execute("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args],
    { cwd: path.resolve(__dirname, "../.."), windowsHide: true, encoding: "utf8", timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  assert(!result.stderr.trim(), result.stderr); return result.stdout;
}
async function startCurrentInstalledNovelSession({ adoptAttempt } = {}) {
  const attempt = adoptAttempt || fs.readdirSync(run).filter(f => /^launch(?:-\d\d)?\.json$/.test(f)).length + 1;
  assert(attempt >= 1 && attempt <= 9); const suffix = attempt === 1 ? "" : `-${String(attempt).padStart(2, "0")}`;
  const launcher = path.resolve(__dirname, "../installed-preview-session.ps1");
  if (!adoptAttempt) await command(launcher, ["-Suite", "novel-floating", "-Attempt", String(attempt), "-Action", "Launch"]);
  else assert(fs.existsSync(path.join(run, `launch${suffix}.json`)), "Can adopt only a specifically recorded live launch");
  const known = read(path.join(run, `launch${suffix}.json`));
  const end = Date.now() + 60000; let healthy = false;
  while (Date.now() < end) {
    // A health observation must never create/restart a host process.
    const live = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId=${known.editorPid}"|Select-Object ProcessId,ExecutablePath|ConvertTo-Json`],
    { encoding: "utf8", windowsHide: true, timeout: 15000 }).trim();
    assert(live, "Recorded Editor has exited; do not pretend startup remains live");
    const identity = JSON.parse(live.replace(/^\uFEFF/, ""));
    assert.equal(path.resolve(identity.ExecutablePath), path.resolve(known.installRoot, "agentvn-editor.exe"));
    try {
      const r = await fetch(`http://127.0.0.1:${known.backendPort}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok && (await r.json()).service === "agentvn-backend") { healthy = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert(healthy, "Same recorded host did not finish automatic backend startup");
  if (!fs.existsSync(path.join(run, `backend-ready${suffix}.json`)))
    await command(launcher, ["-Suite", "novel-floating", "-Attempt", String(attempt), "-Action", "Observe"]);
  const launchFile = path.join(run, `launch${suffix}.json`), launch = read(launchFile);
  const ready = read(path.join(run, `backend-ready${suffix}.json`));
  const backend = ready.processes.find(p => p.Name === "creator-backend.exe" && p.ParentProcessId === launch.editorPid);
  assert(backend);
  const state = { ...launch, backendPid: backend.ProcessId,
    databasePath: "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db",
    webviewRoot: "C:/Users/1/AppData/Local/com.agentvn.editor", attempt,
    backendReadyFile: path.join(run, `backend-ready${suffix}.json`) };
  let stopped;
  const owner = { state, launchFile, async stop() {
    if (stopped) return stopped;
    const evidence = `novel-stop-${String(attempt).padStart(2, "0")}`;
    await command(path.resolve(__dirname, "../installed-assistant-recovery-session.ps1"),
      ["-Suite", "novel-floating", "-Attempt", String(attempt), "-Action", "StopAll", "-Evidence", evidence]);
    const file = path.join(run, `${evidence}.json`), result = read(file);
    assert.equal(result.status, "PASS"); assert.equal(result.after.length, 0);
    stopped = { editor: { exitCode: 0 }, backend: { exitCode: 0 }, evidence: file, sha256: sha(file),
      method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_WINDOW_CLOSE" };
    return stopped;
  } };
  verify(owner); return owner;
}
module.exports = { startCurrentInstalledNovelSession, verifyCurrentInstalledNovelSession: verify };
