import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGenerationAssetCatalog,
  buildGenerationAssetContextText,
  buildGenerationAssetSummaryText,
  sanitizeGeneratedSceneAssetReferences,
} from "./generatedAssetReferences.ts";

test("builds a compact catalog from usable visual assets only", () => {
  const catalog = buildGenerationAssetCatalog([
    {
      asset_id: "bg_school_gate",
      asset_type: "background",
      metadata: { display_name: "学校门口", mime_type: "image/png" },
    },
    {
      asset_id: "alice_uniform",
      asset_type: "sprite",
      metadata: { display_name: "爱丽丝校服", character_id: "alice", mime_type: "image/webp" },
    },
    {
      asset_id: "missing_clue",
      asset_type: "ui",
      metadata: { display_name: "缺失线索图", placeholder: true, tags: ["missing"] },
    },
    {
      asset_id: "theme_song",
      asset_type: "bgm",
      metadata: { display_name: "主题曲", mime_type: "audio/ogg" },
    },
  ]);

  assert.deepEqual(catalog, [
    {
      asset_id: "bg_school_gate",
      asset_type: "background",
      display_name: "学校门口",
    },
    {
      asset_id: "alice_uniform",
      asset_type: "sprite",
      display_name: "爱丽丝校服",
      character_id: "alice",
    },
  ]);
});

test("describes the visual asset catalog as a strict reference whitelist", () => {
  const context = JSON.parse(buildGenerationAssetContextText([
    {
      asset_id: "bg_school_gate",
      asset_type: "background",
      metadata: { display_name: "学校门口" },
    },
  ]));

  assert.deepEqual(context.policy, {
    reference_only_listed_visual_assets: true,
    omit_unavailable_visual_commands: true,
    never_invent_asset_ids: true,
  });
  assert.deepEqual(context.visual_assets, [
    {
      asset_id: "bg_school_gate",
      asset_type: "background",
      display_name: "学校门口",
    },
  ]);
});

test("provides a compact ID-only whitelist when the full asset catalog exceeds context budget", () => {
  const assets = [
    {
      asset_id: "bg_school_gate",
      asset_type: "background",
      metadata: { display_name: "雨后黄昏时分的学校正门全景" },
    },
    {
      asset_id: "alice_uniform",
      asset_type: "sprite",
      metadata: { display_name: "爱丽丝校服立绘", character_id: "alice" },
    },
  ];
  const full = buildGenerationAssetContextText(assets);
  const summary = buildGenerationAssetSummaryText(assets);

  assert.ok(summary.length < full.length);
  assert.deepEqual(JSON.parse(summary), {
    policy: {
      reference_only_listed_visual_assets: true,
      omit_unavailable_visual_commands: true,
      never_invent_asset_ids: true,
    },
    visual_asset_ids_by_type: {
      background: ["bg_school_gate"],
      sprite: ["alice_uniform"],
    },
  });
});

test("allows imported image files with a generic asset type to be used by show_image", () => {
  const assets = [
    {
      asset_id: "clue_photo",
      asset_type: "other",
      metadata: { display_name: "线索照片", mime_type: "image/png" },
    },
  ];
  const scene = {
    scene_id: "scene_photo",
    title: "照片",
    summary: "展示线索照片。",
    chapter: 1,
    tags: [],
    commands: [{ type: "show_image", image_id: "clue_photo", caption: "照片上的钟停在午夜。" }],
  };

  assert.deepEqual(buildGenerationAssetCatalog(assets), [
    { asset_id: "clue_photo", asset_type: "other", display_name: "线索照片" },
  ]);
  assert.deepEqual(sanitizeGeneratedSceneAssetReferences(scene, assets), {
    scene,
    removed: [],
  });
});

test("keeps generated story content and valid visual commands unchanged", () => {
  const scene = {
    scene_id: "scene_next",
    title: "校门重逢",
    summary: "爱丽丝在雨后的校门口等待。",
    chapter: 2,
    tags: ["reunion"],
    commands: [
      { type: "background", background_id: "bg_school_gate", transition: "fade" },
      { type: "sprite", character_id: "alice", sprite_id: "alice_uniform", visible: true, position: "left" },
      { type: "dialog", character_id: "alice", text: "你终于来了。", portrait: "alice_uniform" },
    ],
  };
  const assets = [
    { asset_id: "bg_school_gate", asset_type: "background", metadata: {} },
    { asset_id: "alice_uniform", asset_type: "sprite", metadata: { character_id: "alice" } },
  ];

  assert.deepEqual(sanitizeGeneratedSceneAssetReferences(scene, assets), {
    scene,
    removed: [],
  });
});

test("drops only nonexistent visual references while preserving the generated story beat", () => {
  const result = sanitizeGeneratedSceneAssetReferences(
    {
      scene_id: "scene_clue",
      title: "雨夜线索",
      summary: "主角在雨夜发现一张照片。",
      chapter: 2,
      tags: ["clue"],
      commands: [
        { type: "background", background_id: "bg_invented" },
        {
          type: "show_image",
          image_id: "photo_invented",
          caption: "照片背面写着：午夜前不要回头。",
          image_fit: "contain",
        },
        { type: "sprite", character_id: "alice", sprite_id: "alice_invented", visible: true },
        { type: "dialog", character_id: "alice", text: "这不是我的字。", portrait: "alice_invented" },
      ],
    },
    [],
  );

  assert.deepEqual(result.scene.commands, [
    { type: "narration", text: "照片背面写着：午夜前不要回头。" },
    { type: "dialog", character_id: "alice", text: "这不是我的字。", portrait: null },
  ]);
  assert.deepEqual(result.removed, [
    { command_type: "background", field: "background_id", asset_id: "bg_invented", action: "removed" },
    { command_type: "show_image", field: "image_id", asset_id: "photo_invented", action: "converted_to_narration" },
    { command_type: "sprite", field: "sprite_id", asset_id: "alice_invented", action: "removed" },
    { command_type: "dialog", field: "portrait", asset_id: "alice_invented", action: "cleared" },
  ]);
  assert.equal(result.scene.title, "雨夜线索");
  assert.equal(result.scene.summary, "主角在雨夜发现一张照片。");
});

test("keeps sprite exit commands because hiding a character does not require an asset file", () => {
  const scene = {
    scene_id: "scene_exit",
    title: "离场",
    summary: "爱丽丝离开画面。",
    chapter: 2,
    tags: [],
    commands: [
      { type: "sprite", character_id: "alice", sprite_id: "alice_invented", visible: false },
    ],
  };

  assert.deepEqual(sanitizeGeneratedSceneAssetReferences(scene, []), {
    scene,
    removed: [],
  });
});
