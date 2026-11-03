"use strict";
// QA evidence classification only; no product launch or synthetic business PASS.
const assert = require("node:assert/strict");
const { analyzeChoiceFrames, analyzeDialogFrames } = require("./lib/nvl-choice-frame-probe.cjs");
const rect = (x, y, width, height) => ({ x, y, width, height, right: x + width, bottom: y + height });
function frame(phase, command, overflow = false) {
  return { phase, at: 1, scene: "capacity", command, page: 1, pages: 1, done: true,
    viewport: { width: 1920, height: 1080, dpr: 1, reduced: true },
    panel: rect(90, 100, 1740, 850), region: rect(100, 110, 1720, 700),
    currentText: "真实当前页", glyphs: [rect(100, 110, 90, overflow ? 720 : 30)],
    choice: command === 24 ? rect(800, 820, 300, 80) : null,
    choiceEnabled: command === 24, choiceHit: command === 24, animations: [] };
}
const before = frame("raf", 23);
const safe = [before, frame("mutation", 24), frame("raf", 24), frame("raf", 24)];
assert.equal(analyzeChoiceFrames(safe).classification, "NO_OVERFLOW_OBSERVED");
const rawWebViewDpr = structuredClone(safe);
for (const f of rawWebViewDpr) f.viewport.dpr = 1.0000000149011612;
assert.equal(analyzeChoiceFrames(rawWebViewDpr).classification, "NO_OVERFLOW_OBSERVED");
assert.equal(rawWebViewDpr[0].viewport.dpr, 1.0000000149011612, "Keep the raw DPR in evidence");
for (const dpr of [1.001, 1.5, NaN, 0]) {
  const wrong = structuredClone(safe); for (const f of wrong) f.viewport.dpr = dpr;
  assert.throws(() => analyzeChoiceFrames(wrong));
}
const transient = [before, frame("mutation", 24, true), frame("raf", 24), frame("raf", 24)];
assert.equal(analyzeChoiceFrames(transient).classification, "MUTATION_ONLY_OVERFLOW");
const rendered = [before, frame("mutation", 24, true), frame("raf", 24, true), frame("raf", 24)];
const r = analyzeChoiceFrames(rendered);
assert.equal(r.classification, "FRAME_OVERFLOW_RECOVERED");
assert.equal(r.badAnimationFrameCount, 1);
assert.equal(r.badSamples[0].command, 24);
assert.equal(analyzeChoiceFrames([before, frame("raf", 24, true), frame("raf", 24, true)])
  .classification, "FRAME_OVERFLOW_AT_END");
const changedDpr = structuredClone(safe); changedDpr[2].viewport.dpr = 2;
const missingGlyphs = structuredClone(safe); missingGlyphs[2].glyphs = [];
const invalid = [
  [], [before], safe.filter(f => f.command !== 23), safe.filter(f => f.phase !== "raf"),
  [before, frame("raf", 24)], changedDpr, missingGlyphs,
];
for (const value of invalid) assert.throws(() => analyzeChoiceFrames(value));
const ordinary = [frame("before", 23), frame("raf", 0), frame("raf", 0)];
ordinary[0].scene = "narrative_entry";
for (const f of ordinary.slice(1)) { f.scene = "voice_dialog"; f.choice = null; }
assert.equal(analyzeDialogFrames(ordinary).classification, "NO_OVERFLOW_OBSERVED");
const clippedDialog = structuredClone(ordinary);
clippedDialog[1].glyphs[0].bottom = 900;
assert.equal(analyzeDialogFrames(clippedDialog).classification, "FRAME_OVERFLOW_RECOVERED");
assert.throws(() => analyzeDialogFrames(ordinary.slice(1)));
assert.deepEqual(safe, [before, frame("mutation", 24), frame("raf", 24), frame("raf", 24)]);
console.log(JSON.stringify({ status: "PASS", positiveCases: 7, rejectedCases: invalid.length + 5,
  scope: "QA_TRACE_CLASSIFIER_NOT_PRODUCT_ACCEPTANCE" }));
