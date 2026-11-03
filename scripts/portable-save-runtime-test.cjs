"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const out = process.env.AGENTVN_SAVE_TEST_OUTPUT
  || path.join(root, "output/portable-save-runtime", new Date().toISOString().replace(/[:.]/g, "-"));
assert(!fs.existsSync(out), "Never overwrite previous evidence");
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", cases: [] };
const data = new Map();
global.window = { location: { search: "" }, localStorage: { getItem: k => data.get(k) ?? null,
  setItem: (k,v) => data.set(k,v) }, matchMedia: () => ({ matches: false }),
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, dispatchEvent() {} };
window.parent = window; global.localStorage = window.localStorage;
global.document = { visibilityState: "visible", addEventListener() {} };
let resolveMigration, rejectMigration, migrateCalls = 0, copyError, unverifiedOnly = false, lastMigration;
const claim = { fileName: "slot-03.json", sourceSha256: "a".repeat(64) };
global.__saveInvoke = async (command, args) => {
  if (command === "get_save_storage_info") return {
    portable: true, sourceDirectory: "旧数据/saves/preview_gamecli", targetDirectory: `安装/saves/${args.installId}`,
    availableFiles: unverifiedOnly ? [] : ["slot-01.json"],
    unverifiedFiles: unverifiedOnly ? [{ ...claim, slot: 3, saveKind: "manual", sceneId: "main", conflict: false }] : [],
    conflictFiles: ["slot-02.json"], skippedFiles: [], copiedFiles: [],
  };
  if (command === "migrate_legacy_saves") {
    lastMigration = structuredClone(args);
    migrateCalls++;
    if (copyError) throw new Error(copyError);
    return new Promise((resolve, reject) => { resolveMigration = resolve; rejectMigration = reject; });
  }
  if (command === "list_saves" || command === "list_gallery_unlocks") return [];
  if (command === "append_frontend_error") return "";
  throw new Error(`Unhandled native command: ${command}`);
};
const built = require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { useRuntimeStore } from "./GameCli_framework/src/store/runtimeStore";' },
  bundle: true, write: false, format: "cjs", platform: "node", define: { "import.meta.env": "{}" },
  plugins: undefined,
});
// Boundary only: Tauri IPC. All store, serialization and ownership logic remains real.
const patched = built.outputFiles[0].text;
const loaded = { exports: {} };
new Function("module", "exports", "require", patched)(loaded, loaded.exports, require);
window.__TAURI_INTERNALS__ = { invoke: (...args) => global.__saveInvoke(...args) };
const game = id => ({ install_id: id, game_id: id, title: id, gallery: [], assetUrls: {},
  manifest: { game_id: id, title: id, assets: [], entry_scene_id: "main" },
  script: { game_id: id, entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main",
    title: "Main", commands: [{ type: "narration", text: "隔离存档迁移" }] }] } });
(async () => {
  const store = loaded.exports.useRuntimeStore;
  store.getState().setRuntimeMode("fixed");
  await store.getState().loadGame(game("game-a"));
  assert.equal(store.getState().saveMigrationOpen, true, "existing matching legacy saves require player consent");
  assert.equal(migrateCalls, 0, "loading the game cannot copy saves");
  store.getState().closeSaveMigration();
  assert.equal(store.getState().saveMigrationOpen, false);
  assert.equal(migrateCalls, 0, "cancel must not invoke migration");
  report.cases.push("initial-consent-and-cancel");
  await store.getState().openSaveMigration();
  const first = store.getState().confirmSaveMigration();
  const duplicate = store.getState().confirmSaveMigration();
  await Promise.resolve();
  assert.equal(migrateCalls, 1);
  assert.equal(store.getState().saveMigrationPending, true);
  store.getState().closeSaveMigration();
  assert.equal(store.getState().saveMigrationOpen, true, "cannot dismiss an active copy");
  resolveMigration({ ...store.getState().saveStorageInfo, availableFiles: [], copiedFiles: ["slot-01.json"] });
  await Promise.all([first, duplicate]);
  assert.equal(store.getState().saveMigrationPending, false);
  assert.equal(store.getState().saveMigrationOpen, false);
  assert.match(store.getState().saveNotice.message, /已复制 1/);
  report.cases.push("single-flight-confirm-and-success-refresh");
  await store.getState().openSaveMigration();
  copyError = "安装目录只读；不会回退到其他位置";
  await store.getState().confirmSaveMigration();
  assert.equal(store.getState().saveMigrationOpen, true);
  assert.match(store.getState().saveMigrationError, /只读/);
  assert.equal(store.getState().saveMigrationPending, false);
  copyError = undefined;
  const retry = store.getState().confirmSaveMigration();
  await Promise.resolve();
  resolveMigration({ ...store.getState().saveStorageInfo, availableFiles: [], copiedFiles: ["slot-01.json"] });
  await retry;
  assert.equal(store.getState().saveMigrationOpen, false);
  report.cases.push("write-error-retains-dialog-and-real-retry");
  for (const staleFailure of [false, true]) {
    await store.getState().openSaveMigration();
    const pending = store.getState().confirmSaveMigration();
    await Promise.resolve();
    const release = resolveMigration, reject = rejectMigration;
    await store.getState().loadGame(game("game-b"));
    await store.getState().loadGame(game("game-a"));
    const expected = { info: store.getState().saveStorageInfo, notice: store.getState().saveNotice };
    if (staleFailure) reject(new Error("late old operation failure"));
    else release({ ...expected.info, copiedFiles: ["old-operation.json"], availableFiles: [] });
    await pending;
    assert.equal(store.getState().currentGame.game_id, "game-a");
    assert.deepEqual(store.getState().saveStorageInfo, expected.info);
    assert.deepEqual(store.getState().saveNotice, expected.notice);
    assert.equal(store.getState().saveMigrationError, undefined);
    assert.equal(store.getState().saveMigrationPending, false);
    assert.equal(store.getState().saveMigrationOpen, true);
  }
  report.cases.push("A-B-A-stale-success-and-failure-ownership");
  unverifiedOnly = true;
  await store.getState().loadGame(game("game-a"));
  assert.equal(store.getState().saveMigrationOpen, true, "ambiguous saves must be visible for manual review");
  const beforeClaims = migrateCalls;
  store.getState().closeSaveMigration();
  assert.equal(migrateCalls, beforeClaims, "review and cancellation cannot copy an ambiguous save");
  await store.getState().openSaveMigration();
  const claimed = store.getState().confirmSaveMigration([claim]);
  const repeated = store.getState().confirmSaveMigration([claim]);
  await Promise.resolve();
  assert.equal(migrateCalls, beforeClaims + 1, "claimed migration remains single-flight");
  assert.deepEqual(lastMigration, { installId: "game-a", gameId: "game-a", confirmed: true, legacyClaims: [claim] });
  resolveMigration({ ...store.getState().saveStorageInfo, unverifiedFiles: [], copiedFiles: ["slot-03.json"] });
  await Promise.all([claimed, repeated]);
  assert.equal(store.getState().saveMigrationOpen, false);
  report.cases.push("explicit-ambiguous-save-claims-reach-native-boundary-once");
  await store.getState().loadLivePreview(game("preview"));
  assert.equal(store.getState().saveStorageInfo, undefined);
  assert.equal(store.getState().saveMigrationOpen, false);
  report.cases.push("live-preview-clears-migration-ui");
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(() => {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Evidence: ${out}`);
});
