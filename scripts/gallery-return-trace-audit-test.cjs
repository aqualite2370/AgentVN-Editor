"use strict";
const assert = require("node:assert/strict");
const { auditReturnTrace } = require("./lib/gallery-return-trace-audit.cjs");
const row = {
  status: "PASS", expected: "main_menu", final: { screen: "main_menu" },
  frames: [
    { at: 100.8, screen: "gallery", phase: "idle" },
    { at: 100.2, screen: "gallery", phase: "idle" },
    { at: 116.8, screen: "gallery", phase: "covering" },
    { at: 133.4, screen: "main_menu", phase: "idle" },
  ],
};
assert.deepEqual(auditReturnTrace(row), { synchronousSeed: row.frames[0],
  renderedFrames: 3, firstFrameTimestampBeforeSeed: true });
const mutations = [
  r => { r.frames[2].at = 99; },
  r => { r.frames[1].at = NaN; },
  r => { r.frames[0].at = -1; },
  r => { r.frames[0].screen = "main_menu"; },
  r => { r.frames = r.frames.slice(0, 2); },
  r => { r.frames.at(-1).screen = "gallery"; },
  r => { r.frames.at(-1).phase = "covering"; },
  r => { r.frames.forEach(f => { f.phase = "idle"; }); },
  r => { r.frames.slice(1).forEach(f => { f.screen = "main_menu"; }); },
  r => { r.final.screen = "gallery"; },
  r => { r.status = "FAILED"; },
];
for (const mutate of mutations) {
  const bad = structuredClone(row); mutate(bad); assert.throws(() => auditReturnTrace(bad));
}
console.log(JSON.stringify({ status: "PASS", acceptedSeedClockBoundary: 1,
  invalidVariantsRejected: mutations.length, productLaunches: 0 }));
