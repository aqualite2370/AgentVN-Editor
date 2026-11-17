"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
const child = process.argv[3] === "--child";
if (!child) {
  assert(out.startsWith("F:\\testavn\\Gallery-Preview-Options-") && !fs.existsSync(out));
  fs.mkdirSync(out, { recursive: true });
  const report = { status: "RUNNING", scope: "ACTUAL_STORE_ENGINE_CONTROLLED_NATIVE_IPC", cases: [], modelRequests: 0 };
  try {
    const built = require("../editor/node_modules/esbuild").buildSync({
      stdin: { resolveDir: root, loader: "ts", contents: `
        export {useRuntimeStore} from "./GameCli_framework/src/store/runtimeStore";
        export {useSettingsStore} from "./GameCli_framework/src/store/settingsStore";` },
      bundle: true, platform: "node", format: "cjs", write: false, define: { "import.meta.env": "{}" },
      nodePaths: [path.join(root, "editor/node_modules"), path.join(root, "GameCli_framework/node_modules")],
    });
    fs.writeFileSync(path.join(out, "store.cjs"), built.outputFiles[0].text, { flag: "wx" });
    for (const theme of ["agentvn", "renpy"]) for (const boundary of ["web", "native"])
      for (const [mode, loader] of [["preview", "loadGame"], ["preview", "loadLivePreview"],
        ["fixed", "loadGame"], ["library", "loadGame"]]) for (const option of ["missing", "false", "true", "invalid"]) {
        const run = cp.spawnSync(process.execPath, [__filename, out, "--child", theme, boundary, mode, loader, option],
          { cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000 });
        report.cases.push({ theme, boundary, mode, loader, option, status: run.status === 0 ? "PASS" : "FAILED",
          exit: run.status, stdout: run.stdout, stderr: run.stderr });
      }
    assert.equal(report.cases.length, 64);
    assert(report.cases.every(c => c.status === "PASS"), "See individual failed cases");
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = e.stack; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, passed: report.cases.filter(c => c.status === "PASS").length,
    cases: report.cases.length, error: report.error }));
} else {
  const [theme, boundary, mode, loader, option] = process.argv.slice(4), records = {}, calls = [];
  const options = option === "missing" ? undefined : { unlockAllGallery: option === "invalid" ? "true" : option === "true" };
  const bypass = mode === "preview" && option === "true";
  const legacy = JSON.stringify({ old: { anchor_id: "old", scene_id: "main" } });
  records["agentvn.gamecli.gallery.preview_gamecli"] = legacy;
  global.window = { location: { search: "" }, localStorage: {
    getItem: k => records[k] ?? null, setItem: (k, v) => { records[k] = v; }, removeItem: k => { delete records[k]; },
  }, matchMedia: () => ({ matches: false }), queueMicrotask, dispatchEvent() {}, clearTimeout,
    setTimeout: (fn, delay) => { const t = setTimeout(fn, delay); t.unref(); return t; } };
  window.parent = window; global.localStorage = window.localStorage;
  global.document = { visibilityState: "visible", addEventListener() {} };
  global.requestAnimationFrame = fn => setImmediate(() => fn(performance.now()));
  const unlocks = {};
  if (boundary === "native") window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    calls.push({ command, args });
    if (command === "list_gallery_unlocks") return Object.keys(unlocks[args.installId] || {});
    if (command === "read_gallery_anchor") return unlocks[args.installId]?.[args.anchorId] || null;
    if (command === "write_gallery_anchor") {
      unlocks[args.installId] = { ...unlocks[args.installId], [args.anchorId]: args.save }; return;
    }
    if (command === "list_saves") return [];
    if (command === "get_save_storage_info") return { portable: false, availableFiles: [] };
    if (command === "append_frontend_error") return "";
    throw new Error("Unexpected native command " + command);
  } };
  const { useRuntimeStore: store, useSettingsStore: settings } = require(path.join(out, "store.cjs"));
  const make = id => ({ install_id: mode === "preview" ? (loader === "loadGame" ? "preview_gamecli" : "live_preview_" + id) : "formal-" + mode,
    game_id: id, title: "预览画廊选项", assetUrls: {},
    manifest: { game_id: id, title: "预览画廊选项", assets: [], layout_type: theme },
    gallery: ["anchor", "legacy-anchor"].map((key, i) => ({ item_id: key, anchor_id: key,
      ...(i === 0 ? { scene_id: "main" } : {}), title: key, asset_id: "", unlocked: true })),
    script: { game_id: id, entry_scene_id: "main", scenes: [{ scene_id: "main", title: "场景", commands: [
      { type: "narration", text: "起点" }, { type: "gallery_anchor", anchor_id: "anchor", title: "画廊", asset_id: "" },
      { type: "narration", text: "经过锚点" }, { type: "gallery_anchor", anchor_id: "legacy-anchor", title: "旧锚点", asset_id: "" },
      { type: "narration", text: "终点" }] }] } });
  const load = (id, chosen = options) => loader === "loadLivePreview"
    ? store.getState().loadLivePreview(make(id), undefined, chosen) : store.getState().loadGame(make(id), chosen);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const galleryCalls = () => calls.filter(c => c.command.includes("gallery"));
  const snapshot = () => JSON.stringify({ records: Object.fromEntries(Object.entries(records).filter(([k]) => k.includes(".gallery."))), unlocks });
  async function enter(promise) {
    store.getState().beginLaunchCover(); await store.getState().completeLaunchCover();
    store.getState().completeLaunchReveal(); await promise;
  }
  (async () => {
    store.getState().setRuntimeMode(mode);
    const before = snapshot();
    await load("project-A");
    settings.getState().updateSettings({ autoSaveEnabled: false, textSpeed: 0 });
    assert.equal(store.getState().previewUnlockAllGallery, bypass);
    assert(store.getState().currentGame.gallery.every(i => i.unlocked === bypass), "Only boolean true in preview bypasses actual locks");
    if (bypass) {
      for (const anchor of ["anchor", "legacy-anchor"]) {
        await enter(store.getState().openGalleryAnchor(anchor));
        assert(store.getState().galleryReplayActive);
        assert.equal(store.getState().engineState.dialog.text, "起点");
        store.getState().exitGalleryReplay();
      }
    }
    await enter(store.getState().startNewGame());
    store.getState().engine.completeTyping(); store.getState().next();
    for (let i = 0; store.getState().engineState.dialog?.text !== "经过锚点" && i < 1000; i++) await tick();
    assert.equal(store.getState().engineState.dialog?.text, "经过锚点", "Wait for the actual anchor event to finish");
    await store.getState().flushAutoSave(); await tick();
    if (bypass) {
      assert.equal(snapshot(), before, "All-open preview must not save gallery progress");
      assert.equal(galleryCalls().length, 0, "All-open preview must not read unlocks either");
      assert(!store.getState().galleryNotice);
      const position = store.getState().engineState.currentCommandIndex;
      await store.getState().controlLivePreview({ action: "set_gallery_unlock_all", unlockAllGallery: false });
      assert(store.getState().currentGame.gallery.every(i => !i.unlocked), "Uncheck restores actual locked progress");
      assert.equal(store.getState().engineState.currentCommandIndex, position, "Changing access must preserve playback");
      await store.getState().controlLivePreview({ action: "set_gallery_unlock_all", unlockAllGallery: true });
      assert(store.getState().currentGame.gallery.every(i => i.unlocked));
    } else {
      assert(store.getState().currentGame.gallery[0].unlocked, "Normal story unlock must still persist");
      if (mode === "preview") {
        await load("project-B");
        assert(store.getState().currentGame.gallery.every(i => !i.unlocked), "Other project stays locked");
      }
      await load("project-A");
      assert(store.getState().currentGame.gallery[0].unlocked, "Normal progress survives reload");
      assert(!store.getState().currentGame.gallery[1].unlocked);
      if (mode !== "preview") {
        await store.getState().controlLivePreview({ action: "set_gallery_unlock_all", unlockAllGallery: true });
        assert(!store.getState().currentGame.gallery[1].unlocked, "Formal runtime ignores even live-preview option control");
      }
    }
    if (mode === "preview") {
      await load("project-B", { unlockAllGallery: true });
      assert(store.getState().currentGame.gallery.every(i => i.unlocked));
      await (loader === "loadGame" ? store.getState().loadGame(make("project-B"))
        : store.getState().loadLivePreview(make("project-B")));
      assert(store.getState().currentGame.gallery.every(i => !i.unlocked), "New launch never inherits bypass");
    }
    assert.equal(records["agentvn.gamecli.gallery.preview_gamecli"], legacy, "Legacy unowned records remain untouched");
    console.log(JSON.stringify({ mode, loader, boundary, option, galleryCalls: galleryCalls().length }));
  })().catch(e => { console.error(e.stack); process.exitCode = 1; });
}
