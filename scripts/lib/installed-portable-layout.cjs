"use strict";
const assert = require("node:assert/strict");

function portableLayoutFlow(layout) {
  const type = layout.layout_type ?? "agentvn";
  assert(["agentvn", "renpy"].includes(type), `Unsupported portable layout: ${type}`);
  return type === "renpy"
    ? { type, quickActions: ["rollback", "history", "skip", "auto", "save-load", "save", "load", "settings", "hide"],
      menu: { key: "Escape" } }
    : { type, quickActions: [], menu: { toggle: "quick-menu-toggle", button: "open-main-menu" } };
}

function assertRenpyQuickBarGeometry(actual, viewport) {
  assert.equal(actual.buttons.length, 9, "Nine quick actions including Hide must be visible");
  assert.deepEqual(actual.buttons.map(button => button.label),
    ["回退", "历史", "快进", "自动", "存档", "快存", "快读", "设置", "隐藏"]);
  const inside = rect => rect.x >= -1 && rect.y >= -1
    && rect.x + rect.width <= viewport.width + 1
    && rect.y + rect.height <= viewport.height + 1 && rect.width > 0 && rect.height > 0;
  assert(inside(actual.rect), "Quick bar must remain in viewport bounds");
  assert(actual.overflow <= 1 && actual.pageOverflow <= 1, "Quick bar must not scroll or overflow");
  for (const [index, button] of actual.buttons.entries()) {
    assert(inside(button.rect), `${button.label} must remain in viewport bounds`);
    assert(button.hit, `${button.label} hit target must belong to the actual button`);
    assert(!button.clipped, `${button.label} must not be clipped`);
    assert(Math.abs(button.rect.y - actual.buttons[0].rect.y) <= 1, "Quick actions must share one row");
    if (index > 0) assert(button.rect.x >= actual.buttons[index - 1].rect.x
      + actual.buttons[index - 1].rect.width - 1, "Quick actions must not overlap");
  }
}

module.exports = { portableLayoutFlow, assertRenpyQuickBarGeometry };
