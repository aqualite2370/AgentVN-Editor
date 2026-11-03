"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");

const orchestratorFiles = new Set([
  "scripts/editor-e2-final-gates.cjs",
  "scripts/lib/e2-gate-evidence-reuse.cjs",
  "scripts/e2-gate-evidence-reuse-test.cjs",
]);
const rendererOwners = {
  ADVANCED_TOOLS_HEADFUL: "scripts/advanced-tools-transition-regression-playwright.cjs",
  WORKBENCH_MORPH_HEADFUL: "scripts/editor-workbench-container-morph-playwright.cjs",
  EDITOR_SURFACE_HEADFUL: "scripts/editor-workspace-surface-transition-playwright.cjs",
  EDITOR_TRANSITION_HEADFUL: "scripts/editor-page-transition-regression-playwright.cjs",
};

function validatedPrefix(previous, current) {
  assert.equal(previous.status, "FAILED", "Reuse only the completed prefix of a terminated failed gate");
  assert(previous.finishedAt && previous.runId.slice(0, 10) === current.runId.slice(0, 10),
    "Historical/date-mismatched gates cannot replace this slice");
  for (const field of ["scope", "slice", "matrix", "performancePolicy", "fixture"])
    assert.deepEqual(previous[field], current[field], `Reuse ${field} mismatch`);
  assert(previous.dev?.status === "NOT_BUILT", "Do not reuse a delivery run");
  for (const file of new Set([...Object.keys(previous.sourceHashes), ...Object.keys(current.sourceHashes)])) {
    if (orchestratorFiles.has(file)) continue;
    assert(previous.sourceHashes[file] && current.sourceHashes[file], `Missing source evidence: ${file}`);
    assert.equal(previous.sourceHashes[file], current.sourceHashes[file], `Changed source/test: ${file}`);
  }
  const failure = previous.checks.findIndex(check => check.status !== "PASS");
  assert(failure > 0 && previous.checks[failure].status === "FAILED", "No non-empty verified prefix");
  const prefix = previous.checks.slice(0, failure);
  const labels = new Set();
  for (const check of prefix) {
    assert(check.exitCode === 0 && check.startedAt && check.finishedAt && !check.error,
      "Incomplete/nonzero check cannot be reused");
    assert(!labels.has(check.label), "Duplicate check label");
    labels.add(check.label);
  }
  return prefix.filter(check => check.label !== "e2-gate-evidence-reuse-test");
}

function assertSameInvocation(check, label, command, env) {
  assert.equal(check.label, label, "Planned gate order changed");
  assert.deepEqual(check.command, command, "Test command changed");
  for (const key of new Set([...Object.keys(check.env), ...Object.keys(env)])) {
    if (["AGENTVN_TEST_PROJECT", "AGENTVN_WORKSPACE_OUTPUT"].includes(key)) continue;
    if (rendererOwners[key] && !command.includes(rendererOwners[key])) continue;
    assert.equal(check.env[key], env[key], `Test environment changed: ${key}`);
  }
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith(`..${path.sep}`)
    && relative !== ".." && !path.isAbsolute(relative);
}

function assertOwnedCheckEvidence(check, report, reportPath, outputRoot, readReport, hashFile, visited = new Set()) {
  const absoluteReportPath = path.resolve(reportPath);
  const absoluteOutputRoot = path.resolve(outputRoot);
  assert(isPathWithin(absoluteOutputRoot, absoluteReportPath), "Evidence report escaped the owned output root");
  assert.equal(path.basename(absoluteReportPath), "report.json", "Evidence source must be an E2 report");
  assert.equal(path.basename(path.dirname(absoluteReportPath)), report.runId, "Evidence report/run identity mismatch");
  assert(!visited.has(absoluteReportPath), "Evidence reuse chain contains a cycle");
  visited.add(absoluteReportPath);

  const ownedCheckDirectory = path.join(path.dirname(absoluteReportPath), check.label);
  const expectedLog = path.join(ownedCheckDirectory, "command.log");
  const expectedProject = path.join(ownedCheckDirectory, "isolated-small.vnproj");
  const expectedOutput = path.join(ownedCheckDirectory, "evidence");
  if (path.resolve(check.logFile) === path.resolve(expectedLog)
    && path.resolve(check.env?.AGENTVN_TEST_PROJECT) === path.resolve(expectedProject)
    && path.resolve(check.env?.AGENTVN_WORKSPACE_OUTPUT) === path.resolve(expectedOutput)
    && path.resolve(check.evidence) === path.resolve(expectedOutput)) {
    assert.equal(check.status, "PASS", "Only a passing owned check can be reused");
    assert.equal(check.exitCode, 0, "Owned check exit code changed");
    const logDigest = hashFile(check.logFile);
    assert(typeof logDigest === "string" && logDigest.length > 0, "Owned check log is missing");
    if (check.reusedLogSha256)
      assert.equal(logDigest, check.reusedLogSha256, "Owned check log digest changed");
    return absoluteReportPath;
  }

  assert(check.reusedFrom && check.reusedLogSha256, "Reused evidence is missing its source report or log digest");
  assert(report.evidenceReuse?.report, "Reused evidence report is missing its recorded parent");
  const sourceReportPath = path.resolve(check.reusedFrom);
  assert.equal(sourceReportPath, path.resolve(report.evidenceReuse.report),
    "Check source does not match its report's evidence reuse parent");
  assert(isPathWithin(absoluteOutputRoot, sourceReportPath), "Evidence source escaped the owned output root");
  assert.equal(hashFile(sourceReportPath), report.evidenceReuse.sha256,
    "Evidence reuse source report digest changed");
  assert.equal(hashFile(check.logFile), check.reusedLogSha256, "Reused command log digest changed");

  const sourceReport = readReport(sourceReportPath);
  assert(sourceReport, "Evidence source report is missing");
  assert.equal(path.basename(path.dirname(sourceReportPath)), sourceReport.runId,
    "Evidence source report/run identity mismatch");
  const sourceCheck = sourceReport.checks?.find(item => item.label === check.label);
  assert(sourceCheck, "Evidence source report does not contain the reused check");
  for (const field of ["status", "exitCode", "command", "env", "logFile", "evidence"]) {
    assert.deepEqual(check[field], sourceCheck[field], `Reused check no longer matches its source: ${field}`);
  }
  return assertOwnedCheckEvidence(
    sourceCheck,
    sourceReport,
    sourceReportPath,
    absoluteOutputRoot,
    readReport,
    hashFile,
    visited,
  );
}

module.exports = { validatedPrefix, assertSameInvocation, assertOwnedCheckEvidence };
