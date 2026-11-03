"use strict";
const assert = require("node:assert/strict");
const { matrix, types } = require("./installed-assets-evidence.cjs");
const key = m => [m.width, m.height, m.dpr, m.reduced].join(":");
function validate(r, expected = { sha256: "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e", multiframeVideo: false }) {
  assert.match(expected.sha256, /^[a-f0-9]{64}$/);
  assert.equal(r.status, "PASS"); assert(r.finishedAt); assert(!r.error && !r.cleanupError);
  assert.equal(r.scope, "CURRENT_INSTALLED_PLAYER_EXACT_NEW_EDITOR_ASSET_EXPORT");
  assert.equal(r.sourceStatus, "PASS");
  assert.equal(r.executable.sha256, expected.sha256);
  for (const n of ["productChanges", "modelRequests", "builds"]) assert.equal(r[n], 0);
  assert.deepEqual(r.errors, []); assert.deepEqual(r.mediaErrors, []);
  assert.deepEqual(r.cases.map(key), matrix().map(key));
  for (const c of r.cases) {
    assert.equal(c.status, "PASS"); assert(c.input.trusted && c.input.hit && c.input.overflow <= 1);
    const b = c.input.rect;
    assert(b.width > 0 && b.height > 0 && b.x >= -1 && b.y >= -1 && b.right <= c.width + 1 && b.bottom <= c.height + 1);
    assert.deepEqual(c.consumed.map(a => a.type).sort(), types.filter(t => t !== "animation").sort());
    for (const a of c.consumed) {
      assert(a.decoded); assert(a.sha256 && a.sha256 === a.expectedSha256);
      if (["bgm", "voice", "sfx"].includes(a.type)) assert(a.played && a.pipelinePlaying && !a.error);
      if (a.type === "video") assert(a.playing && a.ended && a.timeAdvanced && !a.error);
    }
    if (expected.multiframeVideo) {
      const a = c.consumed.find(a => a.type === "video");
      assert(a.duration > 1 && c.videoFrames.length >= 15 && c.videoFrames.some(f => f.time > 1));
      assert(new Set(c.videoFrames.map(f => f.pixelSignature)).size >= 10);
      assert(c.videoFrames.every(f => f.width === 480 && f.height === 270));
      assert(c.video.some(e => e.event === "ended" && e.duration > 1 && e.time > 1));
    }
  }
  assert.equal(r.profileRestored, true); assert.equal(r.protectedUnchanged, true);
  assert.deepEqual(r.gitAfter, r.gitBefore); assert.equal(r.launches.length, 1);
  assert.equal(r.launches[0].cleanup.status, "PASS"); assert.equal(r.launches[0].cleanup.normalCloseClaimed, false);
  return { displayCases: r.cases.length, mediaConsumptions: r.cases.reduce((n, c) => n + c.consumed.length, 0) };
}
module.exports = { validate };
