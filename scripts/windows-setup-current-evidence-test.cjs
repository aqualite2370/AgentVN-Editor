"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validateSetupEvidence } = require("./lib/windows-setup-current-evidence.cjs");
const nativeUI = process.argv.includes("--native-ui"), attempt = process.argv[2] || "07";
assert(/^\d{2}$/.test(attempt));
const options = { editorVersion: nativeUI ? "1.9.22" : "1.9.16" };
const r = JSON.parse(fs.readFileSync(`F:/AgentVN/QA/Windows-Package-20261021-01/runtime-${attempt}/report.json`, "utf8"));
assert.equal(validateSetupEvidence(r, options).installStatus, "PASS");
const bad = [
  r => { r.status = "FAILED"; }, r => { r.profilesRestored = false; }, r => { r.uninstalled = false; },
  r => { r.checks[0].result.installationMethod = "EXTRACTION"; }, r => { r.checks[0].result.isElevated = true; },
  r => { r.checks[0].result.shortcuts[0].target = "D:\\other.exe"; },
  r => { r.checks[0].result.executable.sha256 = "fake"; },
  r => { r.checks[0].result.payloadEvidence.marker.allOtherBytesIdentical = false; },
  r => { r.checks[2].result.loaded.pop(); }, r => { r.launches[1] = r.launches[0]; },
  r => { r.cleanups[0].remaining.push({ pid: 1 }); }, r => { r.checks[4].result.result.status = "FAILED"; },
  r => { r.checks[4].result.result.shortcuts[0].exists = true; }, r => { r.finalSaves[0].sha256 = "wrong"; },
  r => { r.checks[3].result.command = 0; }, r => { r.setupCleanup = false; },
  r => { r.editorVersion = "0.0.0"; }
];
if (nativeUI) bad.push(r => { r.nativeUIBuildSource = false; }, r => { r.sourceAudit.path = "old"; },
  r => { r.payload.path = "old"; }, r => { r.gameId = "old"; }, r => { r.checks[0].result.resources.pop(); });
if (r.nativePhysicalClose) bad.push(r => { r.nativeCloseReceipt.pid = -1; }, r => { r.nativeCloseReceipt.created = "wrong"; },
  r => { r.cleanups[1].method = "ATTRIBUTED_TERMINATION_NOT_PHYSICAL_CLOSE"; });
for (const mutate of bad) { const copy = structuredClone(r); mutate(copy); assert.throws(() => validateSetupEvidence(copy, options)); }
console.log(`PASS: actual setup/install/shortcut/read/uninstall scope; ${bad.length} unsupported evidence variants rejected`);
