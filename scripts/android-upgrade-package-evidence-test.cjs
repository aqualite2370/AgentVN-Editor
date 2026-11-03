"use strict";
// QA validator tests. These do not claim an APK build or device upgrade.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { parseIdentity, validatePair, validateCartridge } = require("./lib/android-upgrade-package-evidence.cjs");
const oldProject = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Android-Package-20261021-01/editor-10/Android 隔离小工程.vnproj", "utf8"));
const signature = "Verifies\nVerified using v2 scheme (APK Signature Scheme v2): true\n"
  + "Signer #1 certificate SHA-256 digest: " + "a".repeat(64) + "\n";
const old = parseIdentity(signature, "package: name='com.agentvn.qa.androidcurrent20261021' versionCode='1000' versionName='0.1.0'");
const current = { ...old, versionCode: 1001, versionName: "0.1.1" };
validatePair(old, current);
const invalidPairs = [
  x => { x.packageName += ".other"; }, x => { x.versionCode = 1000; },
  x => { x.versionName = "0.1.0"; }, x => { x.signerSha256 = "b".repeat(64); },
];
for (const mutate of invalidPairs) { const x = structuredClone(current); mutate(x); assert.throws(() => validatePair(old, x)); }
for (const invalidSignature of [signature.replace("Verifies", "DOES NOT VERIFY"),
  signature.replace("true", "false"), signature + "Signer #2 certificate SHA-256 digest: " + "b".repeat(64),
  signature.replace("a".repeat(64), "bad")]) assert.throws(() => parseIdentity(invalidSignature,
  "package: name='com.agentvn.qa.androidcurrent20261021' versionCode='1000' versionName='0.1.0'"));
const fixture = structuredClone(oldProject);
fixture.nodes[1].data.scene.commands = [0, 1, 2].map(i => ({
  type: "narration", text: `QA_ANDROID_UPGRADE_NEW_${i}：测试文本`,
}));
const manifest = { game_id: fixture.project_id, title: fixture.title, version: "0.1.1",
  entry_scene_id: "ui_acceptance", assets: [], ui_skin: { path: "ui/layout.json" } };
const script = { scenes: [structuredClone(fixture.nodes[1].data.scene)] };
const layout = { layout_type: "agentvn" };
validateCartridge(oldProject, fixture, manifest, script, layout);
const invalidContents = [
  x => { x.manifest.game_id = "different"; }, x => { x.manifest.version = "0.1.0"; },
  x => { x.project.nodes[1].id = "different"; }, x => { x.project.edges = []; },
  x => { x.script.scenes[0].commands[0].text = "old"; }, x => { x.script.scenes.push(x.script.scenes[0]); },
  x => { x.layout.layout_type = "renpy"; }, x => { x.manifest.assets = [{ asset_id: "untracked" }]; },
];
for (const mutate of invalidContents) {
  const x = structuredClone({ project: fixture, manifest, script, layout }); mutate(x);
  assert.throws(() => validateCartridge(oldProject, x.project, x.manifest, x.script, x.layout));
}
console.log(JSON.stringify({ status: "PASS", rejectedVariants: invalidPairs.length + 4 + invalidContents.length,
  scope: "QA_VALIDATOR_ONLY_NOT_APK_OR_DEVICE_ACCEPTANCE" }));
