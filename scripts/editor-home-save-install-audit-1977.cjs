"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const base = "F:/testavn/Windows-Isolated-1977-20261116-02";
const prior = "F:/testavn/Windows-Isolated-1977-20261116-01";
const release = "F:/testavn/Editor-Home-Save-Release-1977-20261116-01";
const source = "F:/testavn/Editor-Home-Save-Ordering-20261116-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const status = "PASS_INSTALLED_HOME_SAVE_ORDERING_AND_DEFAULT_PROFILE_RESTART";
const mode = process.argv[2];
assert(["--audit", "--archive"].includes(mode)); assert.equal(process.argv.length, 3);
if (mode === "--archive") {
  assert.equal(read(path.join(base, "terminal-audit-01.json")).status, status);
  function copy(from, to, files) {
    const item = fs.lstatSync(from); assert(!item.isSymbolicLink(), "Do not traverse source links");
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
    const target = path.join(directory, "qa-sources"), output = path.join(directory, "qa-sources.json"), files = [];
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
    check("failed reproduction retained and nonempty source regression groups", () => {
      const failed = input(path.join(source, "before-home-01/report.json"));
      assert.equal(failed.status, "FAILED"); assert.equal(failed.cases.length, 1);
      assert(failed.error.includes("must not overwrite newer edits"));
      const queueBefore = input(path.join(source, "queue-before-01/report.json"));
      assert.equal(queueBefore.status, "FAILED"); assert.equal(queueBefore.cases.filter(c => c.status === "FAILED").length, 5);
      let direct = 0, browser = 0;
      for (const [name, count, kind] of [["queue-after-01", 6, "direct"], ["persistence-after-01", 15, "direct"],
        ["autosave-after-01", 13, "direct"], ["after-home-01", 1, "browser"],
        ["after-autosave-01", 1, "browser"], ["recovery-browser-after-01", 5, "browser"]]) {
        const report = input(path.join(source, name, "report.json"));
        assert.equal(report.status, "PASS", name); assert.equal(report.cases.length, count);
        assert(report.cases.every(c => c.status === "PASS"), name);
        if (kind === "direct") direct += count; else browser += count;
      }
      return { direct, browser, controlledTiming: true, originalNaturalIncident: "NOT_REPRODUCED" };
    });
    check("new Editor payload and preserved previous release, daily Dev and real git state", () => {
      assert.equal(build.version, "1.9.77");
      assert.equal(build.status, "PASS_EDITOR_DEV_NSIS_AND_PAYLOAD_ACTUAL_INSTALL_NOT_RUN");
      for (const value of [build.installer, build.sourceInstaller, build.dev, build.player, build.backend, build.source, build.payloadReport])
        verify(value);
      const before = input(path.join(release, "checkpoint.json"));
      verify(before.daily); verify(before.index);
      assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(), before.head);
      const previous = input("F:/testavn/Editor-Autosave-Release-1976-20261116-01/release/build.json");
      assert.equal(previous.version, "1.9.76"); verify(previous.installer);
      assert.equal(build.standalonePlayerBuilds, 0); assert.equal(build.androidBuilds, 0);
      return { installer: build.installer, protectedPrevious: previous.installer, realHeadIndexUnchanged: true };
    });
    check("real default-profile installation, controlled home write, exact node restart and natural closes", () => {
      assert.equal(run.status, "PASS");
      assert.equal(run.scope, "ACTUAL_NSIS_1977_DEFAULT_QA_PROFILE_UI_HOME_SAVE_RACE_AND_RESTART_NOT_UPGRADE");
      assert.equal(run.stages.length, 6); assert(run.stages.every(s => s.status === "PASS"));
      assert.equal(run.launches.length, 2); assert.equal(run.cleanups.length, 2);
      const install = input(path.join(prior, "install-new.json"));
      assert.equal(install.status, "PASS"); assert.equal(install.executable.version, "1.9.77"); verify(install.executable);
      const payload = input(build.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
      assert(payload); assert.equal(payload.executable.sha256, install.executable.sha256);
      assert.equal(run.installations, 0);
      verify(run.inheritedInstall.receipt); verify(run.inheritedInstall.failedRun);
      const failed = input(run.inheritedInstall.failedRun.path);
      assert.equal(failed.status, "FAILED"); assert(failed.error.includes("strict mode violation"));
      assert.equal(run.stages[2].detail.maximumConcurrentWrites, 1); assert(run.writes.length >= 2);
      assert.equal(run.writes.filter(w => w.held).length, 1); assert(run.writes.every(w => w.activeAtStart === 1));
      assert(run.writes.every(w => w.finishedAt >= w.startedAt && w.httpStatus >= 200 && w.httpStatus < 300));
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
      assert.equal(run.controlledRequestDelivery, true); assert.equal(run.controlledNativeIPC, false);
      assert.equal(run.storeInjection, false); assert.equal(run.errors.length, 0);
      assert.equal(run.modelRequests, 0); assert.equal(run.blockedModelRequests || 0, 0);
      return { stages: 6, normalCloses: 2, sourceServer: false, controlledRequestDelivery: true,
        upgradeClaim: false, restartNodes: run.stages[4].detail.nodes };
    });
    check("actual viewport and no-side-effect capture dimensions", () => {
      assert.equal(run.screenshots.length, 2);
      for (const shot of run.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
        assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
      }
      return { screenshots: 2, fullDisplayMatrix: false };
    });
    check("owned account and profile retired, precise process and port cleanup, retained DB", () => {
      assert.equal(owner.status, "FINISHED"); assert.equal(owner.jobs.length, 1);
      assert.equal(owner.jobs[0].status, "PASS"); assert(owner.account.createdByThisRun);
      assert.equal(retired.status, "PASS"); assert.equal(retired.account.sid, owner.account.sid);
      assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted); verify(retired.databaseEvidence);
      const state = JSON.parse(ps(`@{account=[bool](Get-LocalUser -SID '${owner.account.sid}' -ErrorAction SilentlyContinue);` +
        `profile=[bool](Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ '${owner.account.sid}')}|ConvertTo-Json -Compress`));
      assert.equal(state.account, false); assert.equal(state.profile, false); assert(!fs.existsSync(retired.account.profile));
      assert.equal(run.cleanupStatus, "PASS");
      assert(!rows().some(p => run.editorKnown.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
      assert.equal(listeners([...new Set(run.launches.flatMap(l => l.ports))]).length, 0);
      const failedRetire = input(path.join(prior, "account-retirement-01.json"));
      assert.equal(failedRetire.status, "FAILED"); assert(failedRetire.error.includes("Product QA cleanup not terminal"));
      const oldRetired = input(path.join(prior, "account-retirement-02.json"));
      assert.equal(oldRetired.status, "PASS"); assert.equal(oldRetired.functionalStatus, "FAILED");
      assert(oldRetired.cleanup.accountDeleted && oldRetired.cleanup.profileDeleted); verify(oldRetired.databaseEvidence);
      assert(!fs.existsSync(oldRetired.account.profile));
      const staging = input(path.join(base, "staging.json"));
      assert.equal(staging.guards, 16); assert.equal(staging.closes.rejectedCloseMisattributions, 10);
      return { sid: owner.account.sid, retired: true, database: retired.databaseEvidence,
        earlierFailedAccountRetired: oldRetired.account.sid, originalFailedRunUnmodified: true,
        earlierRegistration: oldRetired.registrationScope };
    });
    r.status = status;
  } catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, checks: r.checks.length, error: r.error, output }));
  }
}
