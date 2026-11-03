"use strict";
const assert = require("node:assert/strict");
const { validateQuickBar, expectedCategories } = require("./lib/installed-runtime-motion-1922-policy.cjs");
const row = { width: 1920, buttons: Array.from({ length: 9 }, (_, i) => ({
  id: ["rollback", "history", "skip", "auto", "save-load", "save", "load", "settings", "hide"][i],
  hit: true, rect: { top: 980, left: 300 + i * 90, right: 380 + i * 90, width: 80, height: 30 },
})) };
assert.equal(validateQuickBar(row).status, "PASS");
for (const mutate of [
  r => r.buttons.pop(),
  r => r.buttons.push(structuredClone(r.buttons[0])),
  r => { r.buttons[1].hit = false; },
  r => { r.buttons[2].rect.top += 31; },
  r => { r.buttons[4].rect.right = 1950; },
  r => { r.buttons[3].id = "unknown"; },
  r => { r.buttons[1].rect.left = 310; },
]) {
  const bad = structuredClone(row); mutate(bad);
  assert.equal(validateQuickBar(bad).status, "FAILED");
}
assert.deepEqual(expectedCategories, [["text", "文字"], ["audio", "音频"], ["skip", "跳过"], ["system", "系统"]]);
console.log("PASS current nine-item quick-bar baseline; seven missing/wrapped/overlap/input mutations rejected");
