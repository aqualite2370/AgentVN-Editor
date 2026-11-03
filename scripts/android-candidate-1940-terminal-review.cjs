"use strict";
// Read-only supplement after BOTH device sessions finish. Does not repair
// historical reports, waive diagnostics, launch ADB, or rerun the product.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = "F:/AgentVN/QA/Android-Package-20261021-01";
const candidate = "F:/AgentVN/QA/Android-Candidate-1940-20261103-04";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function requireCleanup(runtime, owner, directory, names) {
  assert(runtime.finishedAt && owner.finishedAt);
  assert.equal(runtime.uninstallStatus, "PASS");
  assert.equal(runtime.apkCleanupStatus, "PASS");
  assert.equal(runtime.cleanupError, null);
  assert.equal(owner.emulatorCleanupStatus, "PASS");
  for (const name of names) assert(!fs.existsSync(path.join(directory, name)), name);
}
function inspectLog(text, packageName, finalTouch) {
  const lines = text.split(/\r?\n/);
  const timed = lines.filter(l => /^\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}/.test(l));
  const lastTimestamp = timed.at(-1)?.slice(0, 18) || null;
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`\\bStart proc (\\d+):${escaped}(?:[:/])`);
  const pids = [...new Set(lines.flatMap(l => l.match(start)?.[1] || []))];
  return { lastTimestamp, finalTouch: finalTouch?.label, runtimePids: pids,
    status: pids.length ? "REQUIRES_TIME_COVERAGE_REVIEW" : "BLOCKED_NO_RUNTIME_PID_OR_GAMEPLAY_LOG",
    limitation: "Missing log coverage is never evidence of no warnings or crashes" };
}
function validateUpgrade(a) {
  assert.equal(a.featureStatus, "PASS_LIMITED_REAL_APK_UPGRADE");
  assert.equal(a.checks.length, 6);
  assert(a.checks.every(c => c.status === "PASS"));
  assert.equal(a.status, "BLOCKED_RENDERER_TERMINATION_REVIEW");
  assert.equal(a.rendererTerminationReview.events.length, 2);
  assert(a.cacheWarnings.length > 0);
}
async function review(number) {
  assert.match(number, /^\d{2}$/);
  const out = path.join(candidate, `terminal-review-${number}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], sources: [desc(__filename)],
    productChanges: 0, builds: 0, modelRequests: 0, deviceOperations: 0 };
  const load = f => { report.sources.push(desc(f)); return read(f); };
  const verify = f => { assert.equal(desc(f.path).sha256, f.sha256); report.sources.push(desc(f.path)); };
  const check = (name, fn) => {
    const row = { name, status: "RUNNING" }; report.checks.push(row);
    try { row.evidence = fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  };
  try {
    const storyDir = path.join(root, "device-story-41-01");
    const upgradeDir = path.join(root, "device-story-upgrade-41-02");
    const sb = load(path.join(candidate, "android-story-device-41-01/binding.json"));
    const ub = load(path.join(candidate, "android-renpy-upgrade-02/binding.json"));
    const story = load(path.join(storyDir, "runtime/runtime-smoke-report.json"));
    const upgrade = load(path.join(upgradeDir, "runtime/upgrade-runtime-report.json"));
    const so = load(path.join(storyDir, "runtime/acceptance-launch.json"));
    const uo = load(path.join(upgradeDir, "runtime/acceptance-launch.json"));
    const boots = [storyDir, upgradeDir].map(d => load(path.join(d, "runtime/cold-boot.json")));
    const requests = [storyDir, upgradeDir].map(d => load(path.join(d, "request-submitted.json")));
    const audit = load(upgradeDir + "-audit-02/report.json");
    const originalAudit = load(storyDir + "-audit-01/report.json");
    check("Both frozen executions and source APK bytes remain unchanged", () => {
      for (const binding of [sb, ub]) for (const f of binding.sources) verify(f);
      verify(story.sourceApk); for (const p of ub.pair) verify(p.apk);
      assert.equal(story.sourceApk.sha256, ub.pair[1].apk.sha256);
      return { apk: story.sourceApk.sha256, storyBinding: desc(path.join(candidate,
        "android-story-device-41-01/binding.json")), upgradeBinding: desc(path.join(candidate,
        "android-renpy-upgrade-02/binding.json")) };
    });
    check("Original story failure and unexecuted lifecycle remain visible", () => {
      assert.equal(story.status, "FAILED");
      assert.match(story.message, /Settings return: changed scene/);
      assert.equal(story.fullStory.cases.length, 6);
      assert(story.fullStory.cases.slice(0, 5).every(c => c.status === "PASS"));
      assert.equal(story.fullStory.cases[5].status, "FAILED");
      assert.equal(story.requiredCoverage.stability, "NOT_RUN");
      assert.equal(story.restartTrials, undefined);
      return { status: "FAILED", message: story.message, cases: story.fullStory.cases.map(c =>
        ({ name: c.name, status: c.status })), touches: story.touches.length, lifecycle: "NOT_RUN" };
    });
    check("Upgrade functions pass with unresolved diagnostics retained", () => {
      validateUpgrade(audit);
      assert.equal(upgrade.playerAspectPersistence.status, "PASS");
      assert.deepEqual(upgrade.playerAspectPersistence.trials.map(t => t.n), [1, 2, 3]);
      const log = path.join(upgradeDir, "runtime/logcat.txt");
      report.sources.push(desc(log));
      const text = fs.readFileSync(log, "utf8");
      for (const e of audit.rendererTerminationReview.events) assert(text.includes(e.line));
      assert(audit.cacheWarnings.every(l => text.includes(l)));
      return { status: audit.status, featureStatus: audit.featureStatus, checks: audit.checks.length,
        rendererLines: audit.rendererTerminationReview.events.length,
        cacheWarnings: audit.cacheWarnings.length, playerRatioRestartTrials: 3,
        limitation: "No automatic exemption for Activity finish, code -1, or a warning seen in an older run" };
    });
    check("Finally receipts and currently released owned processes and ports", () => {
      requireCleanup(story, so, path.join(storyDir, "runtime"), ["staging.apk"]);
      requireCleanup(upgrade, uo, path.join(upgradeDir, "runtime"), ["old-staging.apk", "current-staging.apk"]);
      const ports = [...new Set(requests.flatMap(q => [q.adbPort, q.cdpPort,
        q.coldBoot.adbPort, q.coldBoot.grpcPort, 5554, 5555]))];
      const live = rows(), owned = [...boots.flatMap(b => b.processes.map(p => p.ProcessId)),
        so.processId, uo.processId, story.ownership.runnerPid];
      assert(!live.some(p => owned.includes(p.ProcessId)), "Recorded process PID live: inspect creation identity");
      assert.deepEqual(listeners(ports), []);
      return { ports, ownedAbsent: owned, oldAdbPid57608Untouched: true,
        previousAuditLimitation: "Its 5554/5555 observations occurred during the second bound device run",
        originalCleanupCheck: originalAudit.checks[4].status };
    });
    const failureLog = path.join(storyDir, "runtime/failure-logcat.txt");
    report.sources.push(desc(failureLog));
    report.storyLogs = inspectLog(fs.readFileSync(failureLog, "utf8"), requests[0].package, story.touches.at(-1));
    report.storyLogs.runtimeFinishedAt = story.finishedAt;
    report.storyLogs.historicalAuditError = originalAudit.error;
    report.storyStatus = "FAILED";
    report.upgradeStatus = audit.status;
    report.status = report.checks.some(c => c.status === "FAILED") ? "FAILED"
      : "EVIDENCE_VERIFIED_STORY_FAILED_UPGRADE_BLOCKED";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); }
  report.finishedAt = new Date().toISOString();
  const file = path.join(out, "report.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, report: desc(file),
    checks: report.checks.map(({ name, status }) => ({ name, status })), logs: report.storyLogs, error: report.error }));
  if (report.status === "FAILED") process.exitCode = 1;
}
function selfTest() {
  const valid = { featureStatus: "PASS_LIMITED_REAL_APK_UPGRADE", status: "BLOCKED_RENDERER_TERMINATION_REVIEW",
    checks: Array.from({ length: 6 }, () => ({ status: "PASS" })),
    rendererTerminationReview: { events: [{}, {}] }, cacheWarnings: ["unreviewed"] };
  validateUpgrade(valid);
  for (const mutate of [r => r.checks = [], r => r.checks[0].status = "NOT_RUN",
    r => r.rendererTerminationReview.events = [], r => r.cacheWarnings = []]) {
    const r = structuredClone(valid); mutate(r); assert.throws(() => validateUpgrade(r));
  }
  assert.equal(inspectLog("11-02 21:01:47.000 1 2 I tag: unrelated", "com.test", {}).runtimePids.length, 0);
  assert.deepEqual(inspectLog("11-02 21:01:47.000 1 2 I AM: Start proc 12:com.test/u0a2\n" +
    "11-02 21:01:47.001 1 2 I AM: Start proc 13:com.test.other/u0a3", "com.test", {}).runtimePids, ["12"]);
  console.log(JSON.stringify({ status: "PASS", rejectedIncompleteUpgradeEvidence: 4,
    exactPackagePidAndMissingLogChecks: 2, deviceOperations: 0 }));
}
if (require.main === module) {
  if (process.argv[2] === "self-test") selfTest();
  else review(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
}
