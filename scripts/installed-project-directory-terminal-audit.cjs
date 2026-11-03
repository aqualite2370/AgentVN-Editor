"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-project-directory-20261018-01", out = process.argv[2];
assert(out && !fs.existsSync(out));
const sha = f => sha256(fs.readFileSync(f)), read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", projectDirectoryStatus: "BLOCKED",
  at: new Date().toISOString(), checks: [], inputs: [], commands: [], screenshots: 0,
  productChanges: 0, realModelRequests: 0, error: null };
function load(name) {
  const file = path.join(run, name); report.inputs.push({ path: file, sha256: sha(file) }); return read(file);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const prep = load("preparation.json"), fixture = load("fixtures.json"), first = load("launch.json"), second = load("launch-02.json");
  const backend = load("backend-ready.json"), nextBackend = load("backend-ready-02.json");
  const seed = load("seed-01/report.json"), choice = load("choose-a-01/report.json");
  const native = load("choose-a-01/native-computer-use-review.json");
  const defaults = load("default-restart-01/report.json"), matrix = load("matrix-01/report.json");
  const collision = load("collision-01/report.json"), retained = load("download-retention.json");
  await check("Actual frozen NSIS1.9.9 Editor and automatically started packaged backends, isolated fixtures and560 product sources remain identified", () => {
    for (const r of [prep, fixture, first, second, backend, nextBackend]) assert.equal(r.status, "PASS");
    for (const l of [first, second]) {
      assert.equal(l.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
      assert.equal(sha(path.join(l.installRoot, "agentvn-editor.exe")), l.executableSha256);
      assert(!l.manualBackendSpawn && !l.dataDirectoryOverride && !l.webviewDirectoryOverride);
    }
    assert.equal(sha(path.join(second.installRoot, "creator-backend.exe")), nextBackend.backendSha256);
    assert.equal(fixture.projects.length, 2);
    for (const p of fixture.projects) assert.equal(sha(p.input), p.sha256);
    const frozen = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    assert.equal(frozen.source.length, 560);
    for (const s of frozen.source) assert.equal(sha(s.path), s.sha256);
    return { installedEditor: first.executableSha256, projects: 2, originalProfilesProtectedBeforeLaunch: 4,
      frozenProductSourcesMatched: 560, nativeProjectImportClaim: false };
  });
  await check("Native picker blockage remains separate from product failure and never becomes a passing custom-directory workflow", () => {
    assert.equal(seed.status, "PASS"); assert.equal(seed.checks.length, 2);
    assert.equal(choice.status, "FAILED"); assert(choice.error.includes("Timeout 120000ms exceeded"));
    assert.equal(native.status, "BLOCKED_TOOL_NATIVE_INPUT_NO_OBSERVED_RESPONSE");
    assert.equal(native.productFailureClaim, false); assert.equal(native.directPowershellUIAutomationUsed, false);
    assert.equal(native.observedWindow.title, choice.nativeInput.title);
    assert.equal(native.observedFieldValue, fixture.directory);
    assert.equal(defaults.checks[0].status, "PASS");
    return { nativeChooser: "BLOCKED", rawFailedRunPreserved: true, pathFieldSetButConfirmationNotObserved: true,
      customSaveAndSwitch: "NOT_RUN_DEPENDS_ON_NATIVE_CHOICE", cancel: "NOT_RUN", missingDirectory: "NOT_RUN",
      ACLRefusal: "NOT_RUN", browserDownloads: "NOT_RUN", productDefectInferredFromToolTimeout: false };
  });
  await check("Real frontend/backend restart and default-path saves are supported by native packages, not preference-store-only tests", () => {
    assert.equal(defaults.status, "PASS"); assert.equal(defaults.artifacts.length, 2);
    assert.notEqual(defaults.realRestart.editorBefore, defaults.realRestart.editorAfter);
    assert(defaults.realRestart.backendBefore.every(pid => !defaults.realRestart.backendAfter.includes(pid)));
    assert.notEqual(defaults.artifacts[0].path, defaults.artifacts[1].path);
    assert.equal(defaults.pageErrors.length, 0);
    return { actualEditorRestart: true, actualBackendRestart: true, nativeSaves: 2,
      configuredDirectoryRestartClaim: false };
  });
  await check("Actual12 viewport/DPR/media combinations keep native-directory controls visible, hit-testable and nonoverlapping", () => {
    assert.equal(matrix.status, "PASS"); assert.equal(matrix.checks.length, 12); assert.equal(matrix.pageErrors.length, 0);
    const keys = new Set();
    for (const c of matrix.checks) {
      assert.equal(c.status, "PASS");
      const { expected: e, metrics } = c.detail; keys.add(`${e.width}/${e.height}/${e.dpr}/${e.reduced}`);
      assert.equal(metrics.controls.length, 2); assert(metrics.overflow <= 1);
      for (const b of metrics.controls) assert(b.hit && b.rect.left >= 0 && b.rect.top >= 0 && b.rect.right <= e.width && b.rect.bottom <= e.height);
      const [a, b] = metrics.controls.map(c => c.rect);
      assert(Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) <= .1);
    }
    assert.equal(keys.size, 12);
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const r of [false, true])
      assert(keys.has(`${w}/${h}/${d}/${r}`));
    return { actualParameterCombinations: 12, directorySelectionCompleted: false, screenshotOnlyClaim: false };
  });
  await check("Real filename collision selects a suffixed package, preserves all originals, and all34 generated files remain recoverable onF", async () => {
    assert.equal(collision.status, "PASS"); assert.equal(collision.artifacts.length, 1);
    assert.equal(collision.collisionSetup.files.length, 31);
    assert(collision.artifacts[0].path.endsWith("-1.vnproj"));
    const actualOriginal = collision.checks[0].detail.actuallyCollidedWith;
    assert(collision.collisionSetup.files.some(f => f.path === actualOriginal));
    assert.equal(retained.status, "PASS"); assert.equal(retained.rows.length, 34);
    const actual = [...defaults.artifacts, ...collision.collisionSetup.files, ...collision.artifacts];
    for (const f of actual) {
      const row = retained.rows.find(r => r.source === f.path);
      assert(row && row.sourceRemoved && row.copyVerified && !fs.existsSync(row.source));
      assert.equal(row.sha256, f.sha256); assert.equal(sha(row.retained), f.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(row.retained));
      const p = JSON.parse(await zip.file("project.json").async("string"));
      assert.equal(p.project_id, fixture.projectId);
      assert(!JSON.stringify(p).includes("projectExportDirectories"));
      assert(!JSON.stringify(p).includes(fixture.directory));
    }
    return { actualNativeExports: 3, controlledValidCollisionCopies: 31, preservedBytesFiles: 34,
      remainingOwnedDownloads: 0, projectPreferenceLeakedIntoPortable: false };
  });
  await check("Every raw native PNG retains actual viewport/DPR/media and SHA, without claiming it captures the OS picker", () => {
    for (const r of [seed, choice, defaults, matrix, collision]) for (const s of r.screenshots) {
      const b = fs.readFileSync(s.path);
      assert.equal(sha256(b), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshots++;
    }
    assert(report.screenshots >= 16);
    return { nativeWebviewPNGs: report.screenshots, nativeOSPickerClaimFromCDPScreenshot: false };
  });
  await check("Four original profiles restored with55 independent hashes, DB/Dev/MSI unchanged and no owned process/port remains", () => {
    const stop = load("final-stop.json"), previousStop = load("native-blocked-stop.json"), restored = load("profile-restoration.json");
    for (const r of [stop, previousStop, restored]) assert.equal(r.status, "PASS");
    assert.equal(stop.after.length, 0);
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const original = read("D:/AgentVN/output/host-msi-session-20261018-01/incident-audit-01.json");
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), original.userPersistence.databaseSha256);
    assert.equal(sha(path.join(original.actualInstallation.path, "agentvn-editor.exe")), original.actualInstallation.executableSha256);
    const ports = [8278, first.cdpPort, first.playerCdpPort, second.cdpPort, second.playerCdpPort];
    const state = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    assert.equal(state.status, 0, state.stderr);
    const remaining = JSON.parse(state.stdout.replace(/^\uFEFF/, ""));
    assert.equal(remaining.processes.length, 0); assert.equal(remaining.ports.length, 0);
    return { profiles: 4, independentHashes: 55, portsChecked: ports, ...remaining,
      normalWindowCloseClaim: false };
  });
  await check("Supporting preference-store regression and new test-tool syntax are actually executed without substituting for installed chooser", () => {
    for (const args of [
      ["scripts/project-export-directory-preferences-test.cjs"],
      ["scripts/full-regression-evidence-test.cjs"],
      ...["fixtures", "behavior", "retain-downloads", "terminal-audit"].map(n => ["--check", `scripts/installed-project-directory-${n}.cjs`])
    ]) {
      const p = spawnSync(process.execPath, args, { cwd: "D:/AgentVN", encoding: "utf8", windowsHide: true, timeout: 60000 });
      report.commands.push({ command: `node ${args.join(" ")}`, exitCode: p.status, stdout: p.stdout, stderr: p.stderr });
      assert.equal(p.status, 0, p.stderr);
    }
    return { commands: report.commands.length, realChooserStatus: "BLOCKED", sourceTestsDoNotCloseInstalledGap: true };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS";
})().catch(e => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus,
    projectDirectoryStatus: report.projectDirectoryStatus, checks: report.checks.length,
    screenshots: report.screenshots, error: report.error, out }, null, 2));
});
