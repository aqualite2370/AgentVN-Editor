"use strict";
// Validator test only: synthetic scope conversion is never installation evidence.
const assert = require("node:assert/strict"), fs = require("node:fs");
const { validateMatrix } = require("./native-editor-motion-audit.cjs");
const source = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Native-Editor-Motion-20261020-01/session-03/motion/report.json", "utf8"));
const installedScope = "CURRENT_INSTALLED_RELEASE_EDITOR_MOTION_NOT_RUNTIME_OR_PHYSICAL";
validateMatrix(source, false);
const installed = structuredClone(source); installed.scope = installedScope;
validateMatrix(installed, false, false, installedScope);
assert.throws(() => validateMatrix(installed, false));
assert.throws(() => validateMatrix(source, false, false, installedScope));
assert.throws(() => validateMatrix({ ...installed, scope: "MADE_UP_PASS" }, false, false, "MADE_UP_PASS"));
for (const mutate of [
  r => { r.matrix = []; },
  r => { r.matrix[0].episodes = []; },
  r => { r.matrix[0].episodes[0].status = "FAILED"; },
  r => { r.realModelRequests = 1; },
  r => { r.matrix[0].nodeWidthCheck.actual = 999; },
]) {
  const invalid = structuredClone(installed); mutate(invalid);
  assert.throws(() => validateMatrix(invalid, false, false, installedScope));
}
console.log("PASS: explicit Dev/installed scope separation and eight invalid evidence variants; validator-only");
