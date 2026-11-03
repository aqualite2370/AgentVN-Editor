"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), zlib = require("node:zlib");
const { validateTerminal, verifyAdditionalTrace } = require("./installed-runtime-motion-1922-audit.cjs");
const b = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-motion-1922-01/";
const owner = JSON.parse(fs.readFileSync(b + "session.json")), raw = JSON.parse(fs.readFileSync(b + "motion.json"));
validateTerminal(owner, raw);
const mutations = [
  (s, r) => { r.matrix = []; }, (s, r) => { r.matrix[0].episodes.pop(); },
  (s, r) => { r.launches.pop(); }, (s, r) => { s.status = "FAILED"; },
  (s, r) => { s.normalCloseClaimed = true; }, (s, r) => { s.modelRequests = 1; },
  (s, r) => { s.commands[4].exitCode = 1; }, (s, r) => { r.pageErrors.push("ignored"); },
  (s, r) => { r.matrix[2].quickGeometry.buttons.pop(); }, (s, r) => { r.matrix[2].quickGeometry.buttons[0].hit = false; },
  (s, r) => { r.matrix[0].episodes[0].trace.frames = 0; },
  (s, r) => { r.launches[0].cleanup.method = "NORMAL_CLOSE"; },
  (s, r) => { s.finishedAt = null; }, (s, r) => { r.cleanupError = "not restored"; },
  (s, r) => { r.matrix[0].dpr = 3; }, (s, r) => { r.matrix[0].episodes[0].name = "fake-path"; },
  (s, r) => { r.matrix[2].quickGeometry.buttons[0].rect.bottom = 5000; },
];
for (const mutate of mutations) {
  const s = structuredClone(owner), r = structuredClone(raw); mutate(s, r);
  assert.throws(() => validateTerminal(s, r));
}
const m = raw.matrix[0], e = m.episodes.find(e => e.name === "settings-category-text");
const trace = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path))); verifyAdditionalTrace(m, e, trace);
for (const mutate of [
  t => { t.frames.forEach(f => { f.categoryDuration = 1; }); },
  t => { t.frames.forEach(f => { f.categoryPhase = "idle"; }); },
  t => { t.frames.at(-1).categoryId = "audio"; },
  t => { t.inputs.forEach(i => { i.trusted = false; }); },
]) { const bad = structuredClone(trace); mutate(bad); assert.throws(() => verifyAdditionalTrace(m, e, bad)); }
console.log("PASS current terminal/trace baseline; rejected 17 false terminal claims and four damaged category traces");
