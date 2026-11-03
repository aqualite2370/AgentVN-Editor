"use strict";
const assert = require("node:assert/strict");

// The executed gallery sampler invokes sample(performance.now()) once, then
// passes sample directly to requestAnimationFrame. The first entry is a
// synchronous seed, NOT a rAF timestamp. Keep it in the raw evidence, but never
// compare its timestamp with the first rAF entry or count it as a rendered frame.
function auditReturnTrace(trace) {
  assert.equal(trace.status, "PASS");
  assert.equal(trace.final.screen, trace.expected);
  assert(trace.frames.length > 2);
  const [seed, ...frames] = trace.frames;
  assert.equal(seed.screen, "gallery");
  assert(Number.isFinite(seed.at) && seed.at >= 0);
  for (const [i, frame] of frames.entries()) {
    assert(Number.isFinite(frame.at) && frame.at >= 0);
    if (i) assert(frame.at >= frames[i - 1].at, "rAF timestamps must remain ordered");
  }
  assert.equal(frames.at(-1).screen, trace.expected);
  assert.equal(frames.at(-1).phase, "idle");
  assert(frames.some(f => f.screen === "gallery"));
  assert(frames.some(f => f.screen === trace.expected));
  assert(frames.some(f => !["idle", "loading"].includes(f.phase)));
  return { synchronousSeed: seed, renderedFrames: frames.length,
    firstFrameTimestampBeforeSeed: frames[0].at < seed.at };
}
module.exports = { auditReturnTrace };
