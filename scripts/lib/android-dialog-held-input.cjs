"use strict";
// Read-only observation around real ADB gestures. Never dispatches DOM input.
const assert = require("node:assert/strict");
function state() {
  const p = document.querySelector(".story-player"), d = document.querySelector(".dialog-box");
  return { scene: p?.dataset.currentSceneId, command: Number(p?.dataset.currentCommandIndex),
    page: Number(d?.dataset.dialogPage), pages: Number(d?.dataset.dialogPages),
    mode: d?.dataset.dialogueLayoutMode, done: d?.dataset.dialogPageDone === "true",
    choice: p?.dataset.waitingChoice === "true" };
}
async function before(cdp, label, selector) {
  const observation = await cdp.evaluate(`(() => {
    const read = ${state.toString()};
    const entry = window.__avnHeldDialogueProbe;
    if (entry) for (const [type, listener] of entry.listeners) document.removeEventListener(type, listener, true);
    const value = window.__avnHeldDialogueProbe = { events: [], listeners: [] };
    for (const type of ["pointerdown", "pointerup", "pointercancel", "click"]) {
      const listener = event => value.events.push({ type, at: performance.now(),
        pointerType: event.pointerType, pointerId: event.pointerId, trusted: event.isTrusted,
        target: event.target?.className, state: read() });
      value.listeners.push([type, listener]); document.addEventListener(type, listener, true);
    }
    return read();
  })()`);
  assert(observation.done, "Held advance must start on an already revealed page");
  return { label, selector, requestedDurationMs: 650, before: observation };
}
function verify(row) {
  assert.equal(row.requestedDurationMs, 650);
  const downs = row.events.filter(e => e.type === "pointerdown");
  const ups = row.events.filter(e => e.type === "pointerup");
  assert.equal(downs.length, 1); assert.equal(ups.length, 1);
  assert.equal(downs[0].pointerType, "touch"); assert.equal(ups[0].pointerId, downs[0].pointerId);
  assert(row.events.every(e => e.trusted), "Only trusted real ADB events count");
  assert(ups[0].at - downs[0].at >= 450, "A short tap cannot prove the held-touch fix");
  assert.equal(row.events.filter(e => e.type === "pointercancel").length, 0);
  if (row.before.page < row.before.pages) {
    for (const key of ["scene", "command", "mode", "pages"]) assert.equal(row.after[key], row.before[key], key);
    assert.equal(row.after.page, row.before.page + 1, "Held touch must advance exactly one page");
  } else {
    assert(row.after.scene !== row.before.scene || row.after.command !== row.before.command || row.after.choice,
      "Last page must perform its one normal advance");
  }
}
async function after(cdp, row, report) {
  const observed = await cdp.evaluate(`(() => {
    const entry = window.__avnHeldDialogueProbe;
    const result = { after: (${state.toString()})(), events: entry?.events || [] };
    if (entry) for (const [type, listener] of entry.listeners) document.removeEventListener(type, listener, true);
    delete window.__avnHeldDialogueProbe; return result;
  })()`);
  Object.assign(row, observed);
  report.heldDialogueInputs ??= []; report.heldDialogueInputs.push(row);
  try { verify(row); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
function selfTest() {
  const s = { scene: "a", command: 3, page: 1, pages: 3, mode: "bubble", done: true };
  const valid = { requestedDurationMs: 650, before: s, after: { ...s, page: 2 },
    events: [{ type: "pointerdown", at: 0, pointerType: "touch", pointerId: 1, trusted: true },
      { type: "pointerup", at: 650, pointerType: "touch", pointerId: 1, trusted: true },
      { type: "click", at: 651, pointerType: "touch", pointerId: 1, trusted: true }] };
  verify(valid);
  const bad = [r => r.after.page = 3, r => r.events[1].at = 120, r => r.events[0].trusted = false,
    r => r.events.push(r.events[0]), r => r.events[1].pointerId = 2];
  for (const mutate of bad) { const r = structuredClone(valid); mutate(r); assert.throws(() => verify(r)); }
  return { status: "PASS", rejectedGestureClaims: bad.length, deviceOperations: 0 };
}
module.exports = { before, after, verify, selfTest };
