"use strict";
const assert = require("node:assert/strict");
const { planControlSwipe } = require("./android-touch-scroll.cjs");

// Real API-35 failure: Save/Load is clipped by 2.4px. Full-scrollport
// gestures send it past the opposite edge, then reverse on the next attempt.
const failure = {
  rect: { x: 520.4286, y: 171.5714, width: 248, height: 48 },
  scroll: { x: 520.4286, y: 13.7619, width: 248.4762, height: 203.3929 },
};
const swipe = planControlSwipe(failure);
const translatedTop = failure.rect.y + swipe.y2 - swipe.y1;
assert(translatedTop >= failure.scroll.y, "scroll gesture overshoots the target past the top edge");
assert(translatedTop + 48 <= failure.scroll.y + failure.scroll.height, "target must fit after scrolling");
assert.equal(swipe.settleWithDomScroll, false);
for (const y of [-90, 20, 171.5714, 340]) {
  const planned = planControlSwipe({ ...failure, rect: { ...failure.rect, y } });
  assert(planned.y1 > failure.scroll.y && planned.y1 < failure.scroll.y + failure.scroll.height);
  assert(planned.y2 > failure.scroll.y && planned.y2 < failure.scroll.y + failure.scroll.height);
  const delta = planned.y1 - planned.y2;
  const centerError = y + 24 - (failure.scroll.y + failure.scroll.height / 2);
  assert.equal(Math.sign(delta), Math.sign(centerError));
  assert(Math.abs(delta) <= failure.scroll.height * 0.6 + 1e-6, "bounded gesture prevents edge-to-edge oscillation");
}
// Real API-35 save-grid failure: a downward swipe from the first card was
// clamped by the WebView while the card remained clipped. A deterministic DOM
// scroll is allowed only as a settling step; the final activation is still ADB.
const clippedAbove = planControlSwipe({ rect: { x: 110, y: -41, width: 202, height: 156 },
  scroll: { x: 107, y: 105, width: 644, height: 291 } });
assert.equal(clippedAbove.settleWithDomScroll, true);
const clippedBelow = planControlSwipe({ rect: { x: 110, y: 350, width: 202, height: 156 },
  scroll: { x: 107, y: 105, width: 644, height: 291 } });
assert.equal(clippedBelow.settleWithDomScroll, true);
console.log("PASS Android touch scrolling: reported geometry, direction, bounds and overshoot");
