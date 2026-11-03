"use strict";
// Independent read-only audit of already terminal, current-candidate upgrades.
// Does not repeat device operations or turn warning evidence into PASS.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { rendererReview } = require("./android-candidate-renpy-device-audit.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
function main(bindingFile, number) {
  assert.match(number, /^\d{2}$/);
  const b = read(bindingFile), source = path.join(root, `device-upgrade-${b.attempt}-${b.deviceAttempt}`);
  const out = `${source}-terminal-${number}`; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], sources: [desc(__filename)],
    scope: "CURRENT_SIGNED_PAIR_UPGRADE_EVIDENCE_NOT_FULL_ANDROID_ACCEPTANCE",
    productChanges: 0, deviceOperations: 0, modelRequests: 0 };
  const verify = f => { assert.equal(sha(f.path), f.sha256, f.path); r.sources.push(desc(f.path)); };
  const load = f => { r.sources.push(desc(f)); return read(f); };
  const check = (name, run) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = run(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  try {
    const owner = load(path.join(source, "report.json"));
    const runtime = load(path.join(source, "runtime/upgrade-runtime-report.json"));
    const launch = load(path.join(source, "runtime/acceptance-launch.json"));
    const boot = load(path.join(source, "runtime/cold-boot.json"));
    const q = load(path.join(source, "request-submitted.json"));
    check("Current candidate, immutable signed pair and actual administrator cold boot", () => {
      verify(runtime.candidateBinding); assert.equal(path.resolve(bindingFile), runtime.candidateBinding.path);
      assert.deepEqual(q.candidateBinding, runtime.candidateBinding);
      for (const f of b.sources) verify(f);
      const audit = load(b.audit.path); verify(b.audit); verify(b.config);
      assert.equal(audit.status, "APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN");
      assert.deepEqual(q.upgradePair, { old: audit.upgradePair.old, current: audit.upgradePair.current });
      assert.equal(q.apk.sha256, audit.upgradePair.currentApk.sha256);
      for (const f of Object.values(runtime.sourceApks)) verify(f);
      assert.deepEqual(runtime.sourceApks, { old: q.oldApk, current: q.apk });
      assert.equal(q.upgradePair.old.signerSha256, q.upgradePair.current.signerSha256);
      assert(q.upgradePair.current.versionCode > q.upgradePair.old.versionCode);
      assert.equal(launch.isElevated, true); assert.equal(launch.parentBoundary, "non-admin-to-RunAs");
      assert.equal(launch.exitCode, 0); assert(launch.finishedAt);
      assert(runtime.symlinkProbe.isElevated && runtime.symlinkProbe.success);
      assert.equal(runtime.coldBoot.status, "PASS");
      assert.equal(runtime.coldBoot.observedBootId, boot.bootId); assert.equal(boot.coldBoot, true);
      return { old: q.upgradePair.old, current: q.upgradePair.current, binding: runtime.candidateBinding };
    });
    check("Real UI-created saves preserved without clear/uninstall, then loaded and advanced", () => {
      assert.equal(runtime.cases.length, 6); assert(runtime.cases.every(c => c.status === "PASS" && c.finishedAt));
      const before = runtime.cases[1].evidence.baseline, after = runtime.cases[2].evidence.after;
      const view = a => a.map(f => [f.remote, f.sha256]).sort();
      assert(before.some(f => f.value.save_kind === "manual"));
      assert(before.some(f => f.value.save_kind === "auto")); assert.deepEqual(view(before), view(after));
      for (const f of [...before, ...after]) { verify(f); assert.deepEqual(read(f.path), f.value); }
      assert.deepEqual(runtime.cases[0].evidence.pref, runtime.cases[3].evidence.preferences);
      assert.equal(Object.values(runtime.cases[3].evidence.preferences)[0].highContrastText, true);
      assert.equal(runtime.cases[3].evidence.snapshotAndNewScript, true);
      const start = Date.parse(runtime.cases[0].startedAt), end = Date.parse(runtime.cases[3].finishedAt);
      const commands = runtime.commands.filter(c => Date.parse(c.at) >= start && Date.parse(c.at) <= end);
      assert(!commands.some(c => c.args[0] === "uninstall" || c.args.slice(0, 3).join(" ") === "shell pm clear"));
      const update = commands.filter(c => c.args[0] === "install" && c.args[1] === "-r");
      assert.equal(update.length, 1); assert.equal(update[0].status, 0); assert.match(update[0].stdout, /Success/);
      if (runtime.installedPackageBytes) {
        assert.deepEqual(runtime.installedPackageBytes.map(x => [x.label, x.sha256]),
          [["old", q.oldApk.sha256], ["current", q.apk.sha256]]);
      }
      assert(runtime.touches.length >= 18);
      r.authoredTextChanged = read(b.audit.path).authoredTextChanged ?? true;
      return { saves: before.length, touches: runtime.touches.length,
        installedPackageBytes: runtime.installedPackageBytes, authoredTextChanged: r.authoredTextChanged,
        oldQuickCreation: runtime.oldQuickCreation, oldExit: runtime.oldExitObservation };
    });
    check("Six real starts, screenshots, actual DPR and fresh package UIAutomator records", () => {
      assert.equal(runtime.restartTrials.length, 6);
      for (const kind of ["retained-data", "clean-install"])
        assert.deepEqual(runtime.restartTrials.filter(t => t.kind === kind).map(t => t.n), [1, 2, 3]);
      assert(runtime.restartTrials.every(t => t.status === "PASS")); assert(runtime.screenshots.length >= 11);
      let xmlCount = 0;
      for (const shot of runtime.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path); assert.equal(png.subarray(1, 4).toString(), "PNG");
        assert.equal(png.readUInt32BE(16), shot.physical.width);
        assert.equal(png.readUInt32BE(20), shot.physical.height);
        assert.equal(shot.before.width, Math.ceil(shot.physical.width / shot.before.dpr));
        assert.equal(shot.before.height, Math.ceil(shot.physical.height / shot.before.dpr));
        if (shot.uiautomator) {
          verify(shot.uiautomator); const xml = fs.readFileSync(shot.uiautomator.path, "utf8");
          assert(xml.includes("<hierarchy") && xml.includes(`package="${q.package}"`));
          assert(shot.uiautomatorParse.valid && shot.uiautomatorParse.packageNodes > 0); xmlCount++;
        }
      }
      assert(xmlCount >= 4);
      return { screenshots: runtime.screenshots.length, xml: xmlCount, physical: runtime.physical,
        uiautomatorStatus: runtime.uiautomatorStatus, gaps: runtime.evidenceGaps || [] };
    });
    check("Independent actual log review, no inherited warning exemption", () => {
      const file = path.join(source, "runtime/logcat.txt"); r.sources.push(desc(file));
      assert.deepEqual(runtime.logs.fatal, []);
      r.rendererReview = rendererReview({ pids: runtime.logs.pids }, fs.readFileSync(file, "utf8"));
      r.warningCount = runtime.logs.warnings.length;
      r.functionalCasesStatus = "PASS";
      r.featureStatus = r.rendererReview.events.length ? "BLOCKED_RENDERER_TERMINATION_REVIEW"
        : r.warningCount || runtime.evidenceGaps?.length ? "BLOCKED_CURRENT_LOG_OR_COLLECTION_REVIEW"
        : "PASS_LIMITED_UPGRADE";
      return { fatal: 0, warnings: r.warningCount, renderer: r.rendererReview,
        rawStatus: runtime.status, reviewedStatus: r.featureStatus };
    });
    check("Source APK retained, staging removed, owned processes/ports and emulator stopped", () => {
      for (const k of ["uninstallStatus", "apkCleanupStatus", "adbCleanupStatus"]) assert.equal(runtime[k], "PASS");
      assert.equal(runtime.cleanupError, null);
      assert.equal(launch.emulatorCleanupStatus, "PASS"); assert.equal(boot.emulatorCleanupStatus, "PASS");
      for (const file of ["old-staging.apk", "current-staging.apk"])
        assert(!fs.existsSync(path.join(source, "runtime", file)));
      const ports = [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort, 5554, 5555];
      assert.deepEqual(listeners(ports), []);
      const live = rows();
      for (const process of boot.processes) assert(!live.some(p => p.ProcessId === process.ProcessId));
      assert(owner.finishedAt);
      return { stagingDeleted: 2, sourceApksPreserved: 2, portsReleased: ports.length };
    });
    r.status = "EVIDENCE_VERIFIED_FEATURE_" + r.featureStatus;
    r.limitations = owner.limitations;
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, out, checks: r.checks.map(x => ({ name: x.name, status: x.status })),
    warningCount: r.warningCount, renderer: r.rendererReview, error: r.error }, null, 2));
}
if (require.main === module) main(...process.argv.slice(2));
