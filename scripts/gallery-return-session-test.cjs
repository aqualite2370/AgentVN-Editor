"use strict";
// Public Runtime actions + real engine; browser storage is the system boundary.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), esbuild = require("../editor/node_modules/esbuild");
const run = process.argv[2] || "state-01"; assert(/^state-\d{2}$/.test(run));
const rollbackRequired = process.argv.includes("--rollback");
const out = path.join("F:/AgentVN/QA/Runtime-Gallery-Repair-20261020-01", run);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const values = new Map();
global.window = { location: { search: "" }, localStorage: { getItem: k => values.get(k) ?? null,
  setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) },
  matchMedia: () => ({ matches: false }), queueMicrotask, dispatchEvent() {},
  setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout };
global.localStorage = window.localStorage; window.parent = window;
global.document = { visibilityState: "visible", addEventListener() {} };
global.requestAnimationFrame = fn => setImmediate(() => fn(performance.now()));
const report = { status: "RUNNING", at: new Date().toISOString(),
  scope: "SOURCE_PUBLIC_RUNTIME_ACTIONS_WITH_WEB_STORAGE_BOUNDARY_NOT_BROWSER_OR_NATIVE",
  productSources: ["GameCli_framework/src/store/runtimeStore.ts", "GameCli_framework/src/engine/StoryEngine.ts"]
    .map(f => ({ path: path.join(root, f), sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex") })),
  rollbackRequired, cases: [], error: null };
fs.copyFileSync(__filename, path.join(out, path.basename(__filename)), fs.constants.COPYFILE_EXCL);
async function main() {
  const built = esbuild.buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
    export { useRuntimeStore } from "./GameCli_framework/src/store/runtimeStore";
    export { useSettingsStore } from "./GameCli_framework/src/store/settingsStore";
  ` }, bundle: true, platform: "node", format: "cjs", write: false,
  define: { "import.meta.env": "{}" }, logLevel: "silent" });
  const module = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(module, module.exports, require);
  const { useRuntimeStore: store, useSettingsStore: settings } = module.exports;
  const game = id => ({
    install_id: id, game_id: id, title: id, assetUrls: {},
    manifest: { game_id: id, title: id, assets: [], entry_scene_id: "main" },
    gallery: [{ item_id: "anchor", anchor_id: "anchor", scene_id: "main", title: "画廊", asset_id: "", unlocked: false }],
    script: { game_id: id, entry_scene_id: "main", default_dialog_presentation: "dialog", scenes: [
      { scene_id: "main", title: "主场景", next_scene_id: "next", commands: [
        { type: "narration", text: "ORIGINAL_OPENING" },
        { type: "gallery_anchor", anchor_id: "anchor", title: "画廊", asset_id: "" },
        { type: "narration", text: "ORIGINAL_CHECKPOINT" }] },
      { scene_id: "next", title: "后续", commands: [{ type: "narration", text: "FORBIDDEN_REPLAY_SUCCESSOR" }] }],
    },
  });
  const current = () => store.getState();
  function commit() {
    const pending = current().pendingScreenNavigation;
    if (pending) current().commitScreenNavigation(pending.id);
  }
  async function launch(fn) {
    const pending = fn(); current().beginLaunchCover(); await current().completeLaunchCover();
    current().completeLaunchReveal(); await pending;
  }
  async function checkpoint(index) {
    const deadline = performance.now() + 2000;
    while (current().engineState.currentCommandIndex !== index && performance.now() < deadline) {
      await new Promise(r => setTimeout(r, 5));
    }
    assert.equal(current().engineState.currentCommandIndex, index);
  }
  for (const entry of ["main_menu", "playing", "settings", "title_menu"]) for (const exit of ["manual", "boundary"]) {
    const row = { entry, exit, status: "RUNNING" }; report.cases.push(row);
    try {
      const id = `gallery_return_${entry}_${exit}`;
      window.localStorage.setItem(`vn.runtime.settings.${id}`, JSON.stringify({ autoSaveEnabled: false, textSpeed: 0 }));
      await current().loadGame(game(id));
      settings.getState().updateSettings({ autoSaveEnabled: false, textSpeed: 0 });
      await launch(() => current().startNewGame());
      current().engine.completeTyping(); current().next();
      await checkpoint(2);
      const original = structuredClone(current().engine.createSaveSnapshot());
      const originalCanRollback = current().engineState.canRollback;
      if (rollbackRequired) assert(originalCanRollback, "Fixture must have a real original rollback checkpoint");
      if (entry === "main_menu") { current().openMenu(); commit(); }
      if (entry === "settings") { current().openSettings(); commit(); }
      if (entry === "title_menu") {
        assert(current().currentGame.gallery[0].unlocked, "Real progression must unlock the title-page replay");
        await current().loadGame(game(id));
      }
      current().openGallery(); commit();
      const expectedReturn = entry === "settings" ? "playing" : entry;
      assert.equal(current().returnScreen, expectedReturn);
      await launch(() => current().openGalleryAnchor("anchor"));
      assert.equal(current().galleryReplayActive, true);
      if (exit === "manual") current().openMenu();
      else {
        current().engine.completeTyping(); current().next();
        await checkpoint(2);
        current().engine.completeTyping(); current().next();
      }
      commit(); assert.equal(current().screen, "gallery");
      row.actual = { returnScreen: current().returnScreen, scene: current().engineState.currentSceneId,
        command: current().engineState.currentCommandIndex, text: current().engineState.dialog?.text,
        history: current().engineState.history, galleryReplayActive: current().galleryReplayActive,
        canRollbackBeforeLeavingGallery: current().engineState.canRollback };
      assert.equal(current().returnScreen, expectedReturn, "Gallery must retain its original navigation parent");
      if (entry === "title_menu") {
        assert.equal(current().engineState.currentSceneId, "", "Title replay must not leave a fake active story");
        assert.deepEqual(current().engineState.history, []);
      } else {
        assert.equal(current().engineState.currentSceneId, original.scene_id, "Gallery must not reset the original engine");
        assert.equal(current().engineState.currentCommandIndex, original.command_index);
        assert.deepEqual(current().engineState.dialog, original.dialog);
        assert.deepEqual(current().engineState.history, original.history);
      }
      assert.equal(current().galleryReplayActive, false);
      current().closeMenu();
      if (expectedReturn === "playing") {
        current().beginLaunchCover(); await current().completeLaunchCover(); current().completeLaunchReveal();
      } else commit();
      assert.equal(current().screen, expectedReturn);
      if (rollbackRequired && entry !== "title_menu") {
        if (expectedReturn !== "playing") await launch(() => current().resumeActiveGame());
        row.rollback = { availableAfterReplay: current().engineState.canRollback };
        assert.equal(row.rollback.availableAfterReplay, originalCanRollback, "Replay must not erase the original rollback timeline");
        assert.equal(current().rollback(), true);
        assert.equal(current().engineState.dialog?.text, "ORIGINAL_OPENING");
        assert.equal(current().engineState.history.length, 1);
        assert.equal(current().rollForward(), true);
        assert.equal(current().engineState.dialog?.text, original.dialog.text);
        assert.deepEqual(current().engineState.history, original.history);
        row.rollback.roundTrip = true;
      }
      row.status = "PASS";
    } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  }
  report.status = report.cases.length === 8 && report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
}
main().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(() => {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2)); if (report.status !== "PASS") process.exitCode = 1;
});
