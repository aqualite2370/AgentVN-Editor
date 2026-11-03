"use strict";
const assert = require("node:assert/strict");
const { validateCurrentEvidence } = require("./lib/full-regression-evidence.cjs");
const parameters = { width: 1920, height: 1080, dpr: 2, reduced: false };
function report() {
  return { status: "PASS", scope: "INSTALLED_RELEASE", buildSha256: "a".repeat(64),
    execution: "CURRENT_RUN", responseMode: "CONTROLLED",
    cases: [{ id: "actual-user-entry", status: "PASS" }],
    matrix: [{ expected: parameters, actual: parameters, middle: parameters,
      screenshot: { before: parameters, after: parameters, png: { width: 3840, height: 2160 } } }],
    cleanup: { status: "PASS", remainingOwnedPids: [], remainingOwnedPorts: [] } };
}
const requirement = { caseIds: ["actual-user-entry"], matrix: [parameters], installed: true,
  liveModel: false, buildSha256: "a".repeat(64) };
let count = 0;
const test = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };
test("valid current installed behavior with actual DPR and cleanup", () =>
  validateCurrentEvidence(report(), requirement));
for (const [name, change] of [
  ["empty cases", r => r.cases = []],
  ["missing case", r => r.cases[0].id = "different"],
  ["duplicate case", r => r.cases.push(r.cases[0])],
  ["failed case", r => r.cases[0].status = "FAILED"],
  ["empty matrix", r => r.matrix = []],
  ["DPR before operation", r => r.matrix[0].actual = { ...parameters, dpr: 1 }],
  ["DPR middle frame", r => r.matrix[0].middle = { ...parameters, dpr: 1 }],
  ["DPR after screenshot", r => r.matrix[0].screenshot.after = { ...parameters, dpr: 1 }],
  ["PNG CSS pixels only", r => r.matrix[0].screenshot.png = { width: 1920, height: 1080 }],
  ["missing screenshot sampling", r => delete r.matrix[0].screenshot.before],
  ["duplicate matrix replacing missing row", r => r.matrix.push(r.matrix[0])],
  ["source not installation", r => r.scope = "SOURCE_BROWSER"],
  ["historical not current", r => r.execution = "HISTORICAL_REFERENCE"],
  ["changed build", r => r.buildSha256 = "b".repeat(64)],
  ["cleanup incomplete", r => r.cleanup.status = "RUNNING"],
  ["owned process remains", r => r.cleanup.remainingOwnedPids = [123]],
  ["owned port remains", r => r.cleanup.remainingOwnedPorts = [55555]],
  ["overall PASS with failure hidden", r => r.status = "FAILED"],
]) test(`reject ${name}`, () => { const r = report(); change(r); assert.throws(() => validateCurrentEvidence(r, requirement)); });
test("controlled response cannot prove live model", () =>
  assert.throws(() => validateCurrentEvidence(report(), { ...requirement, liveModel: true })));
test("real model requires nonzero actual requests", () => {
  const r = report(); r.responseMode = "LIVE_MODEL"; r.modelRequests = 0;
  assert.throws(() => validateCurrentEvidence(r, { ...requirement, liveModel: true }));
});
test("real model requires no replay and nonzero requests", () => {
  const r = report(); r.responseMode = "LIVE_MODEL"; r.modelRequests = 2;
  validateCurrentEvidence(r, { ...requirement, liveModel: true });
});
console.log(JSON.stringify({ status: "PASS", cases: count, scope: "EVIDENCE_VALIDATOR_NOT_PRODUCT_ACCEPTANCE" }));
