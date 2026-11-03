"use strict";

const path = require("node:path");

const REQUIRED_SCOPE = [
  ["diagnosticOnly", true],
  ["isolated", true],
  ["headful", true],
  ["hardwareGpu", true],
  ["productionPreview", true],
  ["cold", true],
  ["target", "layout"],
  ["viewport", "4k"],
  ["dpr", 1],
  ["repeats", 1],
  ["lowIntrusion", true],
  ["trace", false],
  ["profiler", false],
  ["presentationChanged", false],
];

function getPersistentBrowserProfileDiagnostic(value, scope = {}) {
  if (value === undefined || value === "0") return { enabled: false };
  if (value !== "1") throw new Error('Persistent browser profile diagnostic must be exactly "1".');

  const failures = REQUIRED_SCOPE
    .filter(([key, expected]) => scope[key] !== expected)
    .map(([key]) => `${key} must be ${String(REQUIRED_SCOPE.find(([name]) => name === key)[1])}`);
  if (failures.length > 0) {
    throw new Error(`Persistent browser profile diagnostic rejected: ${failures.join("; ")}.`);
  }

  const profileDirectory = typeof scope.profileDirectory === "string"
    ? scope.profileDirectory.trim()
    : "";
  if (!profileDirectory || !path.isAbsolute(profileDirectory)) {
    throw new Error("Persistent browser profile diagnostic requires an absolute profile directory.");
  }
  if (!["cold", "reuse"].includes(scope.phase)) {
    throw new Error('Persistent browser profile diagnostic phase must be "cold" or "reuse".');
  }

  const outputRoot = typeof scope.outputRoot === "string" && path.isAbsolute(scope.outputRoot)
    ? path.resolve(scope.outputRoot)
    : "";
  if (!outputRoot) throw new Error("Persistent browser profile diagnostic requires an absolute output/playwright root.");

  const resolvedProfileDirectory = path.resolve(profileDirectory);
  const relativeDirectory = path.relative(outputRoot, resolvedProfileDirectory);
  const firstPathPart = relativeDirectory.split(path.sep)[0] ?? "";
  const isWithinOutputRoot = relativeDirectory !== ""
    && relativeDirectory !== ".."
    && !relativeDirectory.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativeDirectory);
  if (!isWithinOutputRoot || !/^e2-persistent-profile-[a-z0-9-]+$/i.test(firstPathPart)) {
    throw new Error("Persistent browser profile must use a dedicated profile directory under output/playwright.");
  }

  return {
    enabled: true,
    kind: "persistent-browser-profile-cache-attribution-not-acceptance",
    phase: scope.phase,
    profileDirectory: resolvedProfileDirectory,
    performanceAcceptance: false,
  };
}

function getPersistentBrowserProfileState(phase, state = {}) {
  const failures = [];
  if (!["cold", "reuse"].includes(phase)) failures.push("phase must be cold or reuse");
  if (phase === "cold" && state.exists !== false) {
    failures.push("cold phase requires a profile directory that does not yet exist");
  }
  if (phase === "reuse") {
    if (state.exists !== true) failures.push("reuse phase requires an existing profile directory");
    if (state.localStatePresent !== true) failures.push("reuse phase requires Chromium Local State");
    if (!(Number(state.gpuCacheFileCount) > 0)) {
      failures.push("reuse phase requires persisted GPU or shader cache files");
    }
  }
  return { valid: failures.length === 0, failures };
}

module.exports = {
  getPersistentBrowserProfileDiagnostic,
  getPersistentBrowserProfileState,
};
