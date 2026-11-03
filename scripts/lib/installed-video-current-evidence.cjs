"use strict";
const assert = require("node:assert/strict");
const { matrix } = require("./installed-assets-evidence.cjs");
const key = m => [m.width, m.height, m.dpr, m.reduced].join(":");
function validateEditor(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt); assert(!r.error && !r.cleanupError);
  assert.equal(r.scope, "CURRENT_INSTALLED_SINGLE_VIDEO_REPLACEMENT_SAVE_RESTART_EXPORT");
  assert.equal(r.version, "1.9.14");
  for (const k of ["productChanges", "modelRequests", "builds"]) assert.equal(r[k], 0);
  assert.equal(r.executable.sha256, "57e280c16cea0cadf41fe55608e94c5216e46cf15c71c75872a2acf415c867af");
  assert.equal(r.steps.length, 4); assert(r.steps.every(s => s.status === "PASS"));
  assert.equal(r.replacement.observedContentSha256, r.video.sha256);
  assert(r.replacement.metadata.duration_ms > 1000);
  assert(r.video.decoded.duration > 1 && r.video.decoded.frames >= 15 && r.video.decoded.lastTime > 1);
  assert.equal(r.portable.assets.length, 11); assert.equal(r.cartridge.assets.length, 10);
  assert.equal(r.portable.assets.find(a => a.type === "video").sha256, r.video.sha256);
  assert.equal(r.cartridge.assets.find(a => a.type === "video").sha256, r.video.sha256);
  assert.equal(r.launches.length, 2); assert.equal(r.cleanups.length, 2);
  assert(r.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
  assert(r.cacheRestored && r.protectedUnchanged); assert.deepEqual(r.errors, []);
  assert.equal(r.downloadCleanup.status, "PASS"); assert.equal(r.downloadCleanup.deletedUserFiles, 0);
  assert.deepEqual(r.gitBefore, r.gitAfter);
}
function validatePlayer(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt); assert(!r.error && !r.cleanupError && !r.validationError);
  assert.equal(r.scope, "CURRENT_INSTALLED_PLAYER_MULTIFRAME_VIDEO_SUPPLEMENT"); assert.equal(r.sourceStatus, "PASS");
  assert.equal(r.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e");
  assert.deepEqual(r.cases.map(key), matrix().map(key)); assert.deepEqual(r.errors, []); assert.deepEqual(r.mediaErrors, []);
  for (const k of ["productChanges", "modelRequests", "builds"]) assert.equal(r[k], 0);
  for (const c of r.cases) {
    assert.equal(c.status, "PASS"); assert(c.input.trusted && c.input.hit && c.input.overflow <= 1);
    assert.equal(c.consumed.length, 1); const a = c.consumed[0]; assert.equal(a.type, "video");
    assert(a.sha256 && a.sha256 === a.expectedSha256 && a.decoded && a.playing && a.ended && a.timeAdvanced && !a.error);
    assert(a.duration > 1); assert(c.videoFrames.length >= 15 && c.videoFrames.some(f => f.time > 1));
    assert(new Set(c.videoFrames.map(f => f.pixelSignature)).size >= 10);
    assert(c.videoFrames.every(f => f.width === 480 && f.height === 270));
    assert(c.video.some(e => e.event === "ended" && e.duration > 1 && e.time > 1));
  }
  assert.equal(r.launches.length, 1); assert.equal(r.launches[0].cleanup.status, "PASS");
  assert.equal(r.launches[0].cleanup.normalCloseClaimed, false);
  assert(r.profileRestored && r.protectedUnchanged); assert.deepEqual(r.gitBefore, r.gitAfter);
}
module.exports = { validateEditor, validatePlayer };
