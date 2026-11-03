"use strict";
const assert = require("node:assert/strict");
const { observeStoryTree, validateResume } = require("./lib/runtime-story-observer.cjs");
const fs = require("node:fs");
const executable = "F:/AgentVN/QA/test/agentvn-player.exe";
const root = { ProcessId: 123, ParentProcessId: 1, Name: "agentvn-player.exe",
  ExecutablePath: executable, Created: "2026-10-23T06:00:00.1234567Z" };
const known = new Map(), launch = { pid: 123 };
assert.equal(observeStoryTree([root], launch, known, executable).recorded, 1);
const exiting = { ...root, ExecutablePath: null, Name: null };
assert.equal(observeStoryTree([exiting], launch, known, executable).transient, true);
assert.equal(known.get("123:" + root.Created).ExecutablePath, executable);
assert.throws(() => observeStoryTree([exiting], launch, new Map(), executable));
assert.throws(() => observeStoryTree([{ ...root, ExecutablePath: "D:/other.exe" }], launch, known, executable));
assert.throws(() => observeStoryTree([{ ...exiting, Created: "2026-10-23T07:00:00.1234567Z" }],
  launch, known, executable));
const prior = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-story-1922-02/session.json", "utf8"));
const current = { executable: prior.executable, originalExport: prior.originalExport,
  installation: prior.installation, fixture: prior.fixture };
assert.equal(validateResume(prior, current), 7);
const invalid = [
  r => { r.cells[0].status = "FAILED"; }, r => { r.cleanupError = "missing"; },
  r => { r.observerError = "unknown error"; }, r => { r.physicalRoaming = false; },
  r => { r.originalExport.sha256 = "wrong"; }, r => { r.commands[1].exitCode = 1; },
  r => { r.cells = []; }, r => { r.modelRequests = 1; },
];
for (const mutate of invalid) {
  const r = structuredClone(prior); mutate(r); assert.throws(() => validateResume(r, current));
}
console.log(JSON.stringify({ status: "PASS", verifiedResumeCells: 7,
  rejectedResumeVariants: invalid.length, rejectedProcessVariants: 3,
  scope: "QA_OBSERVER_ONLY_NO_PRODUCT_OR_PROCESS_MUTATION" }));
