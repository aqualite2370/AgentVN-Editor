"use strict";
// Real snapshot/queue/serializer; only native IPC and raster preview are controlled.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const out = process.env.AGENTVN_SAVE_TEST_OUTPUT
  || path.join(root, "output/portable-save-identity", new Date().toISOString().replace(/[:.]/g, "-"));
assert(!fs.existsSync(out), "Never overwrite previous evidence");
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", cases: [] }, records = new Map(), preferences = new Map();
let portable = true, scanFails = false, expectedGame;
global.window = {
  location: { search: "" }, localStorage: {
    getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value),
  },
  matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, queueMicrotask, dispatchEvent() {},
};
window.parent = window; global.localStorage = window.localStorage;
global.document = { visibilityState: "visible", addEventListener() {} };
window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
  if (command === "get_save_storage_info") {
    if (scanFails) throw new Error("controlled legacy scan denied");
    return { portable, sourceDirectory: null, targetDirectory: "isolated/saves",
      availableFiles: [], conflictFiles: [], skippedFiles: [], copiedFiles: [] };
  }
  if (command === "list_gallery_unlocks") return [];
  if (command === "list_saves") return [...records.values()].filter(save => save.install_id === args.installId);
  if (command === "write_save") {
    assert.equal(args.installId, "preview_gamecli", "Storage install identity must stay unchanged");
    assert.equal(args.save.install_id, args.installId);
    // Mirrors the native fixed-game write guard which caught the installed failure.
    assert.equal(args.save.game_id, expectedGame, "Fixed-game snapshot must retain the actual game ID");
    records.set(`${args.kind}:${args.slot}`, structuredClone(args.save));
    return;
  }
  if (command === "read_save") return records.get(`${args.kind}:${args.slot}`) ?? null;
  if (command === "append_frontend_error") return "";
  throw new Error(`Unhandled native command ${command}`);
} };
async function main() {
  const built = await require("../editor/node_modules/esbuild").build({
    stdin: { resolveDir: root, loader: "ts", contents:
      'export {useRuntimeStore} from "./GameCli_framework/src/store/runtimeStore"; export {useSettingsStore} from "./GameCli_framework/src/store/settingsStore";' },
    bundle: true, platform: "node", format: "cjs", write: false, define: { "import.meta.env": "{}" },
    plugins: [{ name: "preview-boundary", setup(build) {
      build.onLoad({ filter: /[\\/]engine[\\/]savePreview\.ts$/ }, () => ({ loader: "js", contents: `
        export const SAVE_PREVIEW_VERSION=2;
        export const captureSavePreview=async()=>undefined;
        export const captureCurrentSavePreview=captureSavePreview;
        export const renderSavePreviewFromState=captureSavePreview;
        export const cacheCurrentSavePreview=captureSavePreview;
        export const clearCachedSavePreview=()=>{};
      ` }));
    } }],
  });
  const loaded = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(loaded, loaded.exports, require);
  const { useRuntimeStore: store, useSettingsStore: settings } = loaded.exports;
  for (const scenario of [
    { name: "portable-fixed-native-identity", portable: true, scanFails: false, mode: "fixed" },
    { name: "fixed-private-storage-path-unchanged", portable: false, scanFails: false, mode: "fixed" },
    { name: "legacy-scan-error-cannot-corrupt-snapshot-identity", portable: true, scanFails: true, mode: "fixed" },
    { name: "library-install-identity-unchanged", portable: false, scanFails: false, mode: "library" },
    { name: "preview-install-identity-unchanged", portable: false, scanFails: false, mode: "preview" },
  ]) {
    portable = scenario.portable; scanFails = scenario.scanFails; records.clear();
    const actualGame = `actual-game-${scenario.name}`;
    expectedGame = scenario.mode === "fixed" ? actualGame : "preview_gamecli";
    const game = { install_id: "preview_gamecli", game_id: actualGame, title: "隔离游戏",
      gallery: [], assetUrls: {}, manifest: { game_id: actualGame, assets: [], entry_scene_id: "main" },
      script: { game_id: actualGame, entry_scene_id: "main", characters: [],
        scenes: [{ scene_id: "main", title: "Main", commands: [{ type: "narration", text: "真实身份存档" }] }] } };
    store.getState().setRuntimeMode(scenario.mode);
    await store.getState().loadGame(game);
    settings.setState(state => ({ settings: { ...state.settings, autoSaveEnabled: false } }));
    store.getState().engine.start();
    store.setState({ screen: "playing", engineState: { ...store.getState().engine.state } });
    for (const kind of ["manual", "auto"]) await store.getState().save({ kind, slot: 1 });
    await store.getState().quickSave();
    assert.equal(records.size, 3);
    assert([...records.values()].every(save => save.game_id === expectedGame && save.install_id === "preview_gamecli"));
    report.cases.push({ name: scenario.name, status: "PASS", kinds: ["manual", "auto", "quick"] });
  }
  report.status = "PASS";
}
main().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(() => {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Evidence: ${out}`);
});
