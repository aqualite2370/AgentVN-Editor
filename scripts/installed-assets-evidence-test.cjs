"use strict";
const assert = require("node:assert/strict");
const { validate, types, matrix } = require("./lib/installed-assets-evidence.cjs");
const executable = { sha256: "57e280c16cea0cadf41fe55608e94c5216e46cf15c71c75872a2acf415c867af" };
const replacements = types.map(type => ({ type, id: `qa_${type}`, oldSha256: `old-${type}`,
  newSha256: `new-${type}`, referencePreserved: true, folderPreserved: true, staleSourcesCleared: true, status: "PASS" }));
const assets = replacements.map(a => ({ type: a.type, id: a.id, sha256: a.newSha256 }));
const fixture = {
  status: "PASS", finishedAt: "synthetic-guard-only", errors: [], version: "1.9.14",
  scope: "ACTUAL_NSIS_1.9.14_ASSET_REPLACEMENT_SAVE_RESTART_EXPORT_NOT_FULL_G16",
  productChanges: 0, modelRequests: 0, builds: 0, executable, replacements,
  steps: Array.from({ length: 7 }, () => ({ status: "PASS" })),
  negatives: Array.from({ length: 6 }, () => ({ status: "PASS", unchanged: true })),
  matrix: matrix().map(m => ({ ...m, status: "PASS", cancelUnchanged: true, contentBefore: assets, contentAfter: assets, geometry: { overflow: 0,
    controls: [0, 1].map(() => ({ hit: true, clipped: false, overlap: false,
      rect: { x: 0, y: 0, right: 50, bottom: 20 } })) } })),
  portable: { assets, reimportVerified: true, oldBytesAbsent: true },
  cartridge: { assets: assets.filter(a => a.type !== "animation"), animationJsonConsumption: "BLOCKED_UNDEFINED_CONTRACT" },
  launches: [1, 2, 3].map(pid => ({ pid, executable, dataDirectoryOverride: true, webviewDirectoryOverride: true,
    sourceServer: false, manualBackendSpawn: false })),
  cleanups: [1, 2, 3].map(() => ({ status: "PASS", normalCloseClaimed: false })),
  downloadCleanup: { status: "PASS", deletedUserFiles: 0 }, cacheRestored: true, protectedUnchanged: true,
  gitBefore: { index: "same" }, gitAfter: { index: "same" },
  notProven: ["Native picker", "Normal native close", "Player consumption", "Windows setup", "Android", "New audio listening"],
};
validate(fixture);
const currentExpected = { version: "1.9.22", sha256: "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc" };
const current = structuredClone(fixture);
current.version = currentExpected.version;
current.scope = `ACTUAL_NSIS_${currentExpected.version}_ASSET_REPLACEMENT_SAVE_RESTART_EXPORT_NOT_FULL_G16`;
current.executable.sha256 = currentExpected.sha256;
for (const launch of current.launches) launch.executable.sha256 = currentExpected.sha256;
validate(current, currentExpected);
assert.throws(() => validate(current)); assert.throws(() => validate(fixture, currentExpected));
assert.throws(() => validate({ ...current, version: "1.9.21" }, currentExpected));
const invalid = [
  r => { r.status = "RUNNING"; }, r => { r.version = "1.9.9"; },
  r => { r.executable.sha256 = "workspace"; }, r => { r.steps = []; }, r => { r.errors.push("ignored"); },
  r => { r.replacements.pop(); }, r => { r.replacements[0].oldSha256 = r.replacements[0].newSha256; },
  r => { r.replacements[0].referencePreserved = false; }, r => { r.replacements[0].staleSourcesCleared = false; },
  r => { r.negatives.pop(); }, r => { r.matrix = []; }, r => { r.matrix[1] = r.matrix[0]; },
  r => { r.matrix[0].geometry.controls[0].clipped = true; }, r => { r.matrix[0].geometry.controls[0].hit = false; },
  r => { r.matrix[0].geometry.controls[0].overlap = true; },
  r => { r.matrix[0].contentAfter = []; },
  r => { r.portable.assets[0].sha256 = "old"; }, r => { r.portable.reimportVerified = false; },
  r => { r.cartridge.animationJsonConsumption = "PASS"; }, r => { r.launches[0].sourceServer = true; },
  r => { r.cleanups.pop(); }, r => { r.downloadCleanup.deletedUserFiles = 1; },
  r => { r.cacheRestored = false; }, r => { r.gitAfter.index = "changed"; },
  r => { r.modelRequests = 1; }, r => { r.notProven = []; },
];
for (const mutate of invalid) { const r = structuredClone(fixture); mutate(r); assert.throws(() => validate(r)); }
console.log(JSON.stringify({ status: "PASS", syntheticOracleOnly: true, invalidReportsRejected: invalid.length + 3,
  productLaunches: 0, modelRequests: 0 }));
