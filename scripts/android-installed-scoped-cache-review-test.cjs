"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/android-scoped-cache-review-tests", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", cases: [] };
try {
  const { reviewCacheWarnings } = require("./android-installed-scoped-cache-review.cjs");
  const { assessRestartTrials } = require("./android-runtime-log-analysis.cjs");
  const runtime = JSON.parse(fs.readFileSync(path.join(root,
    "output/runtime-webview-android-installed-20261017-01/installed-session/android-runtime/runtime-smoke-report.json"), "utf8"));
  const prior = JSON.parse(fs.readFileSync(path.join(root,
    "output/android-renderer-diagnostics-20261017-01/cache-warning-disposition-01.json"), "utf8"));
  function test(name, mutate, expected = false, preserveAssessment = false) {
    const current = structuredClone(runtime), reference = structuredClone(prior);
    mutate(current, reference);
    if (!preserveAssessment) current.rendererWarningAssessment = assessRestartTrials(current.restartTrials);
    if (expected) assert.equal(reviewCacheWarnings(current, reference).status,
      "SCOPED_NON_BLOCKING_CACHE_WARNING_REVIEW");
    else assert.throws(() => reviewCacheWarnings(current, reference));
    report.cases.push({ name, status: "PASS" });
  }
  test("actual captured fake-index case matches previously investigated warning", () => {}, true);
  test("different provider needs new investigation", r => { r.webviewVersion = r.webviewVersion.replaceAll("124.0.6367.219", "125.0.0.0"); });
  test("different package cannot reuse this evidence", r => { r.packageName += ".other"; });
  test("missing prior causal evidence", (r, p) => { p.capture14DefaultAssessment.unknownWarnings = []; });
  test("unknown warning is not exempted", r => { r.restartTrials[1].warnings.push("Unexpected application error"); });
  test("fake-index requires a native event, not just forwarded output", r => {
    r.restartTrials[1].warnings = r.restartTrials[1].warnings.filter(l => !l.includes("E chromium: [ERROR:simple_version_upgrade"));
  });
  test("fake-index requires nearby cache-path evidence", r => {
    r.restartTrials[1].warnings = r.restartTrials[1].warnings.filter(l => !l.includes("simple_file_enumerator"));
  });
  test("different time is not a correlated event", r => {
    r.restartTrials[1].warnings = r.restartTrials[1].warnings.map(l => l.includes("simple_version_upgrade")
      ? l.replace("23:46:43.", "23:45:43.") : l);
  });
  test("different PID is not a correlated event", r => {
    r.restartTrials[1].warnings = r.restartTrials[1].warnings.map(l => l.includes("simple_version_upgrade")
      ? l.replace(" 6139 ", " 9999 ") : l);
  });
  test("unpaired cache index is not accepted", r => {
    r.restartTrials[0].warnings = r.restartTrials[0].warnings.filter(l => !l.includes("simple_file_enumerator"));
  });
  test("fatal remains blocking", r => { r.restartTrials[2].fatal.push("FATAL EXCEPTION"); });
  test("changing actual screenshots remains blocking", r => { r.restartTrials[3].screenshotSha256 = "a".repeat(64); });
  test("growing memory remains blocking", r => { r.restartTrials.slice(3).forEach((t, i) => { t.pssKb = 90000 + i * 10000; }); });
  test("a seventh or missing trial is not the prescribed matrix", r => { r.restartTrials.pop(); });
  test("original classifier evidence must agree", r => { r.rendererWarningAssessment.unknownWarnings = []; }, false, true);
  test("a failed function cannot be excused by a warning review", r => { r.requiredCoverage.saveWriteRead = "FAILED"; });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
}
