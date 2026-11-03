"use strict";
const assert = require("node:assert/strict");
function fixtureFor(config) {
  const value = require("../installed-editor-windows-upgrade-candidate.cjs").fixtureFor(config.version);
  if (config.gameVersion === undefined) return value;
  assert.equal(config.gameVersion, "1.0.4");
  assert.equal(config.upgradeFromEditor, "1.9.34");
  assert.equal(config.nativeAutomation, "repository-native-v1");
  value.version = config.gameVersion;
  value.project.nodes[1].data.scene.commands = [0, 1, 2].map(i => ({
    type: "narration",
    text: `QA_WINDOWS_UPGRADE_CURRENT_${i}：同游戏新版1.0.4，验证最近旧Runtime存档保留与本轮新剧情资源。`,
  }));
  return value;
}
module.exports = { fixtureFor };
