"use strict";
const assert = require("node:assert/strict");
const { validateWebView2Renderer } = require("./lib/e2-webview2-renderer.cjs");

const base = {
  gpuFeatureStatus: { gpu_compositing: "enabled", rasterization: "enabled", skia_graphite: "disabled_off" },
  browserCommandLine: 'msedgewebview2.exe --remote-debugging-port=51001',
};
assert.equal(validateWebView2Renderer("default", base).matched, true);
assert.equal(validateWebView2Renderer("graphite", base).matched, false);
const graphite = {
  gpuFeatureStatus: { ...base.gpuFeatureStatus, skia_graphite: "enabled_on" },
  browserCommandLine: `${base.browserCommandLine} --enable-features=SkiaGraphite`,
};
assert.equal(validateWebView2Renderer("graphite", graphite).matched, true);
assert.equal(validateWebView2Renderer("default", graphite).matched, false);
assert.equal(validateWebView2Renderer("graphite", { ...graphite, gpuFeatureStatus: base.gpuFeatureStatus }).matched, false);
assert.equal(validateWebView2Renderer("graphite", { ...graphite, browserCommandLine: base.browserCommandLine }).matched, false);
assert.equal(validateWebView2Renderer("graphite", {
  ...graphite, browserCommandLine: 'msedgewebview2.exe --user-data-dir="D:\\Data --enable-features=SkiaGraphite"',
}).matched, false, "profile path text cannot impersonate a real switch");
assert.equal(validateWebView2Renderer("graphite", {
  ...graphite, gpuFeatureStatus: { ...graphite.gpuFeatureStatus, rasterization: "disabled_software" },
}).matched, false);
assert.equal(validateWebView2Renderer("graphite", {}).matched, false);
assert.throws(() => validateWebView2Renderer("unknown", base));
assert.equal(validateWebView2Renderer("graphite", graphite).performanceAcceptance, false);
console.log("PASS: WebView2 renderer actual feature/argument evidence, fallback and unavailable rejection");
