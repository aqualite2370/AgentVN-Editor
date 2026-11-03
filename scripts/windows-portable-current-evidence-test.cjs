"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { validatePortableEvidence } = require("./lib/windows-portable-current-evidence.cjs");
const nativeUI = process.argv.includes("--native-ui"), attempt = process.argv[2] || "05";
assert(/^\d{2}$/.test(attempt));
const options = { editorVersion: nativeUI ? "1.9.22" : "1.9.16" };
const r = JSON.parse(fs.readFileSync(path.join("F:/AgentVN/QA/Windows-Package-20261021-01",
  `runtime-${attempt}/report.json`), "utf8"));
assert.equal(validatePortableEvidence(r, options).runtimeStatus, "PASS_LIMITED");
const bad = [
  r => { r.status = "FAILED"; }, r => { r.profilesRestored = false; },
  r => { r.scope = "SOURCE"; }, r => { r.launches[1] = r.launches[0]; },
  r => { r.cleanups[0].remaining.push({ pid: 1 }); }, r => { r.matrix.pop(); },
  r => { r.matrix[0].geometry.clipped = true; }, r => { r.matrix[0].geometry.buttons[0].hit = false; },
  r => { r.matrix[0].geometry.panel.right = 99999; }, r => { r.acls[0].isElevated = true; },
  r => { r.acls[1].comparison.permissionsMatch = false; },
  r => { r.finalLegacy[0].sha256 = ""; }, r => { r.finalSaves[0].sha256 = ""; },
  r => { r.checks[3].result.command = 0; }, r => { r.launches[0].args = ["--mode", "fixed"]; },
  r => { r.editorVersion = "0.0.0"; }
];
if (nativeUI) bad.push(r => { r.nativeUIBuildSource = false; }, r => { r.sourceAudit.path = "old-source"; });
for (const mutate of bad) { const copy = structuredClone(r); mutate(copy); assert.throws(() => validatePortableEvidence(copy, options)); }
console.log(`PASS: actual portable limited scope verified; ${bad.length} invalid evidence variants rejected`);
