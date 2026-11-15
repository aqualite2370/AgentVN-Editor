"use strict";
const assert = require("node:assert/strict");
function upgradeScope(args) {
  const allowed = ["--cross", "--cross-retry", "--cross-final", "--current-1973", "--cross-1973", "--cross-1973-visible", "--current-1974", "--cross-1974", "--current-1975"];
  assert(args.every(a => allowed.includes(a)), "Unknown upgrade flag");
  assert.equal(new Set(args).size, args.length, "Duplicate upgrade flag");
  if (args.includes("--current-1975")) {
    assert.equal(args.length, 1, "Use one unambiguous 1975 entry");
    return { cross: false, current1973: false, current1974: false, current1975: true,
      cross1973: false, cross1974: false, visibleCross1973: false, crossRetry: false, finalCross: false,
      oldCode: "1974", newCode: "1975", oldVersion: "1.9.74", newVersion: "1.9.75",
      base: "F:/testavn/Windows-Isolated-1975-20261116-02" };
  }
  if (args.includes("--current-1974") || args.includes("--cross-1974")) {
    const cross1974 = args.includes("--cross-1974");
    assert.equal(args.length, 1, "Use one unambiguous 1974 entry");
    return { cross: cross1974, current1973: false, current1974: true, cross1973: false, cross1974,
      visibleCross1973: false, crossRetry: cross1974, finalCross: cross1974,
      oldCode: "1973", newCode: "1974", oldVersion: cross1974 ? "1.7.1" : "1.9.73", newVersion: "1.9.74",
      base: `F:/testavn/Windows-Isolated-1974-20261115-${cross1974 ? "05" : "02"}` };
  }
  const visibleCross1973 = args.includes("--cross-1973-visible");
  const cross1973 = visibleCross1973 || args.includes("--cross-1973");
  assert(!cross1973 || args.length === 1, "Use the unambiguous --cross-1973 entry");
  const cross = cross1973 || args.includes("--cross");
  const current1973 = cross1973 || args.includes("--current-1973");
  assert(cross1973 || !(cross && current1973), "Do not reuse the recent-upgrade entry for a cross-generation run");
  const crossRetry = cross1973 || args.includes("--cross-retry");
  const finalCross = cross1973 || args.includes("--cross-final");
  assert(!crossRetry || cross);
  assert(!finalCross || crossRetry);
  const oldCode = current1973 ? "1972" : "1971", newCode = current1973 ? "1973" : "1972";
  return { cross, current1973, cross1973, visibleCross1973, crossRetry, finalCross, oldCode, newCode,
    oldVersion: cross ? "1.7.1" : current1973 ? "1.9.72" : "1.9.71",
    newVersion: current1973 ? "1.9.73" : "1.9.72",
    base: visibleCross1973 ? "F:/testavn/Windows-Isolated-1973-20261115-02"
      : cross1973 ? "F:/testavn/Windows-Isolated-1973-20261115-01"
      : current1973 ? "F:/testavn/Windows-Isolated-1973-20261114-03"
        : "F:/testavn/Windows-Isolated-1972-20261114-" + (cross ? finalCross ? "05" : crossRetry ? "04" : "03" : "02") };
}
function crossAuditScope(args) {
  if (args.includes("--cross-1974")) {
    assert.equal(args.length, 1, "Use the exact current cross-generation audit");
    return { current1974: true, current1973: false, failedRun: false, visibleWindow: true,
      attempt: "05", auditAttempt: "01", completed: true };
  }
  const flags = args.filter(a => a.startsWith("--"));
  assert(flags.every(a => ["--current-1973", "--failed-run", "--visible-window"].includes(a)), "Unknown audit flag");
  assert.equal(new Set(flags).size, flags.length, "Duplicate audit flag");
  const current1973 = flags.includes("--current-1973");
  const failedRun = flags.includes("--failed-run");
  const visibleWindow = flags.includes("--visible-window");
  const positional = args.filter(a => !a.startsWith("--"));
  assert(positional.length <= 2, "Unexpected audit arguments");
  const attempt = positional[0] || "05", auditAttempt = positional[1] || "01";
  assert(["03", "04", "05"].includes(attempt));
  assert(["01", "02"].includes(auditAttempt));
  assert(!current1973 || attempt === "05", "Exact current cross-generation scope required");
  assert(!failedRun || (current1973 && attempt === "05"), "Failed-run override is current cross-generation only");
  assert(!visibleWindow || current1973, "Visible-window scope requires current cross-generation");
  return { current1973, failedRun, visibleWindow, attempt, auditAttempt, completed: attempt === "05" && !failedRun };
}
module.exports = { upgradeScope, crossAuditScope };
