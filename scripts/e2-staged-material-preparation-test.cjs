"use strict";
const assert = require("node:assert/strict");
const { groupMaterialSignatures, getStagedMaterialMode } =
  require("./lib/e2-staged-material-preparation.cjs");
assert.equal(getStagedMaterialMode("default"), false);
assert.equal(getStagedMaterialMode("visible-material"), false);
assert.equal(getStagedMaterialMode("staged-visible-material"), true);
assert.throws(() => getStagedMaterialMode("arbitrary"));
const result = groupMaterialSignatures([
  { id: 0, signature: "outer-shell" },
  { id: 1, signature: "button" },
  { id: 2, signature: "text" },
  { id: 3, signature: "button" },
  { id: 4, signature: "text" },
]);
assert.deepEqual(result, [[0], [1, 3], [2, 4]]);
assert.deepEqual(result.flat().sort((a, b) => a - b), [0, 1, 2, 3, 4]);
assert.throws(() => groupMaterialSignatures([]), /nonempty/);
assert.throws(() => groupMaterialSignatures([{ id: 0, signature: "a" }, { id: 0, signature: "b" }]), /unique/);
assert.throws(() => groupMaterialSignatures([{ id: 0, signature: "" }]), /signature/);
console.log("PASS: staged material diagnostic mode and complete stable grouping without duplicates");
