"use strict";
const assert = require("node:assert/strict");
const { inspectWorkspaceInertOwnership } = require("./lib/e2-workspace-inert-ownership.cjs");
assert.deepEqual(inspectWorkspaceInertOwnership([{ at: 1, previous: false, requested: true }]), {
  lockCount: 1, transientUnlocks: [], redundantWrites: [],
});
const prior = [{ at: 1, previous: false, requested: true },
  { at: 2, previous: true, requested: false },
  { at: 3, previous: false, requested: true },
  { at: 4, previous: true, requested: true }];
assert.equal(inspectWorkspaceInertOwnership(prior).transientUnlocks.length, 1);
assert.equal(inspectWorkspaceInertOwnership(prior).redundantWrites.length, 1);
assert.throws(() => inspectWorkspaceInertOwnership([]), /nonempty/);
assert.throws(() => inspectWorkspaceInertOwnership([{ at: 1, previous: true, requested: "true" }]), /invalid/);
console.log("PASS: workspace inert lock, transient unlock, redundant writes and nonempty evidence contract");
