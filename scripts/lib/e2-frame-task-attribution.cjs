"use strict";

function inspectFrameTrace({ events, marker, interactionStartMs, frames }) {
  if (!Array.isArray(events) || !Number.isFinite(marker?.ts)
    || !Number.isInteger(marker.pid) || !Number.isInteger(marker.tid)
    || !Number.isFinite(interactionStartMs)) throw new Error("valid trace/performance clock required");
  if (!Array.isArray(frames)) throw new Error("frame evidence array required");
  const offsetUs = marker.ts - interactionStartMs * 1000;
  const completeSlices = events.filter(event => event.ph === "X"
    && Number.isFinite(event.ts) && Number.isFinite(event.dur) && event.dur > 0);
  const main = completeSlices.filter(event => event.pid === marker.pid && event.tid === marker.tid);
  const describe = event => ({
    name: event.name, pid: event.pid, tid: event.tid,
    traceStartUs: event.ts, durationMs: event.dur / 1000,
    threadDurationMs: Number.isFinite(event.tdur) ? event.tdur / 1000 : null,
    args: event.args,
  });
  return {
    clock: { offsetUs, markerUs: marker.ts, interactionStartMs, pid: marker.pid, tid: marker.tid },
    interpretation: "Nested wall slices overlap. Other-thread overlap does not establish a dependency. Task coverage uses a clipped interval union, not a duration sum.",
    mainThreadEventCount: main.length,
    mainThreadNames: main.reduce((counts, event) => {
      counts[event.name] = (counts[event.name] || 0) + 1;
      return counts;
    }, {}),
    frames: frames.map(frame => {
      if (!Number.isFinite(frame.startTime) || !Number.isFinite(frame.duration) || frame.duration < 0)
        throw new Error("valid frame timestamps required");
      const start = offsetUs + frame.startTime * 1000;
      const end = start + frame.duration * 1000;
      const overlaps = event => event.ts < end && event.ts + event.dur > start;
      const mainSlices = main.filter(overlaps);
      const tasks = mainSlices.filter(event => event.name === "ThreadControllerImpl::RunTask");
      const intervals = tasks.map(event => [Math.max(start, event.ts), Math.min(end, event.ts + event.dur)])
        .sort((a, b) => a[0] - b[0]);
      let covered = 0, cursor = start;
      for (const [left, right] of intervals) {
        covered += Math.max(0, right - Math.max(left, cursor));
        cursor = Math.max(cursor, right);
      }
      return {
        performanceFrame: frame, traceStartUs: start, traceEndUs: end,
        traceRenderUs: Number.isFinite(frame.renderStart) && frame.renderStart > 0
          ? offsetUs + frame.renderStart * 1000 : null,
        mainTaskCount: tasks.length, mainTaskCoverageMs: covered / 1000,
        mainSlices: mainSlices.sort((a, b) => b.dur - a.dur).slice(0, 24).map(describe),
        otherThreadSlices: completeSlices.filter(event => overlaps(event)
          && (event.pid !== marker.pid || event.tid !== marker.tid))
          .sort((a, b) => b.dur - a.dur).slice(0, 24).map(describe),
      };
    }),
  };
}
module.exports = { inspectFrameTrace };
