"use strict";

// Serialized into Chromium. Events only: no style reads or per-frame DOM work.
function installMeasurementVisibilityTracking() {
  const state = window.__advancedLayoutTransitionAudit;
  if (!state) throw new Error("measurement state missing");
  state.stopVisibilityTracking?.();
  state.visibilitySamples = [];
  state.samplePageVisibility = phase => {
    const sample = { phase, at: performance.now(), visibilityState: document.visibilityState,
      hidden: document.hidden, hasFocus: document.hasFocus() };
    state.visibilitySamples.push(sample);
    return sample;
  };
  const visibility = () => { if (state.running) state.samplePageVisibility("visibilitychange"); };
  const focus = () => { if (state.running) state.samplePageVisibility("focus"); };
  const blur = () => { if (state.running) state.samplePageVisibility("blur"); };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", focus);
  window.addEventListener("blur", blur);
  state.stopVisibilityTracking = () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("focus", focus);
    window.removeEventListener("blur", blur);
  };
  return { kind: "event-only-page-visibility-provenance", installed: true };
}

function getMeasurementVisibilityFailures(samples, { inputRequired = false, windowStates } = {}) {
  if (!Array.isArray(samples) || !samples.length) return ["missing page visibility evidence"];
  const failures = [];
  for (const phase of ["start", ...(inputRequired ? ["input"] : []), "end"]) {
    if (samples.filter(sample => sample.phase === phase).length !== 1)
      failures.push(`requires exactly one visibility ${phase}`);
  }
  if (samples[0].phase !== "start" || samples.at(-1).phase !== "end")
    failures.push("page visibility window boundaries invalid");
  let previous = -Infinity;
  for (const sample of samples) {
    if (!Number.isFinite(sample.at) || sample.at < previous) failures.push("invalid visibility timestamp order");
    previous = sample.at;
    if (sample.hidden !== false || sample.visibilityState !== "visible")
      failures.push(`page hidden during ${sample.phase}`);
    if (typeof sample.hasFocus !== "boolean") failures.push("missing actual page focus state");
  }
  if (windowStates !== undefined) {
    if (!Array.isArray(windowStates) || !windowStates.length) failures.push("missing native window evidence");
    else for (const sample of windowStates) {
      if (!Number.isInteger(sample.windowId)
        || !["normal", "minimized", "maximized", "fullscreen"].includes(sample.bounds?.windowState))
        failures.push("invalid native window evidence");
      else if (sample.bounds.windowState === "minimized")
        failures.push(`native window minimized during ${sample.phase}`);
    }
  }
  // Focus is reported independently: a visible but unfocused window is not
  // automatically hidden. Native occlusion is not proven by this API.
  return [...new Set(failures)];
}

module.exports = { installMeasurementVisibilityTracking, getMeasurementVisibilityFailures };
