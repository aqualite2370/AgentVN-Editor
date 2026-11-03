"use strict";
const assert = require("node:assert/strict");
const { getCheckboxPaintDiagnostic, validateCheckboxPaintEvidence } =
  require("./lib/e2-webview2-checkbox-paint.cjs");

const control = getCheckboxPaintDiagnostic("default");
assert.equal(control.css, "");
assert.equal(control.performanceAcceptance, false);
const omitted = getCheckboxPaintDiagnostic("checkbox-paint-omitted");
assert.match(omitted.css, /\.runtime-layout-designer input\[type="checkbox"\]/);
assert.match(omitted.css, /opacity:\s*0\s*!important/);
assert.doesNotMatch(omitted.css, /display|visibility|transform|transition|animation|filter|background|width|height/);
assert.throws(() => getCheckboxPaintDiagnostic("arbitrary-selector"));

const before = [
  { id: 0, rect: { x: 2, y: 3, width: 36, height: 36 }, checked: true, disabled: false,
    opacity: "1", display: "inline-grid", visibility: "visible", transform: "matrix(1, 0, 0, 1, 0, 0)" },
  { id: 1, rect: { x: 2, y: 46, width: 36, height: 36 }, checked: false, disabled: true,
    opacity: "0.48", display: "inline-grid", visibility: "visible", transform: "matrix(1, 0, 0, 1, 0, 0)" },
];
const after = before.map(item => ({ ...item, opacity: "0" }));
assert.equal(validateCheckboxPaintEvidence("checkbox-paint-omitted", before, after).matched, true);
assert.equal(validateCheckboxPaintEvidence("default", before, before).matched, true);
assert.equal(validateCheckboxPaintEvidence("default", before, after).matched, false);
assert.equal(validateCheckboxPaintEvidence("checkbox-paint-omitted", before, before).matched, false);
assert.equal(validateCheckboxPaintEvidence("checkbox-paint-omitted", [], []).matched, false);
for (const key of ["checked", "disabled", "display", "visibility", "transform"]) {
  const changed = after.map(item => ({ ...item, [key]: "changed" }));
  assert.equal(validateCheckboxPaintEvidence("checkbox-paint-omitted", before, changed).matched, false, key);
}
assert.equal(validateCheckboxPaintEvidence("checkbox-paint-omitted", before, [
  { ...after[0], rect: { ...after[0].rect, width: 37 } }, after[1],
]).matched, false);
assert.equal(validateCheckboxPaintEvidence("checkbox-paint-omitted", before, after.slice(1)).matched, false);
console.log("PASS: checkbox paint diagnostic scope, nonempty evidence, geometry/state preservation and default control");
