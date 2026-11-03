"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validate } = require("./installed-runtime-story-audit.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const source = process.argv[2] ||
  "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-story-1922-01/session.json";
const r = read(source), flows = r.cells.map(c => read(c.report.path));
const cross = r.crossLayout ? read(r.crossLayout.path) : null;
const input = [r, flows, cross];
assert.doesNotThrow(() => validate(...input));
const mutations = [
  ["unfinished", a => { a[0].status = "RUNNING"; }],
  ["no completion", a => { a[0].finishedAt = null; }],
  ["empty cells", a => { a[0].cells = []; }],
  ["wrong binary", a => { a[0].executable.sha256 = "wrong"; }],
  ["missing restoration", a => { a[0].commands.pop(); }],
  ["cleanup failure", a => { a[0].cleanupError = "still running"; }],
  ["model request", a => { a[0].modelRequests = 1; }],
  ["normal close overclaim", a => { a[0].normalCloseClaimed = true; }],
  ["missing port cleanup evidence", a => { a[0].absentPorts = []; }],
  ["empty matrix", a => { a[1][0].matrix = []; }],
  ["duplicate layout", a => { a[1][0].matrix[1] = a[1][0].matrix[0]; }],
  ["wrong DPR", a => { a[1][0].matrix[0].dpr = 4; }],
  ["unreachable action", a => { a[1][0].matrix[0].controls[0].hit = false; }],
  ["missing cleanup", a => { a[1][0].launches[0].cleanup.status = "RUNNING"; }],
  ["page error", a => { a[1][0].pageErrors.push("error"); }],
  ["default storage overclaim", a => { a[1][0].launches[0].libraryStorage = "PHYSICAL_DEFAULT_PATH"; }],
];
if (r.status === "FAILED")
  mutations.push(["failure reported as pass", a => { a[0].status = "PASS"; }]);
else mutations.push(
  ["missing business step", a => { a[1][0].checks.pop(); }],
  ["picker overclaim", a => { a[2].checks[0].detail.nativePickerClaim = true; }],
  ["missing save bytes", a => { a[2].checks[0].detail.files = []; }],
  ["incomplete matrix", a => { a[0].cells.pop(); a[1].pop(); }]);
for (const [label, mutate] of mutations) {
  const args = structuredClone(input); mutate(args);
  assert.throws(() => validate(...args), label);
}
console.log(JSON.stringify({ status: "PASS", source, businessStatus: r.status,
  rejectedVariants: mutations.length, scope: "EVIDENCE_GUARDS_NOT_PRODUCT_ACCEPTANCE" }));
