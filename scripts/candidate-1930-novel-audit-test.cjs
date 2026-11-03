"use strict";
// Historical observations transformed in memory for validator tests only.
const fs = require("node:fs"), assert = require("node:assert/strict");
const { build, validator, protectedProducts } = require("./candidate-1930-novel-audit.cjs");
let rejected = 0;
for (const kind of ["default", "floating"]) {
  const file = kind === "default" ? "candidate-1924-novel-audit.cjs" : "installed-novel-1922-audit.cjs";
  const original = fs.readFileSync(`${__dirname}/${file}`, "utf8");
  const result = build(kind, original);
  assert(result.changes.length > 0);
  for (const c of result.changes) {
    assert.throws(() => build(kind, original.replace(c.before, "MISSING_INPUT")));
    rejected++;
  }
  const fixture = JSON.parse(fs.readFileSync(kind === "default"
    ? "F:/AgentVN/QA/Installed-Novel-Default-1928-20261026-01/session-01/report.json"
    : "F:/AgentVN/QA/Installed-Novel-Floating-1928-20261026-01/session-02/report.json", "utf8"));
  fixture.version = "1.9.30";
  if (kind === "floating") {
    for (const l of fixture.nativeSession.launches)
      l.executable.sha256 = "a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577";
  }
  const validate = validator(kind); validate(fixture);
  const changes = [
    r => r.version = "1.9.28", r => r.cases = [], r => r.realModelRequests = 1,
    r => r.errors.push("error"), r => r.status = "FAILED",
    r => r.continuation = { inherited: true },
    ...(kind === "default" ? [
      r => r.modelRequests = 0, r => r.bundles = [], r => r.launches.pop(),
      r => r.modelBoundary[0].stage = "wrong",
      r => r.completed.project.nodes = r.initial.project.nodes,
      r => r.sockets.find(s => s.command === "start_novel_job").controlledSelection = false,
    ] : [
      r => r.matrix = [], r => r.matrix[1] = r.matrix[0],
      r => r.matrix[0].entry.frames = [], r => r.matrix[0].geometry.card.width = 280,
      r => r.nativeSession.cleanups[0].status = "FAILED", r => r.cache.pop(),
      r => r.nativeSession.launches[0].executable.sha256 = "bad",
      r => r.cases[6].staleAbaResult = "NOT_RUN",
    ]),
  ];
  for (const change of changes) {
    const bad = structuredClone(fixture); change(bad);
    assert.throws(() => validate(bad)); rejected++;
  }
}
const current = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Installed-Novel-Floating-1930-20261026-01/session-01/report.json", "utf8"));
const installed = require("./candidate-1930-exit.cjs").validateInstallation(current.installation.path);
assert.deepEqual(protectedProducts(current, installed), installed.protectedFiles);
for (const mutate of [
  r => delete r.installation.protectedFiles,
  r => r.installation.protectedFiles = [],
  r => r.installation.protectedFiles.pop(),
  r => r.installation.protectedFiles[0].sha256 = "bad",
  r => r.installation.protectedFiles[0].path = r.installation.executable.path,
  r => r.installation.resources = [],
  r => r.installation.sha256 = "bad",
  r => r.installation.path = "F:/AgentVN/QA/other-receipt.json",
]) {
  const bad = structuredClone(current); mutate(bad);
  assert.throws(() => protectedProducts(bad, installed)); rejected++;
}
console.log(JSON.stringify({ status: "PASS", rejected, fixtureOnly: true,
  launches: 0, profileChanges: 0, modelRequests: 0 }));
