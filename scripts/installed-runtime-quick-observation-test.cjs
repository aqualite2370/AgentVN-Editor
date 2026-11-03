"use strict";
const assert = require("node:assert/strict");
const { validatePendingObservation } = require("./installed-runtime-quick-observation.cjs");
const good = { pointers: [
  { type: "pointerdown", hit: true, trusted: true, at: 10, busy: false, disabled: false },
  { type: "pointerdown", hit: true, trusted: true, at: 30, busy: true, disabled: true }],
  clicks: [{ at: 15, trusted: true }], busy: [{ at: 16, busy: true }, { at: 60, busy: false }] };
assert.equal(validatePendingObservation(good).pendingMs, 44);
const bad = [
  d => { d.pointers[1].trusted = false; },
  d => { d.pointers[1].busy = false; },
  d => { d.pointers[1].at = 61; },
  d => { d.pointers[1].hit = false; },
  d => { d.pointers.pop(); },
  d => { d.clicks.push({ at: 35, trusted: true }); },
  d => { d.busy.pop(); },
  d => { d.busy.push({ at: 70, busy: true }, { at: 90, busy: false }); },
  d => { d.pointers[1].disabled = false; },
];
for (const mutate of bad) { const d = structuredClone(good); mutate(d); assert.throws(() => validatePendingObservation(d)); }
console.log("PASS: 10 actual-pending evidence oracle cases (not product UI tests)");
