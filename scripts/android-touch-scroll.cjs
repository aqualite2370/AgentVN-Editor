"use strict";

function planControlSwipe(info) {
  const scroll = info.scroll;
  const upper = scroll.y + Math.min(12, scroll.height / 4);
  const lower = scroll.y + scroll.height - Math.min(12, scroll.height / 4);
  const centerError = info.rect.y + info.rect.height / 2 - (scroll.y + scroll.height / 2);
  // Aim at the center, not at the opposite edge of the scrollport. Include
  // touch slop, but cap movement so partially visible rows cannot oscillate
  // between being clipped at the top and bottom.
  const distance = Math.min(Math.abs(centerError) + 16, scroll.height * 0.6, lower - upper);
  const down = centerError > 0;
  return {
    x: scroll.x + scroll.width / 2,
    y1: down ? lower : upper,
    y2: down ? lower - distance : upper + distance,
    settleWithDomScroll: Math.abs(centerError) > scroll.height * 0.5,
  };
}

module.exports = { planControlSwipe };
