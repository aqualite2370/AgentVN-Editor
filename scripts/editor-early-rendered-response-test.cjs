"use strict";
const assert = require("node:assert/strict");
const { selectEarlyRenderedResponse } = require("./lib/editor-early-rendered-response.cjs");

const missedWindow = [
  { clock: .057, renderedProgress: .237641 },
  { clock: .1405, renderedProgress: .529185 },
  { clock: .182, renderedProgress: .640691 },
  { clock: .34875, renderedProgress: .890121 },
];
const proof = selectEarlyRenderedResponse(missedWindow);
assert.equal(proof.method, "measured-before-quarter-threshold");
assert.strictEqual(proof.sample, missedWindow[2], "Use an actual frame, not interpolation");
assert(proof.sample.clock <= .25 && proof.sample.renderedProgress >= .45);
const slow = selectEarlyRenderedResponse([{ clock: .25, renderedProgress: .236656 }]);
assert.equal(slow.sample.renderedProgress, .236656, "Preserve the original sluggish RED evidence");
assert(slow.sample.renderedProgress < .45);
for (const frames of [
  [],
  [{ clock: .182, renderedProgress: .1 }, { clock: .349, renderedProgress: .9 }],
  [{ clock: .5, renderedProgress: 1 }],
  [{ clock: .25, progress: .9 }],
  [{ clock: -.1, renderedProgress: .9 }],
  [{ clock: .2, renderedProgress: NaN }],
]) assert.equal(selectEarlyRenderedResponse(frames), null, "Missing/late/non-pixel evidence must not PASS");
const quarter = selectEarlyRenderedResponse([
  { clock: .1, renderedProgress: .5 }, { clock: .26, renderedProgress: .77 },
]);
assert.equal(quarter.method, "measured-quarter-frame");
assert.equal(quarter.sample.clock, .26);
console.log("PASS early rendered response: real early proof, original RED preserved, 6 invalid evidence sets rejected");
