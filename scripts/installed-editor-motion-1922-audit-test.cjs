"use strict";
// Replays terminal evidence only, then corrupts in-memory copies to prove that
// completeness/cleanup and feature failures cannot be silently relabelled.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { validateTerminal } = require("./installed-editor-motion-1922-audit.cjs");
const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
const root = path.join("F:/AgentVN/QA/Installed-Editor-Motion-20261021-01", `editor-${attempt}`);
const owner = JSON.parse(fs.readFileSync(path.join(root, "report.json")));
const raw = JSON.parse(fs.readFileSync(path.join(root, "motion/report.json")));
validateTerminal(owner, raw);
const variants = [
  (s, r) => { r.matrix = []; },
  (s, r) => { r.matrix.pop(); },
  (s, r) => { r.matrix[0].episodes = []; },
  (s, r) => { r.matrix[0].episodes[0].checks = []; },
  (s, r) => { r.matrix[0].episodes[0].trace.frames = 0; },
  (s, r) => { r.matrix[0].width = 640; },
  (s, r) => { r.matrix[0].dpr = 3; },
  (s, r) => { r.matrix[0].nodeWidthCheck.actual = 500; },
  (s, r) => { r.realModelRequests = 1; },
  (s, r) => { r.modelSubmissions.push("unapproved"); },
  (s, r) => { r.productChanges = 1; },
  s => { s.candidateVersion = "1.9.16"; },
  s => { s.smoke = true; },
  s => { s.cacheRestored = false; },
  s => { s.cleanupError = "residual process"; },
  s => { s.protectedUnchanged = false; },
  (s, r) => {
    const e = r.matrix.flatMap(m => m.episodes).find(e => e.status === "FAILED"); assert(e);
    e.status = "PASS";
  },
  (s, r) => { r.status = "PASS"; },
];
assert.equal(raw.status, "FAILED", "This validator test intentionally preserves current failed product evidence");
for (const corrupt of variants) {
  const s = structuredClone(owner), r = structuredClone(raw); corrupt(s, r);
  assert.throws(() => validateTerminal(s, r));
}
console.log(`PASS terminal validator: ${variants.length} invalid completeness/provenance/cleanup/relabel variants rejected; original feature remains FAILED`);
