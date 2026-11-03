"use strict";
const expectedCategories = [["text", "文字"], ["audio", "音频"], ["skip", "跳过"], ["system", "系统"]];
function validateQuickBar(g) {
  const ids = ["rollback", "history", "skip", "auto", "save-load", "save", "load", "settings", "hide"];
  const pass = g.buttons.length === 9 && g.buttons.every((b, i) => b.id === ids[i] && b.hit
    && b.rect.width > 0 && b.rect.height > 0
    && Math.abs(b.rect.top - g.buttons[0].rect.top) <= 1
    && b.rect.left >= -1 && b.rect.right <= g.width + 1
    && (!i || b.rect.left >= g.buttons[i - 1].rect.right - 1));
  return { ...g, status: pass ? "PASS" : "FAILED" };
}
module.exports = { validateQuickBar, expectedCategories };
