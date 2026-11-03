#!/usr/bin/env node
"use strict";

const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const GAMECLI_ROOT = path.join(ROOT, "GameCli_framework");

global.window = global.window || {};
global.window.setTimeout = setTimeout;
global.window.clearTimeout = clearTimeout;
global.window.dispatchEvent = global.window.dispatchEvent || (() => true);
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const manifest = {
  game_id: "scene_sprite_isolation_contract",
  title: "Scene Sprite Isolation Contract",
  version: "1.0.0",
  locale: "zh-CN",
  assets: [
    { asset_id: "sprite_old", type: "sprite", path: "old.png" },
    { asset_id: "sprite_new", type: "sprite", path: "new.png" },
  ],
  entry_scene_id: "scene_a",
};

const scriptData = {
  schema_version: "1.0.0",
  entry_scene_id: "scene_a",
  characters: [{ character_id: "hero", name: "Hero" }],
  scenes: [
    {
      scene_id: "scene_a",
      title: "Scene A",
      summary: "Shows the old sprite.",
      tags: [],
      chapter: 1,
      commands: [
        { type: "sprite", character_id: "hero", sprite_id: "sprite_old", position: "left", visible: true, scale: 1.25 },
      ],
    },
    {
      scene_id: "scene_b",
      title: "Scene B",
      summary: "Has no sprite command.",
      tags: [],
      chapter: 1,
      commands: [
        { type: "narration", text: "Scene B has no sprite." },
      ],
    },
    {
      scene_id: "scene_c",
      title: "Scene C",
      summary: "Shows a fresh sprite.",
      tags: [],
      chapter: 1,
      commands: [
        { type: "sprite", character_id: "hero", sprite_id: "sprite_new", position: "right", visible: true, scale: 0.8 },
      ],
    },
  ],
};

async function main() {
  const { createServer } = await import(pathToFileURL(path.join(GAMECLI_ROOT, "node_modules", "vite", "dist", "node", "index.js")).href);
  const server = await createServer({
    root: GAMECLI_ROOT,
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
  });

  try {
    const { StoryEngine } = await server.ssrLoadModule("/src/engine/StoryEngine.ts");
    const engine = new StoryEngine();
    engine.loadScript(scriptData, manifest);
    engine.start();
    await wait(10);

    assert.equal(engine.state.currentSceneId, "scene_a", "starts in scene A");
    assert.equal(engine.state.sprites.hero?.sprite_id, "sprite_old", "scene A sprite is visible");
    assert.equal(engine.state.sprites.hero?.position, "left", "scene A sprite position is captured");
    assert.deepEqual(engine.state.spriteOrder, ["hero"], "scene A sprite order includes hero");

    const snapshot = engine.createSaveSnapshot(1);
    assert.equal(snapshot.sprites.hero?.sprite_id, "sprite_old", "save snapshot captures current scene sprite");

    engine.playRuntimeAnimation({
      effect_id: "sprite-effect-a",
      animation_id: "sprite_shake",
      target: "sprite:hero",
      target_kind: "sprite",
      target_id: "hero",
      params: { duration: 1000, keyframes: [{ offset: 0, x: 0 }, { offset: 1, x: 12 }] },
      started_at: Date.now(),
      duration_ms: 1000,
    }, true);
    assert.equal(engine.state.animationEffects.some((effect) => effect.target === "sprite:hero"), true, "sprite animation effect is active before scene switch");

    engine.jumpToScene("scene_b");
    await wait(10);
    assert.equal(engine.state.currentSceneId, "scene_b", "jumped to scene B");
    assert.deepEqual(engine.state.sprites, {}, "scene B starts with no inherited sprites");
    assert.deepEqual(engine.state.spriteOrder, [], "scene B starts with empty sprite order");
    assert.equal(engine.state.animationEffects.some((effect) => effect.target_kind === "sprite" || effect.target.startsWith("sprite:")), false, "scene switch clears old sprite animation effects");
    assert.equal(engine.state.dialog?.text, "Scene B has no sprite.", "non-sprite scene command still executes");

    engine.jumpToScene("scene_c");
    await wait(10);
    assert.equal(engine.state.currentSceneId, "scene_c", "jumped to scene C");
    assert.equal(engine.state.sprites.hero?.sprite_id, "sprite_new", "scene C creates a fresh sprite from its own command");
    assert.equal(engine.state.sprites.hero?.position, "right", "scene C does not inherit scene A position");
    assert.equal(engine.state.sprites.hero?.scale, 0.8, "scene C does not inherit scene A scale");
    assert.deepEqual(engine.state.spriteOrder, ["hero"], "scene C sprite order is rebuilt");

    engine.restoreSaveSnapshot(snapshot);
    assert.equal(engine.state.currentSceneId, "scene_a", "restore returns to saved scene");
    assert.equal(engine.state.sprites.hero?.sprite_id, "sprite_old", "restore keeps saved scene sprite");
    assert.deepEqual(engine.state.spriteOrder, ["hero"], "restore keeps saved sprite order");

    engine.jumpToScene("scene_b");
    await wait(10);
    assert.deepEqual(engine.state.sprites, {}, "scene switch after restore still clears sprites");
    assert.deepEqual(engine.state.spriteOrder, [], "scene switch after restore still clears sprite order");

    console.log("PASS GameCLI scene sprite isolation contract");
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

