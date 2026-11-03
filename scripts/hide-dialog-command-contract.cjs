#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("../GameCli_framework/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const workbenchSource = fs.readFileSync(
  path.join(root, "editor", "src", "components", "command-editors", "FloatingCommandWorkbench.tsx"),
  "utf8",
);
if (!/types:\s*\["dialog",\s*"narration",\s*"hide_dialog"\]/.test(workbenchSource)) {
  throw new Error("scene workbench must expose hide_dialog in the text narrative group");
}

const source = `
  import { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine";
  import { commandLabels, defaultCommand } from "./editor/src/utils/commandTools";
  import { commandPreview } from "./editor/src/utils/commandPreview";

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  const scheduled: Array<() => void> = [];
  (globalThis as typeof globalThis & { window: Window }).window = {
    setTimeout(callback: TimerHandler) {
      scheduled.push(callback as () => void);
      return scheduled.length;
    },
    clearTimeout() {},
  } as unknown as Window;

  const authored = defaultCommand("hide_dialog");
  assert(authored.type === "hide_dialog", "workbench default must create hide_dialog");
  assert(
    JSON.stringify(authored) === '{"type":"hide_dialog"}',
    "hide_dialog must not add irrelevant payload fields",
  );
  assert(commandLabels.hide_dialog === "隐藏对话框", "workbench must show the Chinese event label");
  assert(commandPreview(authored) === "隐藏当前对话框", "scene preview must explain the event");

  const engine = new StoryEngine();
  engine.loadScript({
    schema_version: "1.1.0",
    game_id: "hide-dialog-contract",
    title: "Hide Dialog Contract",
    entry_scene_id: "scene",
    scenes: [{
      scene_id: "scene",
      title: "Scene",
      summary: "",
      chapter: 1,
      tags: [],
      commands: [
        { type: "dialog", character_id: "alice", text: "This must disappear." },
        authored,
        { type: "wait", duration_ms: 1000 },
      ],
    }],
  }, {
    game_id: "hide-dialog-contract",
  } as any);
  engine.start();
  assert(engine.state.dialog?.text === "This must disappear.", "dialog fixture must start visibly");
  engine.state.isTyping = false;
  engine.state.typingRevealRequested = true;
  engine.state.advanceQueuedAfterReveal = true;

  engine.next();

  assert(engine.state.dialog === undefined, "runtime must clear the active dialog");
  assert(engine.state.isTyping === false, "runtime must stop dialog typing");
  assert(engine.state.typingRevealRequested === false, "runtime must clear reveal requests");
  assert(engine.state.advanceQueuedAfterReveal === false, "runtime must clear queued dialog advances");
  assert(engine.state.currentCommandType === "hide_dialog", "runtime must expose the active command type");
  assert(engine.state.currentCommandIndex === 1, "hide_dialog must execute at its authored position");
  assert(scheduled.length === 1, "hide_dialog must queue automatic continuation");

  scheduled.shift()?.();
  assert(engine.state.currentCommandIndex === 2, "hide_dialog must continue to the next event");
  assert(engine.state.currentCommandType === "wait", "the following event must execute");
  assert(engine.state.dialog === undefined, "the dialog must remain hidden during the following event");

  console.log("hide dialog command contract test OK");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "hide-dialog-command-contract.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
});

const moduleUnderTest = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(
  require,
  moduleUnderTest,
  moduleUnderTest.exports,
);
