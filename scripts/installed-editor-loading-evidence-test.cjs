"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { scope, validateLoadingEvidence } = require("./lib/installed-editor-loading-evidence.cjs");
// Explicitly converted historical fixture only checks the validator. It is
// never counted as current-version installed-product evidence.
const old = JSON.parse(fs.readFileSync("output/installed-editor-loading-20261018-01/flow-01/report.json", "utf8"));
assert.throws(() => validateLoadingEvidence(old));
const fixture = structuredClone(old); fixture.scope = scope; validateLoadingEvidence(fixture);
for (const mutate of [
  r => { r.status = "FAILED"; }, r => { r.matrix = []; }, r => { r.matrix.pop(); },
  r => { r.matrix[1] = structuredClone(r.matrix[0]); }, r => { r.matrix[0].episodes = []; },
  r => { r.matrix[0].episodes[0].checks = []; }, r => { r.matrix[0].episodes[0].status = "FAILED"; },
  r => { r.matrix[0].actualBefore.dpr = 1.5; }, r => { r.matrix[0].actualAfter.width = 640; },
  r => { r.matrix[0].episodes[0].trace.frames = 0; },
  r => { r.matrix[0].episodes[0].checks.find(c => c.name.startsWith("Failure retains")).detail.retryHit = false; },
  r => { r.matrix[0].episodes[1].checks.find(c => c.name.startsWith("Latest actual")).detail.active = "animation"; },
  r => { r.timeoutCases = []; }, r => { r.timeoutCases[1].reduced = false; },
  r => { r.timeoutCases[0].checks[0].detail.elapsedMs = 20; },
  r => { r.timeoutCases[0].checks[0].detail.failed.inert = true; },
  r => { r.timerMock = true; }, r => { r.storeMutation = true; },
  r => { r.sourceServer = true; }, r => { r.realModelRequests = 1; },
  r => { r.pageErrors.push("hidden error"); }, r => { r.forbiddenRequests.push("/api/assistant/chat"); },
  r => { r.screenshots = []; }, r => { r.transport = []; },
  r => { r.transport.find(t => t.mode === "hold").releaseError = "release failed"; }
]) { const r = structuredClone(fixture); mutate(r); assert.throws(() => validateLoadingEvidence(r)); }
console.log("PASS: current loading scope guard rejects historical scope plus 25 invalid evidence variants; fixture-only");
