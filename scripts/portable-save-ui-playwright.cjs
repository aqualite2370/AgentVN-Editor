"use strict";
// Real Runtime components, controlled Tauri IPC boundary. Not installed-package acceptance.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), out = process.env.AGENTVN_SAVE_TEST_OUTPUT
  || path.join(root, "output/playwright/portable-save-ui", new Date().toISOString().replace(/[:.]/g, "-"));
assert(!fs.existsSync(out), "Never overwrite previous evidence");
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "Runtime actual modal/save screen, controlled native storage boundary; not native installed acceptance", cases: [], errors: [] };
let server, browser;
const layouts = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(layouts, layouts.exports);
async function initialize(page, url, layout) {
  await page.goto(`${url}/?mode=preview`);
  await page.locator("#root").waitFor();
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
  await page.evaluate(async uiSkin => {
    const { useRuntimeStore: store } = await import("/src/store/runtimeStore.ts");
    const game = { install_id: "preview_gamecli", game_id: "portable-ui", title: "隔离存档验收", gallery: [], assetUrls: {},
      uiSkin, manifest: { game_id: "portable-ui", title: "隔离存档验收", assets: [], entry_scene_id: "main" },
      script: { game_id: "portable-ui", entry_scene_id: "main", characters: [],
        scenes: [{ scene_id: "main", title: "Main", commands: [{ type: "narration", text: "存档迁移确认" }] }] } };
    // Finish the existing preview bootstrap before installing the controlled native boundary.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener("message", ready); reject(new Error("preview bootstrap timeout")); }, 10000);
      function ready(event) {
        if (event.data?.type === "agentvn.live-preview.ready" && event.data?.sessionId === "save-migration-ui") {
          clearTimeout(timer); window.removeEventListener("message", ready); resolve();
        }
      }
      window.addEventListener("message", ready);
      window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "save-migration-ui",
        revision: 1, requestId: "save-migration-ui", runId: "save-migration-ui", screen: "title_menu",
        manifest: game.manifest, script: game.script, uiSkin, assetUrls: {} }, "*");
    });
    window.__migrationCalls = 0;
    window.__writtenSaves = [];
    window.__migrationFailure = false;
    window.__saveStorage = { portable: true,
      sourceDirectory: "C:\\旧存档 中文目录\\AppData\\com.agentvn.player\\saves\\preview_gamecli",
      targetDirectory: "D:\\游戏 中文 安装目录\\saves\\portable-ui\\preview_gamecli",
      availableFiles: ["slot-01.json", "auto-01.json", "quick-01.json"], conflictFiles: ["slot-02.json"],
      skippedFiles: ["slot-03.json"], copiedFiles: [] };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => 0,
      invoke: async (command, args) => {
        if (command === "write_save") {
          if (args.save.game_id !== "portable-ui" || args.installId !== "preview_gamecli")
            throw new Error("存档不属于当前独立游戏，拒绝写入。");
          window.__writtenSaves.push(structuredClone(args.save));
          return;
        }
        if (command === "get_save_storage_info") return structuredClone(window.__saveStorage);
        if (command === "migrate_legacy_saves") {
          window.__migrationCalls++;
          if (window.__migrationFailure) throw new Error("安装目录不可写，未迁移；不会回退到AppData。".repeat(12));
          const status = window.__saveStorage;
          status.copiedFiles = status.availableFiles; status.availableFiles = [];
          return structuredClone(status);
        }
        if (command === "list_saves") return structuredClone(window.__writtenSaves);
        if (command === "list_gallery_unlocks") return [];
        return null;
      },
    };
    store.getState().setRuntimeMode("fixed");
    await store.getState().loadGame(game);
    const { useSettingsStore } = await import("/src/store/settingsStore.ts");
    useSettingsStore.setState(state => ({ settings: { ...state.settings, autoSaveEnabled: false } }));
  }, layout === "renpy" ? layouts.exports.createRenpyUILayout() : layouts.exports.getDefaultUISkinLayout());
}
async function geometry(dialog) {
  return dialog.evaluate(panel => {
    const box = panel.getBoundingClientRect();
    const controls = [...panel.querySelectorAll("button")].filter(b => !b.disabled).map(b => {
      const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
      return { label: b.textContent || b.ariaLabel, rect: r.toJSON(), hit: b === hit || b.contains(hit) };
    });
    return { rect: box.toJSON(), controls, overflow: document.documentElement.scrollWidth - innerWidth,
      inside: box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      focusedInside: panel.contains(document.activeElement), clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth };
  });
}
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0, logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, url: server.url, runId: server.runId };
  browser = await chromium.launch({ headless: true });
  const focused = process.argv.includes("--focused");
  const matrix = focused ? [[1920,1080,1,false,"agentvn"]] :
    currentAcceptanceViewports().flatMap(([w,h]) => [1,2].flatMap(dpr => [false,true].flatMap(reduced =>
      ["agentvn","renpy"].map(layout => [w,h,dpr,reduced,layout]))));
  assert(matrix.length);
  for (const [width,height,dpr,reduced,layout] of matrix) {
    await server.assertAlive();
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
      reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(String(error)));
    const row = { width,height,dpr,reduced,layout,status: "RUNNING" }; report.cases.push(row);
    try {
      await initialize(page, server.url, layout);
      const dialog = page.getByRole("dialog", { name: "复制旧存档到游戏目录？", exact: true });
      await dialog.waitFor({ timeout: 8000 });
      row.initial = await geometry(dialog);
      assert(row.initial.inside && row.initial.focusedInside);
      assert(row.initial.controls.every(b => b.hit), "modal controls must be truly clickable");
      assert(row.initial.overflow <= 1 && row.initial.scrollWidth <= row.initial.clientWidth + 1);
      await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
      assert((await geometry(dialog)).focusedInside);
      await dialog.getByRole("button", { name: "暂不迁移", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => window.__migrationCalls), 0);
      // Real title navigation; no internal navigation event/store action substitutes.
      await page.getByTestId("open-save-load").click();
      await page.getByTestId("save-storage-open").waitFor();
      await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
        ?.getAttribute("data-runtime-screen-transition") === "idle");
      row.toolbar = await page.locator(".save-load-toolbar").evaluate(node => {
        const controls = [...node.querySelectorAll("button:not([disabled])")].map(button => {
          const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
          return { rect: r.toJSON(), hit: hit === button || button.contains(hit) };
        });
        return { controls, overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(row.toolbar.controls.every(b => b.hit) && row.toolbar.overflow <= 1);
      for (let a=0; a<row.toolbar.controls.length; a++) for (let b=a+1; b<row.toolbar.controls.length; b++) {
        const x = row.toolbar.controls[a].rect, y = row.toolbar.controls[b].rect;
        assert(!(Math.min(x.right,y.right)-Math.max(x.x,y.x) > 1
          && Math.min(x.bottom,y.bottom)-Math.max(x.y,y.y) > 1), "storage action must not overlap existing controls");
      }
      await page.getByTestId("save-storage-open").click();
      await dialog.waitFor();
      await page.evaluate(() => { window.__migrationFailure = true; });
      await dialog.getByRole("button", { name: "确认复制", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      row.error = await geometry(dialog);
      assert(row.error.inside && row.error.overflow <= 1);
      assert(row.error.controls.every(b => b.hit));
      await page.screenshot({ path: path.join(out, `${width}-${dpr}-${reduced}-${layout}.png`) });
      await page.evaluate(() => { window.__migrationFailure = false; });
      await dialog.getByRole("button", { name: "重试复制", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => window.__migrationCalls), 2);
      await page.getByTestId("save-storage-open").click();
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /没有待复制的旧存档/);
      assert.match(await dialog.innerText(), /slot-02.json/);
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      assert.equal(await page.getByTestId("save-storage-open").evaluate(n => n === document.activeElement), true);
      await page.getByTestId(layout === "renpy" ? "renpy-menu-return" : "back-to-player").click();
      await page.getByTestId("start-new-game").waitFor();
      await settleRuntime(page);
      await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-state-playing").waitFor();
      await settleRuntime(page);
      if (layout === "renpy") await page.getByTestId("renpy-quick-save-load").click();
      else {
        await page.getByTestId("quick-menu-toggle").click();
        await page.getByRole("button", { name: "打开存档读档", exact: true }).click();
      }
      await settleRuntime(page);
      await page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
      await page.waitForFunction(() => window.__writtenSaves.length === 1);
      row.writtenSave = await page.evaluate(() => {
        const { game_id, install_id, save_kind, slot } = window.__writtenSaves[0];
        return { game_id, install_id, save_kind, slot };
      });
      assert.deepEqual(row.writtenSave, { game_id: "portable-ui", install_id: "preview_gamecli", save_kind: "manual", slot: 1 });
      row.status = "PASS";
    } catch (error) { row.status = "FAILED"; row.errorText = String(error.stack || error); throw error; }
    finally { await context.close(); fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report,null,2)); }
  }
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close(); await server?.stop();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report,null,2));
  console.log(`Evidence: ${out}`);
});
