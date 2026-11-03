"use strict";
const assert = require("node:assert/strict");
const packageName = "com.agentvn.qa.androidcurrent20261021";
function parseIdentity(signature, badging) {
  assert.match(signature, /^Verifies\r?$/m, "Actual apksigner verification required");
  assert.match(signature, /^Verified using v2 scheme.*:\s*true\r?$/m);
  const certs = [...signature.matchAll(/^Signer #(\d+) certificate SHA-256 digest:\s*([a-f0-9]{64})\r?$/gim)];
  assert.equal(certs.length, 1, "This retained sample has exactly one signer");
  assert.equal(certs[0][1], "1");
  const records = [...badging.matchAll(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/gm)];
  assert.equal(records.length, 1);
  const [, name, code, version] = records[0];
  assert.equal(name, packageName);
  assert(Number.isSafeInteger(Number(code)) && Number(code) > 0);
  return { packageName: name, versionCode: Number(code), versionName: version, signerSha256: certs[0][2].toLowerCase() };
}
function validatePair(old, current) {
  assert.equal(old.packageName, packageName); assert.equal(current.packageName, packageName);
  assert.equal(old.versionCode, 1000); assert.equal(old.versionName, "0.1.0");
  assert.equal(current.versionCode, 1001); assert.equal(current.versionName, "0.1.1");
  assert.match(old.signerSha256, /^[a-f0-9]{64}$/); assert.equal(current.signerSha256, old.signerSha256);
  return true;
}
function validateCartridge(oldProject, project, manifest, script, layout) {
  assert.equal(project.project_id, "qa_android_pkg_20261021_10");
  assert.equal(project.title, "AVN Android QA 20261021");
  const original = oldProject.nodes.map(n => n.data?.scene).filter(Boolean);
  const authored = project.nodes.map(n => n.data?.scene).filter(Boolean);
  assert.equal(original.length, 1); assert.equal(authored.length, 1);
  const copy = structuredClone(project);
  const copiedScene = copy.nodes.find(n => n.data?.scene).data.scene;
  assert.equal(authored[0].commands.length, 3);
  authored[0].commands.forEach((c, i) => {
    assert.equal(c.type, "narration"); assert(c.text.startsWith(`QA_ANDROID_UPGRADE_NEW_${i}：`));
    assert.deepEqual(Object.keys(c).sort(), ["text", "type"]);
  });
  copiedScene.commands = structuredClone(original[0].commands);
  assert.deepEqual(copy, oldProject, "Only the three authored lines may change, not identity or graph positions");
  assert.equal(manifest.game_id, project.project_id); assert.equal(manifest.title, project.title);
  assert.equal(manifest.version, "0.1.1"); assert.equal(manifest.entry_scene_id, original[0].scene_id);
  assert.deepEqual(manifest.assets, []); assert.deepEqual(project.asset_manifest, []);
  assert.equal(manifest.ui_skin.path, "ui/layout.json"); assert.equal(layout.layout_type ?? "agentvn", "agentvn");
  assert.equal(script.scenes.length, 1); assert.equal(script.scenes[0].scene_id, original[0].scene_id);
  assert.deepEqual(script.scenes[0].commands.map(c => ({ type: c.type, text: c.text })), authored[0].commands);
  return true;
}
module.exports = { parseIdentity, validatePair, validateCartridge };
