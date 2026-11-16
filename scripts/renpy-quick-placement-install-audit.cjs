"use strict";
// Independent artifact/lifecycle audit; no product launches or mutations.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), releaseRoot = "F:/testavn/Editor-Quick-Placement-Release-1981-20261116-01";
const first = "F:/testavn/Windows-Isolated-1981-20261116-01", last = "F:/testavn/Windows-Isolated-1981-20261116-04";
const scopes = [first, "F:/testavn/Windows-Isolated-1981-20261116-02",
  "F:/testavn/Windows-Isolated-1981-20261116-03", last];
const mode = process.argv[2]; assert(["--audit", "--archive"].includes(mode)); assert.equal(process.argv.length, 3);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const verify = file => assert.equal(sha(file.path), file.sha256, file.path);
const expectedStatus = "PASS1981_INSTALLED_AUTHOR_RESTART_UI_EXPORT_NATIVE032_REAL031_REFUSAL";
if (mode === "--archive") {
  assert.equal(read(path.join(releaseRoot, "installed-audit-01.json")).status, expectedStatus);
  for (const scope of scopes) {
    const target = path.join(scope, "qa-sources"), output = path.join(scope, "qa-sources.json"), files = [];
    assert(!fs.existsSync(target) && !fs.existsSync(output));
    function copy(source, destination) {
      const item = fs.lstatSync(source); assert(!item.isSymbolicLink());
      if (item.isDirectory()) {
        if (path.basename(source) === "__pycache__") return;
        fs.mkdirSync(destination);
        for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(destination, name));
      } else {
        assert(/\.(cjs|ps1|psm1|py)$/.test(source), "Unexpected QA source " + source);
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
        assert.equal(sha(source), sha(destination)); files.push({ source, ...desc(destination) });
      }
    }
    copy(path.join(scope, "harness/scripts"), target);
    fs.writeFileSync(output, JSON.stringify({ status: "PASS", at: new Date().toISOString(), files }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "PASS", scope, files: files.length }));
  }
} else {
  const output = path.join(releaseRoot, "installed-audit-01.json"); assert(!fs.existsSync(output));
  const audit = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], inputs: [], productLaunches: 0, modelRequests: 0 };
  const input = file => { audit.inputs.push(desc(file)); return read(file); };
  const check = (name, action) => {
    const row = { name, status: "RUNNING" }; audit.checks.push(row);
    try { row.detail = action(); row.status = "PASS"; }
    catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  };
  try {
    const build = input(path.join(releaseRoot, "release/build.json")), checkpoint = input(path.join(releaseRoot, "checkpoint.json"));
    const original = input(path.join(first, "resource-01/report.json")), run = input(path.join(last, "resource-01/report.json"));
    check("unique native032 candidate and real NSIS installed payload", () => {
      assert.equal(build.version, "1.9.81"); assert.equal(build.runtimeVersion, "0.32.0");
      assert.equal(build.nativePlayerBuilds, 1); assert.equal(build.standalonePlayerInstallers, 0);
      assert.equal(build.msiInstallers, 0); assert.equal(build.androidBuilds, 0); assert.equal(build.modelRequests, 0);
      for (const file of [build.installer, build.sourceInstaller, build.dev, build.player, build.backend,
        build.oldPlayer, build.payloadReport, build.stages, build.checkpoint, ...build.sources]) verify(file);
      for (const pair of build.bundledSources) { verify(pair.source); verify(pair.bundled); assert.equal(pair.source.sha256, pair.bundled.sha256); }
      const stages = input(build.stages.path); assert.equal(stages.status, "PASS_BUILD_NOT_INSTALLED");
      assert.equal(stages.stages.length, 4); assert(stages.stages.every(s => s.status === "PASS" && s.exitCode === 0));
      for (const stage of stages.stages) verify(stage.log);
      const installed = input(path.join(first, "install-new.json")); assert.equal(installed.status, "PASS");
      assert.equal(installed.executable.version, "1.9.81"); verify(installed.executable);
      const payload = input(build.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
      assert(payload); assert.equal(installed.executable.sha256, payload.executable.sha256);
      assert.equal(input(path.join(first, "metadata-restoration.json")).status, "PASS");
      return { installer: build.installer, oneInstallation: original.installations, followingInstallations: run.installations };
    });
    check("real authoring and same-original-default-profile restart preserved", () => {
      assert.equal(original.status, "FAILED"); assert.equal(original.cleanupStatus, "PASS");
      assert(original.stages.slice(0, 4).every(s => s.status === "PASS"));
      assert.match(original.stages[4].error, /android-env-import-backdrop/);
      assert.equal(original.installations, 1); assert.equal(original.launches.length, 2);
      assert.equal(original.launches[0].database, original.launches[1].database);
      const actualMenu = original.stages[1].detail.menu;
      assert.deepEqual(actualMenu.rect, { x: 50, y: 10, width: 60, height: 6, anchor: "top_center" });
      assert.equal(actualMenu.style.quickMenuPlacement, "custom");
      assert(original.stages[3].detail.rectangleRestored);
      assert(original.cleanups.some(c => c.method === "WM_CLOSE" && c.receipt.normalClose && !c.killed.length));
      assert.equal(run.inheritedStages.length, 4);
      for (const stage of run.inheritedStages) verify(stage.evidence);
      assert.equal(run.stages[1].detail.sameOriginalProfileClaim, false);
      assert.equal(run.stages[1].detail.repeatedAuthoring, false);
      return { authoring: "actual UI", originalDefaultProfileRestart: true, laterFreshProfileExplicit: true };
    });
    check("remaining actual UI export native032 geometry and real old031 rejection", () => {
      assert.equal(run.status, "PASS"); assert.equal(run.cleanupStatus, "PASS");
      assert.equal(run.stages.length, 6); assert(run.stages.every(s => s.status === "PASS"));
      assert.equal(run.installations, 0); assert.equal(run.storeInjection, false); assert.equal(run.controlledNativeIPC, false);
      assert.equal(run.computerUse, false); assert.equal(run.blockedModelRequests || 0, 0); assert.deepEqual(run.errors, []);
      verify(run.cartridge);
      const exported = run.stages.find(s => s.name === "actual-installed-export-button-and-cartridge-layout-runtime-version").detail;
      assert(exported.actualExportButton); assert.equal(exported.publicExportApiCalledByQA, false);
      assert.equal(exported.manifest.runtime_version, "0.32.0");
      assert(exported.cartridge.events.some(e => e.state === "completed" && e.receivedBytes > 0));
      const refusal = run.stages.find(s => s.name === "actual-frozen031-binary-refuses-unmodified032-cartridge").detail;
      verify(refusal.binary); verify(refusal.cartridge); assert.equal(refusal.versionOrBinaryMutation, false);
      assert.match(refusal.text, /卡带要求 0\.32\.0/); assert.match(refusal.text, /当前 GameCLI 为 0\.31\.0/);
      const native = run.stages.find(s => s.name === "actual-installed032-player-consumes-ui-export-and-nine-controls").detail;
      verify(native.binary); assert.equal(native.binary.sha256, build.player.sha256);
      assert.equal(native.geometry.buttons.length, 9); assert(native.geometry.buttons.every(b => b.hit));
      assert.equal(native.geometry.placement, "custom"); assert(native.historyReturnHideRestore);
      const close = run.cleanups.find(c => c.method === "WM_CLOSE"); assert(close?.receipt.normalClose && !close.killed.length);
      return { uiExport: run.cartridge, refusalBinary: refusal.binary, newPlayer: native.binary,
        viewportScope: "1920x1080 DPR1 normal WebView emulation, not physical phone or new full matrix" };
    });
    check("screenshots have real matching viewport DPR and byte dimensions", () => {
      let count = 0;
      for (const report of [original, run]) for (const shot of report.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
        assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr); count++;
      }
      assert(count >= 5); return { screenshots: count, auxiliaryEvidenceOnly: true };
    });
    check("all three ordinary QA identities retired and original failures retained", () => {
      const live = rows(), ports = [];
      for (const scope of [first, scopes[2], last]) {
        const controller = input(path.join(scope, "account-controller.json")), retired = input(path.join(scope, "account-retirement-01.json"));
        const report = input(path.join(scope, "resource-01/report.json"));
        assert.equal(controller.status, "FINISHED"); assert.equal(retired.status, "PASS");
        assert.equal(controller.account.sid, retired.account.sid); assert(controller.account.createdByThisRun);
        assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted); assert(!fs.existsSync(retired.account.profile));
        verify(retired.databaseEvidence);
        const observed = JSON.parse(ps(`@{account=[bool](Get-LocalUser -SID '${controller.account.sid}' -ErrorAction SilentlyContinue);` +
          `profile=[bool](Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ '${controller.account.sid}')}|ConvertTo-Json -Compress`));
        assert.equal(observed.account, false); assert.equal(observed.profile, false);
        for (const known of [...(report.editorKnown || []), ...(report.knownProcesses || [])])
          assert(!live.some(p => p.ProcessId === known.ProcessId && p.Created === known.Created));
        for (const launch of report.launches) ports.push(...(launch.ports || [launch.port]));
        assert.equal(report.cleanupStatus, "PASS"); assert(report.finishedAt);
      }
      assert.equal(listeners([...new Set(ports)]).length, 0);
      assert.equal(input(path.join(scopes[1], "preparation-failed-01.json")).testAccounts, 0);
      assert.equal(input(path.join(scopes[2], "resource-01/report.json")).status, "FAILED");
      return { accountsRetired: 3, oldFailedReportsPreserved: true, ports };
    });
    check("daily Dev frozen1980 real HEAD and index unchanged", () => {
      verify(checkpoint.daily); verify(checkpoint.frozen.installer); verify(checkpoint.frozen.player); verify(checkpoint.git.index);
      assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), checkpoint.git.head);
      return { dailyUnchanged: true, frozenUnchanged: true, head: checkpoint.git.head };
    });
    audit.status = expectedStatus;
  } catch (error) { audit.status = "FAILED"; audit.error = error.stack; process.exitCode = 1; }
  finally {
    audit.finishedAt = new Date().toISOString(); fs.writeFileSync(output, JSON.stringify(audit, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: audit.status, checks: audit.checks.length, output, error: audit.error }));
  }
}
