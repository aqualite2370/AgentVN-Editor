"use strict";
const assert = require("node:assert/strict");
const {
  getRasterBackendDiagnostic,
  validateRasterBackendEvidence,
  extractBrowserSwitches,
} = require("./lib/e2-raster-backend-diagnostic.cjs");
assert.deepEqual(extractBrowserSwitches('"C:\\Program Files\\Chrome\\chrome.exe" --foo=bar --disable-gpu-rasterization'),
  ["--foo=bar", "--disable-gpu-rasterization"]);
assert.deepEqual(extractBrowserSwitches('chrome.exe "--disable-gpu-rasterization"'), ["--disable-gpu-rasterization"]);
assert.deepEqual(extractBrowserSwitches('chrome.exe --user-data-dir="C:\\Foo --disable-gpu-rasterization"'),
  ['--user-data-dir="C:\\Foo --disable-gpu-rasterization"']);
const scope = {
  diagnosticOnly: true, isolated: true, headful: true, hardwareGpu: true,
  cold: true, currentSource: true, viewport: "4k", dpr: 1, repeats: 1,
  injection: false, profiling: false, reducedMotion: false, target: "layout", singleTrial: true,
};
assert.deepEqual(getRasterBackendDiagnostic(undefined, scope).args, []);
assert.deepEqual(getRasterBackendDiagnostic("default", scope).args, []);
assert.deepEqual(getRasterBackendDiagnostic("cpu", scope).args, ["--disable-gpu-rasterization"]);
assert.throws(() => getRasterBackendDiagnostic("unknown", scope));
for (const [key, value] of Object.entries({
  diagnosticOnly: false, isolated: false, headful: false, hardwareGpu: false,
  cold: false, currentSource: false, viewport: "1080p", dpr: 2,
  repeats: 3, injection: true, profiling: true, reducedMotion: true,
  target: "theme", singleTrial: false,
})) {
  assert.throws(() => getRasterBackendDiagnostic("cpu", { ...scope, [key]: value }), key);
}
const hardware = {
  gpuFeatureStatus: { rasterization: "enabled", gpu_compositing: "enabled" },
  browserArguments: ["--enable-automation"],
};
const software = {
  gpuFeatureStatus: { rasterization: "disabled_software", gpu_compositing: "enabled" },
  browserArguments: ["--enable-automation", "--disable-gpu-rasterization"],
};
assert.equal(validateRasterBackendEvidence("default", hardware).valid, true);
assert.equal(validateRasterBackendEvidence("cpu", software).valid, true);
assert.equal(validateRasterBackendEvidence("cpu", hardware).valid, false);
assert.equal(validateRasterBackendEvidence("default", software).valid, false);
assert.equal(validateRasterBackendEvidence("cpu", {
  ...software, browserArguments: [],
}).valid, false);
assert.equal(validateRasterBackendEvidence("cpu", {
  ...software, gpuFeatureStatus: { ...software.gpuFeatureStatus, gpu_compositing: "disabled_software" },
}).valid, false);
assert.equal(validateRasterBackendEvidence("cpu", {}).valid, false);
console.log("PASS E2 raster-backend scope and actual GPU/launch evidence");
