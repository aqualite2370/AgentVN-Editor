"use strict";
const { extractBrowserSwitches } = require("./e2-raster-backend-diagnostic.cjs");
const HISTOGRAM = "Gpu.GrShaderCacheLoadHitInCache";

function getShaderCacheEvidenceEnabled(value, scope = {}) {
  if (value === undefined || value === "0") return false;
  if (value !== "1") throw new Error("Shader-cache evidence flag must be 0 or 1.");
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
    repeats: Number(scope.repeats) === (scope.reusePair === true ? 2 : 1),
    lowIntrusion: scope.lowIntrusion === true,
    trace: scope.trace !== true,
    profiler: scope.profiler !== true,
    presentationChanged: scope.presentationChanged !== true,
  };
  const failures = Object.keys(checks).filter(key => !checks[key]);
  if (failures.length) throw new Error(`Shader-cache evidence scope rejected: ${failures.join(", ")}`);
  return true;
}

function validateShaderCacheLaunch(evidence = {}) {
  const failures = [];
  const browserArguments = extractBrowserSwitches(evidence.browserCommandLine);
  if (!evidence.browserCommandLine?.trim()) failures.push("actual browser command line is absent");
  for (const arg of browserArguments) {
    if (["--disable-gpu", "--disable-gpu-rasterization", "--disable-gpu-shader-disk-cache"].includes(arg)
      || /^--use-angle=(swiftshader|swiftshader-webgl|warp)$/.test(arg)) {
      failures.push(`non-default GPU/cache launch argument: ${arg}`);
    }
  }
  for (const feature of ["gpu_compositing", "rasterization"]) {
    if (evidence.gpuFeatureStatus?.[feature] !== "enabled")
      failures.push(`${feature} is not confirmed enabled`);
  }
  return { valid: failures.length === 0, failures, browserArguments };
}

async function captureShaderCacheSnapshot(session) {
  const requestedAt = new Date().toISOString();
  try {
    const result = await session.send("Browser.getHistograms", { query: HISTOGRAM, delta: false });
    return {
      supported: true, requestedAt, receivedAt: new Date().toISOString(),
      histograms: (result.histograms ?? []).filter(item => item.name === HISTOGRAM).map(item => ({
        name: item.name, count: item.count, sum: item.sum,
        buckets: (item.buckets ?? []).map(bucket => ({
          low: bucket.low, high: bucket.high, count: bucket.count,
        })),
      })),
    };
  } catch (error) {
    return {
      supported: false, requestedAt, receivedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readBooleanHistogram(histogram) {
  if (!Number.isSafeInteger(histogram.count) || histogram.count < 0
    || !Number.isSafeInteger(histogram.sum) || histogram.sum < 0
    || !Array.isArray(histogram.buckets)) return null;
  let misses = 0, hits = 0;
  for (const bucket of histogram.buckets) {
    if (!Number.isSafeInteger(bucket.count) || bucket.count < 0) return null;
    if (bucket.low === 0 && bucket.high === 1) misses += bucket.count;
    else if (bucket.low === 1 && bucket.high === 2) hits += bucket.count;
    else if (bucket.count !== 0) return null;
  }
  if (misses + hits !== histogram.count || hits !== histogram.sum) return null;
  return { misses, hits };
}

function summarizeShaderCacheDelta(before, after) {
  const limitation = "Counters are browser-global; they cannot attribute a miss to one DOM layer or prove compilation duration. Child-process reporting may lag.";
  const base = { histogram: HISTOGRAM, limitation };
  if (!before?.supported || !after?.supported)
    return { ...base, status: "unavailable", reason: "CDP histogram capture unavailable" };
  const initial = before.histograms?.find(item => item.name === HISTOGRAM);
  const final = after.histograms?.find(item => item.name === HISTOGRAM);
  if (!final) return { ...base, status: "unavailable", reason: "Histogram was not exposed; absence is not zero misses" };
  const initialValues = initial ? readBooleanHistogram(initial) : { misses: 0, hits: 0 };
  const finalValues = readBooleanHistogram(final);
  if (!initialValues || !finalValues)
    return { ...base, status: "invalid", reason: "Malformed or inconsistent boolean histogram" };
  const cacheMisses = finalValues.misses - initialValues.misses;
  const cacheHits = finalValues.hits - initialValues.hits;
  if (cacheMisses < 0 || cacheHits < 0)
    return { ...base, status: "invalid", reason: "Counters regressed; process reset cannot be treated as a delta" };
  return {
    ...base, status: "available", baselineNotProducedYet: !initial,
    cacheMisses, cacheHits, totalLoads: cacheMisses + cacheHits,
  };
}

function getShaderTraceEnabled(value, scope = {}) {
  if (value === undefined || value === "0") return false;
  if (value !== "1") throw new Error("Shader trace flag must be 0 or 1.");
  const checks = {
    diagnosticOnly: scope.diagnosticOnly === true,
    isolated: scope.isolated === true,
    headful: scope.headful === true,
    hardwareGpu: scope.hardwareGpu === true,
    productionPreview: scope.productionPreview === true,
    cold: scope.cold === true,
    target: scope.target === "layout",
    viewport: ["1080p", "1440p", "4k"].includes(scope.viewport),
    dpr: Number(scope.dpr) === 1,
    repeats: Number(scope.repeats) === (scope.reusePair === true ? 2 : 1),
    lowIntrusion: scope.lowIntrusion === true,
    trace: scope.trace === true,
    rendererTrace: scope.rendererTrace === true,
    profiler: scope.profiler === false,
    presentationChanged: scope.presentationChanged === false,
  };
  const failures = Object.keys(checks).filter(key => !checks[key]);
  if (failures.length) throw new Error(`Shader trace scope rejected: ${failures.join(", ")}`);
  return true;
}

function getShaderAttributionTraceMode(value, scope = {}) {
  if (value === undefined || value === "0") return { enabled: false };
  if (value !== "1") throw new Error("Shader attribution flag must be 0 or 1.");
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
    trace: scope.trace === true,
    rendererTrace: scope.rendererTrace === true,
    profiler: scope.profiler === false,
    control: Object.hasOwn(SHADER_ATTRIBUTION_CONTROLS, scope.control),
    controlCount: Number(scope.controlCount) === 1,
  };
  const failures = Object.keys(checks).filter(key => !checks[key]);
  if (failures.length) throw new Error(`Shader attribution scope rejected: ${failures.join(", ")}`);
  return {
    enabled: true,
    kind: "single-control-shader-attribution-not-acceptance",
    control: scope.control,
    performanceAcceptance: false,
  };
}

function getShaderDriverTraceArgs(value, shaderTraceEnabled) {
  if (value === undefined || value === "0") return [];
  if (value !== "1") throw new Error("GL driver trace flag must be 0 or 1.");
  if (!shaderTraceEnabled) throw new Error("GL driver tracing requires the bounded shader trace diagnostic.");
  return ["--enable-gpu-service-tracing"];
}

const SHADER_EVENTS = new Set([
  "shader_compile", "cache_hit", "cache_miss", "driver_link_program",
  "driver_compile_shader",
]);
const DRIVER_SHADER_EVENTS = new Set([
  "TraceGLAPI::glCompileShader", "TraceGLAPI::glGetShaderiv",
  "TraceGLAPI::glLinkProgram", "TraceGLAPI::glGetProgramiv",
  "TraceGLAPI::glProgramBinary", "TraceGLAPI::glGetProgramBinary",
]);
const SHADER_ATTRIBUTION_CONTROLS = Object.freeze({
  "layout-sidebar-backdrop-filter-disabled": {
    kind: "backdrop-filter",
    selector: ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) "
      + '.advanced-tab-content.is-active[data-tab="layout"] '
      + ".runtime-layout-sidebar .liquid-glass-adapter",
    declarations: "backdrop-filter:none!important;-webkit-backdrop-filter:none!important",
  },
  "layout-sidebar-glass-warp-backdrop-filter-disabled": {
    kind: "backdrop-filter",
    selector: ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) "
      + '.advanced-tab-content.is-active[data-tab="layout"] '
      + ".runtime-layout-sidebar .liquid-glass-adapter .glass__warp",
    declarations: "backdrop-filter:none!important;-webkit-backdrop-filter:none!important",
  },
  "layout-active-glass-warp-backdrop-filter-disabled": {
    kind: "backdrop-filter",
    selector: ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) "
      + '.advanced-tab-content.is-active[data-tab="layout"] '
      + ".glass__warp",
    declarations: "backdrop-filter:none!important;-webkit-backdrop-filter:none!important",
  },
  "quick-menu-preview-backdrop-filter-disabled": {
    kind: "backdrop-filter",
    selector: ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) "
      + '.advanced-tab-content.is-active[data-tab="layout"] '
      + ".runtime-layout-stage .preview-quick-menu-toggle, "
      + ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) "
      + '.advanced-tab-content.is-active[data-tab="layout"] '
      + ".runtime-layout-stage .preview-quick-menu-button",
    declarations: "backdrop-filter:none!important;-webkit-backdrop-filter:none!important",
  },
  "editor-flow-canvas-filter-disabled": {
    kind: "filter",
    selector: ".editor-workspace > .flow-surface",
    declarations: "filter:none!important",
  },
  "editor-toolbar-backdrop-filter-disabled": {
    kind: "backdrop-filter",
    selector: ".editor-shell .editor-toolbar",
    declarations: "backdrop-filter:none!important;-webkit-backdrop-filter:none!important",
  },
});

function getShaderAttributionControl(control) {
  const entry = SHADER_ATTRIBUTION_CONTROLS[control];
  if (!entry) throw new Error("Unsupported shader attribution control.");
  return { control, ...entry };
}

function unionDurationUs(events) {
  const intervals = events.map(event => [event.ts, event.ts + event.dur])
    .sort((left, right) => left[0] - right[0]);
  let total = 0, end = -Infinity;
  for (const [start, nextEnd] of intervals) {
    total += Math.max(0, nextEnd - Math.max(start, end));
    end = Math.max(end, nextEnd);
  }
  return total;
}
function summarizeShaderTrace(events = []) {
  const validInterval = event => event.ph === "X"
    && Number.isFinite(event.ts) && Number.isFinite(event.dur) && event.dur >= 0;
  const shaders = events.filter(event => validInterval(event)
    && ((SHADER_EVENTS.has(event.name) && String(event.cat ?? "").split(",").some(category =>
      ["skia.shaders", "disabled-by-default-skia.shaders"].includes(category)))
      || (DRIVER_SHADER_EVENTS.has(event.name) && String(event.cat ?? "").split(",").includes("gpu"))));
  if (!shaders.length) return {
    status: "unavailable", reason: "No recognized shader intervals; absence does not prove no compilation",
  };
  const counts = {};
  for (const event of shaders) counts[event.name] = (counts[event.name] ?? 0) + 1;
  const longestFlush = events.filter(event => validInterval(event)
    && event.name === "RasterDecoderImpl::DoEndRasterCHROMIUM::Flush")
    .sort((left, right) => right.dur - left.dur)[0];
  const inside = longestFlush ? shaders.filter(event => event.pid === longestFlush.pid
    && event.tid === longestFlush.tid && event.ts >= longestFlush.ts
    && event.ts + event.dur <= longestFlush.ts + longestFlush.dur) : [];
  const safeEvent = event => ({
    name: event.name, startTimeUs: event.ts, durationMs: event.dur / 1000,
    pid: event.pid, tid: event.tid,
  });
  return {
    status: "available", counts, skiaMarkersPresent: shaders.some(event => SHADER_EVENTS.has(event.name)),
    limitation: "Shader compile envelopes include preparation and cache work; driver link is narrower. Same-thread containment is temporal evidence, not exclusive DOM-layer causality.",
    longestFlush: longestFlush ? {
      ...safeEvent(longestFlush),
      shaderCompileEnvelopeMs: unionDurationUs(inside.filter(event => event.name === "shader_compile")) / 1000,
      driverLinkMs: unionDurationUs(inside.filter(event =>
        ["driver_link_program", "TraceGLAPI::glLinkProgram"].includes(event.name))) / 1000,
      driverShaderOperationsMs: unionDurationUs(inside.filter(event => DRIVER_SHADER_EVENTS.has(event.name)
        || ["driver_compile_shader", "driver_link_program"].includes(event.name))) / 1000,
      cacheMisses: inside.filter(event => event.name === "cache_miss").length,
      cacheHits: inside.filter(event => event.name === "cache_hit").length,
      intervals: inside.map(safeEvent),
    } : null,
    longestShaderIntervals: [...shaders].sort((left, right) => right.dur - left.dur)
      .slice(0, 24).map(safeEvent),
  };
}

module.exports = {
  getShaderCacheEvidenceEnabled, validateShaderCacheLaunch,
  captureShaderCacheSnapshot, summarizeShaderCacheDelta,
  getShaderTraceEnabled, getShaderAttributionTraceMode, getShaderAttributionControl,
  summarizeShaderTrace,
  getShaderDriverTraceArgs,
};
