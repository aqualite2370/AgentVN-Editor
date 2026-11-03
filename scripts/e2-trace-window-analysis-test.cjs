const assert = require("node:assert/strict");
const { summarizeTraceLoafWindows } = require("./lib/e2-trace-window-analysis.cjs");

const result = summarizeTraceLoafWindows({
  traceOriginUs: 1_000_000,
  longAnimationFrames: [{ startTime: 100, duration: 80 }],
  traceEvents: [
    {
      name: "thread_name",
      ph: "M",
      pid: 41,
      tid: 7,
      args: { name: "CrGpuMain" },
    },
    {
      name: "GPUTask",
      cat: "gpu",
      ph: "X",
      pid: 41,
      tid: 7,
      ts: 1_170_000,
      dur: 60_000,
      tdur: 15_000,
      args: {},
    },
    {
      name: "RasterDecoderImpl::DoEndRasterCHROMIUM::Flush",
      cat: "gpu",
      ph: "X",
      pid: 41,
      tid: 7,
      ts: 1_175_000,
      dur: 53_000,
      tdur: 9_000,
      args: {},
    },
    {
      name: "RasterDecoderImpl::DoRasterCHROMIUM",
      cat: "gpu",
      ph: "X",
      pid: 41,
      tid: 7,
      ts: 1_176_000,
      dur: 3_000,
      tdur: 3_000,
      args: { raster_id: 90 },
    },
    {
      name: "GPUTask",
      cat: "gpu",
      ph: "X",
      pid: 41,
      tid: 7,
      ts: 1_185_000,
      dur: 20_000,
      tdur: 8_000,
      args: {},
    },
    {
      name: "PipelineReporter",
      ph: "b",
      pid: 52,
      tid: 9,
      ts: 1_160_000,
      args: { frame_reporter: { frame_sequence: 10, state: "STATE_DROPPED" } },
    },
    {
      name: "PipelineReporter",
      ph: "b",
      pid: 52,
      tid: 9,
      ts: 1_175_000,
      args: { frame_reporter: { frame_sequence: 11, state: "STATE_PRESENTED_ALL" } },
    },
  ],
});

assert.equal(result.frames.length, 1);
assert.equal(result.frames[0].startTime, 100);
assert.equal(result.frames[0].endTime, 180);
assert.equal(result.frames[0].gpuTasks.length, 1);
assert.deepEqual(result.frames[0].gpuTasks[0], {
  name: "GPUTask",
  processName: "",
  threadName: "CrGpuMain",
  startTime: 170,
  endTime: 230,
  durationMs: 60,
  threadCpuMs: 15,
  overlapMs: 10,
  nestedRasterFlushes: [{
    name: "RasterDecoderImpl::DoEndRasterCHROMIUM::Flush",
    startTime: 175,
    durationMs: 53,
    threadCpuMs: 9,
  }],
  nestedRasterCommands: [{
    name: "RasterDecoderImpl::DoRasterCHROMIUM",
    startTime: 176,
    durationMs: 3,
    rasterId: 90,
  }],
});
assert.deepEqual(result.frames[0].compositorFrameStates, [
  { frameSequence: 10, state: "STATE_DROPPED", frameType: "NORMAL", time: 160 },
  { frameSequence: 11, state: "STATE_PRESENTED_ALL", frameType: "NORMAL", time: 175 },
]);
assert.deepEqual(
  summarizeTraceLoafWindows({
    traceOriginUs: Number.NaN,
    longAnimationFrames: [{ startTime: 100, duration: 80 }],
    traceEvents: [],
  }).failures,
  ["trace clock origin is missing or invalid"],
);

console.log("PASS E2 Chrome trace LoAF-window attribution contract");
