"use strict";
// New game version only. Retained release policies remain byte-for-byte sealed.
const assert = require("node:assert/strict");
function fixtureFor(config) {
  if (config.gameVersion !== "1.0.5")
    return require("./windows-upgrade-fixture-policy.cjs").fixtureFor(config);
  assert.equal(config.version, "1.9.40");
  assert.equal(config.upgradeFromEditor, "1.9.35");
  assert.equal(config.nativeAutomation, "repository-native-v1");
  const value = require("../installed-editor-windows-upgrade-candidate.cjs").fixtureFor(config.version);
  value.version = "1.0.5";
  value.project.nodes[1].data.scene.commands = [0, 1, 2].map(i => ({
    type: "narration",
    text: `QA_WINDOWS_UPGRADE_CURRENT_${i}：同游戏新版1.0.5，验证1.9.35导出旧游戏的实际存档保留与更新正文。`,
  }));
  return value;
}
module.exports = { fixtureFor };
