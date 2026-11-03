"use strict";
const assert = require("node:assert/strict");
const { rectOutsideRoot } = require("../visible-control-geometry.cjs");
// Preserve the original snapshot. Only attach evidence obtained by the existing
// real-ADB swipe/actionability path; no blanket exemption for scrollable content.
async function verifyScrollableSaveCards(state, reach) {
  for (const button of state.buttons) {
    if (!String(button.className).split(/\s+/).includes("save-card-main")
      || !rectOutsideRoot(button.rect, state.root)) continue;
    const rect = await reach(`button.save-card-main[aria-label=${JSON.stringify(button.label)}]`,
      `reach complete ${button.label}`, { scrollOnly: true });
    assert(rect && rect.width > 0 && rect.height > 0 && !rectOutsideRoot(rect, state.root), "SAVE_CARD_STILL_OUTSIDE");
    button.reachableRect = rect;
  }
  return state;
}
module.exports = { verifyScrollableSaveCards };
