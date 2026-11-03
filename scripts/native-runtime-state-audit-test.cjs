"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validateReports } = require("./native-runtime-state-audit.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/session-03/";
const read = f => JSON.parse(fs.readFileSync(base + f, "utf8"));
const input = [read("session.json"), read("flow/report.json"), read("cross-layout/report.json")];
assert.doesNotThrow(() => validateReports(...input));
const mutations = [
  ["zero cases", ([, f]) => { f.checks = []; }],
  ["empty matrix", ([, f]) => { f.matrix = []; }],
  ["duplicate matrix entry", ([, f]) => { f.matrix[1] = f.matrix[0]; }],
  ["failed matrix", ([, f]) => { f.matrix[0].status = "FAILED"; }],
  ["unverified screenshot", ([, f]) => { f.screenshots.pop(); }],
  ["wrong product", ([, f]) => { f.exe.sha256 = "wrong"; }],
  ["cleanup incomplete", ([, f]) => { f.launches[0].cleanup.status = "RUNNING"; }],
  ["reported page error", ([, f]) => { f.pageErrors.push("error"); }],
  ["missing save bytes", ([,, c]) => { c.checks[0].detail.files = []; }],
  ["picker overclaim", ([,, c]) => { c.checks[0].detail.nativePickerClaim = true; }],
  ["standalone overclaim", ([,, c]) => { c.checks[0].detail.standaloneExeSaveLocationClaim = true; }],
  ["unexpected build", ([s]) => { s.builds = 1; }],
  ["unfinished command", ([s]) => { s.commands[0].status = "RUNNING"; }],
  ["mismatched reused matrix", ([,, c]) => { c.matrix[0].dpr = 4; }],
];
for (const [name, mutate] of mutations) {
  const changed = structuredClone(input); mutate(changed);
  assert.throws(() => validateReports(...changed), name);
}
console.log(JSON.stringify({ status: "PASS", acceptedBaseline: 1, rejectedMutations: mutations.length,
  scope: "QA_EVIDENCE_GUARD_NOT_PRODUCT_ACCEPTANCE" }));
