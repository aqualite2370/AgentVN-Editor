"use strict";
// Separate Node processes run the actual store, engine and gallery manager.
// Only native IPC is controlled; its files survive the process boundary.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
const child = process.argv[3] === "--child";
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
if (!child) {
  assert(process.argv[2] && !fs.existsSync(out), "Use a new evidence directory");
  fs.mkdirSync(out, { recursive: true });
  const report = { status: "RUNNING", scope: "ACTUAL_STORE_ENGINE_SEPARATE_PROCESSES_CONTROLLED_NATIVE_IPC",
    cases: [], source: ["GameCli_framework/src/store/runtimeStore.ts", "GameCli_framework/src/engine/galleryAnchorManager.ts",
      "GameCli_framework/src/cartridge/desktopLibrary.ts"].map(p => ({ path: p, sha256: hash(path.join(root, p)) })),
    models: 0, userDataWrites: 0 };
  try {
    const built = require("../editor/node_modules/esbuild").buildSync({
      stdin: { resolveDir: root, loader: "ts", contents: `
        export {useRuntimeStore} from "./GameCli_framework/src/store/runtimeStore";
        export {useSettingsStore} from "./GameCli_framework/src/store/settingsStore";
        export {loadGameFromUnpackedPreview,loadGameFromEmbeddedDirectory} from "./GameCli_framework/src/cartridge/desktopLibrary";
      ` }, bundle: true, platform: "node", format: "cjs", write: false, define: { "import.meta.env": "{}" },
      nodePaths: [path.join(root, "GameCli_framework/node_modules"), path.join(root, "editor/node_modules")],
    });
    fs.writeFileSync(path.join(out, "store.cjs"), built.outputFiles[0].text, { flag: "wx" });
    for (const theme of ["agentvn", "renpy"]) for (const boundary of ["web", "native"]) {
      for (const [mode, id, persists] of [
        ["fixed", "fixed_embedded_game", true],
        ["fixed", "preview_gamecli", true],
        ["library", "installed-isolated-game", true],
        ["preview", "preview_gamecli", false],
      ]) {
        const scenario = `${theme}-${boundary}-${mode}-${id}`, directory = path.join(out, scenario);
        fs.mkdirSync(directory);
        const entry = { scenario, status: "RUNNING", mode, id, persists, theme, boundary };
        report.cases.push(entry);
        for (const phase of ["unlock", "restart"]) {
          const result = cp.spawnSync(process.execPath, [__filename, out, "--child", directory,
            mode, id, String(persists), boundary, theme, phase], {
            cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000,
          });
          entry[phase] = { exit: result.status, stdout: result.stdout, stderr: result.stderr };
          assert.equal(result.status, 0, scenario + " " + phase + "\n" + result.stderr);
        }
        entry.status = "PASS";
      }
    }
    assert.equal(report.cases.length, 16);
    for (const phase of ["pending-success", "pending-failure", "loader-identity"]) {
      const directory = path.join(out, phase); fs.mkdirSync(directory);
      const result = cp.spawnSync(process.execPath, [__filename, out, "--child", directory,
        "fixed", "fixed_embedded_game", "true", "native", "shared-state", phase], {
          cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000,
        });
      report.cases.push({ scenario: phase, status: result.status === 0 ? "PASS" : "FAILED",
        exit: result.status, stdout: result.stdout, stderr: result.stderr });
      assert.equal(result.status, 0, phase + "\n" + result.stderr);
    }
    assert.equal(report.cases.length, 19);
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, out }));
  }
} else {
  const [directory, mode, id, persistText, boundary, theme, phase] = process.argv.slice(4);
  const persists = persistText === "true", storage = path.join(directory, "storage.json");
  let finishWrite;
  const read = () => fs.existsSync(storage) ? JSON.parse(fs.readFileSync(storage, "utf8")) : {};
  const put = records => fs.writeFileSync(storage, JSON.stringify(records));
  const get = key => read()[key] ?? null;
  global.window = { location: { search: "" }, localStorage: {
    getItem: get, setItem: (key, value) => put({ ...read(), [key]: value }),
    removeItem: key => { const records = read(); delete records[key]; put(records); },
  }, matchMedia: () => ({ matches: false }), queueMicrotask, dispatchEvent() {}, clearTimeout,
    setTimeout: (fn, delay) => { const t = setTimeout(fn, delay); t.unref(); return t; } };
  window.parent = window; global.localStorage = window.localStorage;
  global.document = { visibilityState: "visible", addEventListener() {} };
  global.requestAnimationFrame = fn => setImmediate(() => fn(performance.now()));
  if (boundary === "native") window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    const key = args && `native.gallery.${args.installId}`;
    if (command === "load_unpacked_preview" || command === "load_embedded_game") return {
      manifest: game.manifest, script: game.script, gallery: { items: game.gallery },
    };
    if (command === "list_gallery_unlocks") return Object.keys(get(key) || {});
    if (command === "write_gallery_anchor") {
      if (phase.startsWith("pending-")) await new Promise((resolve, reject) => { finishWrite = { resolve, reject }; });
      put({ ...read(), [key]: {
      ...(get(key) || {}), [args.anchorId]: args.save,
    } }); return; }
    if (command === "list_saves") return [];
    if (command === "get_save_storage_info") return { portable: false, availableFiles: [] };
    if (command === "append_frontend_error") return "";
    throw new Error("Unexpected native command " + command);
  } };
  const { useRuntimeStore: store, useSettingsStore: settings, loadGameFromUnpackedPreview,
    loadGameFromEmbeddedDirectory } = require(path.join(out, "store.cjs"));
  const game = { install_id: id, game_id: "restart-owner", title: "重启持久化", assetUrls: {},
    manifest: { game_id: "restart-owner", title: "重启持久化", assets: [], layout_type: theme },
    gallery: [{ item_id: "anchor", anchor_id: "anchor", scene_id: "main", title: "画廊", asset_id: "", unlocked: false }],
    script: { game_id: "restart-owner", entry_scene_id: "main", scenes: [{ scene_id: "main", title: "场景",
      commands: [{ type: "narration", text: "起点" }, { type: "gallery_anchor", anchor_id: "anchor", title: "画廊", asset_id: "" },
        { type: "narration", text: "经过锚点" }] }] } };
  (async () => {
    if (phase === "loader-identity") {
      assert.equal((await loadGameFromUnpackedPreview("isolated-preview")).install_id, "preview_gamecli");
      assert.equal((await loadGameFromUnpackedPreview("isolated-fixed", "fixed_embedded_game")).install_id, "fixed_embedded_game");
      assert.equal((await loadGameFromEmbeddedDirectory()).install_id, "fixed_embedded_game");
      console.log("PASS native embedded, fixed directory and external preview identities");
      return;
    }
    store.getState().setRuntimeMode(mode);
    await store.getState().loadGame(game);
    settings.getState().updateSettings({ autoSaveEnabled: false, textSpeed: 0 });
    if (phase === "restart") {
      assert.equal(store.getState().currentGame.gallery[0].unlocked, persists, "Restart must restore committed unlocks");
      assert.equal(store.getState().galleryUnlocks.includes("anchor"), persists);
    } else {
      const launch = store.getState().startNewGame(); store.getState().beginLaunchCover();
      await store.getState().completeLaunchCover(); store.getState().completeLaunchReveal(); await launch;
      store.getState().engine.completeTyping(); store.getState().next();
      if (phase.startsWith("pending-")) {
        for (let i = 0; i < 40 && !finishWrite; i++) await new Promise(resolve => setImmediate(resolve));
        assert(finishWrite);
        assert(!store.getState().currentGame.gallery[0].unlocked);
        let exited = false;
        const exiting = store.getState().flushAutoSave().then(result => { exited = true; return result; });
        await new Promise(resolve => setImmediate(resolve));
        assert(!exited, "Exit must wait for the gallery write, including with autosaving disabled");
        if (phase === "pending-failure") finishWrite.reject(new Error("Controlled gallery disk denial"));
        else finishWrite.resolve();
        const result = await exiting;
        assert.equal(result.status === "failed", phase === "pending-failure");
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(store.getState().currentGame.gallery[0].unlocked, phase === "pending-success");
        if (phase === "pending-failure") {
          assert.equal(store.getState().saveNotice.status, "error");
          assert.match(store.getState().saveNotice.message, /画廊解锁保存失败/);
        }
        console.log(JSON.stringify({ phase, pid: process.pid, exitResult: result }));
        return;
      }
      for (let i = 0; i < 40 && !store.getState().galleryUnlocks.includes("anchor"); i++)
        await new Promise(resolve => setImmediate(resolve));
      assert(store.getState().currentGame.gallery[0].unlocked, "Natural story unlock must complete");
    }
    console.log(JSON.stringify({ phase, pid: process.pid, mode, id, unlocked: store.getState().galleryUnlocks }));
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
