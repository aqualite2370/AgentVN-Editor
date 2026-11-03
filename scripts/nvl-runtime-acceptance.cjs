"use strict";

const assert = require("node:assert/strict");
const esbuild = require("../GameCli_framework/node_modules/esbuild");

const root = require("node:path").resolve(__dirname, "..");
const source = `
  import { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine";
  import {
    minimumRuntimeVersionForScript,
    runtimeScriptSchemaVersion,
    scriptUsesBubblePresentation,
  } from "./shared/cartridge/runtimeCapabilities";
  import {
    validateRuntimeScript,
    validateVersionCompatibility,
  } from "./shared/cartridge/validators";
  import { validateSaveData } from "./GameCli_framework/src/engine/validation";

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

  const engine = new StoryEngine();
  engine.loadScript({
    schema_version: "1.1.0",
    game_id: "nvl-runtime-acceptance",
    title: "NVL runtime acceptance",
    entry_scene_id: "scene",
    characters: [{ character_id: "alice", name: "Alice" }],
    scenes: [{
      scene_id: "scene",
      title: "NVL",
      summary: "",
      chapter: 1,
      tags: [],
      commands: [
        { type: "dialog", character_id: "alice", text: "第一句", presentation_mode: "nvl" },
        { type: "narration", text: "第二句旁白", presentation_mode: "nvl" },
        { type: "dialog", character_id: "alice", text: "第三句", presentation_mode: "nvl" },
        { type: "narration", text: "新段落第一句", presentation_mode: "nvl", clear_nvl_page_before: true },
        { type: "wait", duration_ms: 1000 },
      ],
    }],
  }, {
    game_id: "nvl-runtime-acceptance",
  } as any);

  engine.start();
  assert(engine.state.currentCommandType === "dialog", "the first authored NVL line must start");
  assert(engine.state.nvlPage?.length === 1, "the first NVL line must be visible in the accumulated page");
  assert(engine.state.nvlPage?.[0]?.text === "第一句", "the first page entry must preserve its text");
  assert(engine.state.nvlPage?.[0]?.speaker === "Alice", "dialogue entries must preserve the speaker");
  assert(minimumRuntimeVersionForScript(engine.script!) === "0.16.0",
    "scripts using the authored NVL clear-page marker must declare its Runtime capability floor");
  assert(runtimeScriptSchemaVersion(engine.script!) === "1.8.0",
    "scripts using the authored NVL clear-page marker must declare its script schema floor");
  assert(!validateVersionCompatibility({
    runtime_version: "0.13.0",
    cartridge_version: "1.0.0",
  } as any, "0.12.0").ok, "older Runtime must reject cartridges requiring NVL support");
  const invalidMode = structuredClone(engine.script!) as any;
  invalidMode.scenes[0].commands[0].presentation_mode = "subtitle";
  assert(validateRuntimeScript(invalidMode).errors.some(issue => issue.code === "dialog_presentation_mode"),
    "unknown presentation modes must fail validation instead of silently falling back");
  const invalidClearPage = structuredClone(engine.script!) as any;
  invalidClearPage.scenes[0].commands[0].clear_nvl_page_before = "yes";
  assert(validateRuntimeScript(invalidClearPage).errors.some(issue => issue.code === "dialog_nvl_clear_page"),
    "invalid clear-page values must fail validation rather than being treated as enabled");
  assert(!validateVersionCompatibility({
    runtime_version: "0.16.0",
    cartridge_version: "1.0.0",
  } as any, "0.15.0").ok,
  "runtimes before NVL page clearing must reject cartridges that use the new marker");

  const bubbleEngine = new StoryEngine();
  bubbleEngine.loadScript({
    schema_version: "1.1.0",
    game_id: "bubble-runtime-acceptance",
    title: "Bubble runtime acceptance",
    entry_scene_id: "scene",
    characters: [{ character_id: "alice", name: "小岚" }],
    scenes: [{
      scene_id: "scene",
      title: "气泡对白",
      summary: "",
      chapter: 1,
      tags: [],
      commands: [
        { type: "sprite", character_id: "alice", sprite_id: "alice-standing", visible: true },
        { type: "dialog", character_id: "alice", text: "跟随角色立绘显示的气泡对白", presentation_mode: "bubble" },
      ],
    }],
  }, { game_id: "bubble-runtime-acceptance" } as any);
  assert(validateRuntimeScript(bubbleEngine.script!).errors.length === 0,
    "bubble presentation must be a valid authored dialogue mode");
  assert(scriptUsesBubblePresentation(bubbleEngine.script!),
    "runtime capability detection must identify bubble dialogue");
  assert(minimumRuntimeVersionForScript(bubbleEngine.script!) === "0.17.0",
    "bubble dialogue must declare its minimum Runtime version");
  assert(runtimeScriptSchemaVersion(bubbleEngine.script!) === "1.9.0",
    "bubble dialogue must declare its script schema version");
  scheduled.splice(0);
  bubbleEngine.start();
  while (scheduled.length > 0) scheduled.shift()!();
  assert(bubbleEngine.state.nvlPresentationMode === "bubble",
    "the runtime must preserve bubble presentation as the current dialogue mode");
  assert(bubbleEngine.state.nvlPage.length === 0,
    "bubble dialogue must not append its line to the accumulated NVL page");
  assert(bubbleEngine.state.sprites.alice?.visible === true,
    "the speaking character's visible sprite must remain available as the bubble anchor");
  const bubbleSave = bubbleEngine.createSaveSnapshot(1);
  bubbleEngine.restoreSaveSnapshot(bubbleSave);
  assert(bubbleEngine.state.nvlPresentationMode === "bubble",
    "saving and restoring bubble dialogue must preserve its presentation mode");

  engine.completeTyping(engine.state.dialog?.text_key);
  engine.next();
  assert(engine.state.currentCommandType === "narration", "advancing must execute the second authored NVL line");
  assert(engine.state.nvlPage?.length === 2, "the next NVL line must append rather than replace the page");
  assert(engine.state.nvlPage?.map(line => line.text).join("|") === "第一句|第二句旁白",
    "dialogue and narration must retain authored order");

  const saved = engine.createSaveSnapshot(4);
  assert(saved.nvl_page?.length === 2, "a save must include the accumulated NVL page");
  assert(saved.dialog_page_index === 0 && saved.dialog_page_count === 1,
    "ordinary and legacy-compatible dialogue checkpoints must begin on fragment one");
  engine.setDialogPagePosition(2, 5);
  const paginatedSave = engine.createSaveSnapshot(5);
  assert(paginatedSave.dialog_page_index === 2,
    "a save must preserve the currently displayed fragment of an overlong dialogue");

  engine.completeTyping(engine.state.dialog?.text_key);
  engine.next();
  assert(engine.state.currentCommandType === "dialog", "the fixture must advance to its third authored NVL line");
  assert(engine.state.nvlPage?.length === 3, "the third NVL line must append exactly once");
  assert(engine.rollback(), "the previous NVL line must remain a rollback checkpoint");
  assert(engine.state.nvlPage?.map(line => line.text).join("|") === "第一句|第二句旁白",
    "the first rollback must restore the exact preceding accumulated page");
  assert(engine.state.dialogPageIndex === 2 && engine.state.dialogPageCount === 5,
    "rollback must restore the current fragment position of the preceding long line");
  assert(engine.rollForward(), "the NVL line after the restored fragment must remain available");
  assert(engine.state.dialogPageIndex === 0 && engine.state.dialogPageCount === 1,
    "roll-forward must restore the next line's initial fragment position");
  assert(engine.rollback(), "rollback must remain available after rolling forward");
  engine.setDialogPagePosition(0, 5);
  assert(engine.rollback(), "the earlier NVL line must remain available for rollback");
  assert(engine.state.nvlPage?.map(line => line.text).join("|") === "第一句",
    "rollback must restore the exact earlier accumulated page");
  engine.restoreSaveSnapshot(saved);
  assert(engine.state.nvlPage?.map(line => line.text).join("|") === "第一句|第二句旁白",
    "loading a save must restore the page without replaying or duplicating lines");
  const legacySave = structuredClone(saved) as any;
  delete legacySave.dialog_page_index;
  delete legacySave.dialog_page_count;
  engine.restoreSaveSnapshot(legacySave);
  assert(engine.state.dialogPageIndex === 0 && engine.state.dialogPageCount === 1,
    "older saves without fragment metadata must safely restore to the first fragment");
  engine.restoreSaveSnapshot(paginatedSave);
  assert(engine.state.dialogPageIndex === 2,
    "loading a save must restore the exact current dialogue fragment");
  const malformedPosition = structuredClone(paginatedSave) as any;
  malformedPosition.dialog_page_index = 5;
  assert(validateSaveData(malformedPosition).some(issue => issue.code === "dialog_page_position"),
    "save validation must reject a fragment index outside the persisted page count");
  assert(engine.rollback(), "rollback must move one fragment backward before leaving the current long dialogue");
  assert(engine.state.dialogPageIndex === 1 && engine.state.dialogPageCount === 5,
    "rollback within a long dialogue must restore the immediately preceding fragment");
  assert(engine.rollForward(), "roll-forward must restore the fragment that was just rolled back");
  assert(engine.state.dialogPageIndex === 2,
    "roll-forward within a long dialogue must restore the exact later fragment");
  engine.completeTyping(engine.state.dialog?.text_key);
  engine.next();
  engine.completeTyping(engine.state.dialog?.text_key);
  engine.next();
  assert(engine.state.nvlPage?.map(line => line.text).join("|") === "新段落第一句",
    "an authored NVL clear-page marker must clear prior accumulated lines before showing the new paragraph");
  assert(engine.rollback(), "clearing an NVL page must remain rollbackable");
  assert(engine.state.nvlPage?.map(line => line.text).join("|") === "第一句|第二句旁白|第三句",
    "rollback after an NVL page clear must restore the exact prior page");

  const modeSwitch = new StoryEngine();
  modeSwitch.loadScript({
    schema_version: "1.1.0",
    game_id: "nvl-mode-switch",
    title: "NVL mode switch",
    entry_scene_id: "scene",
    scenes: [{
      scene_id: "scene",
      title: "Mode switch",
      summary: "",
      chapter: 1,
      tags: [],
      commands: [
        { type: "narration", text: "累积内容", presentation_mode: "nvl" },
        { type: "dialog", character_id: "alice", text: "切回普通对白" },
      ],
    }],
  }, { game_id: "nvl-mode-switch" } as any);
  modeSwitch.start();
  modeSwitch.completeTyping(modeSwitch.state.dialog?.text_key);
  modeSwitch.next();
  assert(modeSwitch.state.nvlPage.length === 0,
    "leaving NVL presentation must clear its accumulated page");
  assert(modeSwitch.state.nvlPresentationMode === "dialog",
    "leaving NVL presentation must restore standard presentation mode");
  console.log("nvl-runtime-acceptance: PASS");
`;

const built = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "nvl-runtime-acceptance.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
});

const testModule = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(
  require,
  testModule,
  testModule.exports,
);
