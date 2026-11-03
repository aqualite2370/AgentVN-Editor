const assert = require("node:assert/strict");
const {
  decodeCSwitchPayload,
  xmlTimestampDeltaMs,
  summarizeThreadSwitches,
  splitOffCpuByObservedReady,
  classifyThreadCpuMetricComparison,
} = require("./lib/e2-etw-cswitch.cjs");

const payload = Buffer.alloc(28);
payload.writeUInt32LE(55156, 0);
payload.writeUInt32LE(808, 4);
payload.writeInt8(9, 8);
payload.writeInt8(8, 9);
payload.writeUInt8(13, 12);
payload.writeUInt8(0, 13);
payload.writeUInt8(5, 14);
assert.deepEqual(decodeCSwitchPayload(payload.toString("hex"), 5), {
  newThreadId: 55156,
  oldThreadId: 808,
  newThreadPriority: 9,
  oldThreadPriority: 8,
  oldThreadWaitReason: 13,
  oldThreadWaitMode: 0,
  oldThreadState: 5,
  payloadLength: 28,
  version: 5,
});
assert.throws(() => decodeCSwitchPayload("FF", 5), /at least 24 bytes/);
assert.throws(() => decodeCSwitchPayload("not hex", 5), /hexadecimal/);
assert.throws(() => decodeCSwitchPayload(payload.toString("hex"), 6), /unsupported/);
payload.writeUInt8(9, 14);
assert.equal(decodeCSwitchPayload(payload.toString("hex"), 5).oldThreadState, 9,
  "unrecognized states must retain their numeric value, not be mislabeled as waiting");
payload.writeUInt8(255, 8);
assert.equal(decodeCSwitchPayload(payload.toString("hex"), 5).newThreadPriority, 255,
  "the reference parser reads priorities as unsigned bytes");
assert.equal(decodeCSwitchPayload(payload.toString("hex"), 5).newThreadId, 55156,
  "CSwitch newThreadId is read from payload offset zero, not System/Execution ThreadID");
assert.ok(Math.abs(xmlTimestampDeltaMs(
  "2026-10-09T12:17:53.205897400+07:59",
  "2026-10-09T12:17:53.185139800+07:59",
) - 20.7576) < 1e-8, "timestamp differences must retain sub-millisecond precision");
assert.throws(() => xmlTimestampDeltaMs("invalid", "invalid"), /timestamp/);
assert.deepEqual(summarizeThreadSwitches([
  { time: 0, newThreadId: 7, oldThreadId: 0 },
  { time: 10, newThreadId: 0, oldThreadId: 7, oldThreadState: 5 },
  { time: 30, newThreadId: 7, oldThreadId: 0 },
  { time: 40, newThreadId: 0, oldThreadId: 7, oldThreadState: 1 },
], 7, 5, 35), {
  durationMs: 30, runningMs: 10, offCpuMs: 20, unknownMs: 0,
  switchCount: 2, maxRunningIntervalMs: 5, maxOffCpuIntervalMs: 20,
  offCpuByRawStateMs: { 5: 20 },
});
const switches = [
  { time: 0, newThreadId: 7, oldThreadId: 0 },
  { time: 10, newThreadId: 0, oldThreadId: 7 },
  { time: 30, newThreadId: 7, oldThreadId: 0 },
  { time: 40, newThreadId: 0, oldThreadId: 7 },
];
const readiness = [
  { time: 11, awakenedThreadId: 99 },
  { time: 20, awakenedThreadId: 7 },
  { time: 21, awakenedThreadId: 7 },
];
assert.deepEqual(splitOffCpuByObservedReady(switches, readiness, 7, 5, 35), {
  offCpuMs: 20, beforeObservedReadyMs: 10, observedReadyToRunMs: 10,
  withoutReadyEvidenceMs: 0, intervalCount: 1, intervalsWithReadyEvidence: 1,
  maxObservedReadyToRunMs: 10,
});
assert.equal(splitOffCpuByObservedReady(switches, readiness, 7, 25, 35).observedReadyToRunMs, 5,
  "a wake before the measurement window must establish ready state");
assert.equal(splitOffCpuByObservedReady(switches, [], 7, 5, 35).withoutReadyEvidenceMs, 20,
  "missing ReadyThread evidence must not be labeled blocked or runnable");
const cpuMetricComparison = classifyThreadCpuMetricComparison(14.563, 11.283);
assert.equal(cpuMetricComparison.status, "DISCREPANCY_REQUIRES_REVIEW");
assert.equal(cpuMetricComparison.traceThreadCpuMs, 14.563);
assert.equal(cpuMetricComparison.scheduledOnCpuWallMs, 11.283);
assert.ok(Math.abs(cpuMetricComparison.numericDifferenceMs - 3.28) < 1e-9);
assert.equal(
  classifyThreadCpuMetricComparison(11.683, 11.283).status,
  "NO_EXCESS_OBSERVED_NOT_A_PROOF",
);
assert.deepEqual(classifyThreadCpuMetricComparison(null, 11.283), {
  status: "MISSING_TRACE_THREAD_CPU",
  traceThreadCpuMs: null,
  scheduledOnCpuWallMs: 11.283,
  numericDifferenceMs: null,
});
console.log("PASS E2 CSwitch payload decoding and rejection contract");
