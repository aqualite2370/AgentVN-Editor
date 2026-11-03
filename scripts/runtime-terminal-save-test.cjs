"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), loaded = { exports: {} };
new Function("module", "exports", "require", buildSync({ stdin: { loader: "ts", resolveDir: root,
  contents: 'export { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine"; export { validateSaveData } from "./GameCli_framework/src/engine/validation";' },
  platform: "node", format: "cjs", bundle: true, write: false }).outputFiles[0].text)(loaded, loaded.exports, require);
global.window = { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} };
const { StoryEngine, validateSaveData } = loaded.exports;
const source = { schema_version: "1.1.0", game_id: "terminal-save", title: "隔离末句存档",
  entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
    commands: [{ type: "narration", text: "唯一一句，反复推进也不能写出越界存档。" }] }] };
for (const automatic of [false, true]) {
  const engine = new StoryEngine(); engine.loadScript(structuredClone(source), { game_id: source.game_id }); engine.start();
  const text = engine.state.dialog.text;
  engine.state.isSkipMode = true; engine.state.isAutoMode = true;
  for (let i = 0; i < 100; i++) { engine.state.isTyping = false; engine.next(automatic); }
  const save = engine.createSaveSnapshot(1);
  assert.equal(save.command_index, 0, "No-successor scene must retain its final valid command for saving");
  assert.equal(save.dialog.text, text);
  assert.equal(engine.state.isSkipMode, false); assert.equal(engine.state.isAutoMode, false);
  assert.equal(validateSaveData(save).length, 0);
  const restored = new StoryEngine(); restored.loadScript(structuredClone(source), { game_id: source.game_id });
  restored.restoreSaveSnapshot(save);
  assert.equal(restored.state.currentCommandIndex, 0); assert.equal(restored.state.dialog.text, text);
}
// Explicit endings still finish; do not turn them into a stuck last page.
const ending = new StoryEngine(), endingSource = structuredClone(source); endingSource.scenes[0].is_ending = true;
ending.loadScript(endingSource, { game_id: source.game_id }); ending.start(); ending.state.isTyping = false; ending.next(true);
assert.equal(ending.state.isEnded, true);
// A real successor must still be scheduled instead of clamping to last line.
const scheduled = [];
window.setTimeout = fn => { scheduled.push(fn); return scheduled.length; };
const chained = new StoryEngine(), chainedSource = structuredClone(source);
chainedSource.scenes[0].next_scene_id = "second";
chainedSource.scenes.push({ scene_id: "second", title: "Second", chapter: 1, tags: [],
  commands: [{ type: "narration", text: "后继场景仍可推进。" }] });
chained.loadScript(chainedSource, { game_id: source.game_id }); chained.start(); chained.state.isTyping = false;
chained.next(true); assert(scheduled.length > 0);
for (let i = 0; i < scheduled.length && i < 10; i++) scheduled[i]();
assert.equal(chained.state.currentSceneId, "second"); assert.equal(chained.state.currentCommandIndex, 0);
console.log("runtime-terminal-save-test: PASS (manual/automatic exhaustion, save/restore, explicit ending)");
