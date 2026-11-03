"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-windows-export-20261018-02");
const sha = f => sha256(fs.readFileSync(f)), read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const out = process.argv[2]; assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
const report = { status: "RUNNING", windowsExportStatus: "BLOCKED", at: new Date().toISOString(),
  checks: [], inputs: [], screenshotCount: 0, productChanges: 0, realModelRequests: 0, error: null };
const load = f => { report.inputs.push({ path: f, sha256: sha(f) }); return read(f); };
function check(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c);
  try { c.detail = fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
try {
  const prep = load(path.join(run, "preparation.json")), launch = load(path.join(run, "launch.json"));
  const fixture = load(path.join(run, "fixtures.json")), ready = load(path.join(run, "backend-ready.json"));
  const ui = load(path.join(run, "prepare-ui-01/report.json")), fail = load(path.join(run, "choose-native-01/report.json"));
  const native = load(path.join(run, "native-computer-use-review.json"));
  check("Frozen installation unchanged, real packaged backend and nonempty UI preflight completed", () => {
    for (const r of [prep, launch, fixture, ready, ui]) assert.equal(r.status, "PASS");
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(fixture.input), fixture.inputSha256);
    assert.equal(fixture.projectId, "installed-windows-export-isolated-20261018-02");
    assert.equal(ui.checks.length, 2); assert(ui.checks.every(c => c.status === "PASS")); assert.equal(ui.environmentState, "passed");
    assert.equal(launch.manualBackendSpawn, false); assert.equal(launch.dataDirectoryOverride, false);
    assert.equal(launch.webviewDirectoryOverride, false); assert.equal(launch.buildStorage.CARGO_TARGET_DIR, null);
    assert(ready.processes.some(p => p.Name === "creator-backend.exe" && p.ParentProcessId === launch.editorPid));
    const frozen = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560); for (const f of frozen.source) assert.equal(sha(f.path), f.sha256);
    return { productFiles: 560, UIpreflightChecks: 2, controlledProjectImportNotNativePicker: true };
  });
  check("Native input tool failure retained, no fake selection or build; physical QA packaging cache stays on F", () => {
    assert.equal(fail.status, "FAILED"); assert.equal(fail.checks.length, 1); assert(fail.error.includes("Timeout 150000ms"));
    assert.equal(native.status, "BLOCKED_TOOL_NATIVE_INPUT_NO_OBSERVED_CONFIRMATION");
    assert(!native.pickerMocked && !native.storeMutationUsedForOutputDirectory && !native.productFailureClaim && !native.windowsBuildStarted);
    assert.deepEqual(fs.readdirSync(fixture.output), []);
    const junction = native.environmentBoundary.buildCacheOnlyJunction;
    assert(fs.lstatSync(junction.path).isSymbolicLink());
    assert.equal(fs.realpathSync(junction.path).toLowerCase(), fs.realpathSync(junction.target).toLowerCase());
    assert.deepEqual(fs.readdirSync(junction.target), []);
    return { directoryNavigationObserved: true, nativeConfirmation: "BLOCKED", actualNewExecutables: 0,
      testOnlyCacheJunctionUnused: true, repeatedClickLoop: false };
  });
  check("Actual2 native WebView PNGs retain matching viewport/DPR/bytes, not OS picker screenshots", () => {
    for (const s of ui.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshotCount++;
    }
    assert.equal(report.screenshotCount, 2);
    return { nativeWebViewPNGs: report.screenshotCount, osPickerPNGsRetained: false, fullMatrixClaim: false };
  });
  check("All4 original profiles55 files restored, original DB/Dev/pendingMSI untouched and owned processes3 ports empty", () => {
    const restored = load(path.join(run, "profile-restoration.json")), stopped = load(path.join(run, "native-picker-blocked-stop.json"));
    assert.equal(restored.status, "PASS"); assert.equal(stopped.status, "PASS"); assert.deepEqual(stopped.after, []);
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    const incident = load(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    const ports = [8278, launch.cdpPort, launch.playerCdpPort];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaLive=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaLive;ports=$qaPorts}|ConvertTo-Json -Depth 5
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const state = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.deepEqual(state.processes, []); assert.deepEqual(state.ports, []);
    return { restoredFiles: count, ...state, normalCloseClaim: false };
  });
  assert.equal(report.checks.length, 4); report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, windowsExportStatus: report.windowsExportStatus,
    checks: report.checks.length, screenshots: report.screenshotCount, error: report.error, out }, null, 2));
}
