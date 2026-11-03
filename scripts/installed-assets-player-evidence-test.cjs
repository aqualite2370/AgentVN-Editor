"use strict";
const assert = require("node:assert/strict");
const { validate } = require("./lib/installed-assets-player-evidence.cjs");
const { matrix, types } = require("./lib/installed-assets-evidence.cjs");
const fixture = { status: "PASS", finishedAt: "guard-only", productChanges: 0, modelRequests: 0, builds: 0,
  scope: "CURRENT_INSTALLED_PLAYER_EXACT_NEW_EDITOR_ASSET_EXPORT",
  executable: { sha256: "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e" },
  sourceStatus: "PASS", errors: [], mediaErrors: [], protectedUnchanged: true, profileRestored: true,
  gitBefore: { index: "unchanged" }, gitAfter: { index: "unchanged" },
  launches: [{ cleanup: { status: "PASS", normalCloseClaimed: false } }],
  cases: matrix().map(m => ({ ...m, status: "PASS", input: { trusted: true, overflow: 0, hit: true,
    rect: { x: 0, y: 0, width: 100, height: 40, right: 100, bottom: 40 } },
  consumed: types.filter(t => t !== "animation").map(type => ({ type, sha256: `${type}-new`, expectedSha256: `${type}-new`,
    decoded: true, ...(type === "video" ? { playing: true, ended: true, timeAdvanced: true, error: false } : {}),
    ...(["bgm", "voice", "sfx"].includes(type) ? { played: true, pipelinePlaying: true, error: false } : {}) })) })),
};
validate(fixture);
const expected = { sha256: "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59", multiframeVideo: true };
const current = structuredClone(fixture); current.executable.sha256 = expected.sha256;
for (const c of current.cases) {
  c.consumed.find(a => a.type === "video").duration = 1.765;
  c.videoFrames = Array.from({ length: 20 }, (_, i) => ({ time: i / 12, pixelSignature: i, width: 480, height: 270 }));
  c.video = [{ event: "ended", duration: 1.765, time: 1.765 }];
}
validate(current, expected);
assert.throws(() => validate(fixture, expected)); assert.throws(() => validate(current));
const badFrames = structuredClone(current); badFrames.cases[0].videoFrames = [];
assert.throws(() => validate(badFrames, expected));
const badDuration = structuredClone(current); badDuration.cases[0].consumed.find(a => a.type === "video").duration = .001;
assert.throws(() => validate(badDuration, expected));
const invalid = [
  r => { r.status = "RUNNING"; }, r => { r.sourceStatus = "FAILED"; },
  r => { r.cases = []; }, r => { r.cases[1] = r.cases[0]; },
  r => { r.executable.sha256 = "workspace"; }, r => { r.errors.push("React"); },
  r => { r.mediaErrors.push("decoder"); }, r => { r.cases[0].consumed.pop(); },
  r => { r.cases[0].consumed[0].sha256 = "old"; }, r => { r.cases[0].consumed[0].decoded = false; },
  r => { r.cases[0].input.trusted = false; }, r => { r.cases[0].input.hit = false; },
  r => { r.cases[0].input.rect.right = 3000; }, r => { r.cases[0].input.overflow = 10; },
  r => { r.cases[0].consumed.find(a => a.type === "voice").played = false; },
  r => { r.cases[0].consumed.find(a => a.type === "sfx").pipelinePlaying = false; },
  r => { r.cases[0].consumed.find(a => a.type === "video").ended = false; },
  r => { r.cases[0].consumed.find(a => a.type === "video").timeAdvanced = false; },
  r => { r.profileRestored = false; }, r => { r.protectedUnchanged = false; },
  r => { r.gitAfter.index = "changed"; }, r => { r.launches[0].cleanup.status = "FAILED"; },
  r => { r.launches[0].cleanup.normalCloseClaimed = true; }, r => { r.modelRequests = 1; },
];
for (const mutate of invalid) {
  const r = structuredClone(fixture); mutate(r); assert.throws(() => validate(r));
}
console.log(JSON.stringify({ status: "PASS", invalidReportsRejected: invalid.length + 4, syntheticOnly: true, launches: 0 }));

// Replay the raw installed-Player failure, without launching or rewriting it.
if (process.argv[2]) {
  const fs = require("node:fs");
  const { attributeAudio } = require("./lib/installed-assets-audio-attribution.cjs");
  const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  assert.equal(raw.status, "FAILED");
  const c = raw.cases.find(c => c.status === "FAILED");
  const first = c.audioObjects.find(g => g.stage === "dialog-after-transition-idle").values;
  const later = c.audioObjects.find(g => g.stage === "sfx").values;
  const bgm = c.diagnostics.audio.find(e => e.payload.kind === "bgm"
    && e.payload.assetId === "qa_bgm" && e.payload.phase === "play-request").payload.source;
  const input = { first, later, bgm, events: c.mediaEvents,
    assets: raw.cartridge.assets };
  // The old URL-presence test counted a preloader as voice and hid real SFX.
  assert.equal(new Set(first.filter(a => a.src !== bgm).map(a => a.src)).size, 2);
  assert.equal(new Set(later.filter(a => !first.some(f => f.src === a.src)).map(a => a.src)).size, 0);
  const audio = attributeAudio(input);
  assert.deepEqual(audio.map(a => a.type), ["bgm", "voice", "sfx"]);
  assert.equal(new Set(audio.map(a => a.src)).size, 3);
  assert(audio.every(a => a.played && a.pipelinePlaying && a.decoded));
  const badAudio = [
    x => { x.first.push(structuredClone(x.first.find(a => a.src === audio[1].src))); },
    x => { x.first.push({ ...x.first.find(a => a.src === audio[1].src), src: "duplicate-voice" }); },
    x => { x.later = x.later.filter(a => a.src !== audio[2].src); },
    x => { x.first.find(a => a.src === audio[1].src).sha256 = "old-bytes"; },
    x => { x.later.find(a => a.src === audio[2].src && a.readyState >= 2).error = 3; },
    x => { x.events = x.events.map(g => ({ ...g, events: g.events.filter(e => JSON.parse(e.value).event !== "kPlay") })); },
    x => { x.events = x.events.map(g => ({ ...g, events: g.events.filter(e => JSON.parse(e.value).pipeline_state !== "kPlaying") })); },
    x => {
      const group = x.events.find(g => g.events.some(e => {
        const v = JSON.parse(e.value); return v.event === "kLoad" && v.url === audio[1].src;
      }) && g.events.some(e => JSON.parse(e.value).event === "kPlay"));
      x.events.push({ ...structuredClone(group), playerId: "duplicate-playing-pipeline" });
    },
  ];
  for (const mutate of badAudio) {
    const copy = structuredClone(input); mutate(copy);
    assert.throws(() => attributeAudio(copy));
  }
  console.log(JSON.stringify({ status: "PASS", scope: "RAW_FAILURE_AUDIO_ATTRIBUTION_REPLAY",
    originalUnmodified: process.argv[2], rejectedAudioMutations: badAudio.length,
    realAudioSources: audio.map(a => ({ type: a.type, src: a.src, playerId: a.playerId })), launches: 0 }));
}
