"use strict";
// QA request guards only; no device, model or product operations.
const assert = require("node:assert/strict"), fs = require("node:fs");
const { validateNavigationRequest } = require("./android-current-navigation.cjs");
const source = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Android-Package-20261021-01/device-upgrade-12-08/request-submitted.json", "utf8"));
const request = { ...source, scope: "installed-current-navigation",
  outputDir: "F:\\AgentVN\\QA\\Android-Package-20261021-01\\device-navigation-12-01\\runtime" };
assert.doesNotThrow(() => validateNavigationRequest(request));
assert.doesNotThrow(() => validateNavigationRequest({ ...request, exitProbe: "no-game-autosave-disabled" }));
assert.doesNotThrow(() => validateNavigationRequest({
  ...request, exitProbe: "no-game-autosave-disabled", traceExitBoundary: true,
}));
const invalid = [
  q => { q.scope = "installed-package-smoke"; },
  q => { q.package = "com.other"; },
  q => { q.apk.sha256 = "0".repeat(64); },
  q => { q.apk = q.oldApk; },
  q => { q.outputDir = "D:\\AgentVN"; },
  q => { q.outputDir = "F:\\AgentVN\\QA\\Android-Package-20261021-01\\device-navigation-12-01\\..\\..\\runtime"; },
  q => { q.cdpPort = q.adbPort; },
  q => { q.coldBoot = null; },
  q => { q.serial = "emulator-5556"; },
  q => { q.exitProbe = "invoke-native-directly"; },
  q => { q.traceExitBoundary = "invoke-native-directly"; },
  q => { q.traceExitBoundary = true; },
];
for (const mutate of invalid) {
  const bad = structuredClone(request); mutate(bad);
  assert.throws(() => validateNavigationRequest(bad));
}
console.log(JSON.stringify({ status: "PASS", rejected: invalid.length,
  scope: "QA_REQUEST_GUARDS_ONLY", adbOperations: 0, modelRequests: 0 }));
