"use strict";
// Independent verification of the targeted installed session, not a new run.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const base = "F:/testavn/Windows-Isolated-1980-20261116-01";
const release = "F:/testavn/Editor-History-Release-1980-20261116-01";
const mode = process.argv[2]; assert(["--audit", "--archive"].includes(mode)); assert.equal(process.argv.length, 3);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const verify = f => assert.equal(sha(f.path), f.sha256, f.path);
const status = "PASS_INSTALLED_HISTORY_FEEDBACK_NATIVE_TIMELINE_DEFAULT_PROFILE_RESTART";
if (mode === "--archive") {
  assert.equal(read(path.join(base, "terminal-audit-01.json")).status, status);
  const target = path.join(base, "qa-sources"), output = path.join(base, "qa-sources.json"), files = [];
  assert(!fs.existsSync(target) && !fs.existsSync(output));
  function copy(from, to) {
    const item = fs.lstatSync(from); assert(!item.isSymbolicLink());
    if (item.isDirectory()) {
      if (path.basename(from) === "__pycache__") return;
      fs.mkdirSync(to);
      for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
    } else {
      assert(/\.(cjs|ps1|psm1|py)$/.test(from), "Unexpected QA source " + from);
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); assert.equal(sha(from), sha(to));
      files.push({ source: from, ...desc(to) });
    }
  }
  copy(path.join(base, "harness/scripts"), target);
  fs.writeFileSync(output, JSON.stringify({ status: "PASS", files, at: new Date().toISOString() }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "PASS", files: files.length, output }));
} else {
  const output = path.join(base, "terminal-audit-01.json"); assert(!fs.existsSync(output));
  const report = { status: "RUNNING", checks: [], inputs: [], models: 0, productRestarts: 0, at: new Date().toISOString() };
  const input = f => { report.inputs.push(desc(f)); return read(f); };
  const check = (name, action) => {
    const row = { name, status: "RUNNING" }; report.checks.push(row);
    try { row.detail = action(); row.status = "PASS"; }
    catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  };
  try {
    const build = input(path.join(release, "release/build.json")), checkpoint = input(path.join(release, "checkpoint.json"));
    const run = input(path.join(base, "resource-01/report.json"));
    const controller = input(path.join(base, "account-controller.json")), retired = input(path.join(base, "account-retirement-01.json"));
    check("reviewed source delta and unique 1980 actual NSIS payload", () => {
      assert.equal(build.version, "1.9.80");
      assert.equal(build.status, "PASS_EDITOR_DEV_NSIS_AND_PAYLOAD_ACTUAL_INSTALL_NOT_RUN");
      for (const artifact of [build.installer, build.sourceInstaller, build.dev, build.player, build.backend,
        build.payloadReport, build.packageLog, build.sourceEvidence, ...build.logs, ...build.historySources]) verify(artifact);
      assert.equal(build.historySources.length, 4);
      assert.equal(input(build.sourceEvidence.path).status, "PASS_SOURCE_HISTORY_AND_CONFIRMED_TIMELINE_REVISION_NOT_INSTALLED");
      assert.equal(build.standalonePlayerBuilds, 0); assert.equal(build.androidBuilds, 0); assert.equal(build.modelRequests, 0);
      for (const artifact of build.historySources) {
        const retained = checkpoint.files.find(f => path.resolve(f.source) === path.resolve(artifact.path));
        assert(retained); verify(retained.retained); assert.equal(artifact.sha256, retained.retained.sha256);
      }
      const install = input(path.join(base, "install-new.json")); assert.equal(install.status, "PASS");
      assert.equal(install.executable.version, "1.9.80"); verify(install.executable);
      const payload = input(build.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
      assert(payload); assert.equal(install.executable.sha256, payload.executable.sha256);
      assert.equal(input(path.join(base, "metadata-restoration.json")).status, "PASS");
      return { installer: build.installer, installations: run.installations, productSources: 4 };
    });
    check("all eight installed stages, ordinary profile input and two normal closes", () => {
      assert.equal(run.status, "PASS"); assert.equal(run.cleanupStatus, "PASS");
      assert.equal(run.scope, "ACTUAL_NSIS_1980_DEFAULT_PROFILE_HISTORY_FEEDBACK_NATIVE_TIMELINE_RESTART");
      assert.equal(run.stages.length, 8); assert(run.stages.every(s => s.status === "PASS"));
      assert.equal(run.installations, 1); assert.equal(run.launches.length, 2); assert.equal(run.cleanups.length, 2);
      assert.deepEqual(run.errors, []); assert.equal(run.modelRequests, 0); assert.equal(run.blockedModelRequests || 0, 0);
      assert.equal(run.computerUse, false); assert.equal(run.storeInjection, false);
      assert.equal(run.controlledNativeIPC, false); assert.equal(run.controlledRequestDelivery, false);
      assert(run.stages[1].detail.emptyUndo && run.stages[1].detail.emptyRedo && run.stages[1].detail.graphUnchanged);
      assert(run.stages[2].detail.nativeTextUndo); assert.equal(run.stages[2].detail.graphConfirmationOpened, false);
      assert.match(run.stages[3].detail.text, /雨夜车站/); assert.match(run.stages[3].detail.text, /第\s*1\s*项/);
      assert.match(run.stages[3].detail.text, /等待/); assert(run.stages[3].detail.cancelPreservesGraph);
      assert.deepEqual(run.stages[3].detail.confirmedUndo, [100, 200, 300]);
      assert.deepEqual(run.stages[3].detail.redo, [400, 200, 300]);
      assert.equal(run.stages[3].detail.redoNotice, "已重做上一次撤销。");
      assert(run.stages[4].detail.nativeFilesystem); assert.equal(run.stages[4].detail.controlledRaceReproduction, false);
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
      assert(run.writes.length > 0);
      return { actualInput: true, nativeFiles: true, normalCloses: 2, sameDefaultProfile: true,
        controlledRaceClaim: false, upgradeClaim: false };
    });
    check("native backup bytes, actual persisted graph and bounded screenshot evidence", () => {
      assert(run.backupEvidence.length >= 2);
      for (const artifact of run.backupEvidence) { verify(artifact); verify(artifact.metadata); }
      const target = run.backupEvidence.find(p => p.trigger !== "before_restore");
      const before = run.backupEvidence.find(p => p.trigger === "before_restore"); assert(target && before);
      const graph = g => ({ nodes: g.nodes.map(n => ({ id: n.id, position: n.position, data: n.data })),
        edges: g.edges.map(({ selected, ...edge }) => edge) });
      const expected = input(path.join(base, "resource-01/expected-restart-graph.json"));
      assert.deepEqual(graph(read(target.path)), expected);
      assert.deepEqual(graph(read(before.path)), input(path.join(base, "resource-01/before-restore-graph.json")));
      assert.equal(sha(path.join(base, "resource-01/expected-restart-graph.json")), run.stages[6].detail.expected);
      verify(retired.databaseEvidence);
      const { DatabaseSync } = require("node:sqlite");
      const database = new DatabaseSync(retired.databaseEvidence.path, { readOnly: true });
      try {
        const row = database.prepare("SELECT project_json FROM editor_project_details WHERE project_id = ?")
          .get("qa-editor-history-revision-1980"); assert(row);
        assert.deepEqual(graph(JSON.parse(row.project_json)), expected);
      } finally { database.close(); }
      assert.equal(run.screenshots.length, 3);
      for (const shot of run.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
        assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
      }
      return { nativeBackups: run.backupEvidence.length, screenshots: 3,
        viewportScope: "1920x1080_DPR1_NORMAL", fullDisplayMatrixClaim: false };
    });
    check("actual disposable account/profile and owned processes/ports retired", () => {
      assert.equal(controller.status, "FINISHED"); assert(controller.account.createdByThisRun);
      assert.equal(controller.jobs.length, 1); assert.equal(controller.jobs[0].status, "PASS");
      assert.equal(retired.status, "PASS"); assert.equal(retired.account.sid, controller.account.sid);
      assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted); assert(!fs.existsSync(retired.account.profile));
      const observed = JSON.parse(ps(`@{account=[bool](Get-LocalUser -SID '${controller.account.sid}' -ErrorAction SilentlyContinue);` +
        `profile=[bool](Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ '${controller.account.sid}')}|ConvertTo-Json -Compress`));
      assert.equal(observed.account, false); assert.equal(observed.profile, false);
      const live = rows(); assert(!live.some(p => run.editorKnown.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
      assert.equal(listeners([...new Set(run.launches.flatMap(l => l.ports))]).length, 0);
      const staging = input(path.join(base, "staging.json"));
      assert.equal(staging.guards, 16); assert.equal(staging.closes.rejectedCloseMisattributions, 10);
      return { sid: controller.account.sid, accountDeleted: true, profileDeleted: true, retainedDatabase: retired.databaseEvidence };
    });
    check("real HEAD index daily Dev and frozen 1979 remain unchanged", () => {
      verify(checkpoint.daily); verify(checkpoint.frozenPrevious); verify(checkpoint.index);
      assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(), checkpoint.head);
      return { head: checkpoint.head, dailyUnchanged: true, priorCandidateUnchanged: true };
    });
    report.status = status;
  } catch (error) { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, output }));
  }
}
