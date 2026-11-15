"use strict";
// Controlled rendering fixture for the existing v2 preview protocol. It is
// intentionally separate from an author export or fixed-game persistence test.
const assert = require("node:assert/strict"), zlib = require("node:zlib");
const crypto = require("node:crypto");
const crc32 = require("../../editor/node_modules/jszip/lib/crc32");
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function raster(width, height, color) {
  const chunk = (type, bytes) => {
    const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])) >>> 0);
    return Buffer.concat([size, name, bytes, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  const rgb = Buffer.from(color.slice(1), "hex");
  for (let y = 0; y < height; y++)
    scanlines.fill(rgb, y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
}
function createSpritePreview({ manifest, script, uiSkin, type }) {
  assert(["agentvn", "renpy"].includes(type));
  assert.equal(uiSkin.layout_type || "agentvn", type);
  const original = JSON.stringify({ manifest, script, uiSkin });
  const nextManifest = structuredClone(manifest), nextScript = structuredClone(script);
  const id = "qa_android_sprite_1975_" + type;
  const scene = "count_geometry";
  const assets = [], images = [], assetUrls = {};
  for (const [name, width, height, color] of [
    ["wide", 900, 600, "#316a8a"], ["tall", 420, 1100, "#8a4267"],
  ]) {
    const bytes = raster(width, height, color);
    const asset = { asset_id: "sprite_" + name, asset_type: "sprite",
      path: "assets/sprite/" + name + ".png", mime_type: "image/png", size_bytes: bytes.length };
    assets.push(asset);
    images.push({ ...asset, width, height, sha256: sha256(bytes) });
    assetUrls[asset.asset_id] = assetUrls[asset.path] = "data:image/png;base64," + bytes.toString("base64");
  }
  nextManifest.game_id = nextScript.game_id = id;
  nextManifest.entry_scene_id = nextScript.entry_scene_id = scene;
  nextManifest.assets = assets;
  const show = (i, scale = i ? 1.15 : .85) => ({ type: "sprite",
    character_id: "c" + i, sprite_id: i ? "sprite_tall" : "sprite_wide",
    position: i === 0 ? "left" : i === 1 ? "right" : "center",
    visible: true, scale, offset_x: i ? 0 : 2, offset_y: 0, animation: "fade_in" });
  const hide = i => ({ ...show(i), visible: false, animation: "fade_out" });
  const say = text => ({ type: "narration", text });
  const commands = [show(0), say("SIZE_STAGE_1"), show(1), say("SIZE_STAGE_2"),
    ...[2, 3, 4].map(i => show(i)), say("SIZE_STAGE_5"),
    ...[1, 2, 3, 4].map(hide), say("SIZE_STAGE_RETURN_1"),
    show(0, 1.1), say("SIZE_STAGE_AUTHOR_SCALE")];
  nextScript.characters = Array.from({ length: 5 }, (_, i) => ({ character_id: "c" + i, name: "角色" + i }));
  nextScript.scenes = [{ scene_id: scene, title: "Sprite geometry", chapter: 1, tags: [], commands }];
  const requestId = "sprite-init-" + type;
  const message = { type: "agentvn.live-preview.init", protocolVersion: 2,
    sessionId: id, revision: 1, requestId, runId: id + "_run",
    manifest: nextManifest, script: nextScript, uiSkin: structuredClone(uiSkin), assetUrls,
    start: { requestId, target: { sceneId: scene, commandIndex: 1 },
      entryPath: [], mode: "play_target_event", playbackRate: 1, reducedMotion: false } };
  assert.equal(JSON.stringify({ manifest, script, uiSkin }), original);
  return { message, evidence: { type, images, sourceManifestSha256: sha256(Buffer.from(JSON.stringify(manifest))),
    scriptSha256: sha256(Buffer.from(JSON.stringify(nextScript))),
    uiSkinSha256: sha256(Buffer.from(JSON.stringify(uiSkin))),
    scope: "CONTROLLED_V2_PREVIEW_PAYLOAD_NOT_AUTHOR_EXPORT_OR_FIXED_GAME" } };
}
module.exports = { createSpritePreview };
