"use strict";
// Read-only evidence/safety audit while the REAL native migration prompt waits.
// This does not approve migration, write the test DB, or operate a window.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, ".."), run = path.join(repo, "output/host-nsis-cross-20261018-01");
const phase = path.join(run, "en-US"), out = process.argv[2];
assert(out && path.dirname(path.resolve(out)) === run && !fs.existsSync(out), "Fresh exact run receipt required");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "BLOCKED", evidenceStatus: "RUNNING", at: new Date().toISOString(),
  scope: "REAL_NSIS_171_TO_199_UPGRADE_PRE_NATIVE_CONSENT_NOT_MIGRATION_PASS",
  blocker: "NATIVE_MIGRATION_USER_APPROVAL_REQUIRED_COMPUTER_USE_PIPE_UNAVAILABLE",
  checks: [], productChanges: 0, realModelRequests: 0, physicalInputVerified: false,
  sources: [], error: null };
function load(file) { report.sources.push({ path: file, sha256: sha(file) }); return read(file); }
function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
try {
  const prep = load(path.join(run, "preparation.json")), checkpoint = load(path.join(run, "Checkpoint.json"));
  const oldInstall = load(path.join(run, "InstallOld.json")), newInstall = load(path.join(run, "InstallNew.json"));
  const oldUI = load(path.join(phase, "old-ui-01/report.json"));
  const before = load(path.join(phase, "before-upgrade-snapshot.json"));
  const preserved = load(path.join(phase, "before-upgrade-verify.json"));
  const payload = load(path.join(phase, "installed-resource-audit.json"));
  const launch = load(path.join(phase, "new-launch.json"));
  check("Actual old install, real UI save, in-place new install and prelaunch disk/resource preservation", () => {
    for (const item of [prep, checkpoint, oldInstall, newInstall, oldUI, before, preserved, payload, launch]) assert.equal(item.status, "PASS");
    assert(prep.blankDefaultProfiles); assert.equal(prep.qaSeed.length, 0);
    assert.equal(oldInstall.actualVersion, "1.7.1"); assert.equal(newInstall.actualVersion, "1.9.9");
    assert.equal(oldInstall.installRoot, newInstall.installRoot);
    assert.equal(oldUI.scope, "OLD_NSIS_REAL_UI_PROJECT_CREATION_AND_SAVE");
    assert.equal(launch.installerKind, "NSIS");
    assert(!launch.dataDirectoryOverride && !launch.webviewDirectoryOverride && !launch.manualBackendSpawn);
    assert.equal(payload.files.length, 28); assert.equal(payload.scriptCount, 19);
    assert.equal(sha(oldUI.package.path), oldUI.package.sha256);
    return { oldUiChecks: oldUI.checks.length, preservedFiles: preserved.files.length, installedResources: payload.files.length };
  });
  check("Live native prompt belongs to the just-installed candidate; no injected consent or manually started backend", () => {
    const owner = launch.processes.find(p => p.Name === "agentvn-editor.exe"); assert(owner);
    assert(Number.isInteger(owner.ProcessId));
    const script = `[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
      $all=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe'})
      $p=Get-Process -Id ${owner.ProcessId}
      @{window=@{pid=$p.Id;title=$p.MainWindowTitle;responding=$p.Responding};
      processes=@($all|Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CreationDate)}|ConvertTo-Json -Depth 6`;
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", script],
      { windowsHide: true, encoding: "utf8", timeout: 20000 });
    assert.ifError(p.error); assert.equal(p.status, 0, p.stderr);
    const native = JSON.parse(p.stdout);
    assert.equal(native.window.title, "迁移 AgentVN 项目数据"); assert(native.window.responding);
    assert.equal(native.processes.length, 1);
    assert.equal(native.processes[0].ProcessId, owner.ProcessId);
    assert.equal(native.processes[0].ExecutablePath, owner.ExecutablePath);
    assert.equal(native.processes[0].CreationDate, owner.CreationDate);
    assert.equal(sha(owner.ExecutablePath), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    const backend = "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend";
    assert(!fs.existsSync(path.join(backend, "database-migration-decision.json")));
    assert(!fs.existsSync(path.join(backend, "vn_engine.db")));
    report.nativePrompt = native;
    return { pid: owner.ProcessId, cdpPort: launch.cdpPort, title: native.window.title, backendCount: 0, consentWritten: false };
  });
  check("All four original profiles and independent persistent-file backups still match", () => {
    assert.equal(prep.profiles.length, 4); let count = 0;
    for (const row of prep.profiles) {
      assert(fs.statSync(row.held).isDirectory());
      for (const file of row.files) {
        assert.equal(sha(path.join(row.held, file.relative)), file.sha256);
        assert.equal(sha(file.backup), file.sha256); count++;
      }
    }
    assert.equal(count, 55); return { protectedOriginalFiles: count, originalProfilesRestoredYet: false };
  });
  check("Original frozen installation remains intact and independently backed up", () => {
    const original = load(checkpoint.originalInstallation.backup);
    assert.equal(sha(checkpoint.originalInstallation.backup), checkpoint.originalInstallation.sha256);
    for (const file of original.files) {
      assert.equal(sha(path.join(original.source, file.relative)), file.sha256);
      assert.equal(sha(path.join(original.backupRoot, "installation", file.relative)), file.sha256);
    }
    return { checkedOriginalAndBackupFiles: original.files.length, source: original.source };
  });
  check("Real old install-local SQLite remains untouched and all pre-upgrade backup bytes remain available", () => {
    assert.equal(before.files.length, 16);
    const oldFiles = before.files.filter(file => file.source.startsWith(path.join(launch.installRoot, "data") + path.sep));
    assert(oldFiles.some(file => file.source.endsWith("vn_engine.db")));
    for (const file of before.files) assert.equal(sha(file.backup), file.sha256);
    for (const file of oldFiles) assert.equal(sha(file.source), file.sha256);
    return { oldInstallLocalFiles: oldFiles.length, backupFiles: before.files.length,
      oldDatabase: path.join(launch.installRoot, "data/backend/vn_engine.db"),
      currentWebviewFilesExpectedToRemainByteIdenticalAfterLaunch: false };
  });
  check("Frozen product source and Dev unchanged; original safety-tool failure is retained", () => {
    const frozen = load(path.join(repo, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560);
    for (const file of frozen.source) assert.equal(sha(file.path), file.sha256, file.path);
    assert.equal(sha(path.join(repo, "AgentVN Dev.exe")), checkpoint.devSha256);
    const failure = load(path.join(phase, "old-owned-termination.json"));
    const recovered = load(path.join(phase, "old-owned-termination-attempt02.json"));
    assert.equal(failure.status, "FAILED"); assert.equal(failure.stopped.length, 0);
    assert.equal(recovered.status, "PASS"); assert(recovered.captureFile.endsWith("old-capture-audit-02.json"));
    return { frozenSourceHashes: 560, devSha256: checkpoint.devSha256, normalCloseClaim: false };
  });
  report.evidenceStatus = "PASS";
} catch (error) { report.evidenceStatus = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus,
    checks: report.checks.length, error: report.error, report: out }, null, 2));
}
