"use strict";
const fs = require("node:fs"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const { assertHomeContainerCurve } = require("./lib/native-editor-container-curve.cjs");
const baseline = "F:/AgentVN/QA/Native-Editor-Motion-20261020-01/session-02/motion/report.json";
const raw = JSON.parse(fs.readFileSync(baseline, "utf8"));
assert.equal(raw.matrix.length, 2);
let rejected = 0;
for (const m of raw.matrix) {
  const episode = m.episodes.find(e => e.name === "home-to-editor");
  assert.equal(episode.status, "FAILED"); // Preserve the original false rejection.
  const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(episode.trace.path)));
  assert.throws(() => {
    const animated = t.frames.filter(f => f.editor?.animations.some(a => a.name === "container-boot"));
    assert(animated.every(f => f.editor.animations.every(a =>
      a.duration === (m.reduced ? 520 : 1120) && a.easing === "cubic-bezier(0.16, 0.86, 0.18, 1)")));
  }, "Original predicate must reproduce its false rejection");
  assertHomeContainerCurve(t, m.reduced);
  const mutations = [
    t => { t.frames = []; },
    t => { t.frames.forEach(f => { if (f.editor) f.editor.cssAnimationTimingFunction = "linear"; }); },
    t => { t.frames.forEach(f => f.editor?.animations.forEach(a => { a.duration = 0; })); },
    t => { t.frames.forEach(f => f.editor?.animations.forEach(a => { a.keyframes = []; })); },
    t => { t.frames.forEach(f => f.editor?.animations.forEach(a => a.keyframes.forEach(k => { k.easing = "linear"; }))); },
    t => { t.frames.forEach(f => f.editor?.animations.forEach(a => { a.keyframes.at(-1).offset = .5; })); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(t); mutate(copy); assert.throws(() => assertHomeContainerCurve(copy, m.reduced)); rejected++;
  }
}
console.log(`PASS actual normal/reduced traces reproduce old CSS-segment false rejection; corrected oracle rejected ${rejected} invalid variants`);
