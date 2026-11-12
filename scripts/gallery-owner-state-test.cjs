"use strict";
// Delay only the storage boundary; keep the actual Runtime store and StoryEngine.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), esbuild = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const values = new Map(), gates = [];
global.window = { location: { search: "" }, localStorage: { getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
  matchMedia: () => ({ matches: false }), queueMicrotask, dispatchEvent() {}, clearTimeout,
  setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timer.unref(); return timer; } };
window.parent = window; global.localStorage = window.localStorage;
global.document = { visibilityState: "visible", addEventListener() {} };
global.requestAnimationFrame = fn => setImmediate(() => fn(performance.now()));
global.__galleryWriteGate = () => new Promise((resolve, reject) => gates.push({ resolve, reject }));
const report = { status: "RUNNING", cases: [], scope: "ACTUAL_STORE_ENGINE_WITH_CONTROLLED_STORAGE_LATENCY_NOT_NATIVE",
  source: { path: path.join(root, "GameCli_framework/src/store/runtimeStore.ts") }, modelRequests: 0 };
report.source.sha256 = crypto.createHash("sha256").update(fs.readFileSync(report.source.path)).digest("hex");
const turn = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const bundle = await esbuild.build({ stdin: { resolveDir: root, loader: "ts", contents: `
    export {useRuntimeStore} from "./GameCli_framework/src/store/runtimeStore";
    export {useSettingsStore} from "./GameCli_framework/src/store/settingsStore";
  ` }, bundle: true, platform: "node", format: "cjs", write: false, define: { "import.meta.env": "{}" },
    plugins: [{ name: "controlled-gallery-write-boundary", setup(build) {
      build.onLoad({ filter: /galleryAnchorManager\.ts$/ }, args => {
        const source = fs.readFileSync(args.path, "utf8").replace("export async function writeGalleryAnchor(",
          "async function persistGalleryAnchor(");
        return { loader: "ts", contents: source + `
          export async function writeGalleryAnchor(...args: Parameters<typeof persistGalleryAnchor>) {
            await (globalThis as any).__galleryWriteGate(); await persistGalleryAnchor(...args);
          }` };
      });
    } }] });
  const m = { exports: {} }; new Function("module", "exports", "require", bundle.outputFiles[0].text)(m, m.exports, require);
  const { useRuntimeStore: store, useSettingsStore: settings } = m.exports, current = () => store.getState();
  const game = id => ({ install_id: id, game_id: id, title: id, assetUrls: {},
    manifest: { game_id: id, title: id, assets: [] },
    gallery: [{ item_id: "anchor", anchor_id: "anchor", scene_id: "main", title: "锚点", asset_id: "", unlocked: false }],
    script: { game_id: id, entry_scene_id: "main", scenes: [{ scene_id: "main", title: "场景",
      commands: [{ type: "narration", text: "起点" }, { type: "gallery_anchor", anchor_id: "anchor", title: "锚点", asset_id: "" },
        { type: "narration", text: "已经过锚点" }] }] } });
  for (const scenario of ["late-success-A-B", "late-success-A-B-A", "late-error-A-B", "late-error-A-B-A"]) {
    const a = `gallery-${scenario}-A`, b = `gallery-${scenario}-B`;
    await current().loadGame(game(a)); settings.getState().updateSettings({ autoSaveEnabled: false, textSpeed: 0 });
    const launch = current().startNewGame(); current().beginLaunchCover();
    await current().completeLaunchCover(); current().completeLaunchReveal(); await launch;
    current().engine.completeTyping(); current().next();
    for (let i = 0; !gates.length && i < 100; i++) await turn();
    assert.equal(gates.length, 1); const gate = gates.shift();
    await current().loadGame(game(b));
    if (scenario.endsWith("B-A")) await current().loadGame(game(a));
    const before = { game: structuredClone(current().currentGame), unlocks: structuredClone(current().galleryUnlocks),
      notice: current().galleryNotice, saveNotice: current().saveNotice, entryError: current().entryError };
    if (scenario.includes("error")) gate.reject(new Error("Controlled delayed gallery storage failure"));
    else gate.resolve();
    for (let i = 0; i < 5; i++) await turn();
    assert.deepEqual({ game: current().currentGame, unlocks: current().galleryUnlocks,
      notice: current().galleryNotice, saveNotice: current().saveNotice, entryError: current().entryError }, before);
    if (scenario.includes("success")) {
      assert(values.has(`agentvn.gamecli.gallery.${a}`), "The completed write remains assigned to its original game");
      await current().loadGame(game(a)); assert(current().currentGame.gallery[0].unlocked);
    }
    report.cases.push({ scenario, status: "PASS" });
  }
  assert.equal(report.cases.length, 4); assert.equal(gates.length, 0); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => { fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report)); });
