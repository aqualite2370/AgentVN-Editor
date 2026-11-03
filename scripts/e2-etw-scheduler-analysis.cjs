const fs = require("node:fs");
const path = require("node:path");
const {
  decodeCSwitchPayload,
  xmlTimestampDeltaMs,
  summarizeThreadSwitches,
  splitOffCpuByObservedReady,
  classifyThreadCpuMetricComparison,
} = require("./lib/e2-etw-cswitch.cjs");

function analyze(rootArg) {
  const root = path.resolve(rootArg);
  const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const diagnosticPath = path.join(root, "audit", "performance-diagnostic-only.json");
  const collection = readJson(path.join(root, "collection-report.json"));
  if (!collection.isElevated || collection.wprStartExitCode !== 0 || collection.wprStopExitCode !== 0) {
    throw new Error("An elevated, successfully stopped capture is required");
  }
  const summaryPath = path.join(root, "trace-summary-best-effort.txt");
  const summaryText = fs.readFileSync(summaryPath, "utf8");
  const lostMatch = summaryText.match(/Total Events\s+Lost\s+(\d+)/);
  if (!lostMatch || Number(lostMatch[1]) !== 0) throw new Error("A verified zero-loss ETW summary is required");
  const report = readJson(diagnosticPath);
  const trial = report.diagnosticResults?.[0]?.trials?.find((t) => t.mode === "low-intrusion" && t.repeat === 1);
  if (!trial?.traceSummary?.rawTracePath || !trial?.browserClockAnchor) {
    throw new Error("The capture lacks aligned Chrome trace/clock evidence");
  }
  const trace = readJson(trial.traceSummary.rawTracePath);
  const gpuThreads = trace.traceEvents.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrGpuMain");
  if (gpuThreads.length !== 1) throw new Error("Exactly one Chrome GPU main thread is required");
  const gpu = gpuThreads[0];

  const csvPath = path.join(root, "events.csv");
  const xmlPath = path.join(root, "events-best-effort.xml");
  const csv = fs.readFileSync(csvPath, "utf8");
  const xml = fs.readFileSync(xmlPath, "utf8");
  const csvHeader = csv.split(/\r?\n/, 2)[1]?.split(",").map((s) => s.trim());
  const firstXml = xml.match(/<Event\b[\s\S]*?<\/Event>/)?.[0];
  if (csvHeader?.[0] !== "EventTrace" || csvHeader[1] !== "Header"
      || !firstXml?.includes("{68fdd900-4a3e-11d1-84f4-0000f80464e3}")) {
    throw new Error("The XML/CSV header anchor pair could not be verified");
  }
  const xmlAnchor = firstXml.match(/SystemTime="([^"]+)"/)?.[1];
  if (!xmlAnchor || !/^\d+$/.test(csvHeader[16])) throw new Error("Invalid XML/CSV clock anchors");
  const filetimeToEpoch = (value) => Number(BigInt(value) - 116444736000000000n) / 10000;
  const epochAnchorMs = filetimeToEpoch(csvHeader[16]);
  const csvGpuEvents = [];
  for (const line of csv.split(/\r?\n/)) {
    const columns = line.split(",").map((s) => s.trim());
    if (columns[0] !== "Microsoft-Windows-DxgKrnl") continue;
    if (Number(columns[9]) !== gpu.pid || Number(columns[10]) !== gpu.tid) continue;
    csvGpuEvents.push({
      id: Number(columns[2]), opcode: Number(columns[6]), epochMs: filetimeToEpoch(columns[16]),
    });
  }
  if (csvGpuEvents.length < 2) throw new Error("No usable DxgKrnl events were found for the Chrome GPU main thread");
  const switches = [];
  const readinessEvents = [];
  const xmlGpuEvents = [];
  let decodedSwitchCount = 0;
  const switchVersions = new Set();
  for (const match of xml.matchAll(/<Event\b[\s\S]*?<\/Event>/g)) {
    const event = match[0];
    const timestamp = event.match(/SystemTime="([^"]+)"/)?.[1];
    if (!timestamp) continue;
    const time = epochAnchorMs + xmlTimestampDeltaMs(timestamp, xmlAnchor);
    if (event.includes("{3d6fa8d1-fe05-11d0-9dda-00c04fd7ba7c}")
        && event.includes("<Opcode>ReadyThread</Opcode>")) {
      const threadId = event.match(/<Data Name="TThreadId">0x([a-f\d]+)<\/Data>/i)?.[1];
      if (threadId) {
        const awakenedThreadId = Number.parseInt(threadId, 16);
        if (awakenedThreadId === gpu.tid) readinessEvents.push({ time, awakenedThreadId });
      }
    } else if (event.includes("{3d6fa8d1-fe05-11d0-9dda-00c04fd7ba7c}") && event.includes("<Opcode>36</Opcode>")) {
      const version = Number(event.match(/<Version>(\d+)<\/Version>/)?.[1]);
      const hex = event.match(/<BinaryEventData>([a-f\d]+)<\/BinaryEventData>/i)?.[1];
      const decoded = decodeCSwitchPayload(hex, version);
      decodedSwitchCount++;
      switchVersions.add(version);
      if (decoded.newThreadId === gpu.tid || decoded.oldThreadId === gpu.tid) {
        switches.push({ time, ...decoded });
      }
    } else if (event.includes('Name="Microsoft-Windows-DxgKrnl"')
        && event.includes(`ProcessID="${gpu.pid}"`) && event.includes(`ThreadID="${gpu.tid}"`)) {
      xmlGpuEvents.push({
        id: Number(event.match(/<EventID[^>]*>(\d+)<\/EventID>/)?.[1]),
        opcode: Number(event.match(/<Opcode>(\d+)<\/Opcode>/)?.[1]), epochMs: time,
      });
    }
  }
  // Check both ends against independent FILETIME values. The CSV exporter may
  // omit unsupported event payloads, so use ID/opcode/time, not event counts.
  const clockChecks = [csvGpuEvents[0], csvGpuEvents[csvGpuEvents.length - 1]].map((event) => {
    const matches = xmlGpuEvents.filter((candidate) => candidate.id === event.id && candidate.opcode === event.opcode);
    const errorMs = Math.min(...matches.map((candidate) => Math.abs(candidate.epochMs - event.epochMs)));
    if (!Number.isFinite(errorMs) || errorMs > 0.002) throw new Error("XML/FILETIME clock cross-check failed");
    return { id: event.id, opcode: event.opcode, epochMs: event.epochMs, errorMs };
  });
  if (!decodedSwitchCount || !switches.length) throw new Error("No CSwitch events were decoded for the GPU main thread");
  const originUs = trial.traceSummary.traceClockAlignment?.traceOriginUs;
  const timeOrigin = trial.browserClockAnchor.timeOriginEpochMs;
  if (!Number.isFinite(originUs) || !Number.isFinite(timeOrigin)) throw new Error("Chrome clock origin is invalid");
  const chromeEpochMs = (event) => timeOrigin + (event.ts - originUs) / 1000;
  const windows = (trial.longAnimationFrames ?? []).map((frame) => {
    const start = timeOrigin + frame.startTime;
    const end = start + frame.duration;
    const frameScheduler = summarizeThreadSwitches(switches, gpu.tid, start, end);
    const longest = trace.traceEvents.filter((e) => e.ph === "X" && e.pid === gpu.pid && e.tid === gpu.tid
      && e.name === "RasterDecoderImpl::DoEndRasterCHROMIUM::Flush"
      && chromeEpochMs(e) < end && chromeEpochMs(e) + e.dur / 1000 > start)
      .sort((a, b) => b.dur - a.dur)[0];
    const flushScheduler = longest ? summarizeThreadSwitches(switches, gpu.tid,
      chromeEpochMs(longest), chromeEpochMs(longest) + longest.dur / 1000) : null;
    const frameReadiness = splitOffCpuByObservedReady(switches, readinessEvents, gpu.tid, start, end);
    const traceCpuMs = longest && Number.isFinite(longest.tdur) ? longest.tdur / 1000 : null;
    return {
      frame,
      scheduler: frameScheduler,
      observedReadiness: frameReadiness,
      longestEndRasterFlush: longest ? {
        startEpochMs: chromeEpochMs(longest), wallMs: longest.dur / 1000,
        traceThreadCpuMs: traceCpuMs,
        scheduler: flushScheduler,
        observedReadiness: splitOffCpuByObservedReady(switches, readinessEvents, gpu.tid,
          chromeEpochMs(longest), chromeEpochMs(longest) + longest.dur / 1000),
        cpuCrossCheck: classifyThreadCpuMetricComparison(traceCpuMs, flushScheduler.runningMs),
      } : null,
    };
  });
  return {
    kind: "e2-etw-scheduler-diagnostic-not-acceptance", root, diagnosticPath,
    lostEvents: 0, gpu: { pid: gpu.pid, tid: gpu.tid }, decodedSwitchCount,
    switchVersions: [...switchVersions], targetSwitchCount: switches.length,
    targetReadinessEventCount: readinessEvents.length,
    clock: { xmlAnchor, csvAnchorFiletime: csvHeader[16], epochAnchorMs, clockChecks },
    dxgKrnlEventsOnTargetThread: csvGpuEvents.length,
    windows,
    limitations: [
      "ETW plus Chrome tracing alters timing; this is not a product performance baseline.",
      "On-CPU wall time includes interrupts and is not identical to thread CPU time.",
      "An off-CPU interval alone does not identify its wait object, GPU engine work, or driver cause.",
      "Raw CSwitch state/wait fields are retained; no unverified version-specific wait names are inferred.",
      "Chrome Windows x64 ThreadTicks is a cycle-derived CPU-time estimate guarded by the constant-rate TSC capability check; compare with ETW scheduled-on-CPU wall only diagnostically and review any material positive delta.",
    ],
  };
}

try {
  const [, , root, output] = process.argv;
  if (!root || process.argv.length > 4) throw new Error("Usage: node scripts/e2-etw-scheduler-analysis.cjs <capture directory> [new output.json]");
  const result = analyze(root);
  const text = JSON.stringify(result, null, 2) + "\n";
  if (output) fs.writeFileSync(path.resolve(output), text, { flag: "wx" });
  process.stdout.write(text);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
