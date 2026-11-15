"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const prior = "F:/testavn/Windows-Isolated-1979-20261116-01";
const partial = "F:/testavn/Windows-Isolated-1979-20261116-02";
const base = "F:/testavn/Windows-Isolated-1979-20261116-03";
const release = "F:/testavn/Editor-Event-Release-1979-20261116-01";
const source = "F:/testavn/Editor-Event-Boundaries-20261116-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const status = "PASS_INSTALLED_EVENT_EDITS_NATIVE_TIMELINE_AND_DEFAULT_PROFILE_RESTART";
const mode = process.argv[2];
assert(["--audit", "--archive"].includes(mode)); assert.equal(process.argv.length, 3);
if (mode === "--archive") {
  assert.equal(read(path.join(base, "terminal-audit-01.json")).status, status);
  for (const session of [prior, partial, base]) {
    const files = [], target = path.join(session, "qa-sources"), output = path.join(session, "qa-sources.json");
    assert(!fs.existsSync(target)); assert(!fs.existsSync(output));
    function copy(from, to) {
      const item = fs.lstatSync(from); assert(!item.isSymbolicLink());
      if (item.isDirectory()) {
        if (path.basename(from) === "__pycache__") return;
        fs.mkdirSync(to);
        for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
      } else {
        assert(/\.(cjs|ps1|psm1|py)$/.test(from), "Unexpected QA source: " + from);
        fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); assert.equal(sha(from), sha(to));
        files.push({ source: from, ...desc(to) });
      }
    }
    copy(path.join(session, "harness/scripts"), target);
    fs.writeFileSync(output, JSON.stringify({ status: "PASS", at: new Date().toISOString(), files }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "PASS", files: files.length, output }));
  }
} else {
  const output = path.join(base, "terminal-audit-01.json"); assert(!fs.existsSync(output));
  const report = { status: "RUNNING", checks: [], inputs: [], models: 0, productRestarts: 0, at: new Date().toISOString() };
  const verify = v => assert.equal(sha(v.path), v.sha256, v.path);
  const input = f => { report.inputs.push(desc(f)); return read(f); };
  const check = (name, operation) => {
    const row = { name, status: "RUNNING" }; report.checks.push(row);
    try { row.detail = operation(); row.status = "PASS"; }
    catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  };
  try {
    const build = input(path.join(release, "release/build.json"));
    const run = input(path.join(base, "resource-01/report.json"));
    const owner = input(path.join(base, "account-controller.json"));
    const retired = input(path.join(base, "account-retirement-01.json"));
    const previous = input(path.join(prior, "resource-01/report.json"));
    const passed = input(path.join(partial, "resource-01/report.json"));
    check("original failures retained and all 34 nonempty source behavior checks", () => {
      assert.equal(input(path.join(source, "before-02/report.json")).status, "FAILED");
      let count = 0;
      for (const [name, expected] of [["after-complete-02", 14], ["recovery-01", 5], ["persistence-01", 15]]) {
        const result = input(path.join(source, name, "report.json"));
        assert.equal(result.status, "PASS"); assert.equal(result.cases.length, expected);
        assert(result.cases.every(c => c.status === "PASS")); count += expected;
      }
      const delivery = input(path.join(source, "source-delivery-01.json"));
      assert.equal(delivery.status, "PASS"); assert(delivery.files.every(f => f.remotelyVerified));
      return { sourceCases: count, originalNaturalIncident: "NOT_REPRODUCED", sourceCommit: delivery.commit };
    });
    check("unique 1979 source payload dev and protected previous artifacts", () => {
      assert.equal(build.version, "1.9.79");
      assert.equal(build.status, "PASS_EDITOR_DEV_NSIS_AND_PAYLOAD_ACTUAL_INSTALL_NOT_RUN");
      for (const artifact of [build.installer, build.sourceInstaller, build.dev, build.player, build.backend,
        build.payloadReport, ...build.eventSources, ...build.logs]) verify(artifact);
      const checkpoint = input(path.join(release, "checkpoint.json"));
      verify(checkpoint.daily); verify(checkpoint.index); verify(checkpoint.frozenPrevious);
      assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(), checkpoint.head);
      assert.equal(build.standalonePlayerBuilds, 0); assert.equal(build.androidBuilds, 0);
      assert.equal(build.modelRequests, 0); assert.equal(build.eventSources.length, 3);
      return { installer: build.installer, unchangedDaily: checkpoint.daily, actualProductDelta: 3 };
    });
    check("actual installed event editing native restore and natural same-profile restart", () => {
      assert.equal(run.status, "PASS"); assert.equal(run.cleanupStatus, "PASS");
      assert.equal(run.scope, "ACTUAL_NSIS_1979_DEFAULT_PROFILE_EVENT_EDIT_UNDO_NATIVE_TIMELINE_RESTART");
      assert.equal(run.stages.length, 6); assert(run.stages.every(s => s.status === "PASS"));
      assert.equal(previous.status, "FAILED"); assert.equal(previous.cleanupStatus, "PASS");
      assert.equal(previous.stages[0].status, "PASS"); assert.equal(previous.stages[1].status, "PASS");
      assert(previous.stages[2].error.includes("command-card-summary"));
      assert.equal(previous.installations, 1); assert.equal(run.installations, 0);
      verify(run.inheritedInstall);
      assert.equal(path.resolve(run.inheritedInstall.path), path.resolve(prior, "install-new.json"));
      assert.equal(run.launches.length, 2); assert.equal(run.cleanups.length, 2);
      assert.equal(passed.status, "FAILED"); assert.equal(passed.cleanupStatus, "PASS");
      assert(passed.stages.slice(0, 4).every(s => s.status === "PASS"));
      assert(passed.stages[4].error.includes("exact newer graph"));
      assert.deepEqual(passed.stages[2].detail.order, [250, 300, 100]);
      assert.equal(passed.stages[2].detail.confirmedUndoSteps, 1); assert.equal(passed.stages[2].detail.redoSteps, 1);
      assert.equal(passed.stages[3].detail.deletedEventRestored, true);
      assert.equal(run.stages[2].detail.nativeFilesystem, true);
      const install = input(path.join(prior, "install-new.json"));
      assert.equal(install.status, "PASS"); assert.equal(install.executable.version, "1.9.79"); verify(install.executable);
      const payload = input(build.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
      assert.equal(install.executable.sha256, payload.executable.sha256);
      assert.equal(input(path.join(prior, "metadata-restoration.json")).status, "PASS");
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
      assert.equal(run.controlledRequestDelivery, false); assert.deepEqual(run.errors, []);
      assert.equal(run.modelRequests, 0); assert.equal(run.blockedModelRequests || 0, 0);
      assert(run.writes.length > 0);
      const expected = input(path.join(base, "resource-01/expected-restart-graph.json"));
      assert.deepEqual(expected.nodes.find(n => n.id === "scene").data.scene.commands.map(c => c.duration_ms), [250, 300, 100]);
      assert.equal(sha(path.join(base, "resource-01/expected-restart-graph.json")), run.stages[4].detail.expected);
      return { inheritedPassedStages: 4, remainingStages: 6, inheritedInstallations: 1, newInstallations: 0, naturalCloses: 2,
        freshQaProfile: true, oldProfileContinuityClaim: false, upgradeClaim: false, controlledRaceClaim: false };
    });
    check("actual native backup bytes and scoped display evidence retained", () => {
      assert.equal(run.backupEvidence.length, 2);
      const saved = run.backupEvidence.find(v => v.trigger !== "before_restore");
      const before = run.backupEvidence.find(v => v.trigger === "before_restore");
      assert(saved && before);
      for (const item of run.backupEvidence) { verify(item); verify(item.metadata); }
      const order = v => read(v.path).nodes.find(n => n.id === "scene").data.scene.commands.map(c => c.duration_ms);
      assert.deepEqual(order(saved), [250, 300, 100]); assert.deepEqual(order(before), [270, 300, 100]);
      const graph = g => ({ nodes: g.nodes.map(n => ({ id: n.id, position: n.position, data: n.data })),
        edges: g.edges.map(({ selected, ...edge }) => edge) });
      const original = input(path.join(base, "resource-01/before-restore-graph.json"));
      assert.deepEqual(graph(read(before.path)), original);
      const captured = input(path.join(partial, "backup-diagnostic-01.json"));
      assert.equal(captured.status, "PASS_CAPTURE_ONLY_NOT_PRODUCT_ASSERTION");
      for (const artifact of captured.files) verify(artifact);
      const points = require("./lib/native-editor-recovery-files.cjs").recoveryPoints(
        path.join(partial, "diagnostic-native-backups"), "qa-editor-event-integrity-1979");
      const oldBefore = points.find(p => p.meta.trigger === "before_restore");
      const oldAuto = points.find(p => p.meta.trigger === "auto_save" &&
        p.value.nodes.find(n => n.id === "scene").data.scene.commands[0].duration_ms === 270);
      assert(oldBefore && oldAuto); assert.deepEqual(graph(oldBefore.value), graph(oldAuto.value));
      assert.equal(run.screenshots.length, 2);
      for (const shot of run.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
        assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
      }
      return { actualNativeBackups: 2, screenshots: 2, preservedPartialBeforeRestore: oldBefore.sha256,
        fullDisplayMatrix: false, physicalPhone: false };
    });
    check("test account profile and exact processes ports retired, QA DB preserved", () => {
      const identities = [];
      for (const [session, result, expectedJob] of [[prior, previous, "FAILED"], [partial, passed, "FAILED"], [base, run, "PASS"]]) {
        const controller = session === base ? owner : input(path.join(session, "account-controller.json"));
        const retirement = session === base ? retired : input(path.join(session, "account-retirement-01.json"));
        assert.equal(controller.status, "FINISHED"); assert(controller.account.createdByThisRun);
        assert.equal(controller.jobs.length, 1); assert.equal(controller.jobs[0].status, expectedJob);
        assert.equal(retirement.status, "PASS"); assert.equal(retirement.account.sid, controller.account.sid);
        assert(retirement.cleanup.accountDeleted && retirement.cleanup.profileDeleted); verify(retirement.databaseEvidence);
        const observed = JSON.parse(ps(`@{account=[bool](Get-LocalUser -SID '${controller.account.sid}' -ErrorAction SilentlyContinue);` +
          `profile=[bool](Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ '${controller.account.sid}')}|ConvertTo-Json -Compress`));
        assert.equal(observed.account, false); assert.equal(observed.profile, false); assert(!fs.existsSync(retirement.account.profile));
        assert(!rows().some(p => result.editorKnown.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
        assert.equal(listeners([...new Set(result.launches.flatMap(l => l.ports))]).length, 0);
        const staging = input(path.join(session, "staging.json"));
        assert.equal(staging.guards, 16); assert.equal(staging.closes.rejectedCloseMisattributions, 10);
        identities.push({ sid: controller.account.sid, deleted: true, retainedDatabase: retirement.databaseEvidence });
      }
      return identities;
    });
    report.status = status;
  } catch (error) { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, output }));
  }
}
