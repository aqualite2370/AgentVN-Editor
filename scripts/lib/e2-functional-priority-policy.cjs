"use strict";

// Only the explicitly recorded 2026-10-11 user decision changes this gate.
// Existing failed reports remain authoritative; visual/functional checks do
// not become optional, and no successful performance result is synthesized.
function e2PerformancePolicy(args) {
  const deferred = args.includes("--functional-priority-20261011");
  return {
    status: deferred ? "DEFERRED_BY_USER" : "REQUIRED",
    coldEntryRequired: !deferred,
    functionalChecksRequired: true,
    performancePassClaimAllowed: !deferred,
    reason: deferred
      ? "2026-10-11: user explicitly accepts first-click jank temporarily and prioritizes functional completion."
      : "Default strict cold-entry performance gate.",
    deferredFamilies: deferred ? [
      "cold-layout-performance", "whole-first-options-performance", "mount-read-performance",
    ] : [],
    knownFailureEvidence: deferred ? [
      "output/playwright/e2-glass-material-paired-20261011-175753/",
      "output/playwright/e2-sections-restored-20261011-01/",
    ] : [],
  };
}
module.exports = { e2PerformancePolicy };
