const RASTER_FLUSH_NAMES = new Set([
  "RasterDecoderImpl::DoEndRasterCHROMIUM::Flush",
  "RasterDecoderImpl::DoEndRasterCHROMIUM",
]);
const RASTER_COMMAND_NAMES = new Set([
  "RasterDecoderImpl::DoRasterCHROMIUM",
]);

function summarizeTraceLoafWindows({
  traceOriginUs,
  longAnimationFrames = [],
  traceEvents = [],
} = {}) {
  const originUs = Number(traceOriginUs);
  if (!Number.isFinite(originUs)) {
    return { ok: false, failures: ["trace clock origin is missing or invalid"], frames: [] };
  }

  const failures = [];
  const processNames = new Map();
  const threadNames = new Map();
  for (const event of Array.isArray(traceEvents) ? traceEvents : []) {
    if (event?.ph !== "M") continue;
    if (event.name === "process_name" && event.args?.name != null) {
      processNames.set(String(event.pid), String(event.args.name));
    } else if (event.name === "thread_name" && event.args?.name != null) {
      threadNames.set(`${String(event.pid)}:${String(event.tid)}`, String(event.args.name));
    }
  }

  const intervals = (Array.isArray(traceEvents) ? traceEvents : [])
    .filter((event) => event?.ph === "X")
    .map((event) => ({
      event,
      startUs: Number(event?.ts),
      durationUs: Number(event?.dur),
    }))
    .filter((entry) => Number.isFinite(entry.startUs)
      && Number.isFinite(entry.durationUs)
      && entry.durationUs >= 0);

  const frames = [];
  for (const [index, frame] of (Array.isArray(longAnimationFrames) ? longAnimationFrames : []).entries()) {
    const startTime = Number(frame?.startTime);
    const duration = Number(frame?.duration);
    if (!Number.isFinite(startTime) || startTime < 0
      || !Number.isFinite(duration) || duration <= 0) {
      failures.push(`LoAF ${index} has an invalid start time or duration`);
      continue;
    }
    const endTime = startTime + duration;
    const startUs = originUs + startTime * 1000;
    const endUs = originUs + endTime * 1000;

    const gpuTasks = intervals
      .filter(({ event, startUs: eventStartUs, durationUs }) => (
        event.name === "GPUTask"
        && eventStartUs < endUs
        && eventStartUs + durationUs > startUs
      ))
      .map(({ event, startUs: eventStartUs, durationUs }) => {
        const taskEndUs = eventStartUs + durationUs;
        const nested = intervals.filter((candidate) => {
          const candidateEndUs = candidate.startUs + candidate.durationUs;
          return String(candidate.event.pid) === String(event.pid)
            && String(candidate.event.tid) === String(event.tid)
            && candidate.startUs >= eventStartUs
            && candidateEndUs <= taskEndUs
            && candidate.event.ph === "X";
        });
        const nestedRasterFlushes = nested
          .filter(({ event: candidate }) => RASTER_FLUSH_NAMES.has(candidate.name))
          .map(({ event: candidate, startUs: candidateStartUs, durationUs: candidateDurationUs }) => ({
            name: String(candidate.name),
            startTime: (candidateStartUs - originUs) / 1000,
            durationMs: candidateDurationUs / 1000,
            threadCpuMs: Number.isFinite(Number(candidate.tdur)) ? Number(candidate.tdur) / 1000 : null,
          }))
          .sort((left, right) => left.startTime - right.startTime);
        const nestedRasterCommands = nested
          .filter(({ event: candidate }) => RASTER_COMMAND_NAMES.has(candidate.name))
          .map(({ event: candidate, startUs: candidateStartUs, durationUs: candidateDurationUs }) => ({
            name: String(candidate.name),
            startTime: (candidateStartUs - originUs) / 1000,
            durationMs: candidateDurationUs / 1000,
            rasterId: candidate.args?.data?.raster_id ?? candidate.args?.raster_id ?? null,
          }))
          .sort((left, right) => left.startTime - right.startTime);
        const taskStartTime = (eventStartUs - originUs) / 1000;
        const taskEndTime = (taskEndUs - originUs) / 1000;
        return {
          name: String(event.name),
          processName: processNames.get(String(event.pid)) ?? "",
          threadName: threadNames.get(`${String(event.pid)}:${String(event.tid)}`) ?? "",
          startTime: taskStartTime,
          endTime: taskEndTime,
          durationMs: durationUs / 1000,
          threadCpuMs: Number.isFinite(Number(event.tdur)) ? Number(event.tdur) / 1000 : null,
          overlapMs: Math.max(0, Math.min(taskEndTime, endTime) - Math.max(taskStartTime, startTime)),
          nestedRasterFlushes,
          nestedRasterCommands,
        };
      })
      .sort((left, right) => left.startTime - right.startTime);

    const compositorFrameStates = (Array.isArray(traceEvents) ? traceEvents : [])
      .filter((event) => (
        event.name === "PipelineReporter"
        && event.ph === "b"
        && Number.isFinite(Number(event.ts))
        && Number(event.ts) >= startUs
        && Number(event.ts) <= endUs
        && event.args?.frame_reporter
      ))
      .map((event) => ({
        frameSequence: Number(event.args.frame_reporter.frame_sequence),
        state: String(event.args.frame_reporter.state ?? ""),
        frameType: String(event.args.frame_reporter.frame_type ?? "NORMAL"),
        time: (Number(event.ts) - originUs) / 1000,
      }))
      .filter((entry) => Number.isFinite(entry.frameSequence))
      .sort((left, right) => left.time - right.time);

    frames.push({
      startTime,
      endTime,
      durationMs: duration,
      gpuTasks,
      compositorFrameStates,
    });
  }

  return { ok: failures.length === 0, failures, frames };
}

module.exports = { summarizeTraceLoafWindows };
