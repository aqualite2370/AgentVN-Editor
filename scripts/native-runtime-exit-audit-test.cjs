"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validateExitReport } = require("./native-runtime-exit-audit.cjs");
const root = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/";
const raw = JSON.parse(fs.readFileSync(root + "exit-04/exit.json", "utf8"));
assert.doesNotThrow(() => validateExitReport(raw, false));
const mutations = [
  ["zero cases", r => { r.cases = []; }],
  ["zero checks", r => { r.checks = []; }],
  ["empty matrix", r => { r.matrix = []; }],
  ["duplicate display", r => { r.matrix[1] = r.matrix[0]; }],
  ["failed display", r => { r.matrix[0].status = "FAILED"; }],
  ["wrong nested focus", r => { r.matrix[0].second.focusInside = false; }],
  ["wrong return route", r => { r.cases[0].before.settingsEscapePath = ["playing"]; }],
  ["unexpected save changed", r => { r.checks.find(c => c.case === "auto_off" && c.name.startsWith("Explicit")).detail.changed.push({}); }],
  ["missing staging trace", r => { r.checks.find(c => c.name.startsWith("Restore exact")).detail.events = []; }],
  ["wrong restart command", r => { r.checks.find(c => c.name.startsWith("Actual new")).detail.restored.command = 9; }],
  ["stale ACL deny", r => { r.acls[0].data.probe.allowed = true; }],
  ["incomplete ACL restore", r => { r.acls[1].data.comparison.permissionsMatch = false; }],
  ["dropped screenshot", r => { r.screenshots.pop(); }],
  ["dropped save bytes", r => { r.retained.pop(); }],
  ["running cleanup", r => { r.launches[0].cleanup.status = "RUNNING"; }],
  ["termination labelled as native exit", r => { r.launches[0].cleanup.method = "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE"; }],
  ["page error", r => { r.pageErrors.push("unexpected"); }],
  ["product mutation", r => { r.productChanges = 1; }],
  ["new model request", r => { r.modelRequests = 1; }],
  ["new build", r => { r.builds = 1; }],
  ["physical native close overclaim", r => { r.notRun = r.notRun.filter(n => n !== "Physical Alt+F4/window-close"); }],
];
for (const [name, mutate] of mutations) {
  const copy = structuredClone(raw); mutate(copy);
  assert.throws(() => validateExitReport(copy, false), name);
}
console.log(JSON.stringify({ status: "PASS", acceptedBaseline: 1, rejectedMutations: mutations.length,
  scope: "QA_EVIDENCE_GUARD_NOT_PRODUCT_ACCEPTANCE" }));
