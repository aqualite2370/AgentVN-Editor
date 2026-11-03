"use strict";
// Real engine; memory checkpoint must not change serialized disk-save semantics.
const assert = require("node:assert/strict");
const esbuild = require("../editor/node_modules/esbuild"), path = require("node:path");
global.window = { setTimeout, clearTimeout, matchMedia: () => ({ matches: false }), dispatchEvent() {} };
global.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const result = esbuild.buildSync({ stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "ts",
  contents: 'export { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine";' },
bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const loaded = { exports: {} };
new Function("module", "exports", "require", result.outputFiles[0].text)(loaded, loaded.exports, require);
const { StoryEngine } = loaded.exports;
const script = { game_id: "checkpoint", entry_scene_id: "main", scenes: [{
  scene_id: "main", title: "原剧情", commands: [
    { type: "narration", text: "FIRST" }, { type: "narration", text: "SECOND" },
    { type: "narration", text: "THIRD" }],
}] };
const manifest = { game_id: "checkpoint", assets: [] };
function engine(mode = "dialog") {
  const e = new StoryEngine(); e.loadScript({ ...script, default_dialog_presentation: mode }, manifest);
  e.start(); e.completeTyping(); e.next(); e.completeTyping(); e.next(); e.completeTyping();
  assert.equal(e.state.dialog.text, "THIRD"); assert(e.state.canRollback);
  return e;
}
const cases = [];
function check(name, fn) { fn(); cases.push({ name, status: "PASS" }); console.log(`PASS: ${name}`); }
for (const mode of ["dialog", "nvl", "bubble"]) check(`${mode}: original history, presentation and bidirectional timeline survive replay`, () => {
  const e = engine(mode), original = structuredClone(e.createSaveSnapshot());
  const session = e.capturePlaybackSession(); e.startGalleryReplay("main");
  e.completeTyping(); e.next(); assert(session.restore());
  assert.deepEqual(e.state.history, original.history); assert.deepEqual(e.state.nvlPage, original.nvl_page);
  assert.equal(e.state.dialogRestored, true); assert.equal(e.state.dialog.presentation_mode, mode);
  assert(e.rollback()); assert.equal(e.state.dialog.text, "SECOND");
  assert(e.rollForward()); assert.equal(e.state.dialog.text, "THIRD");
  assert.deepEqual(e.state.history, original.history);
  assert.equal(session.restore(), false, "Checkpoint must be single-use");
});
check("An existing forward branch is restored, not replaced by the replay branch", () => {
  const e = engine(); assert(e.rollback()); assert.equal(e.state.dialog.text, "SECOND");
  assert(e.state.canRollForward); const session = e.capturePlaybackSession();
  e.startGalleryReplay("main"); assert(session.restore());
  assert(e.state.canRollback && e.state.canRollForward);
  assert(e.rollForward()); assert.equal(e.state.dialog.text, "THIRD");
  assert(e.rollback()); assert.equal(e.state.dialog.text, "SECOND");
});
check("Page-forward visibility and page position are retained", () => {
  const e = engine(); e.setDialogPagePosition(2, 3);
  assert(e.rollback()); assert.equal(e.state.dialogPageIndex, 1);
  const session = e.capturePlaybackSession(); e.startGalleryReplay("main"); assert(session.restore());
  assert.equal(e.state.dialogPageIndex, 1); assert.equal(e.state.dialogPageCount, 3);
  assert(e.rollForward()); assert.equal(e.state.dialogPageIndex, 2);
});
check("Reloading even the same script object invalidates old in-memory ownership", () => {
  const e = new StoryEngine(); e.loadScript(script, manifest); e.start();
  const session = e.capturePlaybackSession(); e.loadScript(script, manifest);
  const fresh = structuredClone(e.state); assert.equal(session.restore(), false);
  assert.deepEqual(e.state, fresh);
});
check("Ordinary persisted-save load keeps its existing fresh timeline semantics", () => {
  const e = engine(), snapshot = structuredClone(e.createSaveSnapshot());
  const keys = Object.keys(snapshot).sort(); e.restoreSaveSnapshot(snapshot);
  assert.equal(e.state.canRollback, false); assert.equal(e.state.canRollForward, false);
  assert.deepEqual(Object.keys(e.createSaveSnapshot()).sort(), keys);
  assert(!keys.some(k => /session|rollback/i.test(k)));
});
assert.equal(cases.length, 7);
console.log(JSON.stringify({ status: "PASS", cases }));
