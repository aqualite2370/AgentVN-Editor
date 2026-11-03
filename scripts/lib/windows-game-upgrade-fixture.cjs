"use strict";
const fs = require("node:fs"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const sourcePath = "F:/AgentVN/QA/Windows-Package-20261021-01/editor-01/独立 Windows 小工程.vnproj";
const sourceHash = "3cb8f244c60917d3115e8dcce015aa41cf14226c5825721a69966d176a207f63";
function oldFixture() {
  const bytes = fs.readFileSync(sourcePath);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), sourceHash,
    "Retained original fixture must not be modified");
  return JSON.parse(bytes);
}
function retainedUpgradeFixture() {
  const project = oldFixture();
  project.nodes[1].data.scene.commands = [0, 1, 2].map(i => ({
    type: "narration", text: `QA_WINDOWS_UPGRADE_NEW_${i}：同游戏新版1.0.1，验证旧存档位置、偏好和更新后的实际剧情。`,
  }));
  const result = { project, version: "1.0.1", marker: "QA_WINDOWS_UPGRADE_NEW",
    source: { path: sourcePath, sha256: sourceHash }, oldEditorVersion: "1.9.16", newEditorVersion: "1.9.22" };
  validateUpgradeFixture(result);
  return result;
}
function validateUpgradeFixture(result) {
  const original = oldFixture(), restored = structuredClone(result.project);
  assert.equal(result.source.path, sourcePath); assert.equal(result.source.sha256, sourceHash);
  assert.equal(result.version, "1.0.1"); assert.equal(result.marker, "QA_WINDOWS_UPGRADE_NEW");
  assert.equal(result.oldEditorVersion, "1.9.16"); assert.equal(result.newEditorVersion, "1.9.22");
  const commands = restored.nodes[1].data.scene.commands;
  assert.equal(commands.length, 3);
  commands.forEach((command, i) => {
    assert.deepEqual(Object.keys(command).sort(), ["text", "type"]);
    assert.equal(command.type, "narration");
    assert.equal(command.text,
      `QA_WINDOWS_UPGRADE_NEW_${i}：同游戏新版1.0.1，验证旧存档位置、偏好和更新后的实际剧情。`);
  });
  // Only the text changes. IDs, command indexes, graph and both layout inputs stay exact.
  restored.nodes[1].data.scene.commands = original.nodes[1].data.scene.commands;
  assert.deepEqual(restored, original);
  return true;
}
module.exports = { retainedUpgradeFixture, validateUpgradeFixture };
