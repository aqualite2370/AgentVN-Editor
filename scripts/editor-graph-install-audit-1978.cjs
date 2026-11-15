"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const base = "F:/testavn/Windows-Isolated-1978-20261116-02";
const prior = "F:/testavn/Windows-Isolated-1978-20261116-01";
const release = "F:/testavn/Editor-Graph-Release-1978-20261116-01";
const source = "F:/testavn/Editor-Delete-Integrity-20261116-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const status = "PASS_INSTALLED_GRAPH_DELETE_ROUTE_UNDO_REDO_AND_DEFAULT_PROFILE_RESTART";
const mode = process.argv[2];
assert(["--audit", "--archive"].includes(mode)); assert.equal(process.argv.length, 3);
if (mode === "--archive") {
  assert.equal(read(path.join(base, "terminal-audit-01.json")).status, status);
  function copy(from, to, files) {
    const item = fs.lstatSync(from); assert(!item.isSymbolicLink(), "No linked QA source");
    if (item.isDirectory()) {
      if (path.basename(from) === "__pycache__") return;
      fs.mkdirSync(to);
      for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name), files);
    } else {
      assert(/\.(cjs|ps1|psm1|py)$/.test(from), "Unexpected source type: " + from);
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); assert.equal(sha(from), sha(to));
      files.push({ source: from, ...desc(to) });
    }
  }
  for (const directory of [prior, base]) {
    const files = [], target = path.join(directory, "qa-sources"), output = path.join(directory, "qa-sources.json");
    assert(!fs.existsSync(target)); assert(!fs.existsSync(output));
    copy(path.join(directory, "harness/scripts"), target, files);
    fs.writeFileSync(output, JSON.stringify({ status: "PASS", at: new Date().toISOString(), files }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "PASS", files: files.length, output }));
  }
} else {
  const output = path.join(base, "terminal-audit-01.json"); assert(!fs.existsSync(output));
  const r = { status: "RUNNING", checks: [], inputs: [], models: 0, productRestarts: 0, at: new Date().toISOString() };
  const verify = v => assert.equal(sha(v.path), v.sha256, v.path);
  const input = f => { r.inputs.push(desc(f)); return read(f); };
  const check = (name, operation) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.detail = operation(); row.status = "PASS"; }
    catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  };
  try {
    const build = input(path.join(release, "release/build.json"));
    const run = input(path.join(base, "resource-01/report.json"));
    const owner = input(path.join(base, "account-controller.json"));
    const retired = input(path.join(base, "account-retirement-01.json"));
    check("original failures retained and nonempty source regression groups", () => {
      const before = input(path.join(source, "before-01/report.json"));
      assert.equal(before.status, "FAILED"); assert.equal(before.cases.length, 8);
      assert.equal(before.cases.filter(c => c.status === "FAILED").length, 8);
      const route = input(path.join(source, "route-before-01/report.json"));
      assert.equal(route.status, "FAILED"); assert.equal(route.cases.length, 10);
      assert.equal(route.cases.filter(c => c.status === "FAILED").length, 8);
      let direct = 0, browser = 0;
      for (const [name, count, kind] of [["after-complete-01", 8, "direct"], ["route-after-01", 10, "direct"],
        ["persistence-complete-01", 15, "direct"], ["browser-complete-01", 4, "browser"],
        ["route-browser-after-02", 6, "browser"]]) {
        const report = input(path.join(source, name, "report.json"));
        assert.equal(report.status, "PASS"); assert.equal(report.cases.length, count);
        assert(report.cases.every(c => c.status === "PASS"));
        if (kind === "direct") direct += count; else browser += count;
      }
      return { direct, browser, originalNaturalIncident: "NOT_REPRODUCED" };
    });
    check("new payload actual source and preserved frozen release daily Dev real HEAD/index", () => {
      assert.equal(build.version, "1.9.78");
      assert.equal(build.status, "PASS_EDITOR_DEV_NSIS_AND_PAYLOAD_ACTUAL_INSTALL_NOT_RUN");
      for (const artifact of [build.installer, build.sourceInstaller, build.dev, build.player, build.backend,
        build.payloadReport, ...build.graphSources]) verify(artifact);
      const checkpoint = input(path.join(release, "checkpoint.json"));
      verify(checkpoint.daily); verify(checkpoint.index); verify(checkpoint.frozenPrevious);
      assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(), checkpoint.head);
      assert.equal(build.standalonePlayerBuilds, 0); assert.equal(build.androidBuilds, 0);
      assert.equal(build.modelRequests, 0); assert.equal(build.graphSources.length, 5);
      return { version: build.version, installer: build.installer, realHeadIndexUnchanged: true, preservedDaily: checkpoint.daily };
    });
    check("actual installed deletion whole-route undo redo and same-default-profile restart", () => {
      assert.equal(run.status, "PASS"); assert.equal(run.cleanupStatus, "PASS");
      assert.equal(run.scope, "ACTUAL_NSIS_1978_DEFAULT_PROFILE_GRAPH_DELETE_ROUTE_UNDO_REDO_RESTART");
      assert.equal(run.stages.length, 6); assert(run.stages.every(s => s.status === "PASS"));
      assert.equal(run.installations, 0); assert.equal(run.launches.length, 2); assert.equal(run.cleanups.length, 2);
      const original = input(path.join(prior, "resource-01/report.json"));
      assert.equal(original.status, "FAILED"); assert.equal(original.cleanupStatus, "PASS");
      assert.equal(original.stages.length, 5); assert(original.stages.slice(0, 4).every(s => s.status === "PASS"));
      assert(original.stages[4].error.includes("0 !== 100"));
      assert.equal(original.stages[1].detail.entryAndLinksPreserved, true);
      assert.equal(original.stages[1].detail.arrangeInsideAside, true);
      assert.equal(original.stages[2].detail.cleanedChoiceTargets, 2);
      assert.equal(original.stages[3].detail.confirmedUndoSteps, 1);
      assert.equal(run.stages[1].detail.inheritedSavedNodes, 103);
      assert.equal(run.stages[2].detail.importedNodes, 100);
      assert.equal(run.stages[2].detail.importedInternalEdges, 99);
      assert.equal(run.stages[2].detail.undoSteps, 1); assert.equal(run.stages[2].detail.redoSteps, 1);
      assert.equal(run.stages[4].detail.nodes, 203);
      verify(run.inheritedInstall.receipt); verify(run.inheritedInstall.failedRun);
      verify(run.inheritedInstall.fixture.sourceDatabase); verify(run.inheritedInstall.fixture.fixture);
      const install = input(path.join(prior, "install-new.json"));
      assert.equal(install.status, "PASS"); assert.equal(install.executable.version, "1.9.78"); verify(install.executable);
      const payload = input(build.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
      assert(payload); assert.equal(install.executable.sha256, payload.executable.sha256);
      assert.equal(input(path.join(prior, "metadata-restoration.json")).status, "PASS");
      assert(!fs.existsSync(path.join(base, "install-new.json")));
      for (const launch of run.launches) {
        assert.equal(launch.dataDirectoryOverride, false); assert.equal(launch.webviewDirectoryOverride, false);
        assert.equal(launch.sourceServer, false); assert.equal(launch.backendPortOverride, true);
        assert(launch.database.startsWith(retired.account.profile + path.sep));
      }
      assert.equal(run.launches[0].database, run.launches[1].database);
      for (const close of run.cleanups) {
        assert.equal(close.method, "WM_CLOSE"); assert.deepEqual(close.killed, []);
        assert(close.receipt.normalClose); verify(close.receipt.request); verify(close.receipt.nativeEvidence);
      }
      assert.equal(run.controlledNativeIPC, false); assert.equal(run.storeInjection, false);
      assert.equal(run.controlledRequestDelivery, false); assert.equal(run.errors.length, 0);
      assert.equal(run.modelRequests, 0); assert.equal(run.blockedModelRequests || 0, 0);
      assert(run.writes.length > 0);
      return { priorPassedStages: 4, followupStages: 6, newInstallations: 0, inheritedActualInstallations: 1,
        naturalCloses: 2, restartNodes: 203, restoredIntoNewQaProfile: true, upgradeClaim: false };
    });
    check("real viewport and capture dimensions", () => {
      assert.equal(run.screenshots.length, 2);
      for (const shot of run.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
        assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
      }
      return { screenshots: 2, fullDisplayMatrix: false };
    });
    check("owned account profile processes and ports retired and QA database retained", () => {
      assert.equal(owner.status, "FINISHED"); assert(owner.account.createdByThisRun);
      assert.equal(owner.jobs.length, 1); assert.equal(owner.jobs[0].status, "PASS");
      assert.equal(retired.status, "PASS"); assert.equal(retired.account.sid, owner.account.sid);
      assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted); verify(retired.databaseEvidence);
      const state = JSON.parse(ps(`@{account=[bool](Get-LocalUser -SID '${owner.account.sid}' -ErrorAction SilentlyContinue);` +
        `profile=[bool](Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ '${owner.account.sid}')}|ConvertTo-Json -Compress`));
      assert.equal(state.account, false); assert.equal(state.profile, false); assert(!fs.existsSync(retired.account.profile));
      assert(!rows().some(p => run.editorKnown.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
      assert.equal(listeners([...new Set(run.launches.flatMap(l => l.ports))]).length, 0);
      const staging = input(path.join(base, "staging.json"));
      assert.equal(staging.guards, 16); assert.equal(staging.closes.rejectedCloseMisattributions, 10);
      const previousOwner = input(path.join(prior, "account-controller.json"));
      const previousRetired = input(path.join(prior, "account-retirement-01.json"));
      assert.equal(previousOwner.status, "FINISHED"); assert.equal(previousOwner.jobs[0].status, "FAILED");
      assert.equal(previousRetired.status, "PASS"); assert.equal(previousRetired.functionalStatus, "FAILED");
      assert.equal(previousRetired.account.sid, previousOwner.account.sid);
      assert(previousRetired.cleanup.accountDeleted && previousRetired.cleanup.profileDeleted);
      verify(previousRetired.databaseEvidence); assert(!fs.existsSync(previousRetired.account.profile));
      return { sid: owner.account.sid, retired: true, database: retired.databaseEvidence,
        previousFailedAccountRetired: previousRetired.account.sid, originalFailureRetained: true };
    });
    r.status = status;
  } catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, checks: r.checks.length, error: r.error, output }));
  }
}
