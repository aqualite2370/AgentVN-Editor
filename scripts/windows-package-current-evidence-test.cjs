"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validateBuildEvidence } = require("./lib/windows-package-current-evidence.cjs");
const r = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Windows-Package-20261021-01/editor-01/report.json", "utf8"));
assert.equal(validateBuildEvidence(r).nativeBuildStatus, "PASS");
const bad = [
  r => { r.status = "PASS"; }, r => { r.scope = "SOURCE"; },
  r => { r.error = "Different failure"; }, r => { r.featureStatus = "FAILED"; },
  r => { r.cleanupError = "restoration failed"; }, r => { r.packageCacheRestored = false; },
  r => { r.protectedUnchanged = false; }, r => { r.steps[1].status = "FAILED"; },
  r => { r.nativeResult.result.ok = false; }, r => { r.nativeResult.result.status = "FAILED"; },
  r => { r.nativeResult.result.failureCode = "BUILD_FAILED"; }, r => { r.artifacts.pop(); },
  r => { r.artifacts[0].bytes++; }, r => { r.artifacts[0].sha256 = ""; },
  r => { r.buildKnownProcesses = []; }, r => { r.cleanups[0].status = "FAILED"; },
  r => { r.normalStandaloneUIExportStatus = "PASS"; }, r => { r.modelRequests = 1; }
];
for (const mutate of bad) { const copy = structuredClone(r); mutate(copy); assert.throws(() => validateBuildEvidence(copy)); }
console.log(`PASS: exact known collector failure remains FAILED; native build validated; ${bad.length} invalid evidence variants rejected`);
