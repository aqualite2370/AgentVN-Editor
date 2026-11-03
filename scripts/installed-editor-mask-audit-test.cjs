"use strict";
// Real evidence used only as a validator fixture; this does not rerun a product.
const fs = require("node:fs"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const { validateCase, validateCoverage } = require("./installed-editor-mask-audit.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const qa = "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01";
const first = read(`${qa}/editor-02/report.json`), middle = read(`${qa}/editor-05/report.json`),
  tail = read(`${qa}/editor-06/report.json`);
assert.equal(tail.status, "PASS");
const cases = [...first.cases.slice(0, 72), ...middle.cases.slice(0, 18), ...tail.cases];
validateCoverage(cases);
for (const mutate of [
  c => c.splice(0), c => c.pop(), c => c.push(structuredClone(c[0])),
  c => { c[0].viewport.width = 390; }, c => { c[0].viewport.dpr = 1.5; },
  c => { c[0].viewport.reduced = null; }, c => { c[0].target = "missing"; }
]) { const c = structuredClone(cases); mutate(c); assert.throws(() => validateCoverage(c)); }
const row = tail.cases.find(c => c.method === "rapid-redirect");
const trace = JSON.parse(zlib.gunzipSync(fs.readFileSync(row.trace.path))); validateCase(row, trace);
for (const mutate of [
  (r,t) => { r.status = "FAILED"; }, (r,t) => { r.failures = ["failure"]; },
  (r,t) => { r.actionError = "timeout"; }, (r,t) => { t.frames = []; },
  (r,t) => { t.viewport.width = 10; }, (r,t) => { t.viewport.dpr = 1.5; },
  (r,t) => { t.reduced = !t.reduced; }, (r,t) => { t.frames[1].at = t.frames[0].at - 1; },
  (r,t) => { t.frames[0].indicator.x = t.frames[0].nav.x - 4; },
  (r,t) => { t.frames[0].material.x += 5; },
  (r,t) => { t.frames[0].adapter.width = NaN; },
  (r,t) => { t.frames[0].interactiveOwners = ["settings", "history"]; },
  (r,t) => { t.frames.at(-1).indicator.width += 5; },
  (r,t) => { t.frames.at(-1).active = "library"; },
  (r,t) => { t.frames.at(-1).morphing = true; },
  (r,t) => { r.inputs = r.inputs.filter(e => e.help !== "advanced.tab.settings"); },
  (r,t) => { r.inputs[0].trusted = false; }
]) {
  const r = structuredClone(row), t = structuredClone(trace); mutate(r, t);
  assert.throws(() => validateCase(r, t));
}
console.log("PASS: mask coverage/raw-frame/actual-input validator rejects 24 invalid evidence variants");
