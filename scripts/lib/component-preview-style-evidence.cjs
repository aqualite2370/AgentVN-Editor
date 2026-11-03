"use strict";
const assert = require("node:assert/strict");
// The tested component declares only a solid background-color, not an image.
// Checking only backgroundColor misses opaque Editor theme gradients above it.
function validateSolidComponentPreview(samples) {
  assert(Array.isArray(samples) && samples.length >= 8);
  const last = samples.slice(-8);
  assert(last.every(s => s.label?.startsWith("分享组件") && s.hovered === false));
  assert(last.every(s => s.inline.backgroundColor === "rgb(34, 51, 68)" && s.inline.color === "rgb(255, 255, 255)"));
  assert(last.every(s => JSON.stringify(s.actual) === JSON.stringify(last[0].actual)));
  assert(last.every(s => s.actual.backgroundColor === s.inline.backgroundColor && s.actual.color === s.inline.color));
  assert(last.every(s => s.actual.backgroundImage === "none"), "Undeclared Editor background image overlays the authored solid component background");
}
module.exports = { validateSolidComponentPreview };
