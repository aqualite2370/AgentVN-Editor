"use strict";
const fs = require("node:fs"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const { validateMatrix, verifyTrace, validateFailedShutdown } = require("./native-editor-motion-audit.cjs");
const raw = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Native-Editor-Motion-20261020-01/session-02/motion/report.json", "utf8"));
validateMatrix(raw, true, true);
const reportMutations = [
  r => { r.matrix = []; },
  r => { r.matrix[0].episodes = []; },
  r => { r.matrix[0].episodes[0].checks = []; },
  r => { r.matrix[0].width = 640; },
  r => { r.matrix[0].episodes[1].status = "FAILED"; },
  r => { r.matrix[0].episodes[0].checks.push({ name: "hidden product failure", status: "FAILED" }); },
  r => { r.matrix[0].nodeWidthCheck.actual = 500; },
  r => { r.productChanges = 1; },
  r => { r.realModelRequests = 1; },
  r => { r.errors.push("unexpected error"); },
  r => { r.scope = "INSTALLED_RELEASE_PASS"; },
];
for (const mutate of reportMutations) {
  const r = structuredClone(raw); mutate(r); assert.throws(() => validateMatrix(r, true, true));
}
const m = raw.matrix[0], e = m.episodes.find(e => e.name === "tab-settings-to-layout");
const trace = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
verifyTrace(m, e, trace);
const traceMutations = [
  t => { t.frames = []; },
  t => { t.inputs.forEach(i => { i.trusted = false; }); },
  t => { t.frames[0].pageHidden = true; },
  t => { t.frames[0].dpr = 2; },
  t => { t.frames[0].overflow = 100; },
  t => { t.frames.forEach(f => f.ghosts.push({ inert: false, pointerEvents: "auto" })); },
  t => { t.frames.forEach(f => { if (f.palette) f.palette.display = "none"; }); },
  t => { t.frames.forEach(f => { if (f.inspector) f.inspector.rect.width += 100; }); },
  t => { t.frames.forEach(f => { f.focus.inUnavailable = true; }); },
  t => { t.frames.forEach(f => { f.paletteFilteredAncestors.push("blurred"); }); },
  t => { t.frames.forEach(f => f.layers.forEach(l => { l.opacity = 0; })); },
  t => { t.frames.forEach(f => f.layers.forEach(l => { l.inert = true; })); },
  t => { t.frames.forEach(f => { f.phase = "idle"; }); },
  t => { t.frames.at(-1).activeTab = "settings"; },
  t => { t.frames.forEach(f => { f.buttons = []; }); },
];
for (const mutate of traceMutations) {
  const t = structuredClone(trace); mutate(t); assert.throws(() => verifyTrace(m, e, t));
}
const reduced = raw.matrix[1], close = reduced.episodes.find(e => e.name === "options-close-to-editor-keyboard");
const closeTrace = JSON.parse(zlib.gunzipSync(fs.readFileSync(close.trace.path)));
verifyTrace(reduced, close, closeTrace);
const copy = structuredClone(closeTrace); copy.frames.at(-1).focus.surface = "options";
assert.throws(() => verifyTrace(reduced, close, copy));
console.log(`PASS actual normal/reduced evidence; rejected ${reportMutations.length + traceMutations.length + 1} false matrix/frame/focus variants`);
const session = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Native-Editor-Motion-20261020-01/session-03/session.json", "utf8"));
validateFailedShutdown(session);
const shutdownMutations = [
  s => { s.status = "CURRENT_NATIVE_EDITOR_MOTION_PASS"; },
  s => { s.commands[0].status = "FAILED"; },
  s => { s.commands[0].exitCode = 1; },
  s => { s.closeError = "unrelated error"; },
  s => { s.cleanup.killed = []; },
  s => { s.cleanup.killed.push("999:unrelated"); },
  s => { s.cleanup.survivors.push("still active"); },
  s => { s.cleanup.listeners.push("occupied"); },
  s => { s.cleanupError = "unknown cleanup"; },
  s => { s.host.created = "reused PID"; },
];
for (const mutate of shutdownMutations) {
  const s = structuredClone(session); mutate(s); assert.throws(() => validateFailedShutdown(s));
}
console.log(`PASS explicit shutdown failure classification; rejected ${shutdownMutations.length} false clean/attribution variants`);
