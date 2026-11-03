"use strict";
// Independent evidence audit. No ADB, emulator, model or product mutations.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
async function main() {
  const [device, audit] = process.argv.slice(2);
  assert.match(device, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const root = "F:/AgentVN/QA/Android-Package-20261021-01";
  const source = path.join(root, "device-upgrade-12-" + device);
  const output = path.join(root, `device-upgrade-audit-12-${device}-${audit}`); fs.mkdirSync(output);
  const result = { status: "RUNNING", scope: "RECENT_SIGNED_ANDROID_AVAILABLE_SAVES_UPGRADE_NOT_FULL_ACCEPTANCE",
    startedAt: new Date().toISOString(), checks: [], sources: [] };
  const load = file => { result.sources.push(fileEvidence(file)); return read(file); };
  const check = async (name, run) => {
    const item = { name, status: "RUNNING" }; result.checks.push(item);
    try { item.evidence = await run(); item.status = "PASS"; }
    catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
  };
  try {
    const owner = load(path.join(source, "report.json"));
    const runtime = load(path.join(source, "runtime/upgrade-runtime-report.json"));
    const launch = load(path.join(source, "runtime/acceptance-launch.json"));
    const request = load(path.join(source, "request.json"));
    const boot = load(path.join(source, "runtime/cold-boot.json"));
    await check("Real elevation, cold boot, fixed source pair and unchanged executed tools", async () => {
      assert(["PARTIAL_PASS", "BLOCKED"].includes(owner.status));
      assert.equal(owner.sourcePublishingWorkflow.normalCloseStatus, "FAILED");
      assert.equal(owner.sourcePublishingWorkflow.publishingWorkflowStatus, "FAILED");
      assert.equal(launch.isElevated, true); assert.equal(launch.parentBoundary, "non-admin-to-RunAs");
      assert(launch.finishedAt); assert.equal(launch.exitCode, 0);
      assert.equal(runtime.isElevated, true); assert(runtime.symlinkProbe.isElevated && runtime.symlinkProbe.success);
      assert.equal(runtime.coldBoot.status, "PASS");
      assert.equal(runtime.coldBoot.observedBootId, boot.bootId);
      assert.equal(boot.coldBoot, true); assert.equal(boot.avd, "AgentVN_API35");
      assert.equal(owner.requestValidator.rejected, 8);
      for (const tool of owner.tools) {
        assert.equal(fileEvidence(tool.path).sha256, tool.sha256);
        assert.equal(fileEvidence(path.join(source, path.basename(tool.path))).sha256, tool.sha256);
      }
      assert.equal(runtime.sourceApks.old.sha256, "504ea034c14f393465b44160898516a7875d3031c65d108779ecb51897b5de5b");
      assert.equal(runtime.sourceApks.current.sha256, "118f2efe1ffedd860d444e704e23904e1295559f5a0d6d8bf8eb61a46511a8e0");
      for (const apk of Object.values(runtime.sourceApks)) assert.equal(fileEvidence(apk.path).sha256, apk.sha256);
      return { bootId: boot.bootId, tools: owner.tools.length, normalClose: "FAILED_RETAINED" };
    });
    await check("Real touch-created save bytes preserved through install -r; actual old snapshot and new text consumption", async () => {
      assert.equal(runtime.cases.length, 6); assert(runtime.cases.every(c => c.status === "PASS"));
      const before = runtime.cases[1].evidence.baseline, after = runtime.cases[2].evidence.after;
      assert(before.some(s => s.value.save_kind === "manual"));
      for (const file of [...before, ...after]) assert.equal(fileEvidence(file.path).sha256, file.sha256);
      const view = saves => saves.map(s => ({ remote: s.remote, sha256: s.sha256 })).sort((a,b) => a.remote.localeCompare(b.remote));
      assert.deepEqual(view(before), view(after));
      assert(runtime.touches.length >= 10);
      const upgrade = runtime.commands.filter(c => c.args[0] === "install" && c.args[1] === "-r");
      assert.equal(upgrade.length, 1); assert.equal(upgrade[0].status, 0); assert.match(upgrade[0].stdout, /Success/);
      const start = Date.parse(runtime.cases[0].startedAt), proved = Date.parse(runtime.cases[3].finishedAt);
      for (const c of runtime.commands.filter(c => Date.parse(c.at) >= start && Date.parse(c.at) <= proved)) {
        assert.notEqual(c.args[0], "uninstall");
        assert.notEqual(c.args.slice(0, 3).join(" "), "shell pm clear");
      }
      assert.equal(runtime.cases[0].evidence.first.command, 0);
      assert(runtime.cases[0].evidence.first.text.startsWith("QA_ANDROID_0："));
      assert.equal(runtime.cases[3].evidence.snapshotAndNewScript, true);
      assert(runtime.cases[3].evidence.oldKinds.includes("manual"));
      assert.deepEqual(runtime.cases[0].evidence.pref, runtime.cases[3].evidence.preferences);
      assert.equal(Object.values(runtime.cases[3].evidence.preferences)[0].highContrastText, true);
      assert.equal(runtime.oldExitObservation.status, "FAILED");
      return { saves: before.length, oldKinds: runtime.cases[3].evidence.oldKinds,
        oldAutoCreation: runtime.oldAutoCreation, oldQuickCreation: runtime.oldQuickCreation,
        oldExit: "FAILED_OLD_0_1_0_ONLY" };
    });
    await check("Six actual starts, immutable screenshots and current-version logs", async () => {
      assert.equal(runtime.restartTrials.length, 6);
      for (const kind of ["retained-data", "clean-install"])
        assert.deepEqual(runtime.restartTrials.filter(t => t.kind === kind).map(t => t.n), [1, 2, 3]);
      for (const trial of runtime.restartTrials) assert.equal(trial.status, "PASS");
      assert(runtime.screenshots.length >= 9);
      for (const shot of runtime.screenshots) {
        assert.equal(fileEvidence(shot.path).sha256, shot.sha256); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path);
        assert.equal(png.subarray(1,4).toString(), "PNG");
        assert.equal(png.readUInt32BE(16), shot.physical.width); assert.equal(png.readUInt32BE(20), shot.physical.height);
        assert(shot.physical.width > shot.physical.height); assert(shot.before.dpr > 0);
        if (shot.uiautomator) assert.equal(fileEvidence(shot.uiautomator.path).sha256, shot.uiautomator.sha256);
      }
      assert.deepEqual(runtime.logs.fatal, []);
      assert(["PASS", "BLOCKED_REQUIRES_CURRENT_VERSION_REVIEW"].includes(runtime.rendererWarningsStatus));
      return { trials: 6, screenshots: runtime.screenshots.length, physical: runtime.physical,
        warningCount: runtime.logs.warnings.length, warningStatus: runtime.rendererWarningsStatus,
        scope: "Native API35 landscape, no emulated desktop DPR or physical-4K claim" };
    });
    await check("Independent terminal staging, source APK, emulator and owned port cleanup", async () => {
      assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
      assert.equal(runtime.adbCleanupStatus, "PASS"); assert.equal(runtime.cleanupError, null);
      assert.equal(launch.emulatorCleanupStatus, "PASS"); assert.equal(boot.emulatorCleanupStatus, "PASS");
      for (const file of ["old-staging.apk", "current-staging.apk"])
        assert.equal(fs.existsSync(path.join(source, "runtime", file)), false);
      const ports = [request.adbPort, request.cdpPort, request.coldBoot.adbPort,
        request.coldBoot.grpcPort, 5554, 5555];
      const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
      assert.deepEqual(listeners(ports), []);
      const live = rows();
      for (const p of boot.processes) assert(!live.some(n => n.ProcessId === p.ProcessId), "Owned emulator still running");
      result.sources.push(fileEvidence(path.join(source, "runtime/logcat.txt")));
      return { stagingDeleted: 2, sourceApksRetained: 2, portsReleased: ports.length };
    });
    result.status = "EVIDENCE_AUDIT_PASS_FEATURE_PARTIAL";
    result.featureStatus = runtime.status;
    result.limitations = owner.limitations;
  } catch (e) { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; }
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, output, checks: result.checks, error: result.error }, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
