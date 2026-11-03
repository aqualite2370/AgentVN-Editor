"use strict";
// Evidence audit only; does not turn a current-source APK into installed acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateRequest, validateImmediateActivityReopen } = require("./android-exit-device.cjs");
const { activityState, validateActivityExit } = require("./lib/android-activity-exit.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const same = f => assert.equal(fileEvidence(f.path).sha256, f.sha256);
function validateRecordedCellLog(cell, raw) {
  const actual = scopedRuntimeLog(raw, cell.package, cell.logs.pids);
  assert.deepEqual(actual.fatal, cell.logs.fatal, "Stored fatal classification must match the original log");
  assert.deepEqual(actual.fatal, [], "Raw app/renderer fatal evidence blocks normal-exit acceptance");
  assert.deepEqual(actual.warnings, cell.logs.warnings, "Stored warnings must match the original log");
}
function validateResult(r) {
  assert(["PASS_LIMITED_EXIT_AND_RESTART", "BLOCKED_RENDERER_REVIEW", "BLOCKED_EVIDENCE_REVIEW"].includes(r.status));
  assert(r.finishedAt); assert.equal(r.cleanupError, null); assert.equal(r.adbCleanupStatus, "PASS");
  assert.equal(r.isElevated, true); assert(r.symlinkProbe.success && r.symlinkProbe.isElevated);
  assert.equal(r.nativeOverrides, 0); assert.equal(r.debuggerBreakpoints, 0); assert.equal(r.storeWrites, 0);
  assert.equal(r.cells.length, 2); assert.equal(r.cases.length, 6); assert.equal(r.exits.length, 12);
  assert.equal(r.launches.length, 12);
  for (const layout of ["agentvn", "renpy"]) {
    const cell = r.cells.find(c => c.layout === layout); assert(cell);
    assert.equal(cell.uninstallStatus, "PASS"); assert.equal(cell.apkCleanupStatus, "PASS");
    assert.equal(cell.cleanupError, null); assert.deepEqual(cell.logs.fatal, []);
    for (const mode of ["title_auto_off", "playing_auto_off", "playing_auto_on"]) {
      const label = layout + "-" + mode, test = r.cases.find(c => c.label === label); assert(test);
      assert.equal(test.status, "PASS");
      for (const name of [label, label + "-restart"]) {
        const exit = r.exits.find(e => e.label === name); assert(exit);
        assert.equal(exit.package, cell.package); assert.equal(exit.confirmationClicks, 1);
        assert.equal(exit.forcedBeforeExit, false); assert(exit.elapsedMs >= 0 && exit.elapsedMs < 15000);
        if (mode === "title_auto_off" && name === label) validateImmediateActivityReopen(exit);
        else validateActivityExit(exit);
        const command = r.commands[exit.closedCommandIndex];
        assert.deepEqual(command.args, ["shell", "dumpsys", "activity", "activities"]);
        assert.deepEqual(activityState(command.stdout, cell.package), exit.after);
        if (exit.reclaim) assert.deepEqual(r.commands[exit.reclaim.commandIndex].args,
          ["shell", "am", "force-stop", cell.package]);
        if (exit.reopened) {
          assert.deepEqual(r.commands[exit.reopened.commandIndex].args,
            ["shell", "monkey", "-p", cell.package, "1"]);
          assert(!r.commands.slice(exit.closedCommandIndex + 1, exit.reopened.commandIndex)
            .some(c => c.args[0] === "shell" && c.args[1] === "am" && c.args[2] === "force-stop"));
        }
      }
      if (mode === "playing_auto_on") {
        assert.deepEqual(test.before, test.restored);
        assert(test.disk.some(f => f.value.save_kind === "auto" && f.value.scene_id === test.before.scene
          && f.value.command_index === test.before.command));
      } else assert.equal(test.disk.length, 0);
    }
  }
  if (r.status === "PASS_LIMITED_EXIT_AND_RESTART") {
    assert(r.cells.every(c => c.logs.warnings.length === 0)); assert.equal(r.toolWarnings?.length || 0, 0);
  }
}
function main() {
  const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
  const base = "F:/AgentVN/QA/Android-Exit-20261024-01";
  const source = path.join(base, "device-" + attempt), out = path.join(base, "device-audit-" + attempt);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), scope: "SOURCE_APK_EXIT_ONLY_NOT_RELEASE_ACCEPTANCE" };
  try {
    const q = read(path.join(source, "request.json")); validateRequest(q);
    const resultFile = path.join(q.outputDir, "report.json"), result = read(resultFile);
    assert.equal(result.activityRestoration, q.activityRestoration);
    validateResult(result);
    const mutations = [r => { r.cases = []; }, r => { r.exits = []; },
      r => { r.exits[0].forcedBeforeExit = true; }, r => { r.nativeOverrides = 1; },
      r => { r.debuggerBreakpoints = 1; }, r => { r.cells[0].uninstallStatus = "FAILED"; },
      r => { r.cleanupError = "staging remains"; },
      r => { r.cases.find(c => c.label.endsWith("playing_auto_on")).restored.text += "wrong"; }];
    for (const mutate of mutations) { const bad = structuredClone(result); mutate(bad); assert.throws(() => validateResult(bad)); }
    for (const cell of result.cells) {
      assert(!fs.existsSync(cell.staging)); same(cell.apk); same(cell.provenance); same(cell.logcat);
      validateRecordedCellLog(cell, fs.readFileSync(cell.logcat.path, "utf8"));
    }
    for (const exit of result.exits) {
      same(exit.beforeEvidence); same(exit.afterEvidence);
      assert.deepEqual(activityState(fs.readFileSync(exit.beforeEvidence.path, "utf8"), exit.package), exit.before);
      assert.deepEqual(activityState(fs.readFileSync(exit.afterEvidence.path, "utf8"), exit.package), exit.after);
      if (exit.reopened) {
        same(exit.reopened.evidence);
        assert.deepEqual(activityState(fs.readFileSync(exit.reopened.evidence.path, "utf8"), exit.package),
          exit.reopened.activity);
        if (result.activityRestoration === "CACHED_RUNTIME_RECREATION") {
          assert.equal(exit.activityRestoration, result.activityRestoration);
          same(exit.reopened.nativeLog);
          same(exit.reopened.targetSnapshot);
          const targets = read(exit.reopened.targetSnapshot.path);
          assert.deepEqual(targets.filter(p => p.type === "page").map(p => p.id),
            exit.reopened.liveTargetIds, "Reopen targets must match the original snapshot");
          const lines = fs.readFileSync(exit.reopened.nativeLog.path, "utf8").split(/\r?\n/)
            .filter(line => /Android Runtime window restored for Activity -?\d+\./.test(line));
          assert.equal(lines.length, 1);
          assert.equal(lines[0], exit.reopened.nativeRestoreLine);
          assert.equal(exit.reopened.processRetained, true);
        }
      }
    }
    for (const test of result.cases) for (const f of test.disk) { same(f); assert.deepEqual(read(f.path), f.value); }
    assert.equal(result.screenshots.length, 24);
    for (const s of result.screenshots) {
      same(s); same(s.uiautomator); assert.deepEqual(s.before, s.after);
      assert.equal(s.hierarchy.root, "hierarchy"); assert.equal(s.hierarchy.parseErrors, 0);
      assert(s.hierarchy.appNodes > 0); assert([0, 137].includes(s.uiautomatorExitCode));
      const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), s.physical.width); assert.equal(b.readUInt32BE(20), s.physical.height);
    }
    const launch = read(path.join(q.outputDir, "acceptance-launch.json"));
    assert(launch.finishedAt && launch.isElevated); assert.equal(launch.emulatorCleanupStatus, "PASS");
    const boot = read(path.join(q.outputDir, "cold-boot.json"));
    assert.equal(boot.emulatorCleanupStatus, "PASS");
    const now = rows();
    assert(boot.processes?.length > 0);
    for (const p of boot.processes) {
      const raw = String(p.CreationDate), match = raw.match(/^\/Date\((\d+)\)\/$/);
      const created = match ? Number(match[1]) : Date.parse(raw);
      assert(Number.isFinite(created), "Emulator process creation time must be verifiable");
      assert(!now.some(n => n.ProcessId === p.ProcessId && Math.abs(Date.parse(n.Created) - created) < 2));
    }
    const ports = [5554, 5555, q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort];
    assert.deepEqual(listeners(ports), []);
    r.runtime = fileEvidence(resultFile); r.request = fileEvidence(path.join(source, "request.json"));
    r.counts = { cases: 6, actualActivityFinishes: 12, osReclaimSimulations: result.exits.filter(e => e.reclaim).length,
      immediateActivityReopens: result.exits.filter(e => e.reopened).length,
      cachedProcessReopens: result.exits.filter(e => e.reopened?.processRetained).length,
      screenshots: 24, rejectedBadEvidence: mutations.length };
    r.cleanup = { ports, sourceApksRetained: 2, stagingApksRemoved: 2, packagesUninstalled: 2 };
    r.warnings = result.cells.flatMap(c => c.logs.warnings);
    r.toolWarnings = result.toolWarnings || [];
    r.status = result.status === "PASS_LIMITED_EXIT_AND_RESTART"
      ? "LIMITED_ANDROID_EXIT_EVIDENCE_PASS" : "EVIDENCE_AUDITED_DEVICE_BLOCKED_REVIEW";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, out, error: r.error }));
}
if (require.main === module) main();
module.exports = { validateResult, validateRecordedCellLog };
