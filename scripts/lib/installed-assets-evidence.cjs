"use strict";
const assert = require("node:assert/strict");
const types = ["background", "sprite", "portrait", "bgm", "sfx", "voice", "video", "animation", "ui", "font", "other"];
const matrix = () => [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true]
  .map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const key = m => [m.width, m.height, m.dpr, m.reduced].join(":");
function validate(r, expected = { version: "1.9.14", sha256: "57e280c16cea0cadf41fe55608e94c5216e46cf15c71c75872a2acf415c867af" }) {
  assert.match(expected.version, /^\d+\.\d+\.\d+$/); assert.match(expected.sha256, /^[a-f0-9]{64}$/);
  assert.equal(r.status, "PASS"); assert(r.finishedAt);
  assert(!r.error && !r.cleanupError); assert.deepEqual(r.errors, []);
  assert.equal(r.scope, `ACTUAL_NSIS_${expected.version}_ASSET_REPLACEMENT_SAVE_RESTART_EXPORT_NOT_FULL_G16`);
  assert.equal(r.version, expected.version);
  for (const n of ["productChanges", "modelRequests", "builds"]) assert.equal(r[n], 0);
  assert.equal(r.executable.sha256, expected.sha256);
  assert.equal(r.steps.length, 7); assert(r.steps.every(s => s.status === "PASS"));
  assert.deepEqual(r.replacements.map(a => a.type), types);
  for (const a of r.replacements) {
    assert.equal(a.status, "PASS"); assert.equal(a.id, `qa_${a.type}`);
    assert.notEqual(a.oldSha256, a.newSha256);
    assert(a.referencePreserved && a.folderPreserved && a.staleSourcesCleared);
  }
  assert.equal(r.negatives.length, 6); assert(r.negatives.every(n => n.status === "PASS" && n.unchanged));
  assert.deepEqual(r.matrix.map(key), matrix().map(key));
  for (const m of r.matrix) {
    assert.equal(m.status, "PASS"); assert(m.cancelUnchanged);
    assert.equal(m.contentBefore.length, 11); assert.deepEqual(m.contentAfter, m.contentBefore);
    for (const a of m.contentBefore) assert.equal(a.sha256, r.replacements.find(x => x.id === a.id).newSha256);
    assert(m.geometry.overflow <= 1 && m.geometry.controls.length >= 2);
    for (const b of m.geometry.controls) assert(b.hit && !b.clipped && !b.overlap
      && b.rect.x >= 0 && b.rect.y >= 0 && b.rect.right <= m.width + 1 && b.rect.bottom <= m.height + 1);
  }
  assert.equal(r.portable.assets.length, 11);
  assert.equal(r.portable.reimportVerified, true); assert.equal(r.portable.oldBytesAbsent, true);
  assert.equal(r.cartridge.assets.length, 10); assert.equal(r.cartridge.animationJsonConsumption, "BLOCKED_UNDEFINED_CONTRACT");
  assert.deepEqual(r.cartridge.assets.map(a => a.type).sort(), types.filter(t => t !== "animation").sort());
  for (const p of [r.portable, r.cartridge])
    for (const a of p.assets) assert.equal(a.sha256, r.replacements.find(x => x.id === a.id).newSha256);
  assert.equal(r.launches.length, 3); assert.equal(new Set(r.launches.map(l => l.pid)).size, 3);
  for (const l of r.launches) {
    assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
    assert.equal(l.executable.sha256, r.executable.sha256);
  }
  assert.equal(r.cleanups.length, 3); assert(r.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
  assert.equal(r.downloadCleanup.status, "PASS"); assert.equal(r.downloadCleanup.deletedUserFiles, 0);
  assert.equal(r.cacheRestored, true); assert.equal(r.protectedUnchanged, true); assert.deepEqual(r.gitBefore, r.gitAfter);
  for (const n of ["Native picker", "Normal native close", "Player consumption", "Windows setup", "Android", "New audio listening"])
    assert(r.notProven.includes(n));
  return { replacedTypes: 11, portableTypes: 11, activeCartridgeTypes: 10, displayCases: 12,
    fullG16: "NOT_PROVEN" };
}
module.exports = { validate, types, matrix };
