"use strict";
const assert = require("node:assert/strict");
const { getAngleBackendDiagnostic, validateAngleBackendEvidence } =
  require("./lib/e2-angle-backend-diagnostic.cjs");

const scope = {
  diagnosticOnly: true, isolated: true, headful: true, hardwareGpu: true,
  cold: true, currentSource: true, viewport: "4k", dpr: 1, repeats: 1,
  injection: false, profiling: false, reducedMotion: false, target: "layout", singleTrial: true,
  otherInterventions: false,
};
assert.deepEqual(getAngleBackendDiagnostic(undefined).args, []);
assert.deepEqual(getAngleBackendDiagnostic("default", scope).args, []);
assert.deepEqual(getAngleBackendDiagnostic("gl", scope).args, ["--use-gl=angle", "--use-angle=gl"]);
assert.deepEqual(getAngleBackendDiagnostic("d3d11on12", scope).args,
  ["--use-gl=angle", "--use-angle=d3d11on12"]);
assert.throws(() => getAngleBackendDiagnostic("swiftshader", scope));
for (const [key, value] of Object.entries({
  diagnosticOnly: false, isolated: false, headful: false, hardwareGpu: false,
  cold: false, currentSource: false, viewport: "1080p", dpr: 2,
  repeats: 3, injection: true, profiling: true, reducedMotion: true,
  target: "theme", singleTrial: false, otherInterventions: true,
})) assert.throws(() => getAngleBackendDiagnostic("gl", { ...scope, [key]: value }), key);

const d3d = {
  gpuFeatureStatus: { rasterization: "enabled", gpu_compositing: "enabled" },
  browserArguments: [],
  gpuAuxAttributes: { glImplementationParts: "(gl=egl-angle,angle=d3d11)",
    glRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11, D3D11)" },
};
const openGl = {
  ...d3d,
  browserArguments: ["--use-gl=angle", "--use-angle=gl"],
  gpuAuxAttributes: { glImplementationParts: "(gl=egl-angle,angle=opengl)",
    glRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2, OpenGL 4.6)" },
};
assert.equal(validateAngleBackendEvidence("default", d3d).valid, true);
assert.equal(validateAngleBackendEvidence("gl", openGl).valid, true);
const d3dOn12 = {
  ...d3d, browserArguments: ["--use-gl=angle", "--use-angle=d3d11on12"],
  gpuAuxAttributes: { ...d3d.gpuAuxAttributes,
    displayType: "ANGLE_D3D11on12",
    glRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11on12, D3D11)" },
};
assert.equal(validateAngleBackendEvidence("d3d11on12", d3dOn12).valid, true);
assert.equal(validateAngleBackendEvidence("default", d3dOn12).valid, false,
  "on12 reports the D3D11 implementation family but is not the default backend");
assert.equal(validateAngleBackendEvidence("d3d11on12", {
  ...d3dOn12, gpuAuxAttributes: d3d.gpuAuxAttributes,
}).valid, false, "D3D11 fallback cannot prove the requested on12 backend");
assert.equal(validateAngleBackendEvidence("d3d11on12", {
  ...d3dOn12, gpuAuxAttributes: { ...d3dOn12.gpuAuxAttributes, displayType: "ANGLE_D3D11" },
}).valid, false);
assert.equal(validateAngleBackendEvidence("d3d11on12", {
  ...d3dOn12, gpuAuxAttributes: { ...d3dOn12.gpuAuxAttributes, glRenderer: d3d.gpuAuxAttributes.glRenderer },
}).valid, false);
assert.equal(validateAngleBackendEvidence("gl", { ...openGl, browserArguments: [] }).valid, false);
assert.equal(validateAngleBackendEvidence("gl", {
  ...openGl, gpuAuxAttributes: d3d.gpuAuxAttributes,
}).valid, false, "requested flag is insufficient if Chromium fell back to D3D11");
assert.equal(validateAngleBackendEvidence("default", openGl).valid, false);
assert.equal(validateAngleBackendEvidence("gl", {
  ...openGl, gpuFeatureStatus: { ...openGl.gpuFeatureStatus, rasterization: "disabled_software" },
}).valid, false);
assert.equal(validateAngleBackendEvidence("gl", {
  ...openGl, gpuFeatureStatus: { ...openGl.gpuFeatureStatus, rasterization: "unavailable_off" },
}).valid, false, "an API switch that disables hardware raster is not a single-variable control");
assert.equal(validateAngleBackendEvidence("gl", {
  ...openGl, gpuAuxAttributes: { ...openGl.gpuAuxAttributes, glRenderer: "Google SwiftShader" },
}).valid, false);
assert.equal(validateAngleBackendEvidence("gl", {}).valid, false);
assert.equal(validateAngleBackendEvidence("gl", {
  ...openGl, gpuAuxAttributes: { ...openGl.gpuAuxAttributes, glImplementationParts: "" },
}).valid, false);
console.log("PASS E2 ANGLE backend scope, actual implementation and hardware evidence");
