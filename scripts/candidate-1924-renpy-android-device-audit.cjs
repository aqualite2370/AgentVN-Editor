"use strict";
// Re-read terminal device evidence. Integrity PASS never upgrades a failed flow.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { validateRenpyRequest } = require("./candidate-1924-renpy-android-device.cjs");
const { validateCompletion } = require("./candidate-1924-renpy-android-device-launch.cjs");
const { validateImmediateActivityReopen } = require("./android-exit-device.cjs");
const root = "F:\\AgentVN\\QA\\Android-Package-20261021-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function validateFlow(r) {
  validateCompletion(r);
  assert(r.cases.length > 0 && r.cases.length <= 5);
  assert(r.cases.every(row => ["PASS", "FAILED"].includes(row.status)));
  if (r.status === "FAILED") return;
  assert.equal(r.cases[2].evidence.writes, 7);
  assert.equal(r.cases[2].evidence.filesRetained, 6);
  assert.equal(r.cases[2].evidence.confirmedRead, true);
  assert.deepEqual(r.cases[3].evidence.methods, ["touch", "BACK"]);
  assert.equal(r.cases[3].evidence.sceneLoop, true);
  for (let i = 0; i < 7; i++) {
    assert.equal(r.quickSaveSnapshots[i].length, Math.min(i + 1, 6));
    const rows = r.quickSaveSnapshots[i];
    assert.equal(new Set(rows.map(row => row.remote)).size, rows.length);
    assert(rows.every(row => row.value.save_kind === "quick" && row.value.scene_id === "ui_acceptance"));
    if (i > 0) assert.notDeepEqual(rows.map(row => row.sha256).sort(),
      r.quickSaveSnapshots[i - 1].map(row => row.sha256).sort(), "Every actual quicksave must produce new content");
  }
  const [first, second] = r.activityExits; validateImmediateActivityReopen(first);
  assert.equal(second.basis, "ACTIVITY_FINISH"); assert.equal(second.after.closed, true);
  assert.equal(second.after.live.length, 0); assert.equal(second.forcedBeforeExit, false);
  assert.equal(second.confirmationClicks, 1); assert.deepEqual(second.fatalBeforeReclaim, []);
  assert(second.elapsedMs >= 0 && second.elapsedMs < 15000);
  assert(first.closedCommandIndex < first.reopened.commandIndex && first.reopened.commandIndex < second.closedCommandIndex);
  const commands = r.commands.slice(0, second.closedCommandIndex + 1);
  assert(!commands.some(row => row.args.slice(0, 3).join(" ") === "shell am force-stop"));
  assert(!commands.some(row => row.args[0] === "uninstall" || row.args.slice(0, 3).join(" ") === "shell pm clear"));
  const e = r.cases[4].evidence;
  assert.equal(e.restoredRuntimeOperable, true); assert.equal(e.confirmationClicks, 2);
  assert.deepEqual(e.continued, r.cases[1].evidence.first);
  assert.deepEqual(e.advanced, e.continued);
  for (const [rows, expected] of [[e.saved, e.continued], [e.savedAfterSecond, e.advanced]]) {
    assert(rows.some(row => row.value.save_kind === "auto" && row.value.scene_id === expected.scene
      && row.value.command_index === Number(expected.command)));
  }
}
function selfTest() {
  const rejected = [
    { finishedAt: "end", status: "PASS_LIMITED_RENPY_OFFICIAL_GUI", cases: [] },
    { finishedAt: "end", scope: "installed-renpy-resource-navigation", status: "FAILED", error: "original",
      isElevated: true, uninstallStatus: "PASS", apkCleanupStatus: "PASS",
      adbCleanupStatus: "PASS", cleanupError: null, cases: [] },
    { finishedAt: "end", scope: "installed-renpy-resource-navigation", status: "PASS",
      cases: Array.from({ length: 5 }, () => ({ status: "PASS" })) },
  ];
  for (const r of rejected) assert.throws(() => validateFlow(r));
  validateFlow({ finishedAt: "end", scope: "installed-renpy-resource-navigation", status: "FAILED", error: "preserved",
    isElevated: true, uninstallStatus: "PASS", apkCleanupStatus: "PASS", adbCleanupStatus: "PASS",
    cleanupError: null, cases: [{ status: "FAILED" }] });
  console.log(JSON.stringify({ status: "PASS", emptyOrFalsePassRejected: rejected.length,
    failedFlowNotUpgraded: true, deviceOperations: 0 }));
}
async function main() {
  if (process.argv[2] === "--self-test") return selfTest();
  assert.equal(process.argv.length, 4);
  const [attempt, auditAttempt] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(auditAttempt, /^\d{2}$/);
  const source = path.join(root, "device-renpy-19-" + attempt);
  const out = path.join(root, `device-renpy-19-${attempt}-audit-${auditAttempt}`);
  fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "RESOURCE_DEVICE_EVIDENCE_NOT_NORMAL_PUBLISH_OR_FULL_ACCEPTANCE", checks: [], sources: [] };
  const load = file => { r.sources.push(fileEvidence(file)); return read(file); };
  const verify = item => {
    assert.equal(fileEvidence(item.path).sha256, item.sha256);
    if (item.bytes !== undefined) assert.equal(fs.statSync(item.path).size, item.bytes);
    return fs.readFileSync(item.path);
  };
  async function check(name, fn) {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  }
  try {
    const owner = load(path.join(source, "report.json")), runtime = load(path.join(source, "runtime/navigation-report.json"));
    const launch = load(path.join(source, "runtime/acceptance-launch.json"));
    const boot = load(path.join(source, "runtime/cold-boot.json"));
    const q = load(path.join(source, "request-submitted.json"));
    await check("Terminal real elevation, cold boot, frozen APK and executed source copies", () => {
      assert(owner.finishedAt && launch.finishedAt && runtime.finishedAt);
      assert.equal(owner.status, runtime.status); validateRenpyRequest(q);
      assert.equal(launch.parentBoundary, "non-admin-to-RunAs"); assert.equal(launch.isElevated, true);
      assert(runtime.symlinkProbe.isElevated && runtime.symlinkProbe.success);
      assert.equal(boot.coldBoot, true); assert.equal(boot.bootId, runtime.coldBoot.observedBootId);
      for (const item of owner.tools) verify({ ...item, path: path.join(source, path.basename(item.path)) });
      for (const name of ["productChanges", "buildInvocations", "modelRequests"]) assert.equal(owner[name], 0);
      return { bootId: boot.bootId, copiedTools: owner.tools.length, status: runtime.status, apk: q.apk };
    });
    await check("Actual resource bytes, seven quicksaves, hidden choices and recreated native Runtime", () => {
      validateFlow(runtime);
      const touches = runtime.commands.filter(row => row.args.slice(0, 2).join(" ") === "shell input");
      if (runtime.cases.filter(row => row.status === "PASS").length > 1) assert(touches.length > 0);
      for (const sample of runtime.renderedResources ?? []) {
        assert(sample.matched.length > 0);
        for (const match of sample.matched)
          assert(q.resourceAssets.some(asset => asset.sha256 === match.sha256 && asset.bytes === match.bytes));
      }
      for (const rows of runtime.quickSaveSnapshots ?? [])
        for (const item of rows) assert.deepEqual(JSON.parse(verify(item)), item.value);
      for (const exit of runtime.activityExits ?? []) {
        for (const item of [exit.beforeEvidence, exit.afterEvidence]) verify(item);
        if (exit.reopened)
          for (const item of [exit.reopened.evidence, exit.reopened.targetSnapshot, exit.reopened.nativeLog]) verify(item);
      }
      if (runtime.cases[4]?.status === "PASS")
        for (const rows of [runtime.cases[4].evidence.saved, runtime.cases[4].evidence.savedAfterSecond])
          for (const item of rows) assert.deepEqual(JSON.parse(verify(item)), item.value);
      return { passed: runtime.cases.filter(row => row.status === "PASS").length,
        failed: runtime.cases.filter(row => row.status === "FAILED").length,
        notRun: 5 - runtime.cases.length, realInputCommands: touches.length };
    });
    await check("Actual native PNG, UIAutomator and independent scoped fatal/cache log parsing", () => {
      assert(runtime.screenshots.length > 0);
      for (const shot of runtime.screenshots) {
        const bytes = verify(shot); assert.deepEqual(shot.before, shot.after);
        assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        assert.equal(bytes.readUInt32BE(16), shot.physical.width); assert.equal(bytes.readUInt32BE(20), shot.physical.height);
        assert(shot.physical.width > shot.physical.height && shot.before.dpr > 0);
        assert(verify(shot.uiautomator).toString("utf8").includes(q.package));
      }
      const logFile = path.join(source, "runtime", runtime.status === "FAILED" ? "failure-logcat.txt" : "logcat.txt");
      r.sources.push(fileEvidence(logFile));
      const parsed = scopedRuntimeLog(fs.readFileSync(logFile, "utf8"), q.package, runtime.pids);
      assert.deepEqual(parsed.fatal, runtime.logs.fatal); assert.deepEqual(parsed.warnings, runtime.logs.warnings);
      if (runtime.status === "PASS_LIMITED_RENPY_OFFICIAL_GUI") {
        assert.deepEqual(parsed.fatal, []); assert.deepEqual(parsed.warnings, []);
      }
      return { screenshots: runtime.screenshots.length, fatal: parsed.fatal.length, warnings: parsed.warnings.length };
    });
    await check("Finally uninstall, staging deletion, emulator/ADB termination and retained source", () => {
      assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
      assert.equal(runtime.adbCleanupStatus, "PASS"); assert.equal(runtime.cleanupError, null);
      assert.equal(launch.emulatorCleanupStatus, "PASS"); assert.equal(boot.emulatorCleanupStatus, "PASS");
      assert(!fs.existsSync(path.join(source, "runtime/staging.apk"))); verify(q.apk);
      const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
      assert.deepEqual(listeners([q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort, 5554, 5555]), []);
      const live = rows();
      for (const p of boot.processes)
        assert(!live.some(n => n.ProcessId === p.ProcessId && Date.parse(n.Created) === Date.parse(p.CreationDate)));
      return { ownedPortsReleased: 6, sourceApkRetained: true, stagingDeleted: true };
    });
    r.trialStatus = runtime.status; r.status = "EVIDENCE_AUDIT_PASS_FEATURE_" + runtime.status;
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  console.log(JSON.stringify({ status: r.status, out, checks: r.checks, error: r.error }));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
