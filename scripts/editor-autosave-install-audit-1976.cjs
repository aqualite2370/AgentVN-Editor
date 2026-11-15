"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const cp = require("node:child_process");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const base = "F:/testavn/Windows-Isolated-1976-20261116-05";
const metadataBase = "F:/testavn/Windows-Isolated-1976-20261116-04";
const priorBase = "F:/testavn/Windows-Isolated-1976-20261116-01";
const releaseBase = "F:/testavn/Editor-Autosave-Release-1976-20261116-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const mode = process.argv[2];
assert(["--audit", "--archive"].includes(mode)); assert.equal(process.argv.length, 3);
if (mode === "--archive") {
  assert.equal(read(path.join(base, "terminal-audit-01.json")).status, "PASS_TARGETED_REUSED_INSTALL_DEFAULT_PROFILE_METADATA_RECOVERY");
  function copy(source, target, files) {
    const item = fs.lstatSync(source); assert(!item.isSymbolicLink());
    if (item.isDirectory()) {
      if (path.basename(source) === "__pycache__") return;
      fs.mkdirSync(target);
      for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(target, name), files);
    } else {
      assert(/\.(cjs|ps1|psm1|py)$/.test(source), "Retain source only: " + source);
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); assert.equal(sha(source), sha(target));
      files.push({ source, ...desc(target) });
    }
  }
  for (const directory of [base, priorBase, "F:/testavn/Windows-Isolated-1976-20261116-02",
    "F:/testavn/Windows-Isolated-1976-20261116-03", metadataBase]) {
    const output = path.join(directory, "qa-sources.json"), to = path.join(directory, "qa-sources"), files = [];
    assert(!fs.existsSync(output)); assert(!fs.existsSync(to));
    if (directory === priorBase || directory.endsWith("-03") || directory === metadataBase) {
      assert.equal(read(path.join(directory, "account-retirement-01.json")).status, "PASS");
      assert.equal(read(path.join(directory, "resource-01/report.json")).status, "FAILED");
    }
    if (directory.endsWith("-02")) {
      assert.equal(read(path.join(directory, "preflight-failure-01.json")).accountsCreated, 0);
      assert(!fs.existsSync(path.join(directory, "account-controller.json")));
    }
    copy(path.join(directory, "harness/scripts"), to, files);
    fs.writeFileSync(output, JSON.stringify({ status: "PASS", at: new Date().toISOString(), files }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "PASS", files: files.length, output }));
  }
} else {
  const output = path.join(base, "terminal-audit-01.json"); assert(!fs.existsSync(output));
  const r = { status: "RUNNING", at: new Date().toISOString(), checks: [], inputs: [], models: 0, productRestarts: 0 };
  const verify = v => assert.equal(sha(v.path), v.sha256, v.path);
  const input = f => { r.inputs.push(desc(f)); return read(f); };
  const check = (name, fn) => r.checks.push({ name, status: "PASS", detail: fn() });
  try {
    const run = input(path.join(base, "resource-01/report.json"));
    const build = input(path.join(releaseBase, "release/build.json"));
    const staging = input(path.join(base, "staging.json"));
    const control = input(path.join(base, "account-controller.json"));
    const retired = input(path.join(base, "account-retirement-01.json"));
    check("one new real Editor candidate with old frozen installer and protected checkout", () => {
      assert.equal(build.version, "1.9.76");
      assert.equal(build.status, "PASS_EDITOR_DEV_NSIS_AND_PAYLOAD_ACTUAL_INSTALL_NOT_RUN");
      for (const f of [build.installer, build.sourceInstaller, build.dev, build.player, build.backend, build.source, build.payloadReport]) verify(f);
      const before = input(path.join(releaseBase, "checkpoint.json"));
      verify(before.daily);
      const git = args => cp.execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
      assert.equal(git(["rev-parse", "HEAD"]), before.head); verify(before.index);
      const frozen = input("F:/testavn/Editor-Recovery-20261115-01/release/build.json"); verify(frozen.installer);
      assert.equal(frozen.version, "1.9.75");
      assert.equal(input(path.join(releaseBase, "version-gate.json")).status, "PASS");
      return { version: build.version, installer: build.installer, frozenPreviousUnchanged: true,
        dailyAndRealHeadIndexUnchanged: true, standalonePlayerBuilds: build.standalonePlayerBuilds, androidBuilds: build.androidBuilds };
    });
    check("actual installed bytes reused, fresh default-profile workflows and two natural closes", () => {
      assert.equal(run.status, "PASS"); assert.equal(run.stages.length, 7);
      assert.equal(run.scope, "REUSE_ACTUAL_1976_INSTALL_FRESH_DEFAULT_QA_PROFILE_METADATA_RECOVERY_NOT_CONTINUOUS_UPGRADE");
      assert(run.stages.every(s => s.status === "PASS")); assert.equal(run.launches.length, 2);
      const old = input(path.join(priorBase, "install-old.json")), next = input(path.join(priorBase, "install-new.json"));
      assert.equal(old.status, "PASS"); assert.equal(next.status, "PASS");
      assert.equal(old.executable.version, "1.9.75"); assert.equal(next.executable.version, "1.9.76");
      assert.equal(old.installRoot, next.installRoot);
      verify(run.inheritedInstall.receipt); verify(run.inheritedInstall.failedRun);
      const failed = input(path.join(priorBase, "resource-01/report.json"));
      assert.equal(failed.status, "FAILED"); assert.equal(failed.stages[0].status, "PASS");
      assert(failed.error.includes("Every installed byte"));
      assert.equal(next.executable.sha256, input(build.payloadReport.path).deployments[0].executable.sha256);
      assert.equal(run.installations, 0); assert.equal(run.cleanups.length, 2);
      for (const close of run.cleanups) {
        assert.equal(close.method, "WM_CLOSE"); assert.deepEqual(close.killed, []);
        assert(close.receipt.normalClose); assert.equal(close.receipt.physicalInput, false);
        verify(close.receipt.request); verify(close.receipt.nativeEvidence);
      }
      assert.equal(run.controlledNativeIPC, false); assert.equal(run.storeInjection, false);
      return { stages: 7, launches: 2, naturalCloses: 2, defaultDatabase: run.launches[0].database,
        repeatedInstallations: 0, continuousUpgradeReadback: "NOT_RUN_ORIGINAL_MARKER_QA_FAILED" };
    });
    check("real metadata recovery files, physical fault and pre-restore safety point", () => {
      verify(run.metadataPointOrigin.report);
      const metadata = input(path.join(metadataBase, "resource-01/report.json"));
      assert.equal(metadata.status, "FAILED");
      assert(metadata.error.includes("strict mode violation"));
      assert.equal(metadata.stages[2].status, "PASS");
      assert.equal(metadata.stages[2].name, "title-author-and-setting-have-real-native-recovery-points-with-unchanged-nodes");
      assert.deepEqual(run.metadataPointOrigin.stage, metadata.stages[2]);
      assert.equal(metadata.backupEvidence.length, 3);
      for (const backup of metadata.backupEvidence) { verify(backup.retained); verify(backup.metadata); }
      assert.equal(run.backupEvidence.length, 5);
      const triggers = [];
      for (const backup of run.backupEvidence) {
        verify(backup.retained); verify(backup.metadata);
        const value = read(backup.retained.path), meta = read(backup.metadata.path);
        assert.equal(value.project_id, "qa-editor-autosave-upgrade-1976"); assert.equal(meta.projectId, value.project_id);
        assert(Array.isArray(value.nodes) && value.nodes.length > 0); triggers.push(meta.trigger);
      }
      assert(triggers.includes("before_restore"));
      assert(run.faultInjection.some(f => f.type === "OWNED_DEFAULT_PROFILE_DIRECTORY_REPLACED_WITH_FILE"));
      assert(run.faultInjection.some(f => f.restoredBlocker));
      for (const fault of run.faultInjection) if (fault.restoredBlocker) verify(fault.restoredBlocker);
      assert.equal(run.errors.length, 0); assert.equal(run.modelRequests, 0); assert.equal(run.blockedModelRequests || 0, 0);
      return { recoveryFiles: 5, metadataPointsInheritedFromFailedRun: 3,
        originalMetadataRunStatus: metadata.status, triggers, realNativeFailure: true, restoredExpected: run.restoredExpected };
    });
    check("actual viewport and captured image dimensions", () => {
      assert.equal(run.screenshots.length, 4);
      for (const shot of run.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
        assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
      }
      return { count: run.screenshots.length, physical4KClaim: false };
    });
    check("owned standard profile, account, processes and ports retired with DB retained", () => {
      assert.equal(control.status, "FINISHED"); assert.equal(control.jobs.length, 1);
      assert.equal(control.jobs[0].status, "PASS"); assert(control.account.createdByThisRun);
      assert.equal(retired.status, "PASS"); verify(retired.databaseEvidence);
      assert.equal(retired.account.sid, control.account.sid);
      assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
      const current = JSON.parse(ps(`@{account=[bool](Get-LocalUser -SID '${control.account.sid}' -ErrorAction SilentlyContinue);` +
        `profile=[bool](Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ '${control.account.sid}')}|ConvertTo-Json -Compress`));
      assert.equal(current.account, false); assert.equal(current.profile, false);
      assert(!fs.existsSync(retired.account.profile));
      assert.equal(run.cleanupStatus, "PASS");
      assert(!rows().some(p => run.editorKnown.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
      assert.equal(listeners([...new Set(run.launches.flatMap(l => l.ports))]).length, 0);
      assert.equal(input(path.join(base, "metadata-restoration.json")).status, "PASS");
      assert.equal(staging.guards, 16); assert.equal(staging.closes.rejectedCloseMisattributions, 10);
      return { sid: control.account.sid, deleted: true, databaseRetained: retired.databaseEvidence };
    });
    r.status = "PASS_TARGETED_REUSED_INSTALL_DEFAULT_PROFILE_METADATA_RECOVERY";
  } catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, checks: r.checks.length, error: r.error }));
  }
}
