"use strict";
const assert = require("node:assert/strict");

// Classify a terminal QA result without rewriting it or converting unexecuted
// assertions into successful product checks.
function classifyVoicePages(raw, capacity) {
  assert(raw.finishedAt && ["PASS", "FAILED"].includes(raw.status), "Terminal source required");
  assert(raw.cells.length > 0, "Empty matrix cannot pass");
  const probe = capacity?.observation;
  const capacityProven = capacity?.status === "RECORDED" &&
    capacity.capacityConclusion === "ORIGINAL_FIXTURE_FITS_ONE_PAGE_NEEDS_STRONGER_INPUT_TO_TEST_PAGINATION" &&
    probe?.viewport?.width === 3840 && probe.viewport.height === 2160 &&
    probe.mode === "nvl" && probe.pages === 1 && probe.wholeTextMatches === true;
  const rows = raw.cells.map(cell => {
    assert(["PASS", "FAILED"].includes(cell.status), "Nonterminal flow cannot pass");
    const expectedChecks = cell.layout === "renpy" ? 11 : 7;
    if (cell.status === "PASS") {
      assert.equal(cell.checks.length, expectedChecks, "Passing flow must include restart and restore checks");
      assert(cell.checks.every(check => check.status === "PASS"));
      return { name: cell.name, status: "PASS", kind: "COMPLETE_FLOW", rawStatus: cell.status };
    }
    const [dialog, nvl] = cell.checks;
    const fixtureOnly = capacityProven && cell.viewport.width === 3840 &&
      cell.viewport.height === 2160 && cell.checks.length === 2 &&
      dialog?.status === "PASS" && dialog.name.startsWith("dialog:") &&
      nvl?.status === "FAILED" && nvl.name.startsWith("nvl:") &&
      /^AssertionError \[ERR_ASSERTION\]: Fixture must actually paginate\n/.test(nvl.error || "") &&
      cell.error === nvl.error;
    return {
      name: cell.name, status: fixtureOnly ? "BLOCKED" : "FAILED", rawStatus: cell.status,
      kind: fixtureOnly ? "QA_FIXTURE_INSUFFICIENT" : "SOURCE_FAILURE_REQUIRES_REVIEW",
      reason: fixtureOnly
        ? "4K NVL pagination precondition failed; later bubble/restart/restoration checks were not executed. Capacity is independently proven only for the sampled first 4K cell."
        : cell.error?.split("\n")[0] || "Failed source check",
    };
  });
  const counts = { pass: 0, blocked: 0, failed: 0 };
  for (const row of rows) counts[row.status.toLowerCase()]++;
  return {
    rawStatus: raw.status,
    status: counts.failed ? "FAILED" : counts.blocked || raw.cells.length !== raw.expectedFlows ? "BLOCKED" : "PASS",
    capacityProven, rows, counts,
    allDeclaredFlowsAttempted: raw.cells.length === raw.expectedFlows,
    completeCoverage: raw.cells.length === raw.expectedFlows && counts.pass === raw.expectedFlows,
  };
}
module.exports = { classifyVoicePages };
