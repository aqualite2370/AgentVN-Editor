"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs");
const { validateEditor, validatePlayer } = require("./lib/installed-video-current-evidence.cjs");
const { matrix } = require("./lib/installed-assets-evidence.cjs");
// Real previous single-frame evidence must never satisfy the new supplement.
const old = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-assets-current-04/report.json"));
assert.equal(old.status, "FAILED"); assert.throws(() => validatePlayer(old));
const f = { status: "PASS", finishedAt: "guard-only", scope: "CURRENT_INSTALLED_PLAYER_MULTIFRAME_VIDEO_SUPPLEMENT",
  sourceStatus: "PASS", productChanges: 0, modelRequests: 0, builds: 0, errors: [], mediaErrors: [],
  executable: { sha256: "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e" },
  cases: matrix().map(m => ({ ...m, status: "PASS", input: { trusted: true, hit: true, overflow: 0 },
    consumed: [{ type: "video", sha256: "new", expectedSha256: "new", duration: 1.77,
      decoded: true, playing: true, ended: true, timeAdvanced: true, error: false }],
    videoFrames: Array.from({ length: 20 }, (_, i) => ({ time: i / 12, width: 480, height: 270, pixelSignature: i })),
    video: [{ event: "ended", duration: 1.77, time: 1.77 }] })),
  launches: [{ cleanup: { status: "PASS", normalCloseClaimed: false } }], profileRestored: true, protectedUnchanged: true,
  gitBefore: { index: "same" }, gitAfter: { index: "same" } };
validatePlayer(f);
const invalid = [
  r => { r.cases = []; }, r => { r.cases[1] = r.cases[0]; }, r => { r.status = "RUNNING"; },
  r => { r.cases[0].videoFrames = []; }, r => { r.cases[0].videoFrames.forEach(f => { f.time = 0; }); },
  r => { r.cases[0].videoFrames.forEach(f => { f.pixelSignature = 1; }); },
  r => { r.cases[0].consumed[0].duration = .001; }, r => { r.cases[0].consumed[0].sha256 = "old"; },
  r => { r.cases[0].consumed[0].ended = false; }, r => { r.cases[0].consumed[0].timeAdvanced = false; },
  r => { r.cases[0].video[0].time = 0; }, r => { r.cases[0].input.trusted = false; },
  r => { r.profileRestored = false; }, r => { r.launches[0].cleanup.normalCloseClaimed = true; },
  r => { r.gitAfter.index = "changed"; }, r => { r.validationError = "ignored"; },
];
for (const mutate of invalid) { const bad = structuredClone(f); mutate(bad); assert.throws(() => validatePlayer(bad)); }
assert.throws(() => validateEditor({ status: "PASS" }));
console.log(JSON.stringify({ status: "PASS", invalidReportsRejected: invalid.length + 2, actualSingleFrameFailureRejected: true, launches: 0 }));
