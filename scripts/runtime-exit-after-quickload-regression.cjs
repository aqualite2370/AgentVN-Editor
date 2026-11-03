"use strict";
// Execute the real store/engine and its save queue. Only preview capture and
// localStorage IO are controlled; the exact exported GUI script stays intact.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const root = path.resolve(__dirname, "..");
const output = path.join("F:\\AgentVN\\QA\\Android-Package-20261021-01", "exit-after-quickload-" + process.argv[2]);
assert.match(process.argv[2] ?? "", /^(?:red|green)-\d{2}$/);
fs.mkdirSync(output);
const values = new Map();
global.window = {
  location: { search: "" }, localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  },
  matchMedia: () => ({ matches: true }), setTimeout, clearTimeout, queueMicrotask, dispatchEvent() {},
};
window.parent = window; global.localStorage = window.localStorage;
global.document = { visibilityState: "visible", addEventListener() {} };
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_STORE_AND_EXPORTED_SCRIPT_CONTROLLED_STORAGE_NOT_NATIVE_OR_DEVICE", cases: [],
  sources: [fileEvidence(__filename), fileEvidence(path.join(root, "GameCli_framework/src/store/runtimeStore.ts"))],
  productChanges: 0, modelRequests: 0 };
const settle = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const build = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Android-Package-20261021-01/editor-19/report.json", "utf8"));
  assert.equal(fileEvidence(build.cartridge.path).sha256, build.cartridge.sha256);
  report.sources.push(build.cartridge);
  const zip = await require("../editor/node_modules/jszip").loadAsync(fs.readFileSync(build.cartridge.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const previewBoundary = path.join(root, "GameCli_framework/src/engine/savePreview.ts");
  const built = await require("../GameCli_framework/node_modules/esbuild").build({
    stdin: { resolveDir: root, loader: "ts", contents: `
      export { useRuntimeStore } from "./GameCli_framework/src/store/runtimeStore";
      export { useSettingsStore } from "./GameCli_framework/src/store/settingsStore";
      export { listDesktopSaves } from "./GameCli_framework/src/engine/desktopSaveManager";
    ` },
    bundle: true, platform: "node", format: "cjs", write: false,
    define: { "import.meta.env": "{}" }, logLevel: "silent",
    plugins: [{ name: "controlled-preview-boundary", setup(build) {
      build.onLoad({ filter: /savePreview\.ts$/ }, args => args.path === previewBoundary ? {
        loader: "js", contents: `
          export const SAVE_PREVIEW_VERSION=2;
          export const captureSavePreview=async()=>undefined;
          export const renderSavePreviewFromState=captureSavePreview;
          export const captureCurrentSavePreview=captureSavePreview;
          export const cacheCurrentSavePreview=captureSavePreview;
          export const clearCachedSavePreview=()=>{};
        `,
      } : undefined);
    } }],
  });
  const loaded = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(loaded, loaded.exports, require);
  const { useRuntimeStore: store, useSettingsStore, listDesktopSaves } = loaded.exports;
  const capture = () => {
    const e = store.getState().engine.state;
    return { command: e.currentCommandIndex, type: e.currentCommandType,
      paused: e.isPaused, scene: e.currentSceneId, history: structuredClone(e.history),
      choices: e.choices.map(choice => choice.choice_id) };
  };
  async function next() {
    store.getState().completeCurrentTyping(); store.getState().next(); await settle(); await settle();
  }
  for (const loop of [false, true]) {
    const row = { name: loop ? "Quickload then a real branch loop before exit" : "Quickload before exit",
      status: "RUNNING", observations: [] };
    report.cases.push(row);
    try {
      const installId = "exit-quickload-qa-" + String(loop);
      const game = { install_id: installId, game_id: manifest.game_id, title: manifest.title,
        manifest: { ...manifest, assets: [] }, script, gallery: [], assetUrls: {} };
      await store.getState().loadGame(game);
      useSettingsStore.setState(state => ({ settings: { ...state.settings, autoSaveEnabled: true } }));
      store.setState({ runtimeMode: "fixed" });
      store.getState().engine.start(); store.setState({ screen: "playing" });
      await settle(); await store.getState().quickSave();
      await next(); assert.equal(capture().type, "choice");
      await settle(); await settle();
      row.observations.push({ phase: "before-quickload", state: capture(), saves: await listDesktopSaves(installId) });
      store.getState().requestQuickLoad();
      assert(store.getState().quickLoadCandidate);
      const loading = store.getState().confirmQuickLoad();
      const until = Date.now() + 5000;
      while (store.getState().launchTransition !== "arming" && Date.now() < until)
        await settle();
      assert.equal(store.getState().launchTransition, "arming", "Wait for actual asynchronous quickload readiness");
      store.getState().beginLaunchCover(); await store.getState().completeLaunchCover();
      store.getState().completeLaunchReveal(); await loading;
      assert.equal(capture().command, 0); assert.equal(capture().type, "dialog");
      if (loop) {
        await next(); assert.equal(capture().type, "choice");
        store.getState().engine.choose(capture().choices[0]); await settle(); await settle();
        assert.equal(capture().command, 0); assert.equal(capture().type, "dialog");
      }
      const current = capture(); row.observations.push({ phase: "before-exit", state: current });
      const result = await store.getState().flushAutoSave(), saves = await listDesktopSaves(installId);
      row.result = result; row.observations.push({ phase: "after-exit-barrier", saves });
      assert.equal(current.paused, false);
      const matches = saves.filter(save => save.save_kind === "auto"
        && save.scene_id === current.scene && save.command_index === current.command);
      assert(matches.length > 0, "Exit must persist current dialogue, not only the previous choice autosave");
      assert(matches.some(save => JSON.stringify(save.history) === JSON.stringify(current.history)),
        "Exit must preserve the actual post-loop history");
      row.status = "PASS";
    } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  }
  report.status = report.cases.every(row => row.status === "PASS") ? "PASS" : "FAILED";
  if (report.status === "FAILED") process.exitCode = 1;
}
let timeout;
Promise.race([main(), new Promise((_, reject) => {
  timeout = setTimeout(() => reject(Error("Controlled regression did not reach terminal state")), 20000);
})]).catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    clearTimeout(timeout);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, output, cases: report.cases.map(({ name, status, error }) => ({ name, status, error })),
      error: report.error }));
  });
