"use strict";
const assert = require("node:assert/strict");
const { validateInterruptedNarrativeFacts } = require("./lib/interrupted-narrative-evidence.cjs");
const facts = {
  sourceStatus: "RUNNING", rawStatus: "RUNNING", sourceFinished: false, rawFinished: false,
  sessionSha256: "a".repeat(64), rawSha256: "b".repeat(64),
  liveOriginalIdentities: [], occupiedOriginalPorts: [],
  restorationStatus: "PASS", deletedUserFiles: 0, originalDirectoriesVerified: 2, originalFilesVerified: 9,
  productExceptions: [{ path: "D:\\AgentVN\\AgentVN Dev.exe", reason: "VERIFIED_OPENING_BUILD",
    previousSha256: "c".repeat(64), currentSha256: "d".repeat(64) }],
  installedProductsVerified: 3, frozenToolsVerified: 13,
  expectedCells: 24, actualCells: 21, passedCells: 9, failedCells: 11, runningCells: 1,
  expectedChecks: 120, passedChecks: 51, failedChecks: 11, notRunChecks: 58,
  normalCloseClaimed: false, sourceFilesRewritten: false,
};
assert.equal(validateInterruptedNarrativeFacts(facts), true);
const variants = [
  f => { f.liveOriginalIdentities = [{ pid: 42 }]; },
  f => { f.occupiedOriginalPorts = [49905]; },
  f => { f.sourceStatus = "PASS"; },
  f => { f.sourceFinished = true; },
  f => { f.restorationStatus = "RUNNING"; },
  f => { f.deletedUserFiles = 1; },
  f => { f.originalDirectoriesVerified = 1; },
  f => { f.frozenToolsVerified = 12; },
  f => { f.installedProductsVerified = 2; },
  f => { f.productExceptions[0].path = "F:\\installed\\agentvn-player.exe"; },
  f => { f.productExceptions[0].reason = "UNKNOWN"; },
  f => { f.productExceptions[0].currentSha256 = f.productExceptions[0].previousSha256; },
  f => { f.passedChecks = 120; f.notRunChecks = 0; },
  f => { f.notRunChecks--; },
  f => { f.actualCells = 24; },
  f => { f.normalCloseClaimed = true; },
  f => { f.sourceFilesRewritten = true; },
];
for (const mutate of variants) {
  const f = structuredClone(facts); mutate(f);
  assert.throws(() => validateInterruptedNarrativeFacts(f));
}
console.log(JSON.stringify({ status: "PASS", accepted: 1, rejected: variants.length }));
