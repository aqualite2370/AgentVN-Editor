"use strict";
// Independent read-only audit of terminal evidence, including failed trials.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
async function main() {
  const [attempt, auditAttempt] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(auditAttempt, /^\d{2}$/);
  const root = "F:\\AgentVN\\QA\\Android-Package-20261021-01";
  const source = path.join(root, "device-navigation-12-" + attempt);
  const output = path.join(root, `device-navigation-audit-12-${attempt}-${auditAttempt}`); fs.mkdirSync(output);
  const r = { status: "RUNNING", scope: "EVIDENCE_INTEGRITY_NOT_BLANKET_PRODUCT_PASS",
    startedAt: new Date().toISOString(), checks: [], sources: [] };
  const load = file => { r.sources.push(fileEvidence(file)); return read(file); };
  const check = async (name, action) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await action(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  try {
    const owner = load(path.join(source, "report.json"));
    const runtime = load(path.join(source, "runtime/navigation-report.json"));
    const launch = load(path.join(source, "runtime/acceptance-launch.json"));
    const boot = load(path.join(source, "runtime/cold-boot.json"));
    const request = load(path.join(source, "request-submitted.json"));
    await check("Terminal ownership, real elevation, symlink probe and frozen source APK", () => {
      assert(owner.finishedAt && launch.finishedAt && runtime.finishedAt);
      assert(["FAILED", "PASS_LIMITED_AGENTVN_NAVIGATION", "BLOCKED_RENDERER_REVIEW"].includes(owner.status));
      assert.equal(runtime.status, owner.status);
      assert.equal(launch.parentBoundary, "non-admin-to-RunAs"); assert.equal(launch.isElevated, true);
      assert.equal(runtime.isElevated, true); assert(runtime.symlinkProbe.success && runtime.symlinkProbe.isElevated);
      assert.equal(boot.coldBoot, true); assert.equal(boot.bootId, runtime.coldBoot.observedBootId);
      assert.equal(fileEvidence(request.apk.path).sha256, "118f2efe1ffedd860d444e704e23904e1295559f5a0d6d8bf8eb61a46511a8e0");
      for (const tool of owner.tools)
        assert.equal(fileEvidence(path.join(source, path.basename(tool.path))).sha256, tool.sha256);
      assert.equal(owner.productChanges, 0); assert.equal(owner.buildInvocations, 0); assert.equal(owner.modelRequests, 0);
      return { bootId: boot.bootId, copiedTools: owner.tools.length, trialStatus: runtime.status };
    });
    await check("Nonempty actual cases and native input; failed and missing steps remain explicit", () => {
      const planned = request.exitProbe ? 1 : 5;
      assert(runtime.cases.length > 0 && runtime.cases.length <= planned);
      assert(runtime.cases.every(c => ["PASS", "FAILED"].includes(c.status)));
      assert(runtime.touches.length > 0);
      const keys = runtime.commands.filter(c => c.args.slice(0, 3).join(" ") === "shell input keyevent");
      assert(keys.some(c => c.args[3] === "KEYCODE_BACK" && c.status === 0));
      if (runtime.status === "PASS_LIMITED_AGENTVN_NAVIGATION" && request.exitProbe) {
        assert.equal(runtime.cases.length, 1); assert.equal(runtime.cases[0].status, "PASS");
        assert.equal(runtime.cases[0].evidence.gameplayStarted, false);
        assert.equal(runtime.cases[0].evidence.autosaveDisabledThroughUI, true);
        assert.equal(runtime.cases[0].evidence.exitedWithoutForceStop, true);
      } else if (runtime.status === "PASS_LIMITED_AGENTVN_NAVIGATION") {
        assert.equal(runtime.cases.length, 5); assert(runtime.cases.every(c => c.status === "PASS"));
        assert(runtime.cases[0].evidence.topModalOnly);
        assert.deepEqual(runtime.cases[1].evidence.restores, ["touch", "system BACK"]);
        assert.equal(runtime.cases[2].evidence.samples.length, 2);
        assert.equal(runtime.cases[3].evidence.menuThenChildThenMenuThenPlayer, true);
        assert.equal(runtime.cases[4].evidence.exitedWithoutForceStop, true);
        assert.equal(runtime.cases[4].evidence.confirmationClicks, 1);
        assert.equal(runtime.rotationRestoreStatus, "PASS_EXACT_POLICY_RESTORED");
      } else {
        assert(runtime.status !== "FAILED" || runtime.cases.some(c => c.status === "FAILED"));
        assert(runtime.status !== "FAILED" || runtime.error);
      }
      return { passed: runtime.cases.filter(c => c.status === "PASS").length,
        failed: runtime.cases.filter(c => c.status === "FAILED").length, notRun: planned - runtime.cases.length,
        realInputCommands: runtime.commands.filter(c => c.args.slice(0, 2).join(" ") === "shell input").length };
    });
    await check("Actual landscape PNG, unchanged viewports, UIAutomator and independently parsed log", () => {
      assert(runtime.screenshots.length >= 1);
      for (const shot of runtime.screenshots) {
        assert.equal(fileEvidence(shot.path).sha256, shot.sha256); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.subarray(1, 4).toString(), "PNG");
        assert.equal(png.readUInt32BE(16), shot.physical.width);
        assert.equal(png.readUInt32BE(20), shot.physical.height); assert(shot.physical.width > shot.physical.height);
        assert(shot.before.dpr > 0); assert.equal(fileEvidence(shot.uiautomator.path).sha256, shot.uiautomator.sha256);
        assert(fs.readFileSync(shot.uiautomator.path, "utf8").includes(request.package));
      }
      const logFile = path.join(source, "runtime", runtime.status === "FAILED" ? "failure-logcat.txt" : "logcat.txt");
      r.sources.push(fileEvidence(logFile));
      const logs = scopedRuntimeLog(fs.readFileSync(logFile, "utf8"), request.package, runtime.pids);
      assert.deepEqual(logs.warnings, runtime.logs.warnings); assert.deepEqual(logs.fatal, runtime.logs.fatal);
      return { screenshots: runtime.screenshots.length, warnings: logs.warnings.length, fatal: logs.fatal.length,
        scope: "Real API35 emulator landscape, no desktop matrix or physical-device claim" };
    });
    await check("Uninstall, staging deletion, source retention and owned process/port cleanup", () => {
      assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
      assert.equal(runtime.adbCleanupStatus, "PASS"); assert.equal(runtime.cleanupError, null);
      assert.equal(launch.emulatorCleanupStatus, "PASS"); assert.equal(boot.emulatorCleanupStatus, "PASS");
      assert(!fs.existsSync(path.join(source, "runtime/staging.apk")));
      const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
      assert.deepEqual(listeners([request.adbPort, request.cdpPort, request.coldBoot.adbPort,
        request.coldBoot.grpcPort, 5554, 5555]), []);
      const processes = rows();
      for (const p of boot.processes)
        assert(!processes.some(n => n.ProcessId === p.ProcessId && Date.parse(n.Created) === Date.parse(p.CreationDate)));
      assert.equal(fileEvidence(request.apk.path).sha256, request.apk.sha256);
      return { stagingDeleted: 1, sourceApkRetained: true, ownedPortsReleased: 6 };
    });
    r.trialStatus = runtime.status;
    r.status = "EVIDENCE_AUDIT_PASS_FEATURE_" + (runtime.status === "PASS_LIMITED_AGENTVN_NAVIGATION" ? "LIMITED_PASS" : runtime.status);
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, output, checks: r.checks, error: r.error }, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
