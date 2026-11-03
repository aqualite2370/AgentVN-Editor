"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validatePortableReport } = require("./native-portable-saves-audit.cjs");
const raw = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Native-Runtime-State-20261020-01/portable-04/portable.json", "utf8"));
validatePortableReport(raw, false);
const mutations = [
  r => { r.status = "FAILED"; },
  r => { r.checks = []; },
  r => { r.matrix = []; },
  r => { r.matrix[0].status = "FAILED"; },
  r => { r.matrix[0].geometry.focusInside = false; },
  r => { r.matrix[0].geometry.controls[0].hit = false; },
  r => { r.matrix[0].geometry.clipped = true; },
  r => { r.matrix[0].dpr = 3; },
  r => { r.launches[0].storage.portable = false; },
  r => { r.launches[0].mode = "library"; },
  r => { r.launches[0].cleanup.method = "REAL_UI_CONFIRMED_NATIVE_DESTROY"; },
  r => { r.acls[0].data.isElevated = true; },
  r => { r.acls[1].data.comparison.permissionsMatch = false; },
  r => { r.finalLegacy.pop(); },
  r => { r.finalTarget.pop(); },
  r => { r.checks[4].detail.restored.command = 0; },
  r => { r.checks[4].detail.actualNewProcess = false; },
  r => { r.notRun = []; },
  r => { r.pageErrors.push("ignored runtime error"); },
  r => { r.cleanupError = "original profile not restored"; },
];
for (const change of mutations) {
  const copy = structuredClone(raw); change(copy);
  assert.throws(() => validatePortableReport(copy, false));
}
console.log(`PASS portable evidence baseline; rejected ${mutations.length} invalid/overclaimed variants`);
