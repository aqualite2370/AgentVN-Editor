"use strict";
const assert = require("node:assert/strict");
const identity = value => JSON.stringify(value);
function validateCurrentEvidence(report, requirement) {
  assert.equal(report.status, "PASS", "Original report must pass");
  assert.equal(report.execution, "CURRENT_RUN", "Historical/replayed execution is not a current run");
  assert.match(report.buildSha256 || "", /^[a-f0-9]{64}$/);
  assert.equal(report.buildSha256, requirement.buildSha256, "Candidate differs");
  if (requirement.installed) assert.equal(report.scope, "INSTALLED_RELEASE");
  if (requirement.liveModel) {
    assert.equal(report.responseMode, "LIVE_MODEL", "Controlled/replayed model cannot prove live flow");
    assert(Number.isInteger(report.modelRequests) && report.modelRequests > 0);
  }
  assert(Array.isArray(requirement.caseIds) && requirement.caseIds.length > 0);
  assert(Array.isArray(report.cases) && report.cases.length > 0);
  const ids = report.cases.map(row => row.id);
  assert.equal(new Set(ids).size, ids.length, "Duplicate cases");
  assert(report.cases.every(row => row.status === "PASS"), "Unpassed child case");
  for (const id of requirement.caseIds) assert(ids.includes(id), `Missing required behavior: ${id}`);
  assert(Array.isArray(requirement.matrix) && requirement.matrix.length > 0);
  assert.equal(report.matrix?.length, requirement.matrix.length, "Empty or incomplete matrix");
  const expectedKeys = requirement.matrix.map(identity);
  assert.equal(new Set(expectedKeys).size, expectedKeys.length);
  const keys = report.matrix.map(row => identity(row.expected));
  assert.equal(new Set(keys).size, keys.length, "Duplicate matrix rows");
  assert.deepEqual([...keys].sort(), [...expectedKeys].sort(), "Wrong matrix coverage");
  for (const row of report.matrix) {
    for (const sample of [row.actual, row.middle, row.screenshot?.before, row.screenshot?.after])
      assert.deepEqual(sample, row.expected, "Actual viewport/DPR/media does not match requested matrix");
    assert.equal(row.screenshot.png.width, row.expected.width * row.expected.dpr, "PNG width is not device pixels");
    assert.equal(row.screenshot.png.height, row.expected.height * row.expected.dpr, "PNG height is not device pixels");
  }
  assert.equal(report.cleanup?.status, "PASS", "Cleanup incomplete");
  assert.deepEqual(report.cleanup.remainingOwnedPids, [], "Owned process remains");
  assert.deepEqual(report.cleanup.remainingOwnedPorts, [], "Owned port remains");
  return { status: "PASS", cases: report.cases.length, matrix: report.matrix.length };
}
module.exports = { validateCurrentEvidence };
