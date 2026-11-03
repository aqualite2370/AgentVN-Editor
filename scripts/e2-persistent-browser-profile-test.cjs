"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {
  getPersistentBrowserProfileDiagnostic,
  getPersistentBrowserProfileState,
} = require("./lib/e2-persistent-browser-profile.cjs");

const outputRoot = path.resolve("output/playwright");
const profileDirectory = path.join(outputRoot, "e2-persistent-profile-cache-pair-01", "user-data");
const scope = {
  diagnosticOnly: true,
  isolated: true,
  headful: true,
  hardwareGpu: true,
  productionPreview: true,
  cold: true,
  target: "layout",
  viewport: "4k",
  dpr: 1,
  repeats: 1,
  lowIntrusion: true,
  trace: false,
  profiler: false,
  presentationChanged: false,
  outputRoot,
};

assert.deepEqual(
  getPersistentBrowserProfileDiagnostic(undefined, { ...scope, profileDirectory, phase: "cold" }),
  { enabled: false },
);

const diagnostic = getPersistentBrowserProfileDiagnostic("1", { ...scope, profileDirectory, phase: "cold" });
assert.equal(diagnostic.enabled, true);
assert.equal(diagnostic.kind, "persistent-browser-profile-cache-attribution-not-acceptance");
assert.equal(diagnostic.phase, "cold");
assert.equal(diagnostic.profileDirectory, path.resolve(profileDirectory));
assert.equal(diagnostic.performanceAcceptance, false);
assert.equal(
  getPersistentBrowserProfileDiagnostic("1", { ...scope, profileDirectory, phase: "reuse" }).phase,
  "reuse",
);

for (const [key, value] of Object.entries({
  diagnosticOnly: false,
  isolated: false,
  headful: false,
  hardwareGpu: false,
  productionPreview: false,
  cold: false,
  target: "theme",
  viewport: "1440p",
  dpr: 2,
  repeats: 2,
  lowIntrusion: false,
  trace: true,
  profiler: true,
  presentationChanged: true,
})) {
  assert.throws(
    () => getPersistentBrowserProfileDiagnostic("1", { ...scope, [key]: value, profileDirectory }),
    new RegExp(key),
  );
}

for (const unsafePath of [
  path.resolve("scripts/fixtures/editor-isolated-small.vnproj"),
  path.resolve("output/checkpoints/e2-persistent-profile"),
  outputRoot,
]) {
  assert.throws(
    () => getPersistentBrowserProfileDiagnostic("1", {
      ...scope, profileDirectory: unsafePath, phase: "cold",
    }),
    /dedicated profile directory under output\/playwright/,
  );
}

assert.throws(
  () => getPersistentBrowserProfileDiagnostic("1", { ...scope, profileDirectory: undefined, phase: "cold" }),
  /absolute profile directory/,
);
assert.throws(
  () => getPersistentBrowserProfileDiagnostic("1", { ...scope, profileDirectory, phase: "other" }),
  /phase must be/,
);
assert.throws(
  () => getPersistentBrowserProfileDiagnostic("true", { ...scope, profileDirectory, phase: "cold" }),
  /must be exactly "1"/,
);

assert.deepEqual(getPersistentBrowserProfileState("cold", { exists: false }), {
  valid: true,
  failures: [],
});
assert.equal(getPersistentBrowserProfileState("cold", { exists: true }).valid, false);
assert.deepEqual(getPersistentBrowserProfileState("reuse", {
  exists: true,
  localStatePresent: true,
  gpuCacheFileCount: 3,
}), { valid: true, failures: [] });
assert.equal(getPersistentBrowserProfileState("reuse", {
  exists: true,
  localStatePresent: true,
  gpuCacheFileCount: 0,
}).valid, false);

console.log("PASS: persistent browser profile scope, isolation path, and diagnostic-only labeling");
