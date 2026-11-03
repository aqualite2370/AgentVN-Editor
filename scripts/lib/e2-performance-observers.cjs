"use strict";

// Serialized directly into Chromium by Playwright. Keep this function
// self-contained; these are the audit's actual observer consumers.
function installPerformanceObservers() {
  const state = window.__advancedLayoutTransitionAudit;
  if (!state) throw new Error("Performance audit state missing");
  const overlapsStart = entry => Number.isFinite(entry.startTime)
    && Number.isFinite(entry.duration)
    && (entry.duration === 0 ? entry.startTime >= state.start
      : entry.startTime + Math.max(0, entry.duration) > state.start);
  const consumeTasks = entries => {
    for (const entry of entries) {
      state.onRawPerformanceEntry?.("longtask", entry);
      if (overlapsStart(entry)) {
        state.longTasks.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration });
      }
    }
  };
  const consumeFrames = entries => {
    for (const entry of entries) {
      state.onRawPerformanceEntry?.("long-animation-frame", entry);
      if (overlapsStart(entry)) {
        state.longAnimationFrames.push({
          startTime: entry.startTime, duration: entry.duration, blockingDuration: entry.blockingDuration,
          renderStart: entry.renderStart, styleAndLayoutStart: entry.styleAndLayoutStart,
          scripts: Array.from(entry.scripts ?? []).slice(0, 8).map(script => ({
            invoker: script.invoker, invokerType: script.invokerType, sourceURL: script.sourceURL,
            sourceFunctionName: script.sourceFunctionName, sourceCharPosition: script.sourceCharPosition,
            duration: script.duration, executionStart: script.executionStart,
            forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
          })),
        });
      }
    }
  };
  try {
    state.observer = new PerformanceObserver(list => consumeTasks(list.getEntries()));
    state.observer.observe({ entryTypes: ["longtask"] });
  } catch { state.observer = null; }
  try {
    if (PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
      state.longAnimationFrameObserver = new PerformanceObserver(list => consumeFrames(list.getEntries()));
      state.longAnimationFrameObserver.observe({ type: "long-animation-frame", buffered: false });
      state.longAnimationFrameSupported = true;
    }
  } catch { state.longAnimationFrameObserver = null; }
  state.drainPerformanceObservers = () => {
    consumeTasks(state.observer?.takeRecords() ?? []);
    consumeFrames(state.longAnimationFrameObserver?.takeRecords() ?? []);
  };
}

// Capture the endpoint before waiting for the current presentation frame to
// finish. RAFs alone do not guarantee LoAF delivery. If a real long task
// has been delivered but its overlapping frame has not, wait for that
// evidence instead of reporting zero. The timeout is a collection failure,
// not a fixed settling delay, and never extends the measured interval.
async function finishPerformanceObservation() {
  const state = window.__advancedLayoutTransitionAudit;
  if (state.observationFailure) throw new Error(state.observationFailure);
  if (state.observationEnd == null) {
    state.observationEnd = performance.now();
    state.running = false;
    state.onObservationEnd?.(state.observationEnd);
  }
  const end = state.observationEnd;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  state.drainPerformanceObservers();
  const pendingTasks = () => state.longTasks.filter(task =>
    task.startTime < end && task.startTime + task.duration > state.start
    && !state.longAnimationFrames.some(frame => frame.startTime < task.startTime + task.duration
      && frame.startTime + frame.duration > task.startTime));
  const pendingAtStop = state.longAnimationFrameSupported ? pendingTasks().length : 0;
  if (pendingAtStop) {
    await new Promise((resolve, reject) => {
      let raf;
      const deadline = setTimeout(() => {
        cancelAnimationFrame(raf);
        state.observationFailure = "Performance collection incomplete: delivered long task has no overlapping LoAF";
        reject(new Error(state.observationFailure));
      }, 10_000);
      const collect = () => {
        state.drainPerformanceObservers();
        if (!pendingTasks().length) {
          clearTimeout(deadline);
          resolve();
        } else raf = requestAnimationFrame(collect);
      };
      raf = requestAnimationFrame(collect);
    });
  }
  return { end, deliveredAt: performance.now(), pendingTasksAtStop: pendingAtStop };
}

module.exports = { installPerformanceObservers, finishPerformanceObservation };
