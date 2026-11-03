"use strict";
const assert = require("node:assert/strict");
function validate(before, after) {
  assert(before && after);
  assert(!Object.hasOwn(before, "gameAspectRatio"), "This adapter covers the pre-aspect preference schema only");
  assert.deepEqual(after, { ...before, gameAspectRatio: "default" },
    "Retain every old preference, allowing only the new project-default aspect field");
}
function selfTest() {
  const before = { muteSfx: true, autoSaveEnabled: true, fontScale: 1 };
  validate(before, { ...before, gameAspectRatio: "default" });
  for (const bad of [
    { ...before }, { ...before, gameAspectRatio: "16:9" },
    { ...before, gameAspectRatio: "default", muteSfx: false },
    { ...before, gameAspectRatio: "default", unexpected: true },
    { muteSfx: true, fontScale: 1, gameAspectRatio: "default" },
  ]) assert.throws(() => validate(before, bad), assert.AssertionError);
  assert.throws(() => validate({ ...before, gameAspectRatio: "16:10" },
    { ...before, gameAspectRatio: "default" }), assert.AssertionError);
  return { status: "PASS", rejectedPreferenceChanges: 6 };
}
module.exports = { validate, selfTest };
if (require.main === module) console.log(JSON.stringify(selfTest()));
