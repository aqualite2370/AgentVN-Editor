"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-assistant-recovery-20261018-01", out = process.argv[2];
assert(out && !fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => sha256(fs.readFileSync(f));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", recoverySliceStatus: "PASS", g03Status: "FAILED",
  at: new Date().toISOString(), checks: [], inputs: [], screenshots: 0, realModelRequests: 0, productChanges: 0, error: null };
function load(name) {
  const f = path.join(run, name); report.inputs.push({ path: f, sha256: sha(f) }); return read(f);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const prep = load("preparation.json"), fixture = load("fixtures.json"), behavior = load("recovery-02/report.json");
  const original = load("recovery-01/report.json"), frontend = load("frontend-restart-2.json");
  const peer = load("peer-launch.json"), peerStop = load("peer-stop.json"), workerStop = load("worker-stop.json");
  const launches = [], backends = [];
  for (const suffix of ["", "-02", "-03"]) { launches.push(load(`launch${suffix}.json`)); backends.push(load(`backend-ready${suffix}.json`)); }
  await check("Frozen real NSIS executable and three automatically started backend launches are traced", () => {
    assert.equal(prep.status, "PASS"); assert.equal(fixture.status, "PASS"); assert.equal(fixture.projects.length, 2);
    for (const p of fixture.projects) assert.equal(sha(p.input), p.sha256);
    for (const [i, l] of launches.entries()) {
      assert.equal(l.status, "PASS"); assert.equal(backends[i].status, "PASS");
      assert(!l.dataDirectoryOverride && !l.webviewDirectoryOverride && !l.manualBackendSpawn);
      assert.equal(l.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
      assert.equal(sha(path.join(l.installRoot, "agentvn-editor.exe")), l.executableSha256);
      assert.equal(sha(path.join(l.installRoot, "creator-backend.exe")), backends[i].backendSha256);
    }
    return { launches: launches.length, candidate: launches[0].executableSha256, fixtureProjects: 2, noManualBackendSpawn: true };
  });
  await check("Frontend-only actual restart preserves same native backend PIDs, one task submission and completed own draft", () => {
    assert.equal(behavior.status, "PASS"); assert.equal(behavior.cases.length, 3);
    assert(behavior.cases.every(c => c.status === "PASS"));
    assert.equal(frontend.status, "PASS"); assert(!frontend.dataDirectoryOverride && !frontend.webviewDirectoryOverride);
    assert(frontend.backendReusedWithoutManualSpawn);
    assert.notEqual(frontend.editorPid, launches[1].editorPid);
    const oldBackends = frontend.before.filter(p => p.Name === "creator-backend.exe");
    const newBackends = frontend.after.filter(p => p.Name === "creator-backend.exe");
    assert.deepEqual(newBackends, oldBackends);
    assert.equal(behavior.cases[0].detail.actualNewEditorPid, frontend.editorPid);
    assert.equal(behavior.submissions.filter(t => t.userRequest.startsWith("RESUME_A")).length, 1);
    assert.equal(behavior.modelRequests.filter(r => r.marker === "RESUME_A").length, 1);
    return behavior.cases[0].detail;
  });
  await check("A second actual installed process uses separate local WebView and accesses/cancels global task from another project", () => {
    assert.equal(peer.status, "PASS"); assert.equal(peerStop.status, "PASS");
    assert(peer.webviewDirectoryOverride && !peer.dataDirectoryOverride && peer.backendReusedWithoutManualSpawn);
    assert.notEqual(peer.editorPid, frontend.editorPid);
    assert.deepEqual(peer.backendPids, frontend.backendPids);
    assert.equal(peerStop.stopped.length, 1); assert.equal(peerStop.stopped[0].ProcessId, peer.editorPid);
    assert(fs.existsSync(path.join(peer.peerWebviewRoot, "EBWebView")));
    const root = fs.statSync(path.join(peer.peerWebviewRoot, "EBWebView"));
    assert(root.birthtimeMs >= new Date(peer.at).getTime() - 2000);
    assert.equal(behavior.cases[1].detail.finalStatus, "cancelled");
    assert.equal(behavior.modelRequests.filter(r => r.marker === "PEER_A").length, 1);
    return { ...behavior.cases[1].detail, separatePeerProfilePopulated: true,
      peerProfileDefaultPathAcceptance: false, physicalDesktopInput: false };
  });
  await check("Native peer task monitor twelve combinations genuinely hit, focus and fit viewport, not an empty matrix", () => {
    assert.equal(behavior.matrix.length, 12);
    const keys = new Set(behavior.matrix.map(r => `${r.width}/${r.height}/${r.dpr}/${r.reduced}`));
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const m of [false, true])
      assert(keys.has(`${w}/${h}/${d}/${m}`));
    for (const r of behavior.matrix) assert(r.status === "PASS" && r.geometry.hit && r.geometry.focus && r.geometry.overflow <= 1);
    return { combinations: 12, actions: "native peer's actual global task monitor cancel button", fullMotionClaim: false };
  });
  await check("Actual killed worker and queued tasks terminalize worker_lost without replay or permanent project lock", () => {
    assert.equal(workerStop.status, "PASS"); assert.equal(workerStop.after.length, 0);
    assert(workerStop.before.some(p => p.Name === "creator-backend.exe"));
    assert.equal(behavior.failedWorker.errorCode, "worker_lost"); assert.equal(behavior.failedWorker.status, "failed");
    assert.equal(behavior.failedQueue.errorCode, "worker_lost"); assert.equal(behavior.failedQueue.status, "failed");
    assert(!behavior.failedWorker.result && !behavior.failedQueue.result);
    assert.deepEqual(behavior.modelRequests.map(r => r.marker), ["RESUME_A", "PEER_A", "INTERRUPTED_A"]);
    assert.equal(behavior.tasks.length, 4);
    assert(behavior.cases[2].detail.bothProjectsUnlocked);
    assert.equal(behavior.commands.length, 6); assert(behavior.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    assert.equal(behavior.providerCleanup.stopped, true); assert.equal(behavior.providerCleanup.requests, 3);
    assert.equal(behavior.credentialCleanup, "CLEARED_TEST_ONLY_PROVIDER_AND_SECRET");
    assert(!behavior.taskCleanupError); assert.equal(behavior.errors.length, 0);
    return { ...behavior.cases[2].detail, killedFrontendAndBackendThenRelaunched: true, naturalCrashClaim: false,
      controlledRequests: 3, paidModelRequests: 0 };
  });
  await check("Nineteen raw screenshots independently preserve real native WebView viewport/DPR and PNG bytes", () => {
    const captures = [...original.screenshots, ...behavior.screenshots]; assert.equal(captures.length, 19);
    for (const s of captures) {
      const png = fs.readFileSync(s.path);
      assert.equal(sha256(png), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshots++;
    }
    return { screenshots: 19, nativeWebViewEmulation: true, physical4k: false };
  });
  await check("Whole original profiles restored and all55 independently backed-up bytes, DB/Dev/pending MSI unchanged", () => {
    const restored = load("profile-restoration.json"); assert.equal(restored.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original)); assert(!fs.existsSync(p.held));
      for (const f of p.files) {
        assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++;
      }
    }
    assert.equal(count, 55); assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const incident = read("D:/AgentVN/output/host-msi-session-20261018-01/incident-audit-01.json");
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    return { profiles: 4, independentFileHashes: count, originalDbDevAndMsiUnchanged: true };
  });
  await check("All owned processes/ports clear; original module failure is preserved and prior focus FAILED is not promoted", () => {
    assert.equal(original.status, "FAILED"); assert(original.error.includes("Get-FileHash"));
    assert.equal(original.providerCleanup.stopped, true);
    assert.equal(original.credentialCleanup, "CLEARED_TEST_ONLY_PROVIDER_AND_SECRET");
    const failedTool = load("frontend-restart.json"), failedStop = load("tool-failure-stop.json"), finalStop = load("final-stop.json");
    assert.equal(failedTool.status, "FAILED"); assert(failedTool.error.includes("Get-FileHash"));
    assert.equal(failedStop.status, "PASS"); assert.equal(finalStop.status, "PASS");
    assert.equal(finalStop.after.length, 0); assert.equal(finalStop.normalWindowClose, "NOT_RUN");
    const previous = read("D:/AgentVN/output/installed-assistant-session-20261018-01/terminal-audit-01.json");
    assert.equal(previous.g03Status, "FAILED"); assert.equal(previous.evidenceStatus, "PASS");
    const ports = [...new Set([8278, Number(new URL(original.modelEndpoint).port), Number(new URL(behavior.modelEndpoint).port),
      frontend.cdpPort, peer.cdpPort, ...launches.flatMap(l => [l.cdpPort, l.playerCdpPort])])];
    const query = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)|AgentVN-QA-InstalledAssistantRecovery')}|Select-Object ProcessId,Name)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { windowsHide: true, encoding: "utf8", timeout: 15000 });
    assert.equal(query.status, 0, query.stderr);
    const state = JSON.parse(query.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { ...state, portsChecked: ports, retainedToolFailure: true, g03StillFailedForFocus: true,
      remaining: "Full AI permission/review/exclusions/merge-conflict/export + real models; G12 motion, Windows/Android and other ledger groups" };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS";
})().catch(e => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, recoverySliceStatus: report.recoverySliceStatus,
    g03Status: report.g03Status, checks: report.checks.length, screenshots: report.screenshots, error: report.error, out }, null, 2));
});
