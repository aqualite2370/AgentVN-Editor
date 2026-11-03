"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const repo = path.resolve(__dirname, ".."), run = path.join(repo, "output/host-nsis-cross-20261018-01");
const phase = path.join(run, "en-US"), destination = process.argv[2];
assert(destination && path.dirname(path.resolve(destination)) === run && !fs.existsSync(destination));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const report = { status: "BLOCKED", evidenceStatus: "RUNNING", sliceStatus: "RUNNING",
  scope: "REAL_CROSS_GENERATION_NSIS_MIGRATION_SAVE_RESTART_UNINSTALL_RESTORE_NOT_FULL_REGRESSION",
  startedAt: new Date().toISOString(), checks: [], inputs: [], screenshots: [], productChanges: 0,
  realModelRequests: 0, androidOperations: 0, error: null,
  limitations: ["Not a clean machine or no-developer-folder proof", "Actual viewport only, not a 12-combination matrix",
    "Attributed process termination, not normal native window close", "No old AI session/component UI existed"] };
function input(file) { report.inputs.push({ path: file, sha256: sha(file) }); return read(file); }
function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
try {
  const prep = input(path.join(run, "preparation.json")), checkpoint = input(path.join(run, "Checkpoint.json"));
  const old = input(path.join(run, "InstallOld.json")), next = input(path.join(run, "InstallNew.json"));
  const removed = input(path.join(run, "Uninstall.json")), restored = input(path.join(run, "RestoreInstallation.json"));
  const profiles = input(path.join(run, "profile-restoration.json"));
  const baseline = input(path.join(phase, "old-ui-data-created.json"));
  const first = input(path.join(phase, "new-ui-01/report.json"));
  const restart = input(path.join(phase, "restart-ui-01/report.json"));
  const exported = input(path.join(phase, "new-project-export.json"));
  const migration = input(path.join(phase, "actual-migration-audit.json"));
  const snapshot = input(path.join(phase, "before-uninstall-snapshot.json"));
  const preserved = input(path.join(phase, "after-uninstall-verify.json"));
  check("Trusted real NSIS packages and actual same-directory 1.7.1 -> 1.9.9 installation", () => {
    for (const row of [prep, checkpoint, old, next, removed, restored, profiles]) assert.equal(row.status, "PASS");
    assert.equal(old.actualVersion, "1.7.1"); assert.equal(next.actualVersion, "1.9.9");
    assert.equal(old.installRoot, next.installRoot); assert.equal(old.installerKind, "NSIS");
    for (const row of [old, next]) { assert.equal(row.exitCode, 0); assert.equal(sha(row.package), row.packageSha256); }
    assert.equal(next.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    return { actualOperations: 3, sourceVersions: [old.actualVersion, next.actualVersion] };
  });
  check("Real old UI save, new UI preservation/save ZIP and different-process restart", () => {
    for (const row of [baseline, first, restart, exported]) assert.equal(row.status, "PASS");
    assert.equal(baseline.checks.length, 3); assert.equal(first.checks.length, 6);
    assert.equal(restart.checks.length, 6); assert.equal(exported.checks.length, 5);
    assert.equal(sha(baseline.package.path), baseline.package.sha256);
    const a = input(path.join(phase, "new-launch.json")), b = input(path.join(phase, "restart-launch.json"));
    assert.equal(a.installerKind, "NSIS"); assert.equal(b.installerKind, "NSIS");
    assert.notEqual(a.processes[0].ProcessId, b.processes[0].ProcessId);
    for (const row of [a, b]) assert(!row.dataDirectoryOverride && !row.webviewDirectoryOverride && !row.manualBackendSpawn);
    assert.equal(first.resumedProject.metadata.projectId, baseline.project.metadata.projectId);
    assert.equal(restart.resumedProject.metadata.projectId, baseline.project.metadata.projectId);
    return { oldChecks: 3, firstChecks: 6, zipChecks: 5, restartChecks: 6, pids: [a.processes[0].ProcessId, b.processes[0].ProcessId] };
  });
  check("Actual consent and archived real old/new SQLite remain independently provable after profile restoration", () => {
    assert.equal(migration.status, "PASS"); assert.equal(migration.checks.length, 5);
    assert.equal(migration.nativeConsent.approved, true);
    assert.equal(migration.nativeConsent.sources[0], path.join(old.installRoot, "data/backend/vn_engine.db").replaceAll("/", "\\"));
    const oldDB = snapshot.files.find(f => path.resolve(f.source) === path.resolve(migration.databases.old.path));
    const newDB = snapshot.files.find(f => path.resolve(f.source) === path.resolve(migration.databases.current.path));
    const decision = snapshot.files.find(f => f.source.endsWith("database-migration-decision.json"));
    assert(oldDB && newDB && decision);
    assert.equal(sha(oldDB.backup), migration.databases.old.sha256);
    assert.equal(sha(newDB.backup), migration.databases.current.sha256);
    assert.equal(read(decision.backup).approved, true);
    const states = [];
    for (const file of [oldDB.backup, newDB.backup]) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
        const rows = db.prepare("SELECT project_id,project_json FROM editor_project_details").all(); assert.equal(rows.length, 1);
        assert.equal(rows[0].project_id, baseline.project.metadata.projectId); states.push(JSON.parse(rows[0].project_json));
      } finally { db.close(); }
    }
    assert.deepEqual(states[0].edges, states[1].edges);
    assert.deepEqual(states[0].nodes.map(n => n.id), states[1].nodes.map(n => n.id));
    assert.equal(states[1].nodes.find(n => n.id === "node_scene_opening").data.scene.summary, "覆盖升级后实际编辑保存_1.9.9_20261018");
    return { oldDatabaseBackup: oldDB.backup, newDatabaseBackup: newDB.backup, nativeConsentBackup: decision.backup };
  });
  check("Actual upgraded installation resources and uninstall preserve all test persistence bytes", () => {
    const resources = input(path.join(phase, "installed-resource-audit.json"));
    assert.equal(resources.status, "PASS"); assert(resources.scope.includes("NSIS"));
    assert.equal(resources.files.length, 28); assert.equal(resources.scriptCount, 19);
    assert.equal(preserved.status, "PASS"); assert.equal(preserved.files.length, 28);
    assert(preserved.files.every(f => f.match)); assert.equal(removed.exitCode, 0);
    assert(!fs.existsSync(path.join(old.installRoot, "agentvn-editor.exe")));
    for (const file of snapshot.files) assert.equal(sha(file.backup), file.sha256);
    return { resources: 28, preservedFilesAfterUninstall: 28 };
  });
  check("Screenshots are real final Editor frames with measured pixel/DPR identity, not a full matrix", () => {
    for (const row of [baseline, first, restart]) {
      if (row !== baseline) assert(row.presentationReady.entryOverlayAbsent && row.presentationReady.containerIdle);
      for (const shot of row.screenshots) {
        assert.equal(sha(shot.path), shot.sha256);
        const bytes = fs.readFileSync(shot.path);
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        assert.equal(bytes.readUInt32BE(16), Math.round(shot.before.width * shot.before.dpr));
        assert.equal(bytes.readUInt32BE(20), Math.round(shot.before.height * shot.before.dpr));
        assert.deepEqual(shot.before, shot.after);
        report.screenshots.push(shot);
      }
    }
    assert.equal(report.screenshots.length, 7);
    return { screenshots: 7, actualViewport: report.screenshots[0].before };
  });
  check("Original installation files and independent complete backup still match", () => {
    const backup = input(checkpoint.originalInstallation.backup);
    assert.equal(sha(checkpoint.originalInstallation.backup), checkpoint.originalInstallation.sha256);
    for (const file of backup.files) {
      assert.equal(sha(path.join(backup.source, file.relative)), file.sha256);
      assert.equal(sha(path.join(backup.backupRoot, "installation", file.relative)), file.sha256);
    }
    assert.equal(backup.files.length, 12848);
    return { files: backup.files.length, originalWasUnchanged: restored.originalInstallationWasUnchanged };
  });
  check("All four original default profiles restored with 55 independent persistent hashes", () => {
    let count = 0; assert.equal(prep.profiles.length, 4);
    for (const row of prep.profiles) {
      assert(!fs.existsSync(row.held)); assert(fs.statSync(row.original).isDirectory());
      for (const file of row.files) {
        assert.equal(sha(path.join(row.original, file.relative)), file.sha256);
        assert.equal(sha(file.backup), file.sha256); count++;
      }
    }
    assert.equal(count, 55); return { originalFiles: count, profiles: 4 };
  });
  check("Original registry/shortcuts restored and no run process or CDP/backend listener remains", () => {
    const script = `[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
      $keys=@('HKCU:\\Software\\agentvn\\AgentVN Editor','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor')
      $reg=@(foreach($p in $keys){$k=Get-Item -LiteralPath $p;@{path=$p;values=@(foreach($n in $k.GetValueNames()){@{name=$n;kind=[string]$k.GetValueKind($n);value=$k.GetValue($n)}})}})
      @{registry=$reg;processes=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId);
        ports=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(8278,65199,63290,63521)}|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 10`;
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, encoding: "utf8", timeout: 20000 });
    assert.ifError(p.error); assert.equal(p.status, 0, p.stderr);
    const state = JSON.parse(p.stdout);
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    const sort = rows => [...rows].sort((a, b) => a.name.localeCompare(b.name));
    for (const row of checkpoint.registry) assert.deepEqual(sort(state.registry.find(r => r.path === row.path).values), sort(row.values));
    for (const row of checkpoint.shortcuts) { assert.equal(sha(row.path), row.sha256); assert.equal(sha(row.backup), row.sha256); }
    report.liveEnvironment = state; return { processes: 0, ports: 0, originalShortcuts: checkpoint.shortcuts.length, registryKeys: 2 };
  });
  check("Frozen product/Dev unchanged and the original tool failure remains preserved", () => {
    const frozen = input(path.join(repo, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560); for (const file of frozen.source) assert.equal(sha(file.path), file.sha256);
    assert.equal(sha(path.join(repo, "AgentVN Dev.exe")), checkpoint.devSha256);
    const rejected = input(path.join(phase, "old-owned-termination.json"));
    assert.equal(rejected.status, "FAILED"); assert.equal(rejected.stopped.length, 0);
    for (const name of ["old-owned-termination-attempt02.json", "new-owned-termination.json", "restart-owned-termination.json"]) {
      assert.equal(input(path.join(phase, name)).status, "PASS");
    }
    return { sourceHashes: 560, devSha256: checkpoint.devSha256, normalCloseRetest: false };
  });
  check("Downloaded test package byte evidence retained or explicitly pending exact cleanup", () => {
    const retainedFile = path.join(run, "downloads-retention.json");
    if (fs.existsSync(retainedFile)) {
      const retained = input(retainedFile); assert.equal(retained.status, "PASS");
      const row = retained.rows.find(r => r.source === exported.package.path); assert(row);
      assert.equal(row.sha256, exported.package.sha256); assert(row.copyVerified && row.sourceRemoved);
      assert(!fs.existsSync(row.source)); assert.equal(sha(row.retained), row.sha256);
      report.sliceStatus = "PASS";
      return { retainedExports: retained.rows.length, downloadsCleaned: true };
    }
    assert.equal(sha(exported.package.path), exported.package.sha256);
    report.sliceStatus = "PENDING_EXACT_DOWNLOAD_RETENTION";
    return { downloadsCleaned: false, pending: exported.package.path, bytes: exported.package.bytes };
  });
  report.evidenceStatus = "PASS";
} catch (error) { report.evidenceStatus = "FAILED"; report.sliceStatus = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus,
    sliceStatus: report.sliceStatus, checks: report.checks.length, error: report.error, report: destination }, null, 2));
}
