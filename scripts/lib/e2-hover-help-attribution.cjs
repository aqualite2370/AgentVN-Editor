"use strict";

function getHoverHelpAttributionMode(value, scope = {}) {
  if (value === undefined || value === "0") {
    return { enabled: false, mode: "product-default" };
  }
  if (value !== "disabled") {
    throw new Error('Hover-help attribution mode must be "disabled" or 0.');
  }

  const checks = {
    diagnosticOnly: scope.diagnosticOnly === true,
    isolated: scope.isolated === true,
    headful: scope.headful === true,
    hardwareGpu: scope.hardwareGpu === true,
    productionPreview: scope.productionPreview === true,
    cold: scope.cold === true,
    target: scope.target === "layout",
    viewport: scope.viewport === "4k",
    dpr: Number(scope.dpr) === 1,
    repeats: Number(scope.repeats) === 1,
    lowIntrusion: scope.lowIntrusion === true,
    trace: typeof scope.trace === "boolean",
    profiler: scope.profiler === false,
  };
  const failures = Object.keys(checks).filter((key) => !checks[key]);
  if (failures.length) {
    throw new Error(`Hover-help attribution scope rejected: ${failures.join(", ")}`);
  }

  return {
    enabled: true,
    mode: "disabled-for-attribution-not-acceptance",
    presentationChanged: true,
    performanceAcceptance: false,
  };
}

function summarizeHoverHelpTimeline(events = []) {
  const valid = events.filter((event) =>
    event
    && ["animationstart", "animationend", "animationcancel"].includes(event.type)
    && typeof event.animationName === "string"
    && Number.isFinite(event.timeMs)
    && ["hover-card-fade-in", "hover-card-fade-out", "hover-help-copy-fill"].includes(event.animationName));
  return {
    eventCount: valid.length,
    firstEventMs: valid.length ? Math.min(...valid.map((event) => event.timeMs)) : null,
    animationNames: [...new Set(valid.map((event) => event.animationName))],
    events: valid.map(({ type, animationName, timeMs }) => ({ type, animationName, timeMs })),
  };
}

module.exports = {
  getHoverHelpAttributionMode,
  summarizeHoverHelpTimeline,
};
