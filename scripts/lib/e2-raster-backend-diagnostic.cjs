"use strict";

function extractBrowserSwitches(commandLine = "") {
  return (commandLine.match(/(?:[^\s"]|"[^"]*")+/g) ?? [])
    .map(token => token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token)
    .filter(token => token.startsWith("--"));
}

function getRasterBackendDiagnostic(value, scope = {}) {
  if (!value) return { enabled: false, mode: "default", args: [] };
  if (!["default", "cpu"].includes(value)) throw new Error("Raster backend must be default or cpu.");
  const checks = {
    diagnosticOnly: scope.diagnosticOnly === true,
    isolated: scope.isolated === true,
    headful: scope.headful === true,
    hardwareGpu: scope.hardwareGpu === true,
    cold: scope.cold === true,
    currentSource: scope.currentSource === true,
    viewport: scope.viewport === "4k",
    dpr: Number(scope.dpr) === 1,
    repeats: Number(scope.repeats) === 1,
    singleTrial: scope.singleTrial === true,
    target: scope.target === "layout",
    injection: scope.injection !== true,
    profiling: scope.profiling !== true,
    reducedMotion: scope.reducedMotion !== true,
  };
  const failures = Object.entries(checks).filter(([, valid]) => !valid).map(([name]) => name);
  if (failures.length) throw new Error(`Raster attribution scope rejected: ${failures.join(", ")}`);
  return {
    enabled: true,
    mode: value,
    args: value === "cpu" ? ["--disable-gpu-rasterization"] : [],
  };
}

function validateRasterBackendEvidence(mode, evidence = {}) {
  const failures = [];
  const status = evidence.gpuFeatureStatus ?? {};
  const args = evidence.browserArguments ?? [];
  if (status.gpu_compositing !== "enabled") failures.push("hardware compositing is not enabled");
  if (mode === "cpu") {
    if (status.rasterization !== "disabled_software") failures.push("CPU rasterization is not confirmed");
    if (!args.includes("--disable-gpu-rasterization")) failures.push("requested raster launch argument absent");
  } else if (mode === "default") {
    if (status.rasterization !== "enabled") failures.push("default GPU rasterization is not confirmed");
    if (args.includes("--disable-gpu-rasterization")) failures.push("default control has CPU raster override");
  } else {
    failures.push("invalid backend mode");
  }
  return { valid: failures.length === 0, failures };
}

module.exports = { getRasterBackendDiagnostic, validateRasterBackendEvidence, extractBrowserSwitches };
