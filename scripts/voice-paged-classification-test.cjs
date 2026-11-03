"use strict";
const assert = require("node:assert/strict");
const { classifyVoicePages } = require("./lib/voice-paged-classification.cjs");
const error = "AssertionError [ERR_ASSERTION]: Fixture must actually paginate\n    at fixture";
const capacity = {
  status: "RECORDED",
  capacityConclusion: "ORIGINAL_FIXTURE_FITS_ONE_PAGE_NEEDS_STRONGER_INPUT_TO_TEST_PAGINATION",
  observation: { viewport: { width: 3840, height: 2160 }, mode: "nvl", pages: 1, wholeTextMatches: true },
};
const failed = {
  name: "4k", viewport: { width: 3840, height: 2160 }, layout: "agentvn", status: "FAILED", error,
  checks: [{ name: "dialog: complete", status: "PASS" }, { name: "nvl: page", status: "FAILED", error }],
};
const passed = {
  name: "1080p", viewport: { width: 1920, height: 1080 }, layout: "agentvn", status: "PASS",
  checks: Array.from({ length: 7 }, () => ({ status: "PASS" })),
};
const raw = cells => ({ status: "FAILED", finishedAt: "2026-10-19", expectedFlows: cells.length, cells });
const cases = [
  ["capacity failure remains blocked, never product PASS", () => {
    const r = classifyVoicePages(raw([passed, failed]), capacity);
    assert.equal(r.status, "BLOCKED"); assert.equal(r.completeCoverage, false);
    assert.deepEqual(r.counts, { pass: 1, blocked: 1, failed: 0 });
  }],
  ["without actual capacity proof, original failure is retained", () => {
    assert.equal(classifyVoicePages(raw([failed]), null).status, "FAILED");
  }],
  ["other failures cannot be excused by a fixture observation", () => {
    const bad = structuredClone(failed); bad.error = bad.checks[1].error = "Actual page clipping";
    assert.equal(classifyVoicePages(raw([bad]), capacity).status, "FAILED");
  }],
  ["1080p source failure cannot be reclassified using 4K evidence", () => {
    const bad = structuredClone(failed); bad.viewport.width = 1920;
    assert.equal(classifyVoicePages(raw([bad]), capacity).status, "FAILED");
  }],
  ["empty and running matrices are rejected", () => {
    assert.throws(() => classifyVoicePages(raw([]), capacity));
    assert.throws(() => classifyVoicePages({ ...raw([passed]), status: "RUNNING" }, capacity));
  }],
  ["truncated successful flows cannot count as passed", () => {
    assert.throws(() => classifyVoicePages(raw([{ ...passed, checks: passed.checks.slice(0, 3) }]), capacity));
  }],
  ["missing declared flows cannot count as complete coverage", () => {
    const r = classifyVoicePages({ ...raw([passed]), expectedFlows: 2 }, capacity);
    assert.equal(r.status, "BLOCKED"); assert.equal(r.completeCoverage, false); assert.equal(r.allDeclaredFlowsAttempted, false);
  }],
  ["complete successful matrix preserves PASS without source mutation", () => {
    const source = { ...raw([passed]), status: "PASS" }, before = JSON.stringify(source);
    const r = classifyVoicePages(source, capacity);
    assert.equal(r.status, "PASS"); assert.equal(r.completeCoverage, true);
    assert.equal(JSON.stringify(source), before);
  }],
];
for (const [name, run] of cases) { run(); console.log(`PASS ${name}`); }
console.log(`${cases.length} report-classification self-tests; zero product UI cases`);
