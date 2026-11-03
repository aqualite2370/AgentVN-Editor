#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const GAMECLI_ROOT = path.join(ROOT, "GameCli_framework");

global.window = global.window || {};
global.window.setTimeout = setTimeout;
global.window.clearTimeout = clearTimeout;
global.window.dispatchEvent = global.window.dispatchEvent || (() => true);
global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false }));
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  throw new Error("Timed out waiting for rollback fixture.");
}

async function main() {
  const { createServer } = await import(
    pathToFileURL(path.join(GAMECLI_ROOT, "node_modules", "vite", "dist", "node", "index.js")).href
  );
  const server = await createServer({
    root: GAMECLI_ROOT,
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
  });

  try {
    const { StoryEngine } = await server.ssrLoadModule("/src/engine/StoryEngine.ts");
    const engine = new StoryEngine();
    engine.loadScript({
      schema_version: "1.1.0",
      game_id: "rollback-contract",
      title: "Rollback Contract",
      entry_scene_id: "scene",
      scenes: [{
        scene_id: "scene",
        title: "Scene",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          { type: "background", background_id: "room_a" },
          { type: "dialog", character_id: "alice", text: "A" },
          { type: "bgm", bgm_id: "theme_b", action: "play", volume: 0.5 },
          { type: "state_update", key: "route", operation: "set", value: "b" },
          { type: "background", background_id: "room_b" },
          { type: "dialog", character_id: "bob", text: "B" },
        ],
      }],
    }, {
      game_id: "rollback-contract",
      assets: [],
    });

    engine.start();
    await wait(10);
    assert.equal(engine.state.dialog?.text, "A");
    assert.equal(engine.state.canRollback, false);

    engine.state.isTyping = false;
    engine.next();
    await waitFor(() => engine.state.dialog?.text === "B");

    assert.equal(engine.state.dialog?.text, "B", JSON.stringify({
      index: engine.state.currentCommandIndex,
      type: engine.state.currentCommandType,
      paused: engine.state.isPaused,
      waiting: engine.state.isWaitingChoice,
    }));
    assert.equal(engine.state.background, "room_b");
    assert.equal(engine.state.variables.route, "b");
    assert.equal(engine.state.bgmState?.bgm_id, "theme_b");
    assert.equal(engine.state.canRollback, true);

    assert.equal(engine.rollback(), true);
    assert.equal(engine.state.dialog?.text, "A");
    assert.equal(engine.state.background, "room_a");
    assert.equal(engine.state.variables.route, undefined);
    assert.equal(engine.state.bgmState, undefined);
    assert.deepEqual(engine.state.history.map((entry) => entry.text), ["A"]);
    assert.equal(engine.state.canRollForward, true);

    assert.equal(engine.rollForward(), true);
    assert.equal(engine.state.dialog?.text, "B");
    assert.equal(engine.state.background, "room_b");
    assert.equal(engine.state.variables.route, "b");
    assert.equal(engine.state.bgmState?.bgm_id, "theme_b");
    assert.deepEqual(engine.state.history.map((entry) => entry.text), ["A", "B"]);

    const branching = new StoryEngine();
    branching.loadScript({
      schema_version: "1.5.0",
      game_id: "rollback-choice-contract",
      title: "Rollback Choice Contract",
      entry_scene_id: "choice",
      scenes: [
        {
          scene_id: "choice",
          title: "Choice",
          summary: "",
          chapter: 1,
          tags: [],
          commands: [{
            type: "choice",
            choices: [
              { choice_id: "a", text: "A route", target_scene_id: "a", conditions: [] },
              { choice_id: "b", text: "B route", target_scene_id: "b", conditions: [] },
            ],
          }],
        },
        {
          scene_id: "a",
          title: "A",
          summary: "",
          chapter: 1,
          tags: [],
          commands: [{ type: "dialog", character_id: "alice", text: "Route A" }],
        },
        {
          scene_id: "b",
          title: "B",
          summary: "",
          chapter: 1,
          tags: [],
          commands: [{ type: "dialog", character_id: "bob", text: "Route B" }],
        },
      ],
    }, { game_id: "rollback-choice-contract", assets: [] });
    branching.start();
    branching.choose("a");
    assert.equal(branching.state.dialog?.text, "Route A");
    assert.equal(branching.rollback(), true);
    assert.equal(branching.state.currentCommandType, "choice");
    assert.equal(branching.state.rollbackSelectedChoiceId, "a");
    branching.choose("b");
    assert.equal(branching.state.dialog?.text, "Route B");
    assert.equal(branching.state.canRollForward, false, "choosing another branch truncates the old future");

    console.log("PASS GameCLI rollback contract");
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
