"use strict";
const { extractBrowserSwitches } = require("./e2-raster-backend-diagnostic.cjs");

function validateWebView2Renderer(mode, evidence = {}) {
  if (!["default", "graphite"].includes(mode)) throw new Error("renderer must be default or graphite");
  const status = evidence.gpuFeatureStatus ?? {};
  const args = extractBrowserSwitches(evidence.browserCommandLine);
  const featureSwitch = args.find(arg => arg.startsWith("--enable-features="));
  const requestedGraphite = featureSwitch?.slice("--enable-features=".length).split(",").includes("SkiaGraphite") === true;
  const failures = [];
  if (status.gpu_compositing !== "enabled" || status.rasterization !== "enabled")
    failures.push("hardware compositing and rasterization must remain enabled");
  if (mode === "graphite") {
    if (!["enabled", "enabled_on"].includes(status.skia_graphite)) failures.push("actual Graphite feature is not enabled");
    if (!requestedGraphite) failures.push("actual Graphite launch argument is absent");
  } else {
    if (status.skia_graphite !== "disabled_off") failures.push("default control is not the default renderer");
    if (requestedGraphite) failures.push("default control contains a renderer override");
  }
  return { requested: mode, graphiteStatus: status.skia_graphite ?? null,
    matched: failures.length === 0, failures, performanceAcceptance: false };
}
module.exports = { validateWebView2Renderer };
