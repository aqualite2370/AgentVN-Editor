"use strict";
// Actual native handle evidence, not a simulated Windows redirection.
const fs = require("node:fs"), assert = require("node:assert/strict");
const file = "F:/AgentVN/QA/Android-Package-20261021-01/file-view-01/report.json";
const r = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
assert.equal(r.productWrites, 0); assert.equal(r.builds, 0); assert.equal(r.isElevated, false);
assert.equal(r.cases.length, 2);
for (const sample of r.cases) {
  assert.equal(sample.views.length, 3);
  const [lexical, packaged, device] = sample.views;
  for (const v of sample.views) {
    assert(v.exists && v.error === null);
    assert.match(v.finalPath, /\\Packages\\OpenAI\.Codex_2p2nqsd0c76g0\\LocalCache\\/);
    assert.equal(v.finalPath, packaged.finalPath); assert.equal(v.sha256, packaged.sha256);
    assert.notEqual(v.sha256, sample.expectedPhysicalSha256);
  }
  assert.notEqual(lexical.finalPath, "\\\\?\\" + lexical.path);
  assert.equal(device.kind, "volume-device");
}
console.log(JSON.stringify({ status: "PASS_FILE_VIEW_MISMATCH_CONFIRMED", samples: 2, handleObservations: 6,
  physicalCurrentState: "NOT_SAMPLED", previousHashAudit: "INVALID_CROSS_VIEW_COMPARISON",
  source: file, productWrites: 0 }));
