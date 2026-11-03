"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  assertOwnedCheckEvidence,
  validatedPrefix,
  assertSameInvocation,
} = require("./lib/e2-gate-evidence-reuse.cjs");
const current = {
  runId: "2026-10-11T12-00-00Z", scope: "Editor", slice: "full-E2",
  matrix: { dpr: [1, 2] }, performancePolicy: { status: "DEFERRED_BY_USER" },
  fixture: "isolated-small.vnproj", sourceHashes: { "editor/source.ts": "abc",
    "scripts/check.cjs": "def", "scripts/editor-e2-final-gates.cjs": "new" },
};
const check = { label: "check", status: "PASS", exitCode: 0,
  startedAt: "start", finishedAt: "end", command: ["node", "scripts/check.cjs"],
  env: { AGENTVN_TEST_PROJECT: "old-input", AGENTVN_WORKSPACE_OUTPUT: "old-output",
    ADVANCED_TOOLS_HEADFUL: "0", DPR: "2" } };
const previous = {
  ...structuredClone(current), status: "FAILED", finishedAt: "end",
  dev: { status: "NOT_BUILT" }, checks: [check, { label: "next", status: "FAILED" }],
};
previous.sourceHashes["scripts/editor-e2-final-gates.cjs"] = "old";
assert.equal(validatedPrefix(previous, current).length, 1);
assertSameInvocation(check, "check", check.command,
  { ...check.env, AGENTVN_TEST_PROJECT: "new-input", ADVANCED_TOOLS_HEADFUL: "1" });
for (const change of [
  value => { value.status = "PASS"; },
  value => { value.finishedAt = null; },
  value => { value.runId = "2026-10-10T12-00-00Z"; },
  value => { value.scope = "Release"; },
  value => { value.slice = "partial"; },
  value => { value.matrix.dpr = [1]; },
  value => { value.performancePolicy.status = "REQUIRED"; },
  value => { value.fixture = "user-project.vnproj"; },
  value => { value.sourceHashes["editor/source.ts"] = "changed"; },
  value => { delete value.sourceHashes["scripts/check.cjs"]; },
  value => { value.dev.status = "PASS"; },
  value => { value.checks[0].status = "FAILED"; },
  value => { value.checks[0].exitCode = 1; },
  value => { value.checks[0].finishedAt = null; },
  value => { value.checks.splice(1, 0, structuredClone(value.checks[0])); },
]) {
  const invalid = structuredClone(previous);
  change(invalid);
  assert.throws(() => validatedPrefix(invalid, current));
}
assert.throws(() => assertSameInvocation(check, "other", check.command, check.env));
assert.throws(() => assertSameInvocation(check, "check", ["node", "other.cjs"], check.env));
assert.throws(() => assertSameInvocation(check, "check", check.command, { ...check.env, DPR: "1" }));
const visual = { ...check, command: ["node", "scripts/advanced-tools-transition-regression-playwright.cjs"] };
assert.throws(() => assertSameInvocation(visual, "check", visual.command,
  { ...check.env, ADVANCED_TOOLS_HEADFUL: "1" }), "Do not reuse a visual test in a changed renderer");

const outputRoot = path.join(__dirname, "..", "output", "editor-e2-final-gates");
const originalDirectory = path.join(outputRoot, "2026-10-11T11-00-00-000Z", "check");
const originalReportPath = path.join(path.dirname(originalDirectory), "report.json");
const originalCheck = {
  ...structuredClone(check),
  status: "PASS",
  exitCode: 0,
  env: {
    ...check.env,
    AGENTVN_TEST_PROJECT: path.join(originalDirectory, "isolated-small.vnproj"),
    AGENTVN_WORKSPACE_OUTPUT: path.join(originalDirectory, "evidence"),
  },
  logFile: path.join(originalDirectory, "command.log"),
  evidence: path.join(originalDirectory, "evidence"),
};
const originalReport = {
  runId: path.basename(path.dirname(originalReportPath)),
  checks: [originalCheck],
};
const firstReuseReportPath = path.join(outputRoot, "2026-10-11T12-00-00-000Z", "report.json");
const firstReuseCheck = {
  ...structuredClone(originalCheck),
  reusedFrom: originalReportPath,
  reusedLogSha256: "log-sha256",
};
const firstReuseReport = {
  runId: path.basename(path.dirname(firstReuseReportPath)),
  evidenceReuse: { report: originalReportPath, sha256: "original-report-sha256" },
  checks: [firstReuseCheck],
};
const secondReuseReportPath = path.join(outputRoot, "2026-10-11T13-00-00-000Z", "report.json");
const secondReuseCheck = {
  ...structuredClone(firstReuseCheck),
  reusedFrom: firstReuseReportPath,
};
const secondReuseReport = {
  runId: path.basename(path.dirname(secondReuseReportPath)),
  evidenceReuse: { report: firstReuseReportPath, sha256: "first-reuse-report-sha256" },
  checks: [secondReuseCheck],
};
const reports = new Map([
  [originalReportPath, originalReport],
  [firstReuseReportPath, firstReuseReport],
  [secondReuseReportPath, secondReuseReport],
]);
const hashes = new Map([
  [originalReportPath, "original-report-sha256"],
  [firstReuseReportPath, "first-reuse-report-sha256"],
  [originalCheck.logFile, "log-sha256"],
]);
const readReport = reportPath => reports.get(reportPath);
const hashFile = filePath => hashes.get(filePath);

assert.doesNotThrow(() => assertOwnedCheckEvidence(
  secondReuseCheck,
  secondReuseReport,
  secondReuseReportPath,
  outputRoot,
  readReport,
  hashFile,
), "Chained evidence reuse must resolve back to its original owned check");
assert.throws(() => assertOwnedCheckEvidence(
  { ...secondReuseCheck, reusedLogSha256: "wrong-log-sha256" },
  secondReuseReport,
  secondReuseReportPath,
  outputRoot,
  readReport,
  hashFile,
), "A reused log whose digest changed must be rejected");
assert.throws(() => assertOwnedCheckEvidence(
  secondReuseCheck,
  { ...secondReuseReport, evidenceReuse: { ...secondReuseReport.evidenceReuse, sha256: "wrong-report-sha256" } },
  secondReuseReportPath,
  outputRoot,
  readReport,
  hashFile,
), "A changed source report must be rejected");

// Rejected evidence must close its report before any browser or delivery starts.
const rejected = spawnSync(process.execPath, [
  path.join(__dirname, "editor-e2-final-gates.cjs"),
  "--functional-priority-20261011",
  `--reuse-unchanged-evidence=${path.join(__dirname, "not-owned-report.json")}`,
], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 10000, windowsHide: true });
assert.equal(rejected.status, 1, "Unowned evidence must fail");
const evidencePath = rejected.stdout.match(/Evidence: ([^\r\n]+)/)?.[1];
assert(evidencePath, "Initialization rejection must publish a finalized report");
const rejectionReport = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
assert.equal(rejectionReport.status, "FAILED");
assert(rejectionReport.finishedAt && rejectionReport.error.includes("owned E2 report"));
assert.deepEqual(rejectionReport.checks, [], "Invalid reuse must not start tests");
assert.equal(rejectionReport.dev.status, "NOT_BUILT");
console.log("PASS evidence reuse: unchanged prefix only; ownership chains, stale/incomplete evidence and changed invocations rejected");
