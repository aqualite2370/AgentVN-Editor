// Layout reference: Microsoft PerfView's CSwitchTraceData in
// src/TraceEvent/Parsers/KernelTraceEventParser.cs. Preserve numeric states;
// a scheduler wait reason is not proof of a particular GPU/driver wait.
function decodeCSwitchPayload(hex, version) {
  if (![2, 3, 4, 5].includes(version)) {
    throw new Error(`CSwitch payload version ${version} is unsupported`);
  }
  if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new Error("CSwitch payload must be an even-length hexadecimal string");
  }
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length < 24) throw new Error("CSwitch payload requires at least 24 bytes");
  return {
    newThreadId: bytes.readUInt32LE(0),
    oldThreadId: bytes.readUInt32LE(4),
    newThreadPriority: bytes.readUInt8(8),
    oldThreadPriority: bytes.readUInt8(9),
    oldThreadWaitReason: bytes.readUInt8(12),
    oldThreadWaitMode: bytes.readUInt8(13),
    oldThreadState: bytes.readUInt8(14),
    payloadLength: bytes.length,
    version,
  };
}

function xmlTimestampNs(value) {
  const match = typeof value === "string" && value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error("invalid ETW XML timestamp");
  const wholeMs = Date.parse(match[1] + match[3]);
  if (!Number.isFinite(wholeMs)) throw new Error("invalid ETW XML timestamp");
  return BigInt(wholeMs) * 1000000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}

function xmlTimestampDeltaMs(value, anchor) {
  // Use differences anchored to the corresponding CSV FILETIME, not the XML
  // UTC offset: tracerpt on this host has emitted an incorrect +07:59 offset.
  return Number(xmlTimestampNs(value) - xmlTimestampNs(anchor)) / 1e6;
}

function summarizeThreadSwitches(events, threadId, startTime, endTime) {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new Error("invalid scheduler time window");
  }
  const relevant = events.filter((e) => e.newThreadId === threadId || e.oldThreadId === threadId)
    .sort((a, b) => a.time - b.time);
  let cursor = startTime;
  let state = "unknown";
  let offCpuState = null;
  const result = {
    durationMs: endTime - startTime, runningMs: 0, offCpuMs: 0, unknownMs: 0,
    switchCount: 0, maxRunningIntervalMs: 0, maxOffCpuIntervalMs: 0,
    offCpuByRawStateMs: {},
  };
  const accumulate = (until) => {
    const duration = Math.max(0, until - cursor);
    result[`${state}Ms`] += duration;
    if (state === "running") {
      result.maxRunningIntervalMs = Math.max(result.maxRunningIntervalMs, duration);
    } else if (state === "offCpu") {
      result.maxOffCpuIntervalMs = Math.max(result.maxOffCpuIntervalMs, duration);
      const key = offCpuState ?? "unknown";
      result.offCpuByRawStateMs[key] = (result.offCpuByRawStateMs[key] ?? 0) + duration;
    }
    cursor = until;
  };
  for (const event of relevant) {
    if (!Number.isFinite(event.time)) throw new Error("invalid context-switch timestamp");
    if (event.time > endTime) break;
    if (event.time >= startTime) {
      accumulate(event.time);
      result.switchCount++;
    }
    if (event.newThreadId === threadId) state = "running";
    else {
      state = "offCpu";
      offCpuState = event.oldThreadState;
    }
  }
  accumulate(endTime);
  return result;
}

function splitOffCpuByObservedReady(events, readinessEvents, threadId, startTime, endTime) {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new Error("invalid scheduler time window");
  }
  const switches = events
    .filter((event) => event.newThreadId === threadId || event.oldThreadId === threadId)
    .sort((a, b) => a.time - b.time);
  const readiness = readinessEvents
    .filter((event) => event.awakenedThreadId === threadId)
    .sort((a, b) => a.time - b.time);
  const intervals = [];
  let offCpuStart = null;

  for (const event of switches) {
    if (!Number.isFinite(event.time)) throw new Error("invalid context-switch timestamp");
    if (event.oldThreadId === threadId && event.newThreadId !== threadId) {
      offCpuStart = { time: event.time, state: event.oldThreadState };
    } else if (event.newThreadId === threadId && event.oldThreadId !== threadId && offCpuStart) {
      intervals.push({ start: offCpuStart.time, end: event.time });
      offCpuStart = null;
    }
  }

  const result = {
    offCpuMs: 0,
    beforeObservedReadyMs: 0,
    observedReadyToRunMs: 0,
    withoutReadyEvidenceMs: 0,
    intervalCount: 0,
    intervalsWithReadyEvidence: 0,
    maxObservedReadyToRunMs: 0,
  };
  for (const interval of intervals) {
    const clippedStart = Math.max(startTime, interval.start);
    const clippedEnd = Math.min(endTime, interval.end);
    if (clippedEnd <= clippedStart) continue;
    const duration = clippedEnd - clippedStart;
    result.intervalCount++;
    result.offCpuMs += duration;

    const ready = readiness.find((event) => event.time >= interval.start && event.time <= interval.end);
    if (!ready) {
      result.withoutReadyEvidenceMs += duration;
      continue;
    }
    result.intervalsWithReadyEvidence++;
    const readyStart = Math.max(clippedStart, ready.time);
    result.beforeObservedReadyMs += Math.max(0, readyStart - clippedStart);
    const readyToRun = Math.max(0, clippedEnd - readyStart);
    result.observedReadyToRunMs += readyToRun;
    result.maxObservedReadyToRunMs = Math.max(result.maxObservedReadyToRunMs, readyToRun);
  }
  return result;
}

function classifyThreadCpuMetricComparison(traceThreadCpuMs, scheduledOnCpuWallMs) {
  if (!Number.isFinite(scheduledOnCpuWallMs) || scheduledOnCpuWallMs < 0) {
    throw new Error("invalid ETW scheduled-on-CPU duration");
  }
  if (traceThreadCpuMs === null) {
    return {
      status: "MISSING_TRACE_THREAD_CPU",
      traceThreadCpuMs: null,
      scheduledOnCpuWallMs,
      numericDifferenceMs: null,
    };
  }
  if (!Number.isFinite(traceThreadCpuMs) || traceThreadCpuMs < 0) {
    throw new Error("invalid trace thread CPU duration");
  }
  const numericDifferenceMs = traceThreadCpuMs - scheduledOnCpuWallMs;
  return {
    status: numericDifferenceMs > 0.5
      ? "DISCREPANCY_REQUIRES_REVIEW"
      : "NO_EXCESS_OBSERVED_NOT_A_PROOF",
    traceThreadCpuMs,
    scheduledOnCpuWallMs,
    numericDifferenceMs,
  };
}

module.exports = {
  decodeCSwitchPayload,
  xmlTimestampDeltaMs,
  summarizeThreadSwitches,
  splitOffCpuByObservedReady,
  classifyThreadCpuMetricComparison,
};
