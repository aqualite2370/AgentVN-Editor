"use strict";
function narrativeCoverage(raw) {
  const expectedCells = raw.smoke ? 2 : 24, expectedChecks = expectedCells * 5;
  let passedChecks = 0, failedChecks = 0;
  const coverageGaps = [];
  for (const cell of raw.cells) {
    const passed = cell.checks.filter(c => c.status === "PASS").length;
    const failed = cell.checks.filter(c => c.status === "FAILED").length;
    passedChecks += passed; failedChecks += failed;
    const notRun = Math.max(0, 5 - passed - failed);
    if (cell.status !== "PASS" || notRun) coverageGaps.push({
      cell: cell.name, requirement: "Five complete narrative flows", status: cell.status,
      passedChecks: passed, failedChecks: failed, notRunChecks: notRun,
    });
    if (cell.status === "PASS" && (!cell.checks[0]?.detail?.historyFonts ||
        cell.checks[0].detail.historyFontSamples?.length === 0))
      coverageGaps.push({ cell: cell.name, requirement: "Repeated visible NVL history retains its font",
        reason: "No nonempty history-font comparisons; not proved." });
  }
  if (raw.cells.length !== expectedCells) coverageGaps.push({
    requirement: "Declared full matrix", actualCells: raw.cells.length, expectedCells,
  });
  const notRunChecks = Math.max(0, expectedChecks - passedChecks - failedChecks);
  return { expectedCells, expectedChecks, passedChecks, failedChecks, notRunChecks,
    coverageComplete: coverageGaps.length === 0 && passedChecks === expectedChecks,
    coverageGaps };
}
module.exports = { narrativeCoverage };
