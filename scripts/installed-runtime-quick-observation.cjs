"use strict";
// Evidence oracle only; it never changes product timing or dispatches input.
const assert = require("node:assert/strict");
function validatePendingObservation(observed) {
  const downs = observed.pointers.filter(e => e.type === "pointerdown" && e.hit);
  assert.equal(downs.length, 2, "Two real pointerdowns must hit the quick-save control");
  assert(downs.every(e => e.trusted), "No synthetic pointer events");
  assert.equal(observed.clicks.length, 1, "Only first click may submit");
  assert(observed.clicks[0].trusted);
  assert.equal(downs[0].busy, false);
  assert.equal(downs[1].busy, true, "Second real pointerdown must occur during actual pending");
  assert.equal(downs[1].disabled, true);
  const started = observed.busy.find(e => e.busy);
  const ended = observed.busy.find(e => !e.busy && started && e.at >= started.at);
  assert(started && ended, "One completed actual busy interval");
  assert(started.at <= downs[1].at && downs[1].at < ended.at, "Second input is temporally inside real busy interval");
  assert.equal(observed.busy.filter(e => e.busy).length, 1);
  assert.equal(observed.busy.filter(e => !e.busy).length, 1);
  return { secondPointerAt: downs[1].at, busyStartAt: started.at, busyEndAt: ended.at,
    pendingMs: ended.at - started.at, realPointerCount: downs.length, acceptedClickCount: observed.clicks.length,
    mockDelay: false };
}
module.exports = { validatePendingObservation };
