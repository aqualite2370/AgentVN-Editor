"use strict";
const assert = require("node:assert/strict");
const { summarizeSettledAdvancedLayers } = require("./lib/advanced-layer-visibility.cjs");
const active = { tab: "settings", className: "advanced-tab-content is-active",
  display: "block", visibility: "visible", opacity: "1", inert: false, ariaHidden: "false", pointerEvents: "auto" };
const warm = { ...active, tab: "layout", className: "advanced-tab-content is-warm",
  opacity: "0.001", inert: true, ariaHidden: "true", pointerEvents: "none" };
assert.equal(summarizeSettledAdvancedLayers([active, warm], true).visibleLayers, 1);
assert.equal(summarizeSettledAdvancedLayers([active, warm], false).visibleLayers, 2,
  "prepaint must not be excluded without this viewport's pixel proof");
assert.equal(summarizeSettledAdvancedLayers([active, { ...warm, opacity: "0" }], false).visibleLayers, 1);
for (const bad of [{ opacity: "0.01" }, { inert: false }, { ariaHidden: "false" },
  { pointerEvents: "auto" }, { tab: "theme" }, { className: "advanced-tab-content is-leaving" }]) {
  assert.equal(summarizeSettledAdvancedLayers([active, { ...warm, ...bad }], true).visibleLayers, 2,
    "painted residue or interactive hidden layer must still fail");
}
assert.equal(summarizeSettledAdvancedLayers([active, { ...warm, display: "none" }], false).visibleLayers, 1);
console.log("PASS settled visibility requires pixel-qualified, inert, exact-alpha layout warm layers");
