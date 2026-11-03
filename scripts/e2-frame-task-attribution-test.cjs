"use strict";
const assert = require("node:assert/strict");
const { inspectFrameTrace } = require("./lib/e2-frame-task-attribution.cjs");
const marker = { ts: 1_000_000, pid: 2, tid: 3 };
const task = (ts, dur, pid = 2, tid = 3, name = "ThreadControllerImpl::RunTask") =>
  ({ ts, dur, pid, tid, ph: "X", cat: "toplevel", name, tdur: dur / 2 });
const events = [
  task(1_005_000, 10_000), task(1_012_000, 12_000),
  task(1_025_000, 5_000, 2, 4),
  task(1_000_000, 100_000, 5, 6, "gpu-stage"),
  task(1_030_000, 5_000, 2, 3, "scheduler-stage"),
];
const frames = [{ startTime: 110, duration: 30, renderStart: 135, scripts: [] }];
const result = inspectFrameTrace({ events, marker, interactionStartMs: 100, frames });
assert.equal(result.frames[0].traceStartUs, 1_010_000);
assert.equal(result.frames[0].traceRenderUs, 1_035_000);
assert.equal(result.frames[0].traceEndUs, 1_040_000);
assert.equal(result.frames[0].mainTaskCoverageMs, 14);
assert.equal(result.frames[0].mainTaskCount, 2);
assert.equal(result.frames[0].otherThreadSlices.length, 2);
assert.equal(result.frames[0].mainSlices.length, 3);
assert.equal(result.mainThreadEventCount, 3);
assert.throws(() => inspectFrameTrace({ events, marker: {}, interactionStartMs: 100, frames }), /clock/);
assert.throws(() => inspectFrameTrace({ events, marker, interactionStartMs: 100,
  frames: [{ startTime: 110, duration: NaN }] }), /frame/);
assert.equal(inspectFrameTrace({ events, marker, interactionStartMs: 100, frames: [] }).frames.length, 0);
console.log("PASS: frame/trace clock mapping, clipped task union, main thread ownership and missing evidence");
