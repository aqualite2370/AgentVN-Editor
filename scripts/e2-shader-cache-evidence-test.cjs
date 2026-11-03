"use strict";
const assert = require("node:assert/strict");
const {
  getShaderCacheEvidenceEnabled,
  validateShaderCacheLaunch,
  summarizeShaderCacheDelta,
  captureShaderCacheSnapshot,
  getShaderTraceEnabled,
  getShaderAttributionTraceMode,
  getShaderAttributionControl,
  summarizeShaderTrace,
  getShaderDriverTraceArgs,
} = require("./lib/e2-shader-cache-evidence.cjs");

async function main() {
  const scope = {
    diagnosticOnly: true, isolated: true, headful: true, hardwareGpu: true,
    productionPreview: true, cold: true, target: "layout", viewport: "4k",
    dpr: 1, repeats: 1, lowIntrusion: true, trace: false, profiler: false,
    presentationChanged: false,
  };
  assert.equal(getShaderCacheEvidenceEnabled(undefined, {}), false);
  assert.equal(getShaderCacheEvidenceEnabled("0", {}), false);
  assert.equal(getShaderCacheEvidenceEnabled("1", scope), true);
  assert.throws(() => getShaderCacheEvidenceEnabled("yes", scope), /0 or 1/);
  for (const key of ["diagnosticOnly", "isolated", "headful", "hardwareGpu",
    "productionPreview", "cold", "lowIntrusion"]) {
    assert.throws(() => getShaderCacheEvidenceEnabled("1", { ...scope, [key]: false }), new RegExp(key));
  }
  for (const [key, value] of Object.entries({
    target: "theme", viewport: "1080p", dpr: 2, repeats: 3, trace: true,
    profiler: true, presentationChanged: true,
  })) {
    assert.throws(() => getShaderCacheEvidenceEnabled("1", { ...scope, [key]: value }), new RegExp(key));
  }
  const launch = {
    browserCommandLine: 'chrome.exe --user-data-dir="C:\\isolated profile" --remote-debugging-pipe',
    gpuFeatureStatus: { gpu_compositing: "enabled", rasterization: "enabled" },
  };
  assert.equal(validateShaderCacheLaunch(launch).valid, true);
  for (const flag of ["--disable-gpu", "--disable-gpu-rasterization",
    "--disable-gpu-shader-disk-cache", "--use-angle=swiftshader"]) {
    assert.equal(validateShaderCacheLaunch({
      ...launch, browserCommandLine: `${launch.browserCommandLine} ${flag}`,
    }).valid, false);
  }
  // Playwright's software fallback permission is not evidence of using it.
  assert.equal(validateShaderCacheLaunch({
    ...launch, browserCommandLine: `${launch.browserCommandLine} --enable-unsafe-swiftshader`,
  }).valid, true);
  assert.equal(validateShaderCacheLaunch({
    ...launch, gpuFeatureStatus: { gpu_compositing: "enabled", rasterization: "disabled_software" },
  }).valid, false);
  assert.equal(validateShaderCacheLaunch({}).valid, false);

  const histogram = (misses, hits) => ({
    name: "Gpu.GrShaderCacheLoadHitInCache", count: misses + hits, sum: hits,
    buckets: [{ low: 0, high: 1, count: misses }, { low: 1, high: 2, count: hits }],
  });
  const snapshot = histograms => ({ supported: true, histograms });
  const delta = summarizeShaderCacheDelta(
    snapshot([histogram(5, 3)]), snapshot([histogram(9, 10)]),
  );
  assert.equal(delta.status, "available");
  assert.equal(delta.cacheMisses, 4);
  assert.equal(delta.cacheHits, 7);
  assert.equal(delta.totalLoads, 11);
  assert.match(delta.limitation, /browser-global.*not.*compilation|browser-global.*cannot.*compilation/);
  const created = summarizeShaderCacheDelta(snapshot([]), snapshot([histogram(3, 1)]));
  assert.equal(created.status, "available");
  assert.equal(created.cacheMisses, 3);
  assert.equal(created.baselineNotProducedYet, true);
  assert.equal(summarizeShaderCacheDelta(snapshot([]), snapshot([])).status, "unavailable");
  assert.equal(summarizeShaderCacheDelta(
    { supported: false, error: "command unavailable" }, snapshot([histogram(3, 1)]),
  ).status, "unavailable");
  assert.equal(summarizeShaderCacheDelta(
    snapshot([histogram(5, 3)]), snapshot([histogram(4, 3)]),
  ).status, "invalid");
  assert.equal(summarizeShaderCacheDelta(
    snapshot([histogram(5, 3)]), snapshot([{ ...histogram(6, 5), count: 99 }]),
  ).status, "invalid");
  assert.equal(summarizeShaderCacheDelta(
    snapshot([]), snapshot([{ ...histogram(6, 5), buckets: [{ low: 2, high: 3, count: 11 }] }]),
  ).status, "invalid");

  const calls = [];
  const read = await captureShaderCacheSnapshot({
    async send(method, args) {
      calls.push({ method, args });
      return { histograms: [histogram(3, 1), { name: "Other.UserData", sum: "private" }] };
    },
  });
  assert.deepEqual(calls, [{
    method: "Browser.getHistograms", args: { query: "Gpu.GrShaderCacheLoadHitInCache", delta: false },
  }]);
  assert.deepEqual(read.histograms, [histogram(3, 1)]);
  assert.equal(JSON.stringify(read).includes("private"), false);
  const unsupported = await captureShaderCacheSnapshot({
    async send() { throw new Error("Browser.getHistograms unsupported"); },
  });
  assert.equal(unsupported.supported, false);
  assert.match(unsupported.error, /unsupported/);
  assert.equal(getShaderTraceEnabled(undefined, {}), false);
  assert.equal(getShaderTraceEnabled("1", { ...scope, trace: true, rendererTrace: true }), true);
  for (const viewport of ["1080p", "1440p"]) {
    assert.equal(getShaderTraceEnabled("1", {
      ...scope, viewport, trace: true, rendererTrace: true,
    }), true);
  }
  assert.throws(() => getShaderTraceEnabled("1", {
    ...scope, viewport: "720p", trace: true, rendererTrace: true,
  }), /viewport/);
  assert.throws(() => getShaderTraceEnabled("1", { ...scope, trace: false }), /trace/);
  assert.throws(() => getShaderTraceEnabled("1", { ...scope, trace: true, rendererTrace: false }), /rendererTrace/);
  assert.equal(getShaderTraceEnabled("1", {
    ...scope, trace: true, rendererTrace: true, repeats: 2, reusePair: true,
  }), true);
  assert.throws(() => getShaderTraceEnabled("1", {
    ...scope, trace: true, rendererTrace: true, repeats: 2, reusePair: false,
  }), /repeats/);
  assert.throws(() => getShaderTraceEnabled("1", {
    ...scope, trace: true, rendererTrace: true, repeats: 1, reusePair: true,
  }), /repeats/);
  const attributionScope = {
    diagnosticOnly: true, isolated: true, headful: true, hardwareGpu: true,
    productionPreview: true, cold: true, target: "layout", viewport: "4k",
    dpr: 1, repeats: 1, lowIntrusion: true, trace: true, rendererTrace: true,
    profiler: false, control: "layout-sidebar-backdrop-filter-disabled",
    controlCount: 1,
  };
  const attribution = getShaderAttributionTraceMode("1", attributionScope);
  assert.equal(attribution.enabled, true);
  assert.equal(attribution.control, attributionScope.control);
  assert.equal(attribution.kind, "single-control-shader-attribution-not-acceptance");
  assert.equal(attribution.performanceAcceptance, false);
  const quickMenuAttribution = getShaderAttributionTraceMode("1", {
    ...attributionScope,
    control: "quick-menu-preview-backdrop-filter-disabled",
  });
  assert.equal(quickMenuAttribution.control, "quick-menu-preview-backdrop-filter-disabled");
  const canvasAttribution = getShaderAttributionTraceMode("1", {
    ...attributionScope,
    control: "editor-flow-canvas-filter-disabled",
  });
  assert.equal(canvasAttribution.control, "editor-flow-canvas-filter-disabled");
  assert.match(getShaderAttributionControl(canvasAttribution.control).selector, /\.flow-surface/);
  assert.match(getShaderAttributionControl(canvasAttribution.control).declarations, /filter:\s*none/);
  const toolbarAttribution = getShaderAttributionTraceMode("1", {
    ...attributionScope,
    control: "editor-toolbar-backdrop-filter-disabled",
  });
  assert.equal(toolbarAttribution.control, "editor-toolbar-backdrop-filter-disabled");
  assert.match(getShaderAttributionControl(toolbarAttribution.control).selector, /\.editor-toolbar/);
  assert.match(getShaderAttributionControl(toolbarAttribution.control).declarations, /backdrop-filter:\s*none/);
  const glassWarpAttribution = getShaderAttributionTraceMode("1", {
    ...attributionScope,
    control: "layout-sidebar-glass-warp-backdrop-filter-disabled",
  });
  assert.equal(glassWarpAttribution.control, "layout-sidebar-glass-warp-backdrop-filter-disabled");
  assert.match(getShaderAttributionControl(glassWarpAttribution.control).selector, /\.runtime-layout-sidebar .*\.glass__warp/);
  assert.match(getShaderAttributionControl(glassWarpAttribution.control).declarations, /backdrop-filter:\s*none/);
  const activeGlassWarpAttribution = getShaderAttributionTraceMode("1", {
    ...attributionScope,
    control: "layout-active-glass-warp-backdrop-filter-disabled",
  });
  assert.equal(activeGlassWarpAttribution.control, "layout-active-glass-warp-backdrop-filter-disabled");
  assert.match(getShaderAttributionControl(activeGlassWarpAttribution.control).selector, /\.advanced-tab-content\.is-active\[data-tab="layout"\].*\.glass__warp/);
  assert.match(getShaderAttributionControl(activeGlassWarpAttribution.control).declarations, /backdrop-filter:\s*none/);
  assert.match(getShaderAttributionControl(quickMenuAttribution.control).selector, /preview-quick-menu-button/);
  for (const [key, value] of Object.entries({
    isolated: false, productionPreview: false, cold: false, target: "theme",
    viewport: "1080p", dpr: 2, repeats: 2, lowIntrusion: false, trace: false,
    rendererTrace: false, profiler: true, control: "all-backdrop-filters-disabled",
    controlCount: 2,
  })) {
    assert.throws(() => getShaderAttributionTraceMode("1", {
      ...attributionScope, [key]: value,
    }), new RegExp(key));
  }
  assert.deepEqual(getShaderAttributionTraceMode(undefined, {}), { enabled: false });
  const event = (name, ts, dur, pid = 2, tid = 3) =>
    ({ name, ts, dur, pid, tid, ph: "X", cat: "skia.shaders" });
  const shaderEvents = [
    { ...event("RasterDecoderImpl::DoEndRasterCHROMIUM::Flush", 1000, 10000), cat: "gpu" },
    event("shader_compile", 2000, 5000),
    event("cache_miss", 2100, 4700),
    event("driver_link_program", 4000, 2500),
    event("driver_link_program", 5500, 1000),
    event("driver_link_program", 4000, 9000, 2, 4),
    event("shader_compile", 12000, 1000),
    event("cache_hit", 12050, 20),
    event("ShaderSource", 2500, 1000),
    { ...event("shader_compile", 16000, 100), args: { source: "private text" } },
  ];
  const shader = summarizeShaderTrace(shaderEvents);
  assert.equal(shader.status, "available");
  assert.equal(shader.counts.shader_compile, 3);
  assert.equal(shader.longestFlush.shaderCompileEnvelopeMs, 5);
  assert.equal(shader.longestFlush.driverLinkMs, 2.5); // overlapping intervals are counted once
  assert.equal(shader.longestFlush.driverShaderOperationsMs, 2.5);
  assert.equal(shader.longestFlush.cacheMisses, 1);
  assert.equal(shader.longestFlush.cacheHits, 0);
  assert.equal(JSON.stringify(shader).includes("private text"), false);
  assert.equal(JSON.stringify(shader).includes("ShaderSource"), false);
  assert.equal(summarizeShaderTrace([]).status, "unavailable");
  assert.equal(summarizeShaderTrace([{
    ...event("shader_compile", 2, -1), args: { source: "not recorded" },
  }]).status, "unavailable");
  assert.equal(summarizeShaderTrace([{
    ...event("shader_compile", 2000, 5000), cat: "disabled-by-default-skia.shaders",
  }]).counts.shader_compile, 1);
  assert.deepEqual(getShaderDriverTraceArgs(undefined, false), []);
  assert.deepEqual(getShaderDriverTraceArgs("1", true), ["--enable-gpu-service-tracing"]);
  assert.throws(() => getShaderDriverTraceArgs("1", false), /shader trace/);
  assert.throws(() => getShaderDriverTraceArgs("yes", true), /0 or 1/);
  const driver = summarizeShaderTrace([
    { ...event("RasterDecoderImpl::DoEndRasterCHROMIUM::Flush", 1000, 10000), cat: "gpu" },
    { ...event("TraceGLAPI::glCompileShader", 2100, 2000), cat: "gpu" },
    { ...event("TraceGLAPI::glGetShaderiv", 4200, 1000), cat: "gpu" },
    { ...event("TraceGLAPI::glLinkProgram", 5300, 4000), cat: "gpu" },
    { ...event("TraceGLAPI::glGetProgramiv", 9400, 100), cat: "gpu" },
  ]);
  assert.equal(driver.status, "available");
  assert.equal(driver.skiaMarkersPresent, false);
  assert.equal(driver.longestFlush.driverShaderOperationsMs, 7.1);
  assert.equal(driver.longestFlush.driverLinkMs, 4);
  console.log("PASS: shader cache evidence scope, launch, counter deltas, missing/reset data and bounded CDP reads");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
