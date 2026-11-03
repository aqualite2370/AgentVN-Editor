"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validateQuickReport } = require("./native-runtime-quick-audit.cjs");
const file = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/quick-01/player-01.json";
const baseline = JSON.parse(fs.readFileSync(file, "utf8"));
assert.doesNotThrow(() => validateQuickReport(baseline, 1));
const mutations = [
  ["empty matrix", r => { r.cells = []; }],
  ["wrong DPR", r => { r.cells[0].viewport.dpr = 2; }],
  ["incomplete checks", r => { r.cells[0].checks.pop(); }],
  ["failed check", r => { r.cells[0].checks[0].status = "FAILED"; }],
  ["two submitted clicks", r => { r.cells[0].checks[0].detail.observed.clicks.push({ trusted: true }); }],
  ["second input outside pending", r => { r.cells[0].checks[0].detail.observed.pointers
    .filter(p => p.type === "pointerdown")[1].busy = false; }],
  ["multiple changed files", r => { r.cells[0].checks[0].detail.changed.push({}); }],
  ["ACL overclaim", r => { r.cells[0].checks[1].detail.method = "ACL"; }],
  ["old file unexpectedly changed", r => { r.cells[0].checks[1].detail.after[5].sha256 = "wrong"; }],
  ["indistinguishable older valid", r => { r.cells[0].checks[2].detail.oldest.command_index = 1; }],
  ["oldest restored instead", r => { r.cells[0].checks[2].detail.restored.command = 0; }],
  ["invalid newest restored", r => { r.cells[0].checks[2].detail.restored.command = 2; }],
  ["corruption missing", r => { r.cells[0].checks[2].detail.listed =
    r.cells[0].checks[2].detail.listed.filter(s => s.scene_id !== "__qa_missing_scene_current_native__"); }],
  ["cancel changed state", r => { r.cells[0].checks[2].detail.cancellationUnchanged = false; }],
  ["unrestored fault", r => { r.faults[0].restoration = "RUNNING"; }],
  ["unreleased lock", r => { r.locks[0].cleanup = "RUNNING"; }],
  ["normal-exit overclaim", r => { r.launches[0].cleanup.method = "REAL_UI_CONFIRMED_NATIVE_DESTROY"; }],
  ["wrong screenshot count", r => { r.screenshots = []; }],
  ["missing native bytes", r => { r.nativeSaves.pop(); }],
  ["mocked timing", r => { r.mockDelay = true; }],
  ["model request", r => { r.modelRequests = 1; }],
];
for (const [name, mutate] of mutations) {
  const changed = structuredClone(baseline); mutate(changed);
  assert.throws(() => validateQuickReport(changed, 1), name);
}
console.log(JSON.stringify({ status: "PASS", acceptedBaseline: 1, rejectedMutations: mutations.length,
  scope: "QA_EVIDENCE_GUARD_NOT_PRODUCT_ACCEPTANCE" }));
