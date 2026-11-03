"use strict";
const assert = require("node:assert/strict");
const { runInNewContext } = require("node:vm");
const { getLayoutShadowDiagnostic, validateLayoutShadowEvidence, captureLayoutShadowState } =
  require("./lib/e2-webview2-layout-shadow.cjs");
assert.equal(getLayoutShadowDiagnostic("default").css, "");
const override = getLayoutShadowDiagnostic("layout-shadow-omitted");
assert.equal(override.performanceAcceptance, false);
assert.match(override.css, /box-shadow:\s*none\s*!important/);
assert.doesNotMatch(override.css, /opacity|filter|background|border|transform|transition|animation|display|visibility/);
assert.throws(() => getLayoutShadowDiagnostic("arbitrary"));
const base = [{ id: 0, pseudo: null, rect: { x: 2, y: 3, width: 40, height: 40 },
  shadow: "rgba(0, 0, 0, 0.2) 0px 5px 12px 0px",
  opacity: "1", transform: "none", filter: "none", backdropFilter: "blur(4px)",
  background: "linear-gradient(red, blue)", borderRadius: "8px" }];
const after = base.map(item => ({ ...item, shadow: "none" }));
assert.equal(validateLayoutShadowEvidence("layout-shadow-omitted", base, after).matched, true);
assert.equal(validateLayoutShadowEvidence("default", base, base).matched, true);
assert.equal(validateLayoutShadowEvidence("default", base, after).matched, false);
assert.equal(validateLayoutShadowEvidence("layout-shadow-omitted", base, base).matched, false);
assert.equal(validateLayoutShadowEvidence("layout-shadow-omitted", [], []).matched, false);
assert.equal(validateLayoutShadowEvidence("layout-shadow-omitted", after, after).matched, false,
  "the control must contain actual shadows");
for (const key of ["id", "pseudo", "opacity", "transform", "filter", "backdropFilter", "background", "borderRadius"]) {
  assert.equal(validateLayoutShadowEvidence("layout-shadow-omitted", base,
    [{ ...after[0], [key]: "changed" }]).matched, false, key);
}
assert.equal(validateLayoutShadowEvidence("layout-shadow-omitted", base,
  [{ ...after[0], rect: { ...after[0].rect, width: 41 } }]).matched, false);
let inserted = false, finishedShadows = 0, finishedOther = 0;
class FakeTransition {
  constructor(property) { this.transitionProperty = property; }
  finish() { if (this.transitionProperty === "box-shadow") finishedShadows++;
    else finishedOther++; }
}
const node = {
  getBoundingClientRect: () => base[0].rect,
  getAnimations: () => [new FakeTransition("box-shadow"), new FakeTransition("opacity"),
    { transitionProperty: "box-shadow", finish: () => finishedOther++ }],
};
const browserContext = {
  document: { querySelectorAll: () => [node],
    createElement: () => ({ dataset: {} }), head: { append: () => { inserted = true; } } },
  CSSTransition: FakeTransition,
  getComputedStyle: () => ({ boxShadow: inserted && finishedShadows ? "none" : base[0].shadow,
    opacity: "1", transform: "none", filter: "none", backdropFilter: "blur(4px)",
    background: "linear-gradient(red, blue)", borderRadius: "8px" }),
};
const sample = runInNewContext(`(${captureLayoutShadowState.toString()})(${JSON.stringify(override.css)})`,
  browserContext);
assert.equal(sample.completedShadowTransitions.length, 1);
assert.equal(finishedOther, 0, "must not finish content, opacity or author keyframe animations");
assert.equal(validateLayoutShadowEvidence("layout-shadow-omitted", sample.before, sample.after).matched, true);
console.log("PASS: scoped layout shadow-only counterfactual, real shadows and preserved materials/geometry");
