"use strict";
const { getRasterBackendDiagnostic } = require("./e2-raster-backend-diagnostic.cjs");

function getAngleBackendDiagnostic(value, scope = {}) {
  if (!value) return { enabled: false, mode: "default", args: [] };
  if (!["default", "gl", "d3d11on12"].includes(value))
    throw new Error("ANGLE attribution backend must be default, gl or d3d11on12.");
  // Reuse the same source/GPU/isolated single-trial gate as the raster
  // diagnostic, while keeping rasterization enabled for both controls.
  getRasterBackendDiagnostic("default", scope);
  if (scope.otherInterventions) throw new Error("ANGLE attribution cannot combine with other interventions.");
  return {
    enabled: true, mode: value,
    args: value === "default" ? [] : ["--use-gl=angle", `--use-angle=${value}`],
  };
}

function validateAngleBackendEvidence(mode, evidence = {}) {
  const failures = [];
  const status = evidence.gpuFeatureStatus ?? {};
  const args = evidence.browserArguments ?? [];
  const aux = evidence.gpuAuxAttributes ?? {};
  const implementationFamily = String(aux.glImplementationParts ?? "").match(/(?:^|[,(]\s*)angle=([\w]+)/)?.[1] ?? null;
  // Chromium reports both D3D11 variants as the same implementation family.
  // Require both runtime discriminators; launch flags alone prove no API.
  const actualBackend = implementationFamily === "d3d11"
    && aux.displayType === "ANGLE_D3D11on12" && /Direct3D11on12\b/.test(aux.glRenderer ?? "")
    ? "d3d11on12" : implementationFamily;
  const expectedBackend = mode === "gl" ? "opengl"
    : mode === "default" ? "d3d11" : mode === "d3d11on12" ? "d3d11on12" : null;
  if (!expectedBackend || actualBackend !== expectedBackend)
    failures.push(`actual ANGLE implementation ${actualBackend} does not match ${expectedBackend}`);
  if (status.gpu_compositing !== "enabled" || status.rasterization !== "enabled")
    failures.push("hardware compositing and rasterization must both remain enabled");
  if (!aux.glRenderer || /swiftshader|llvmpipe|software/i.test(aux.glRenderer))
    failures.push("actual hardware GL renderer missing or software-rendered");
  if (mode !== "default" && (!args.includes("--use-gl=angle") || !args.includes(`--use-angle=${mode}`)))
    failures.push("requested ANGLE launch flags absent");
  if (mode === "default" && args.some(arg => arg.startsWith("--use-angle=") || arg.startsWith("--use-gl=")))
    failures.push("default control has graphics backend overrides");
  return { valid: failures.length === 0, failures, actualBackend, implementationFamily, expectedBackend };
}

module.exports = { getAngleBackendDiagnostic, validateAngleBackendEvidence };
