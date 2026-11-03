"use strict";
const assert = require("node:assert/strict");
const { getSectionSelector, installSectionOmission, inspectSectionOmission } =
  require("./lib/e2-section-omission.cjs");

for (const section of ["header", "toolbar", "sidebar", "center", "inspector"]) {
  assert.equal(getSectionSelector(section), `.runtime-layout-${section}`);
}
for (const section of ["", null, "stage", "center,body", "center}"]) {
  assert.throws(() => getSectionSelector(section), /unsupported section/);
}
let handler, removed = 0;
const fakeStyle = { disabled: false, dataset: {}, remove() { removed++; } };
const previousDocument = global.document;
const previousWindow = global.window;
global.window = {};
global.document = {
  createElement(tag) { assert.equal(tag, "style"); return fakeStyle; },
  head: { appendChild(node) { assert.equal(node, fakeStyle); } },
  addEventListener(type, next, capture) {
    assert.equal(type, "pointerdown"); assert.equal(capture, true); handler = next;
  },
  removeEventListener(type, next, capture) {
    assert.equal(type, "pointerdown"); assert.equal(next, handler); assert.equal(capture, true);
  },
};
try {
  installSectionOmission(".runtime-layout-center");
  assert(fakeStyle.textContent.includes('.advanced-tab-content.is-warm[data-tab="layout"]'));
  assert(fakeStyle.textContent.includes("display:none!important"));
  assert(!fakeStyle.textContent.includes("ready"), "must not forge readiness");
  handler({ isTrusted: false, target: { closest: () => ({}) } });
  assert.equal(fakeStyle.disabled, false, "synthetic input cannot restore omission");
  handler({ isTrusted: true, target: { closest: () => null } });
  assert.equal(fakeStyle.disabled, false, "unrelated real input leaves diagnostic unchanged");
  handler({ isTrusted: true, target: { closest: () => ({}) } });
  assert.equal(fakeStyle.disabled, true, "restore before genuine layout navigation");
  assert.equal(window.__e2SectionOmission.restored, true);
  handler({ isTrusted: true, target: { closest: () => ({}) } });
  assert.equal(window.__e2SectionOmission.restores, 1, "restore exactly once");
  window.__e2SectionOmission.cleanup();
  assert.equal(removed, 1, "remove owned stylesheet");
  assert.throws(() => installSectionOmission("body"), /unsupported selector/);
  assert.equal(typeof inspectSectionOmission, "function");
} finally {
  global.document = previousDocument;
  global.window = previousWindow;
}
console.log("PASS: scoped omission, trusted restoration, cleanup, no forged readiness");
