"use strict";
const fs = require("node:fs"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const file = "F:/AgentVN/QA/Android-Package-20261021-01/editor-10/Android 隔离小工程.vnproj";
const digest = "6335ef181e05589ba1ae5102a86d02f6960aefe438be1aa554eb3ccdd50ffece";
function oldFixture() {
  const bytes = fs.readFileSync(file);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), digest);
  return JSON.parse(bytes);
}
function retainedAndroidFixture() {
  const project = oldFixture();
  project.nodes[1].data.scene.commands = [0, 1, 2].map(i => ({
    type: "narration", text: `QA_ANDROID_UPGRADE_NEW_${i}：当前安装版生成的同身份新版，验证保留旧存档及偏好后推进新内容。`,
  }));
  const r = { project, gameVersion: "0.1.1", versionCode: 1001,
    applicationId: "com.agentvn.qa.androidcurrent20261021", source: { path: file, sha256: digest } };
  validateAndroidFixture(r); return r;
}
function validateAndroidFixture(r) {
  assert.equal(r.source.path, file); assert.equal(r.source.sha256, digest);
  assert.equal(r.gameVersion, "0.1.1"); assert.equal(r.versionCode, 1001);
  assert.equal(r.applicationId, "com.agentvn.qa.androidcurrent20261021");
  const original = oldFixture(), copy = structuredClone(r.project);
  assert.equal(copy.nodes[1].data.scene.commands.length, 3);
  copy.nodes[1].data.scene.commands.forEach((command, i) => assert.deepEqual(command, {
    type: "narration", text: `QA_ANDROID_UPGRADE_NEW_${i}：当前安装版生成的同身份新版，验证保留旧存档及偏好后推进新内容。`,
  }));
  copy.nodes[1].data.scene.commands = original.nodes[1].data.scene.commands;
  assert.deepEqual(copy, original); return true;
}
module.exports = { retainedAndroidFixture, validateAndroidFixture };
