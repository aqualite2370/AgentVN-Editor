"use strict";
const assert = require("node:assert/strict");
const { narrativeCoverage } = require("./lib/narrative-coverage.cjs");
const passing = i => ({ name: `cell-${i}`, status: "PASS",
  checks: Array.from({ length: 5 }, (_, n) => ({ status: "PASS",
    detail: n === 0 ? { historyFonts: 2, historyFontSamples: [{}] } : {} })) });
const full = { smoke: false, cells: Array.from({ length: 24 }, (_, i) => passing(i)) };
assert.deepEqual(narrativeCoverage(full), {
  expectedCells: 24, expectedChecks: 120, passedChecks: 120, failedChecks: 0, notRunChecks: 0,
  coverageComplete: true, coverageGaps: [],
});
const failed = structuredClone(full);
failed.cells[1] = { name: "failed-cell", status: "FAILED", checks: [{ status: "FAILED" }] };
const r = narrativeCoverage(failed);
assert.equal(r.coverageComplete, false); assert.equal(r.passedChecks, 115);
assert.equal(r.failedChecks, 1); assert.equal(r.notRunChecks, 4);
assert.equal(r.coverageGaps.length, 1); assert.equal(r.coverageGaps[0].notRunChecks, 4);
const emptyFonts = structuredClone(full);
emptyFonts.cells[0].checks[0].detail = { historyFonts: 0, historyFontSamples: [] };
assert.equal(narrativeCoverage(emptyFonts).coverageComplete, false);
assert.equal(narrativeCoverage({ smoke: true, cells: [passing(1), passing(2)] }).expectedChecks, 10);
for (const raw of [{ smoke: false, cells: [] }, { smoke: true, cells: [passing(1)] }])
  assert.equal(narrativeCoverage(raw).coverageComplete, false);
assert.deepEqual(full.cells[0], passing(0));
console.log(JSON.stringify({ status: "PASS", cases: 6, scope: "QA_COVERAGE_ACCOUNTING_NOT_PRODUCT_ACCEPTANCE" }));
