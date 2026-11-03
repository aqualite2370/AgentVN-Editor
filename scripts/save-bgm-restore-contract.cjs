#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const esbuild = require("../GameCli_framework/node_modules/esbuild");

const source = `
  import { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine";

  globalThis.window = globalThis;

  const script = {
    schema_version: "1.0.0",
    game_id: "save_bgm_restore_contract",
    title: "Save BGM Restore Contract",
    entry_scene_id: "scene",
    scenes: [{
      scene_id: "scene",
      title: "Scene",
      summary: "",
      chapter: 1,
      tags: [],
      commands: [
        { type: "bgm", bgm_id: "bgm1", action: "play" },
        { type: "narration", text: "旁白1" },
        { type: "narration", text: "旁白2" },
        { type: "narration", text: "旁白3" },
        { type: "bgm", bgm_id: "bgm2", action: "play" },
        { type: "narration", text: "旁白4" }
      ]
    }]
  };

  const manifest = {
    manifest_version: "1.0.0",
    game_id: script.game_id,
    title: script.title,
    author: "AgentVN",
    version: "0.1.0",
    description: "",
    entry_script: "script.json",
    assets: [],
    runtime_version: "0.1.0",
    tags: [],
    language: "zh-CN"
  };

  const engine = new StoryEngine();
  engine.loadScript(script, manifest);
  engine.start();
  const bgm1Save = engine.createSaveSnapshot(1);
  if (bgm1Save.bgm_state?.bgm_id !== "bgm1") {
    throw new Error("save snapshot did not capture BGM1");
  }

  while (engine.state.currentCommandIndex < 5) {
    if (engine.state.isTyping) engine.completeTyping();
    else engine.next();
  }
  if (engine.state.bgmState?.bgm_id !== "bgm2") {
    throw new Error("repro did not advance to BGM2");
  }

  engine.restoreSaveSnapshot(bgm1Save);
  if (engine.state.bgmState?.bgm_id !== "bgm1") {
    throw new Error("restoring a save did not restore BGM1");
  }

  const legacySave = { ...bgm1Save };
  delete legacySave.bgm_state;
  engine.restoreSaveSnapshot(legacySave);
  if (engine.state.bgmState?.action !== "stop" || engine.state.bgmState?.fade_ms !== 0) {
    throw new Error("legacy save did not emit an immediate BGM stop state");
  }

  while (engine.state.currentCommandIndex < 5) {
    if (engine.state.isTyping) engine.completeTyping();
    else engine.next();
  }
  if (engine.state.bgmState?.bgm_id !== "bgm2") {
    throw new Error("legacy stop state prevented the next BGM command");
  }

  console.log("[PASS] save BGM restore contract");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: process.cwd(),
    sourcefile: "save-bgm-restore-contract.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  write: false,
  logLevel: "silent",
});

const moduleUnderTest = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(
  require,
  moduleUnderTest,
  moduleUnderTest.exports,
);
