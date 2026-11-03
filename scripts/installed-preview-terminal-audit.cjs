"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), run = path.join(root, "output/installed-preview-20261018-01");
const destination = process.argv[2];
assert(destination && !fs.existsSync(destination), "Fresh audit report required");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", evidenceStatus: "RUNNING", productStatus: "FAILED",
  scope: "INDEPENDENT_INSTALLED_PREVIEW_EVIDENCE_AND_ORIGINAL_PROFILE_RESTORATION",
  startedAt: new Date().toISOString(), checks: [], error: null };
function check(name, callback) {
  const detail = callback();
  report.checks.push({ name, status: "PASS", detail });
}
try {
  const prep = read(path.join(run, "preparation.json"));
  const launch = read(path.join(run, "launch.json"));
  const external = read(path.join(run, "external-03/report.json"));
  const node = read(path.join(run, "node-01/report.json"));
  const maintenance = read(path.join(run, "maintenance-01/report.json"));
  const defect = read(path.join(run, "maintenance-audit-01.json"));
  check("Real installed Editor, automatic packaged backend and external player identities", () => {
    assert.equal(launch.status, "PASS");
    assert.equal(launch.manualBackendSpawn, false);
    assert.equal(launch.dataDirectoryOverride, false);
    assert.equal(launch.webviewDirectoryOverride, false);
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
    const ready = read(path.join(run, "backend-ready.json"));
    assert.equal(ready.status, "PASS");
    assert.equal(sha(path.join(launch.installRoot, "creator-backend.exe")), ready.backendSha256);
    const payload = read(path.join(root, "output/full-regression-20261017-01/candidate-payload-audit/installer-resource-report.json"))
      .deployments.find(d => d.kind === "NSIS actual payload");
    assert.equal(launch.executableSha256, payload.executable.sha256);
    const expectedPlayer = payload.runtimeProvenance.find(p => p.name === "agentvn-player.exe");
    assert(expectedPlayer);
    assert.equal(external.playerProcesses.length, 1);
    const player = external.playerProcesses[0];
    assert.equal(player.ParentProcessId, launch.editorPid);
    assert.equal(player.ExecutablePath.toLowerCase(), path.join(launch.installRoot, "agentvn-player.exe").toLowerCase());
    assert.equal(sha(player.ExecutablePath), expectedPlayer.expectedSha256);
    assert.equal(player.sha256, expectedPlayer.expectedSha256);
    return { editor: launch.executableSha256, backend: ready.backendSha256, player: player.sha256 };
  });
  check("External preview and separate embedded preview have nonempty real behavior results", () => {
    assert.equal(external.status, "PASS");
    assert.equal(external.checks.length, 7);
    assert(external.checks.every(c => c.status === "PASS"));
    assert.equal(node.status, "PASS");
    assert.equal(node.checks.length, 3);
    assert(node.checks.every(c => c.status === "PASS"));
    const fixture = read(path.join(root, "scripts/fixtures/installed-preview-isolated.vnproj"));
    assert.equal(external.projectBefore.metadata.projectId, fixture.project_id);
    assert.equal(external.exportedScript.game_id, fixture.project_id);
    const narration = fixture.nodes.find(n => n.id === "preview-scene").data.scene.commands[0].text;
    assert(external.exportedScript.scenes.some(s => s.commands.some(c => c.type === "narration" && c.text === narration)));
    return { externalAssertions: 7, nodeAssertions: 3, isolatedProjectId: fixture.project_id,
      inputSha256: sha(path.join(root, "scripts/fixtures/installed-preview-isolated.vnproj")) };
  });
  check("HOST-03 real reload failure is retained and independently confirmed, not counted as PASS", () => {
    assert.equal(maintenance.status, "FAILED");
    assert.equal(defect.productStatus, "FAILED");
    assert.equal(defect.evidenceStatus, "PASS");
    assert.equal(defect.checks.length, 5);
    assert.deepEqual(maintenance.expectedNodeIds, ["preview-scene", "start"]);
    assert.deepEqual(maintenance.renderedNodeIds, ["node_scene_opening", "start"]);
    assert.equal(defect.persistedGraphStatus, "ORIGINAL_IMPORTED_GRAPH_STILL_CORRECT_AT_OBSERVATION");
    return { defect: defect.defect, noPersistedLossClaimed: true, errorRetryTest: "NOT_RUN",
      desktopFullMatrix: "NOT_RUN" };
  });
  check("Eight actual native WebView captures retain their declared parameters and raw PNG pixels", () => {
    let count = 0;
    for (const behavior of [external, node, maintenance]) {
      for (const screenshot of behavior.screenshots) {
        assert.equal(sha(screenshot.path), screenshot.sha256);
        assert.deepEqual(screenshot.before, screenshot.after);
        assert.deepEqual(screenshot.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
        const bytes = fs.readFileSync(screenshot.path);
        assert.equal(bytes.readUInt32BE(16), 1920);
        assert.equal(bytes.readUInt32BE(20), 1080);
        count++;
      }
    }
    assert.equal(count, 8);
    return { captures: count, scope: "Real WebView emulation, not full desktop matrix" };
  });
  check("Original four profiles restored and 55 files match independent backups", () => {
    const restoration = read(path.join(run, "profile-restoration.json"));
    assert.equal(restoration.status, "PASS");
    assert.equal(restoration.profiles.length, 4);
    let count = 0;
    for (const profile of prep.profiles) {
      assert(fs.existsSync(profile.original));
      assert(!fs.existsSync(profile.held));
      for (const file of profile.files) {
        assert.equal(sha(path.join(profile.original, file.relative)), file.sha256);
        assert.equal(sha(file.backup), file.sha256);
        count++;
      }
    }
    assert.equal(count, 55);
    return { profiles: 4, files: count, testProfiles: "Separately retained; not deleted or merged" };
  });
  check("Normal close failure remains FAILED; attributed residual cleanup and terminal state are clean", () => {
    const close = read(path.join(run, "close-audit.json"));
    assert.equal(close.status, "FAILED");
    assert.equal(close.ownedResidualCleanup, "PASS");
    assert(close.residuals.length > 0);
    assert(close.residuals.every(r => r.defect === "HOST-02_BACKEND_SURVIVES_NORMAL_CLOSE"));
    const state = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $ErrorActionPreference='Stop'
      $processes=@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')
      }|Select-Object Name,ProcessId,ExecutablePath)
      $ports=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(8278,${launch.cdpPort},${launch.playerCdpPort})}|
        Select-Object LocalPort,OwningProcess)
      @{processes=$processes;ports=$ports}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    assert.equal(state.status, 0, state.stderr);
    const actual = JSON.parse(state.stdout.replace(/^\uFEFF/, ""));
    assert.equal(actual.processes.length, 0);
    assert.equal(actual.ports.length, 0);
    assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    const original = read(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha(path.join(original.actualInstallation.path, "agentvn-editor.exe")), original.actualInstallation.executableSha256);
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), original.userPersistence.databaseSha256);
    return { ...actual, originalDevAndDbUnchanged: true, pendingMsiExeUnchanged: true,
      defect: "HOST-02", residuals: close.residuals };
  });
  check("Earlier execution failures preserved with no product rebuild or paid model request", () => {
    for (const folder of ["preflight-01", "external-01", "external-02"]) {
      assert.equal(read(path.join(run, folder, "report.json")).status, "FAILED");
    }
    assert.equal(external.realModelRequests, 0);
    assert.equal(node.realModelRequests, 0);
    assert.equal(launch.realModelRequests, 0);
    return { historicalToolFailuresRetained: 3, paidModelRequests: 0, productChanges: 0,
      normalCloseDefectNotHiddenByCleanup: true };
  });
  report.status = "PASS";
  report.evidenceStatus = "PASS";
  report.g11Status = "FAILED";
  report.remaining = ["Native start failure and retry not yet executed", "Full 12-combination preview/UI matrix not executed",
    "MSI historical-directory decision still required", "Other full regression groups remain open"];
} catch (error) {
  report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(error.stack || error);
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, productStatus: report.productStatus,
  checks: report.checks.length, error: report.error, destination }, null, 2));
