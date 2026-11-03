"use strict";
const assert = require("node:assert/strict");
const curve = "cubic-bezier(0.16, 0.86, 0.18, 1)";
function assertHomeContainerCurve(trace, reduced) {
  const frames = trace.frames.filter(f => f.editor?.animations.some(a =>
    a.name === "container-boot" && a.state === "running"));
  assert(frames.length >= 2, "Home container lacks real animated frames");
  for (const f of frames) {
    assert.equal(f.editor.cssAnimationTimingFunction, curve);
    for (const a of f.editor.animations.filter(a => a.name === "container-boot")) {
      assert.equal(a.duration, reduced ? 520 : 1120);
      assert.equal(a.state, "running");
      // CSS animation-timing-function belongs to each keyframe segment.
      // Web Animations effect timing may correctly remain linear.
      assert(a.keyframes.length >= 2);
      assert.equal(a.keyframes[0].offset, 0); assert.equal(a.keyframes.at(-1).offset, 1);
      assert(a.keyframes.filter(k => k.offset < 1).every(k => k.easing === curve));
    }
  }
  return { animatedFrames: frames.length, segmentCurve: curve, duration: reduced ? 520 : 1120 };
}
module.exports = { assertHomeContainerCurve };
