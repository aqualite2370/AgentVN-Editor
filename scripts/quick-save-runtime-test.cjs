"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT || path.join(root, "output/quick-save-runtime", runId);
const values = new Map();
let failWrites = false;
global.window = {
  location: { search: "" },
  localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (failWrites && key.startsWith("agentvn.gamecli.saves.")) throw new Error("controlled disk failure");
      values.set(key, value);
    },
  },
  matchMedia: () => ({ matches: true }),
  setTimeout, clearTimeout, queueMicrotask, dispatchEvent() {},
};
window.parent = window;
global.localStorage = window.localStorage;
global.document = { visibilityState: "visible", addEventListener() {} };
const previewBoundary = path.join(root, "GameCli_framework/src/engine/savePreview.ts");
let releaseCapture;
let captureBlocked = false;
global.__quickCapture = async () => {
  if (captureBlocked) await new Promise(resolve => { releaseCapture = resolve; });
  return undefined;
};

async function main() {
  const built = await require("../GameCli_framework/node_modules/esbuild").build({
    stdin: { resolveDir: root, loader: "ts", contents: `
      export { useRuntimeStore } from "./GameCli_framework/src/store/runtimeStore";
      export { useSettingsStore } from "./GameCli_framework/src/store/settingsStore";
      export * from "./GameCli_framework/src/engine/desktopSaveManager";
    ` },
    bundle: true, platform: "node", format: "cjs", write: false,
    define: { "import.meta.env": "{}" }, logLevel: "silent",
    plugins: [{
      name: "controlled-preview-capture-boundary",
      setup(build) {
        build.onLoad({ filter: /savePreview\.ts$/ }, args => args.path === previewBoundary ? {
          loader: "js", contents: `
            export const SAVE_PREVIEW_VERSION = 2;
            export const captureSavePreview = (...args) => globalThis.__quickCapture(...args);
            export const renderSavePreviewFromState = captureSavePreview;
            export const captureCurrentSavePreview = captureSavePreview;
            export const cacheCurrentSavePreview = captureSavePreview;
            export const clearCachedSavePreview = () => {};
          `,
        } : undefined);
      },
    }],
  });
  const loaded = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(loaded, loaded.exports, require);
  const { useRuntimeStore: store, useSettingsStore, listDesktopSaves, writeDesktopSave } = loaded.exports;
  const game = id => ({
    install_id: id, game_id: id, title: id, gallery: [], assetUrls: {},
    manifest: { game_id: id, title: id, assets: [], entry_scene_id: "main" },
    script: { game_id: id, entry_scene_id: "main", characters: [],
      scenes: [{ scene_id: "main", title: "Main", commands: [{ type: "narration", text: "测试快存" }] }] },
  });
  async function start(id) {
    await store.getState().loadGame(game(id));
    useSettingsStore.setState(state => ({ settings: { ...state.settings, autoSaveEnabled: false } }));
    store.getState().engine.start();
    store.setState({ screen: "playing", engineState: { ...store.getState().engine.state } });
  }
  await start("quick-runtime-a");
  assert.equal(typeof store.getState().quickSave, "function", "Runtime 必须提供真正的快存操作");
  assert.equal(typeof store.getState().requestQuickLoad, "function", "快读必须先请求确认");
  await store.getState().save({ kind: "manual", slot: 1 });
  await store.getState().save({ kind: "auto", slot: 1 });
  const baseline = (await listDesktopSaves("quick-runtime-a")).filter(save => save.save_kind !== "quick");
  for (let index = 0; index < 8; index++) {
    await store.getState().quickSave();
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  let records = await listDesktopSaves("quick-runtime-a");
  assert.equal(records.filter(save => save.save_kind === "quick").length, 6);
  assert.deepEqual(records.filter(save => save.save_kind !== "quick"), baseline);
  report.cases.push("recent-six-and-category-isolation");

  captureBlocked = true;
  const first = store.getState().quickSave();
  const second = store.getState().quickSave();
  const draining = store.getState().flushAutoSave();
  let drained = false;
  void draining.then(() => { drained = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drained, false, "关闭自动保存后，退出仍必须等待正在进行的快存");
  assert.equal(first, second, "重复点击合并为同一快存任务");
  assert.equal(store.getState().quickSavePending, true);
  captureBlocked = false;
  releaseCapture();
  await first;
  await draining;
  assert.equal(store.getState().quickSavePending, false);
  report.cases.push("duplicate-coalesced-and-exit-barrier");

  records = await listDesktopSaves("quick-runtime-a");
  failWrites = true;
  await assert.rejects(store.getState().quickSave(), /controlled disk failure/);
  failWrites = false;
  assert.deepEqual(await listDesktopSaves("quick-runtime-a"), records, "失败不得删除旧快存");
  assert.equal(store.getState().saveNotice.status, "error");
  await store.getState().quickSave();
  report.cases.push("failed-write-retains-all-and-retry");

  records = await listDesktopSaves("quick-runtime-a");
  const valid = records.filter(save => save.save_kind === "quick").sort((a, b) =>
    Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  await writeDesktopSave("quick-runtime-a", { kind: "quick", slot: 6 }, {
    ...valid, save_id: "invalid-newest", scene_id: "missing", created_at: "2099-01-01T00:00:00Z",
  });
  store.setState({ saves: await listDesktopSaves("quick-runtime-a") });
  store.getState().requestQuickLoad();
  assert.notEqual(store.getState().quickLoadCandidate?.save_id, "invalid-newest");
  assert.equal(store.getState().launchTransition, "idle", "请求快读不能提前读档");
  store.getState().cancelQuickLoad();
  assert.equal(store.getState().quickLoadCandidate, undefined);
  report.cases.push("latest-valid-and-confirmation-before-loading");

  captureBlocked = true;
  const oldWrite = store.getState().quickSave();
  await new Promise(resolve => setImmediate(resolve));
  await start("quick-runtime-b");
  captureBlocked = false;
  releaseCapture();
  await oldWrite;
  assert.equal(store.getState().currentGame.install_id, "quick-runtime-b");
  assert.equal(store.getState().saves.length, 0, "旧工程写入返回不能污染新工程");
  assert.equal(store.getState().saveNotice, undefined);
  store.getState().requestQuickLoad();
  assert.equal(store.getState().quickLoadCandidate, undefined);
  assert.match(store.getState().saveNotice.message, /快存/);
  report.cases.push("game-ownership-and-no-quick-feedback");
  report.status = "PASS";
}
const report = { runId, status: "RUNNING", cases: [] };
fs.mkdirSync(output, { recursive: true });
main().catch(error => {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  console.error(report.error);
  process.exitCode = 1;
}).finally(() => {
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`${report.status}: ${report.cases.length} cases; ${output}`);
});
