"use strict";
const fs = require("node:fs"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { validateReport } = require("./lib/native-runtime-motion-oracle.cjs");
const { validateCriticalTrace, validateRecoveredSession } = require("./native-runtime-motion-audit.cjs");
const raw = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Native-Runtime-State-20261020-01/motion-01/motion.json", "utf8"));
validateReport(raw, true);
const mutations = [
  r => { r.matrix = []; }, r => { r.matrix[0].episodes = []; },
  r => { r.matrix[0].status = "FAILED"; }, r => { r.matrix[0].dpr = 3; },
  r => { r.matrix[0].episodes[0].trace.frames = 0; },
  r => { r.matrix[0].episodes[0].checks[0].status = "FAILED"; },
  r => { r.launches = []; }, r => { r.launches[0].cleanup.status = "FAILED"; },
  r => { r.pageErrors.push("ignored error"); }, r => { r.cleanupError = "profile not restored"; },
  r => { r.productChanges = 1; }, r => { r.scope = "INSTALLED_PASS"; },
];
for (const mutate of mutations) {
  const copy = structuredClone(raw); mutate(copy); assert.throws(() => validateReport(copy, true));
}
const m = raw.matrix[0], e = m.episodes.find(e => e.name === "exit-modal-open-cancel");
const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path))); validateCriticalTrace(m, e, t);
const traceMutations = [
  t => { t.frames = []; },
  t => { t.inputs.forEach(i => { i.trusted = false; }); },
  t => { t.frames[0].dpr = 3; },
  t => { t.frames[0].horizontalOverflow = 500; },
  t => { t.frames[0].playerCount = 2; },
  t => { t.frames.filter(f => f.modal).forEach(f => { f.modalFocus = false; }); },
  t => { t.frames.forEach(f => { f.modalExits = []; }); },
  t => { t.frames.forEach(f => { if(f.backdrop) f.backdrop.opacity = 1; }); },
  t => { t.frames.at(-1).screen = "playing"; },
];
for (const mutate of traceMutations) {
  const copy = structuredClone(t); mutate(copy); assert.throws(() => validateCriticalTrace(m, e, copy));
}
const renpy = raw.matrix.find(m => m.layout === "renpy" && !m.reduced);
const nav = renpy.episodes.find(e => e.name === "settings-to-about");
const navTrace = JSON.parse(zlib.gunzipSync(fs.readFileSync(nav.trace.path)));
validateCriticalTrace(renpy, nav, navTrace);
const navMutations = [
  t => { t.frames.forEach(f => { f.black = 1; }); },
  t => { t.frames.forEach(f => { f.sameNavigation = false; }); },
  t => { t.frames.forEach(f => { if(f.surface) f.surface.opacity = 1; }); },
  t => { t.frames.forEach(f => { if(f.phase === "crossfading") f.snapshots = []; }); },
  t => { t.frames.forEach(f => { f.duration = 0; }); },
  t => { t.frames.at(-1).screen = "help"; },
];
for (const mutate of navMutations) {
  const copy = structuredClone(navTrace); mutate(copy);
  assert.throws(() => validateCriticalTrace(renpy, nav, copy));
}
console.log(`PASS native motion evidence baseline; rejected ${mutations.length + traceMutations.length + navMutations.length} invalid report/trace variants`);
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const session = read(`${base}/motion-02/session.json`);
const recovery = read(`${base}/motion-recovery-01/receipt.json`);
const identities = {
  sessionSha: sha(`${base}/motion-02/session.json`),
  guardSha: sha(`${base}/motion-02/profile-process-guard.log`),
  restorationSha: sha(`${base}/motion-02/profile-restoration.json`),
  restoreScriptSha: sha(`${base}/motion-02/native-dev-preview-profile.ps1`),
};
validateRecoveredSession(session, recovery, identities);
const recoveryMutations = [
  (s, r) => { s.status = "PASS"; },
  (s, r) => { s.commands[1].status = "FAILED"; },
  (s, r) => { s.commands[1].exitCode = 1; },
  (s, r) => { s.commands[2].exitCode = 0; },
  (s, r) => { s.commands[2].command = ["unrelated failure"]; },
  (s, r) => { r.status = "FAILED"; },
  (s, r) => { r.originalFailureRewritten = true; },
  (s, r) => { r.processesTerminated = 1; },
  (s, r) => { r.originalSessionSha256 = "0".repeat(64); },
  (s, r) => { r.originalGuardSha256 = "0".repeat(64); },
  (s, r) => { r.restoration.sha256 = "0".repeat(64); },
  (s, r) => { r.restoreScriptSha256 = "0".repeat(64); },
  (s, r) => { r.restoreExitCode = 1; },
  (s, r) => { r.observations = []; },
  (s, r) => { r.observations.at(-1).matches = [{ ProcessId: 42 }]; },
  (s, r) => { r.observations.at(-2).matches = [{ ProcessId: 42 }]; },
  (s, r) => { r.originalGuardCause = "PROVED_WEBVIEW_DELAY"; },
  (s, r) => { r.at = s.at; },
  (s, r) => { r.command[r.command.length - 1] = "C:\\unrelated"; },
];
for (const mutate of recoveryMutations) {
  const s = structuredClone(session), r = structuredClone(recovery); mutate(s, r);
  assert.throws(() => validateRecoveredSession(s, r, identities));
}
console.log(`PASS original failed session plus independent recovery baseline; rejected ${recoveryMutations.length} false recovery variants`);
