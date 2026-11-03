const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const {
  xmlTimestampDeltaMs,
  summarizeThreadSwitches,
  splitOffCpuByObservedReady,
  classifyThreadCpuMetricComparison,
} = require("./lib/e2-etw-cswitch.cjs");
const {
  iterateXmlEvents,
  parseCSwitchEvent,
  parseStackWalkEvent,
  associateStackWalksToSwitches,
  selectStackXmlFile,
} = require("./lib/e2-etw-stack-analysis.cjs");

const THREAD_EVENT_GUID = "3d6fa8d1-fe05-11d0-9dda-00c04fd7ba7c";
const EVENT_TRACE_GUID = "68fdd900-4a3e-11d1-84f4-0000f80464e3";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function filetimeToEpochMs(value) {
  if (!/^\d+$/.test(value)) throw new Error("Invalid CSV FILETIME anchor");
  return Number(BigInt(value) - 116444736000000000n) / 10000;
}

async function readCsvGpuEvents(file, gpu) {
  const lines = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  let csvAnchor = null;
  const events = [];
  for await (const line of lines) {
    lineNumber++;
    const columns = line.split(",").map((value) => value.trim());
    if (lineNumber === 2) {
      if (columns[0] !== "EventTrace" || columns[1] !== "Header" || !/^\d+$/.test(columns[16])) {
        throw new Error("CSV header anchor could not be verified");
      }
      csvAnchor = { filetime: columns[16], epochMs: filetimeToEpochMs(columns[16]) };
      continue;
    }
    if (columns[0] !== "Microsoft-Windows-DxgKrnl") continue;
    if (Number(columns[9]) !== gpu.pid || Number(columns[10]) !== gpu.tid) continue;
    events.push({
      id: Number(columns[2]),
      opcode: Number(columns[6]),
      epochMs: filetimeToEpochMs(columns[16]),
    });
  }
  if (!csvAnchor) throw new Error("CSV clock anchor is missing");
  if (events.length < 2) throw new Error("No usable DxgKrnl events were found for the Chrome GPU main thread");
  return { csvAnchor, events };
}

function eventHeaderMatches(event, guid) {
  return event.includes(`<EventGuid>{${guid}}</EventGuid>`);
}

function rawReadinessThreadId(event) {
  const value = event.match(/<Data Name="TThreadId">([^<]+)<\/Data>/i)?.[1]?.trim();
  if (!value) return null;
  const threadId = Number.parseInt(value, 0);
  return Number.isFinite(threadId) ? threadId : null;
}

function topStackSignatures(samples) {
  const counts = new Map();
  for (const sample of samples) {
    const switchEvent = sample.switch;
    const direction = switchEvent.oldThreadId === sample.threadId ? "switch-out" : "switch-in";
    const key = JSON.stringify({
      direction,
      oldThreadState: direction === "switch-out" ? switchEvent.oldThreadState : null,
      addressPrefix: sample.frames.slice(0, 10),
    });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([signature, count]) => ({ count, ...JSON.parse(signature) }));
}

function stackSamplesInWindow(pairedStacks, threadId, start, end) {
  const candidates = pairedStacks.filter((sample) => sample.time >= start && sample.time <= end);
  const matched = candidates.filter((sample) => sample.switch);
  const outgoing = matched.filter((sample) => sample.switch.oldThreadId === threadId);
  const byRawOldThreadState = {};
  for (const sample of outgoing) {
    const key = String(sample.switch.oldThreadState);
    byRawOldThreadState[key] = (byRawOldThreadState[key] ?? 0) + 1;
  }
  return {
    candidateStackWalkCount: candidates.length,
    matchedStackWalkCount: matched.length,
    unmatchedStackWalkCount: candidates.length - matched.length,
    matchedSwitchOutStackCount: outgoing.length,
    switchOutStacksByRawState: byRawOldThreadState,
    commonAddressSignatures: topStackSignatures(matched),
    samples: matched.map((sample) => ({
      timeEpochMs: sample.time,
      eventTimeStamp: sample.eventTimeStamp,
      deltaFromSwitchMs: sample.deltaMs,
      stackProcessId: sample.processId,
      stackThreadId: sample.threadId,
      frames: sample.frames,
      switch: sample.switch,
    })),
  };
}

async function analyze(rootArg, outputPath) {
  const root = path.resolve(rootArg);
  const collection = readJson(path.join(root, "collection-report.json"));
  if (!collection.isElevated || collection.symlinkProbe?.created !== true
      || collection.wprStartExitCode !== 0 || collection.wprStopExitCode !== 0
      || collection.wprStatusAfter?.includes("recording in progress")) {
    throw new Error("An elevated, symlink-verified, successfully stopped capture is required");
  }
  if (!String(collection.wprProfile).endsWith("!E2GpuStack")) {
    throw new Error("A stack-enabled E2GpuStack profile is required");
  }

  const summaryText = fs.readFileSync(path.join(root, "trace-summary-best-effort.txt"), "utf8");
  const lostMatch = summaryText.match(/Total Events\s+Lost\s+(\d+)/);
  if (!lostMatch || Number(lostMatch[1]) !== 0) throw new Error("A verified zero-loss ETW summary is required");

  const diagnosticPath = path.join(root, "audit", "performance-diagnostic-only.json");
  const report = readJson(diagnosticPath);
  const trial = report.diagnosticResults?.[0]?.trials?.find((item) => (
    item.mode === "low-intrusion" && item.repeat === 1
  ));
  if (!trial?.traceSummary?.rawTracePath || !trial.browserClockAnchor) {
    throw new Error("The capture lacks aligned Chrome trace/clock evidence");
  }
  const trace = readJson(trial.traceSummary.rawTracePath);
  const gpuThreads = trace.traceEvents.filter((event) => (
    event.ph === "M" && event.name === "thread_name" && event.args?.name === "CrGpuMain"
  ));
  if (gpuThreads.length !== 1) throw new Error("Exactly one Chrome GPU main thread is required");
  const gpu = gpuThreads[0];
  const csvResult = await readCsvGpuEvents(path.join(root, "events.csv"), gpu);
  const csvGpuEvents = csvResult.events;
  const csvAnchor = csvResult.csvAnchor;

  const switches = [];
  const readinessEvents = [];
  const stackWalks = [];
  const xmlGpuEvents = [];
  const switchVersions = new Set();
  let xmlAnchor = null;
  let xmlHeaderVerified = false;
  let decodedSwitchCount = 0;
  const stackXmlPath = selectStackXmlFile(root);
  for await (const event of iterateXmlEvents(fs.createReadStream(stackXmlPath))) {
    const timestamp = event.match(/<TimeCreated SystemTime="([^"]+)"/)?.[1];
    if (!timestamp) continue;
    if (!xmlAnchor) {
      xmlAnchor = timestamp;
      xmlHeaderVerified = event.includes(`{${EVENT_TRACE_GUID}}`)
        && event.includes("<Provider>MSNT_SystemTrace</Provider>");
    }
    const time = csvAnchor.epochMs + xmlTimestampDeltaMs(timestamp, xmlAnchor);
    const cswitch = parseCSwitchEvent(event, time);
    if (cswitch) {
      decodedSwitchCount++;
      switchVersions.add(cswitch.version);
      if (cswitch.newThreadId === gpu.tid || cswitch.oldThreadId === gpu.tid) switches.push(cswitch);
      continue;
    }

    if (eventHeaderMatches(event, THREAD_EVENT_GUID)
        && /<Opcode>ReadyThread<\/Opcode>/.test(event)) {
      const awakenedThreadId = rawReadinessThreadId(event);
      if (awakenedThreadId === gpu.tid) readinessEvents.push({ time, awakenedThreadId });
      continue;
    }

    const stack = parseStackWalkEvent(event, time, { processId: gpu.pid, threadId: gpu.tid });
    if (stack) {
      stackWalks.push(stack);
      continue;
    }

    if (event.includes('Name="Microsoft-Windows-DxgKrnl"')
        && event.includes(`ProcessID="${gpu.pid}"`)
        && event.includes(`ThreadID="${gpu.tid}"`)) {
      xmlGpuEvents.push({
        id: Number(event.match(/<EventID>(\d+)<\/EventID>/)?.[1]),
        opcode: Number(event.match(/<Opcode>(\d+)<\/Opcode>/)?.[1]),
        epochMs: time,
      });
    }
  }
  if (!xmlAnchor || !xmlHeaderVerified) throw new Error("ETW XML/CSV header clock anchor could not be verified");
  if (!decodedSwitchCount || !switches.length) throw new Error("No CSwitch events were decoded for the Chrome GPU main thread");

  const clockChecks = [csvGpuEvents[0], csvGpuEvents[csvGpuEvents.length - 1]].map((csvEvent) => {
    const matches = xmlGpuEvents.filter((candidate) => (
      candidate.id === csvEvent.id && candidate.opcode === csvEvent.opcode
    ));
    const errorMs = Math.min(...matches.map((candidate) => Math.abs(candidate.epochMs - csvEvent.epochMs)));
    if (!Number.isFinite(errorMs) || errorMs > 0.002) throw new Error("XML/FILETIME clock cross-check failed");
    return { id: csvEvent.id, opcode: csvEvent.opcode, epochMs: csvEvent.epochMs, errorMs };
  });

  const originUs = trial.traceSummary.traceClockAlignment?.traceOriginUs;
  const timeOrigin = trial.browserClockAnchor.timeOriginEpochMs;
  if (!Number.isFinite(originUs) || !Number.isFinite(timeOrigin)) throw new Error("Chrome clock origin is invalid");
  const chromeEpochMs = (event) => timeOrigin + (event.ts - originUs) / 1000;
  const pairedStacks = associateStackWalksToSwitches(stackWalks, switches, gpu.tid);
  const windows = (trial.longAnimationFrames ?? []).map((frame) => {
    const start = timeOrigin + frame.startTime;
    const end = start + frame.duration;
    const longest = trace.traceEvents
      .filter((event) => event.ph === "X" && event.pid === gpu.pid && event.tid === gpu.tid
        && event.name === "RasterDecoderImpl::DoEndRasterCHROMIUM::Flush"
        && chromeEpochMs(event) < end && chromeEpochMs(event) + event.dur / 1000 > start)
      .sort((a, b) => b.dur - a.dur)[0];
    const flushStart = longest ? chromeEpochMs(longest) : null;
    const flushEnd = longest ? flushStart + longest.dur / 1000 : null;
    const flushScheduler = longest
      ? summarizeThreadSwitches(switches, gpu.tid, flushStart, flushEnd)
      : null;
    const traceCpuMs = longest && Number.isFinite(longest.tdur) ? longest.tdur / 1000 : null;
    return {
      frame,
      scheduler: summarizeThreadSwitches(switches, gpu.tid, start, end),
      observedReadiness: splitOffCpuByObservedReady(switches, readinessEvents, gpu.tid, start, end),
      stackWalks: stackSamplesInWindow(pairedStacks, gpu.tid, start, end),
      longestEndRasterFlush: longest ? {
        startEpochMs: flushStart,
        wallMs: longest.dur / 1000,
        traceThreadCpuMs: traceCpuMs,
        scheduler: flushScheduler,
        observedReadiness: splitOffCpuByObservedReady(switches, readinessEvents, gpu.tid, flushStart, flushEnd),
        stackWalks: stackSamplesInWindow(pairedStacks, gpu.tid, flushStart, flushEnd),
        cpuCrossCheck: classifyThreadCpuMetricComparison(traceCpuMs, flushScheduler.runningMs),
      } : null,
    };
  });

  const result = {
    kind: "e2-etw-stack-scheduler-diagnostic-not-acceptance",
    root,
    diagnosticPath,
    profile: collection.wprProfile,
    stackXmlPath,
    lostEvents: Number(lostMatch[1]),
    gpu: { pid: gpu.pid, tid: gpu.tid },
    decodedSwitchCount,
    switchVersions: [...switchVersions],
    targetSwitchCount: switches.length,
    targetReadinessEventCount: readinessEvents.length,
    targetStackWalkCount: stackWalks.length,
    targetStackWalkMatchedCount: pairedStacks.filter((stack) => stack.switch).length,
    targetStackWalkUnmatchedCount: pairedStacks.filter((stack) => !stack.switch).length,
    dxgKrnlEventsOnTargetThread: csvGpuEvents.length,
    clock: { xmlAnchor, csvAnchorFiletime: csvAnchor.filetime, epochAnchorMs: csvAnchor.epochMs, clockChecks },
    windows,
    limitations: [
      "ETW plus Chrome tracing alters timing; this is not a product performance baseline.",
      "Raw stack instruction pointers are not symbolized and do not identify functions or modules.",
      "StackWalk coverage is reported as observed; missing stack records are not inferred from CSwitch events.",
      "Raw CSwitch state/wait values remain numeric and are not interpreted as a specific wait object or driver cause.",
      "An off-CPU interval plus coincident DxgKrnl events does not by itself prove GPU engine execution or causal blocking.",
    ],
  };
  const output = outputPath ? path.resolve(outputPath) : path.join(root, "stack-analysis.json");
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  return { output, result };
}

async function main() {
  const [, , root, output] = process.argv;
  if (!root || process.argv.length > 4) {
    throw new Error("Usage: node scripts/e2-etw-stack-analysis.cjs <capture directory> [new output.json]");
  }
  const { output: reportPath, result } = await analyze(root, output);
  process.stdout.write(`${JSON.stringify({
    kind: result.kind,
    reportPath,
    lostEvents: result.lostEvents,
    gpu: result.gpu,
    targetSwitchCount: result.targetSwitchCount,
    targetReadinessEventCount: result.targetReadinessEventCount,
    targetStackWalkCount: result.targetStackWalkCount,
    targetStackWalkMatchedCount: result.targetStackWalkMatchedCount,
    dxgKrnlEventsOnTargetThread: result.dxgKrnlEventsOnTargetThread,
    windows: result.windows.map((window) => ({
      durationMs: window.frame.duration,
      scheduler: window.scheduler,
      observedReadiness: window.observedReadiness,
      stackWalks: {
        candidateStackWalkCount: window.stackWalks.candidateStackWalkCount,
        matchedStackWalkCount: window.stackWalks.matchedStackWalkCount,
        switchOutStacksByRawState: window.stackWalks.switchOutStacksByRawState,
      },
      flushMs: window.longestEndRasterFlush?.wallMs ?? null,
      flushScheduler: window.longestEndRasterFlush?.scheduler ?? null,
      flushStackWalks: {
        candidateStackWalkCount: window.longestEndRasterFlush?.stackWalks.candidateStackWalkCount ?? 0,
        matchedStackWalkCount: window.longestEndRasterFlush?.stackWalks.matchedStackWalkCount ?? 0,
        switchOutStacksByRawState: window.longestEndRasterFlush?.stackWalks.switchOutStacksByRawState ?? {},
      },
    })),
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { analyze };
