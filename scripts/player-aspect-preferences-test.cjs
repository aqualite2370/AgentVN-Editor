"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), mod = { exports: {} };
const storage = new Map();
global.window = { localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
} };
new Function("module", "exports", "require", buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export * from "./GameCli_framework/src/store/runtimePreferences";
    export {useSettingsStore} from "./GameCli_framework/src/store/settingsStore";
    export * from "./shared/cartridge/gameViewport";` },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports, require);
const q = mod.exports, checks = [];
function test(name, run) { run(); checks.push({ name, status: "PASS" }); }
test("old and malformed preferences inherit the project default", () => {
  for (const value of [undefined, null, "", "1:1", 16, {}, ["4:3"]])
    assert.equal(q.migrateRuntimeSettings({ gameAspectRatio: value }).gameAspectRatio, "default");
  for (const value of ["default", "16:9", "16:10", "4:3"])
    assert.equal(q.migrateRuntimeSettings({ gameAspectRatio: value }).gameAspectRatio, value);
});
test("player override wins without rewriting authored layout", () => {
  const authored = Object.freeze({ aspectRatio: "4:3" });
  assert.equal(q.resolvePlayerGameViewport(authored, "default").aspectRatio, "4:3");
  assert.equal(q.resolvePlayerGameViewport(authored, "16:10").aspectRatio, "16:10");
  assert.equal(q.resolvePlayerGameViewport(undefined, "default").aspectRatio, "16:9");
  assert.equal(q.resolvePlayerGameViewport(authored, "corrupt").aspectRatio, "4:3");
  assert.deepEqual(authored, { aspectRatio: "4:3" });
});
test("actual settings store persists per-game overrides and restores defaults", () => {
  const store = q.useSettingsStore;
  store.getState().loadForGame("qa-A");
  store.getState().updateSettings({ gameAspectRatio: "16:10", volumeMaster: .55 });
  assert.equal(JSON.parse(storage.get(q.runtimeSettingsKey("qa-A"))).gameAspectRatio, "16:10");
  store.getState().loadForGame("qa-B");
  assert.equal(store.getState().settings.gameAspectRatio, "default");
  store.getState().updateSettings({ gameAspectRatio: "4:3" });
  store.getState().loadForGame("qa-A");
  assert.equal(store.getState().settings.gameAspectRatio, "16:10");
  assert.equal(store.getState().settings.volumeMaster, .55);
  store.getState().updateSettings({ gameAspectRatio: "default" });
  assert.equal(store.getState().settings.volumeMaster, .55);
  store.getState().resetSettings();
  assert.equal(store.getState().settings.gameAspectRatio, "default");
  store.getState().loadForGame("qa-B");
  assert.equal(store.getState().settings.gameAspectRatio, "4:3");
});
test("standalone and editor previews sharing an install ID still isolate game identities", () => {
  const store = q.useSettingsStore;
  for (const installId of ["preview_gamecli", "fixed_embedded_game"]) {
    const a = `作品甲-${installId}`, b = `作品乙-${installId}`;
    store.getState().loadForGame(installId, a);
    store.getState().updateSettings({ gameAspectRatio: "16:10", volumeMaster: .65 });
    store.getState().loadForGame(installId, b);
    assert.equal(store.getState().settings.gameAspectRatio, "default");
    assert.equal(store.getState().settings.volumeMaster, .65, "Existing preference behavior is unchanged");
    store.getState().updateSettings({ gameAspectRatio: "4:3" });
    store.getState().loadForGame(installId, a);
    assert.equal(store.getState().settings.gameAspectRatio, "16:10");
    store.getState().resetSettings();
    store.getState().loadForGame(installId, b);
    assert.equal(store.getState().settings.gameAspectRatio, "4:3");
  }
});
test("same game's ratio follows its stable identity across installations and versions", () => {
  const store = q.useSettingsStore;
  store.getState().loadForGame("install-original", "stable-game");
  store.getState().updateSettings({ gameAspectRatio: "4:3" });
  store.getState().loadForGame("install-reimported", "stable-game");
  assert.equal(store.getState().settings.gameAspectRatio, "4:3");
});
console.log(JSON.stringify({ status: "PASS", checks }, null, 2));
