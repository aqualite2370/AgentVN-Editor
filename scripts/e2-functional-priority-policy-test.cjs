"use strict";
const assert = require("node:assert/strict");
const { e2PerformancePolicy } = require("./lib/e2-functional-priority-policy.cjs");
const strict = e2PerformancePolicy([]);
assert.equal(strict.coldEntryRequired, true);
assert.equal(strict.status, "REQUIRED");
assert.equal(strict.functionalChecksRequired, true);
assert.equal(strict.performancePassClaimAllowed, true);
assert.equal(e2PerformancePolicy(["--deliver-dev"]).coldEntryRequired, true,
  "delivery alone never waives performance checks");
assert.equal(e2PerformancePolicy(["--functional-priority"]).coldEntryRequired, true,
  "an unspecified override cannot silently waive the recorded user decision");
const accepted = e2PerformancePolicy(["--functional-priority-20261011", "--deliver-dev"]);
assert.equal(accepted.coldEntryRequired, false);
assert.equal(accepted.status, "DEFERRED_BY_USER");
assert.equal(accepted.functionalChecksRequired, true);
assert.equal(accepted.performancePassClaimAllowed, false);
assert(accepted.reason.includes("2026-10-11"));
assert.deepEqual(accepted.deferredFamilies, [
  "cold-layout-performance", "whole-first-options-performance", "mount-read-performance",
]);
assert(accepted.knownFailureEvidence.length >= 2);
console.log("PASS: explicit first-click deferral preserves functional gates and cannot claim performance PASS");
