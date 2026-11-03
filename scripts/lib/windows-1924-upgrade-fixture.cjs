"use strict";
const assert = require("node:assert/strict");
const { retainedUpgradeFixture } = require("./windows-game-upgrade-fixture.cjs");
function expectedFixture() {
  const previous = retainedUpgradeFixture(), current = structuredClone(previous);
  current.version = "1.0.2"; current.newEditorVersion = "1.9.24";
  for (const command of current.project.nodes[1].data.scene.commands)
    command.text = command.text.replace("新版1.0.1", "新版1.0.2");
  return { previous, current };
}
function validateUpgradeFixture(value) {
  const { current } = expectedFixture();
  assert.deepEqual(value, current, "Candidate fixture must preserve every field except the declared version/text changes");
  return true;
}
module.exports = { expectedFixture, validateUpgradeFixture };
