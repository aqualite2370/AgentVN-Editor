"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
function validateInterruptedNarrativeFacts(f) {
  assert.equal(f.sourceStatus, "RUNNING"); assert.equal(f.rawStatus, "RUNNING");
  assert.equal(f.sourceFinished, false); assert.equal(f.rawFinished, false);
  for (const hash of [f.sessionSha256, f.rawSha256]) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.liveOriginalIdentities, []); assert.deepEqual(f.occupiedOriginalPorts, []);
  assert.equal(f.restorationStatus, "PASS"); assert.equal(f.deletedUserFiles, 0);
  assert.equal(f.originalDirectoriesVerified, 2); assert.equal(f.originalFilesVerified, 9);
  assert.equal(f.installedProductsVerified, 3); assert.equal(f.frozenToolsVerified, 13);
  assert.equal(f.productExceptions.length, 1);
  const changed = f.productExceptions[0];
  assert.equal(path.win32.normalize(changed.path).toLowerCase(), "d:\\agentvn\\agentvn dev.exe");
  assert.equal(changed.reason, "VERIFIED_OPENING_BUILD");
  for (const hash of [changed.previousSha256, changed.currentSha256]) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(changed.previousSha256, changed.currentSha256);
  assert.equal(f.expectedCells, 24); assert(f.actualCells > 0 && f.actualCells < f.expectedCells);
  assert.equal(f.passedCells + f.failedCells + f.runningCells, f.actualCells);
  assert(f.failedCells > 0 && f.runningCells > 0);
  assert.equal(f.expectedChecks, 120);
  for (const key of ["passedChecks", "failedChecks", "notRunChecks"]) assert(Number.isInteger(f[key]) && f[key] >= 0);
  assert.equal(f.passedChecks + f.failedChecks + f.notRunChecks, f.expectedChecks);
  assert(f.passedChecks < f.expectedChecks && f.failedChecks > 0 && f.notRunChecks > 0);
  assert.equal(f.normalCloseClaimed, false); assert.equal(f.sourceFilesRewritten, false);
  return true;
}
module.exports = { validateInterruptedNarrativeFacts };
