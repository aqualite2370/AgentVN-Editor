"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { runtimeFailureDetails, rendererDiagnosticStatus } = require("./lib/android-runtime-result.cjs");
const base = {
  status: "BLOCKED",
  stages: { build: "PASS", runtime: "BLOCKED", audio: "PASS", provenance: "PASS", cleanup: "PASS" },
  requiredCoverage: { title: "PASS", rendererWarnings: "BLOCKED" },
  audio: { reason: "User explicitly accepted audio; no new capture or listening claimed" },
  rendererWarningAssessment: {
    status: "BLOCKED", reason: "PERSISTENT_UNKNOWN_OR_GROWING_RUNTIME_EVIDENCE",
    unknownWarnings: ["E chromium: Unable to create cache"],
  },
};
const before = JSON.stringify(base);
const details = runtimeFailureDetails(base);
assert.match(details.message, /rendererWarnings/, "Explain the actual missing renderer evidence");
assert.doesNotMatch(details.message, /User explicitly accepted audio/, "A passed audio stage is not a failure");
assert.equal(details.failureCode, "ANDROID_REQUIRED_EVIDENCE_MISSING");
assert.equal(JSON.stringify(base), before, "Never mutate historical evidence");
for (const stage of ["build", "runtime", "provenance", "audio", "cleanup"]) {
  const r = structuredClone(base);
  r.stages = Object.fromEntries(Object.keys(base.stages).map(key => [key, key === stage ? "FAILED" : "PASS"]));
  r.status = "FAILED";
  const result = runtimeFailureDetails(r);
  assert.match(result.message, new RegExp(`${stage}=FAILED`));
  if (stage !== "audio") assert.doesNotMatch(result.message, /explicitly accepted audio/);
  if (stage === "cleanup") assert.equal(result.failureCode, "ANDROID_CLEANUP_FAILED");
}
const fatal = runtimeFailureDetails({ ...base, status: "FAILED",
  stages: { ...base.stages, runtime: "FAILED" }, logcat: { fatal: ["Original SIGSEGV failure"] } });
assert.match(fatal.message, /Original SIGSEGV failure/);
const cleanup = runtimeFailureDetails({ ...base, status: "FAILED",
  stages: { ...base.stages, cleanup: "FAILED" }, cleanupError: "Original uninstall denied" });
assert.equal(cleanup.failureCode, "ANDROID_CLEANUP_FAILED");
assert.match(cleanup.message, /Original uninstall denied/);
const provenance = runtimeFailureDetails({ ...base, provenance: { reason: "APK_HASH_MISMATCH" },
  stages: { ...base.stages, provenance: "FAILED" } });
assert.match(provenance.message, /APK_HASH_MISMATCH/);
for (const status of ["RUNTIME_PASS", "INSTALLED_RESOURCE_SMOKE_PASS", "INSTALLED_PACKAGE_SMOKE_PASS"]) {
  const result = runtimeFailureDetails({ status });
  assert.equal(result.failureCode, null); assert.equal(result.message, null);
}
const empty = runtimeFailureDetails({});
assert.match(empty.message, /NOT_RECORDED/);
assert(!empty.message.includes("undefined"));
const packageIncomplete = runtimeFailureDetails({ ...base, scope: "installed-package-smoke",
  stages: { ...base.stages, audio: "BLOCKED" } });
assert.equal(packageIncomplete.failureCode, "ANDROID_REQUIRED_EVIDENCE_MISSING",
  "An asset-free limited smoke must explain missing runtime evidence, not blame excluded audio");
assert.match(packageIncomplete.message, /rendererWarnings=BLOCKED/);
assert.doesNotMatch(packageIncomplete.message, /audio=BLOCKED/);
for (const status of ["RUNTIME_PASS", "INSTALLED_RESOURCE_SMOKE_PASS", "INSTALLED_PACKAGE_SMOKE_PASS", "FAILED", "BLOCKED"]) {
  const diagnostic = rendererDiagnosticStatus(status);
  assert.equal(diagnostic, status.endsWith("_PASS") ? "RENDERER_DIAGNOSTIC_PASS" : status);
  assert.notEqual(diagnostic, "RUNTIME_PASS", "Focused renderer diagnostics cannot stand in for full gameplay");
}
if (process.argv.length > 2) {
  assert.equal(process.argv.length, 4, "Pass original raw report and a fresh output directory");
  const input = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]);
  assert(!fs.existsSync(out), "Do not overwrite evidence");
  const bytes = fs.readFileSync(input), r = JSON.parse(bytes);
  assert.equal(r.status, "BLOCKED"); assert.equal(r.stages.audio, "PASS");
  assert.equal(r.requiredCoverage.rendererWarnings, "BLOCKED");
  const { assessRestartTrials } = require("./android-runtime-log-analysis.cjs");
  assert.equal(assessRestartTrials(r.restartTrials).status, "BLOCKED",
    "Correcting the explanation must not whitelist the original unknown warning");
  const summary = runtimeFailureDetails(r);
  assert.match(summary.message, /rendererWarnings=BLOCKED/);
  assert.doesNotMatch(summary.message, /explicitly accepted audio/);
  assert.deepEqual(fs.readFileSync(input), bytes);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
    status: "PASS", checkedAt: new Date().toISOString(), scope: "diagnostic-summary-only-not-runtime-acceptance",
    source: { path: input, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      originalStatus: r.status, modified: false }, summary,
    meaning: "Summary correctly identifies renderer evidence; original runtime remains BLOCKED",
  }, null, 2));
  console.log(`Evidence: ${out}`);
}
console.log("android-runtime-result: PASS (actual cause, all stages, cleanup priority, original error, no mutation)");
