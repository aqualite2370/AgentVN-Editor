"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), zlib = require("node:zlib");
const { createSpritePreview } = require("./lib/sprite-preview-fixture.cjs");
function input(type) {
  return { type, manifest: { game_id: "source", assets: [{ asset_id: "private" }] },
    script: { game_id: "source", entry_scene_id: "old", scenes: [{ scene_id: "old" }] },
    uiSkin: { layout_type: type, dialogPortrait: { width: 224 } } };
}
test("two themes use isolated identities, preserve authored layout and leave originals unchanged", () => {
  for (const type of ["agentvn", "renpy"]) {
    const original = input(type), before = structuredClone(original);
    const result = createSpritePreview(original);
    assert.deepEqual(original, before);
    assert.equal(result.message.manifest.game_id, "qa_android_sprite_1975_" + type);
    assert.deepEqual(result.message.uiSkin, before.uiSkin);
    assert.notEqual(result.message.uiSkin, original.uiSkin);
    assert.deepEqual(result.message.start.target, { sceneId: "count_geometry", commandIndex: 1 });
    assert.equal(result.message.script.scenes.length, 1);
    assert(!JSON.stringify(result.message).includes('"private"'));
  }
});
test("data URLs decode into real PNG scanlines with the recorded wide/tall dimensions", () => {
  const { message, evidence } = createSpritePreview(input("renpy"));
  for (const image of evidence.images) {
    const bytes = Buffer.from(message.assetUrls[image.asset_id].split(",")[1], "base64");
    assert.equal(bytes.readUInt32BE(16), image.width);
    assert.equal(bytes.readUInt32BE(20), image.height);
    const parts = [];
    for (let at = 8; at < bytes.length;) {
      const size = bytes.readUInt32BE(at), type = bytes.subarray(at + 4, at + 8).toString();
      if (type === "IDAT") parts.push(bytes.subarray(at + 8, at + 8 + size));
      at += size + 12;
    }
    const scanlines = zlib.inflateSync(Buffer.concat(parts));
    assert.equal(scanlines.length, (image.width * 3 + 1) * image.height);
    assert.equal(scanlines[0], 0);
    assert(scanlines[1] > 0);
    assert.equal(message.assetUrls[image.asset_id], message.assetUrls[image.path]);
  }
});
test("fixture exercises additions, exits and an explicit author size change", () => {
  const { message } = createSpritePreview(input("agentvn"));
  const commands = message.script.scenes[0].commands;
  const present = new Set(), counts = [];
  for (const command of commands) {
    if (command.type === "sprite") {
      if (command.visible) present.add(command.character_id);
      else present.delete(command.character_id);
    } else counts.push(present.size);
  }
  assert.deepEqual(counts, [1, 2, 5, 1, 1]);
  const main = commands.filter(c => c.type === "sprite" && c.character_id === "c0");
  assert.deepEqual(main.map(c => c.scale), [.85, 1.1]);
  assert(main.every(c => c.offset_x === 2));
  assert.equal(commands.filter(c => c.visible === false).length, 4);
  assert.throws(() => createSpritePreview({ ...input("agentvn"), type: "renpy" }));
});
