#!/usr/bin/env node
"use strict";

const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine";

  globalThis.window = globalThis;

  const script = {
    schema_version: "1.0.0",
    game_id: "gallery_runtime_test",
    title: "Gallery runtime test",
    entry_scene_id: "scene_main",
    scenes: [
      {
        scene_id: "scene_main",
        title: "Main",
        summary: "",
        chapter: 1,
        tags: [],
        next_scene_id: "scene_next",
        commands: [
          { type: "narration", text: "Scene opening" },
          { type: "gallery_anchor", anchor_id: "gallery_main", title: "Main gallery", asset_id: "cg_main" },
          { type: "narration", text: "Scene ending" },
        ],
      },
      {
        scene_id: "scene_next",
        title: "Next",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [{ type: "narration", text: "Must not enter next scene" }],
      },
    ],
  };

  const manifest = {
    manifest_version: "1.0.0",
    game_id: "gallery_runtime_test",
    title: "Gallery runtime test",
    author: "AgentVN",
    version: "0.1.0",
    description: "",
    entry_script: "script.json",
    assets: [],
    runtime_version: "0.1.0",
    tags: [],
    language: "zh-CN",
  };

  const engine = new StoryEngine();
  engine.loadScript(script, manifest);
  engine.startGalleryReplay("scene_main");
  if (!engine.state.isGalleryReplay) throw new Error("gallery replay mode must be observable in engine state");
  if (engine.state.currentSceneId !== "scene_main" || engine.state.currentCommandIndex !== 0) {
    throw new Error("gallery replay must start at the first event of the target scene");
  }
  if (engine.state.dialog?.text !== "Scene opening") throw new Error("gallery replay did not show the scene opening");

  engine.completeTyping();
  engine.next();
  if (engine.state.currentCommandIndex !== 1) throw new Error("gallery replay did not advance to the anchor");
  engine.next();
  if (engine.state.currentCommandIndex !== 2) throw new Error("gallery replay did not advance within the scene");
  engine.completeTyping();
  engine.next();
  if (!engine.state.isEnded || !engine.state.isPaused) throw new Error("gallery replay must end at the scene boundary");
  if (engine.state.currentSceneId !== "scene_main") throw new Error("gallery replay crossed into next_scene_id");

  console.log("gallery anchor runtime test OK");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "gallery-anchor-runtime-test.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
  logLevel: "silent",
});

new Function("require", "module", "exports", result.outputFiles[0].text)(
  require,
  { exports: {} },
  {},
);
