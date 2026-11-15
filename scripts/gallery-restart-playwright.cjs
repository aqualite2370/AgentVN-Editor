"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const built = require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";
    export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";
  ` }, bundle: true, platform: "node", format: "cjs", write: false,
});
const moduleObject = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(moduleObject, moduleObject.exports, require);
const layouts = moduleObject.exports;
const sourceFiles = ["GameCli_framework/src/store/runtimeStore.ts", "GameCli_framework/src/cartridge/desktopLibrary.ts",
  "GameCli_framework/src/app/App.tsx", "GameCli_framework/src/engine/galleryAnchorManager.ts"];
const sources = () => sourceFiles.map(file => ({ file, sha256: crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(root, file))).digest("hex") }));
const r = { status: "RUNNING", scope: "SOURCE_REAL_BROWSER_PROCESS_RESTART_SAME_ISOLATED_PROFILE",
  controlled: ["Synthetic embedded game and SVG assets served by HTTP routes", "No native Player or installed package claim"],
  cases: [], sourcesBefore: sources(), models: 0, userDataWrites: 0 };
let server, context;
const idle = (page, screen) => page.waitForFunction(screen => {
  const n = document.querySelector("[data-runtime-screen-transition]");
  return n?.getAttribute("data-runtime-screen-transition") === "idle"
    && n.getAttribute("data-runtime-presented-screen") === screen
    && !document.querySelector("[data-runtime-boot-blocking]");
}, screen);
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "vite.log") });
  r.service = { url: server.url, pid: server.pid, runId: server.runId };
  for (const theme of ["agentvn", "renpy"]) {
    const row = { theme, status: "RUNNING", errors: [], screenshots: [] }; r.cases.push(row);
    const profile = path.join(out, `profile-${theme}`);
    const pixel = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#453952"/></svg>');
    const payloads = {
      "manifest.json": { manifest_version: "1.0.0", runtime_version: "0.31.0", game_id: `restart-${theme}`,
        title: "画廊重启验收", author: "QA", version: "0.1.0", description: "", entry_script: "script.json",
        entry_scene_id: "main", assets: [], language: "zh-CN", tags: [] },
      "script.json": { schema_version: "1.0.0", game_id: `restart-${theme}`, entry_scene_id: "main", title: "画廊重启验收",
        scenes: [{ scene_id: "main", title: "入口", chapter: 1, tags: [], commands: [
          { type: "narration", text: "点击前进解锁画廊" },
          { type: "gallery_anchor", anchor_id: "restart_anchor", title: "重启保留图片", asset_id: "image" },
          { type: "narration", text: "已到达画廊锚点" },
        ] }] },
      "gallery.json": { gallery_version: "1.0.0", items: [{ item_id: "restart_anchor", anchor_id: "restart_anchor",
        title: "重启保留图片", asset_id: "image", scene_id: "main", command_index: 1 }] },
      "checksum.json": {},
      "ui/layout.json": theme === "renpy" ? layouts.createRenpyUILayout() : layouts.getDefaultUISkinLayout(),
    };
    // The normal embedded loader resolves declared asset paths, just as a web export does.
    payloads["manifest.json"].assets.push({ asset_id: "image", asset_type: "ui", path: "assets/image.svg",
      mime_type: "image/svg+xml", size_bytes: 160 });
    for (const phase of ["unlock", "restart"]) {
      context = await chromium.launchPersistentContext(profile, { headless: true,
        viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(20000);
      page.on("pageerror", error => row.errors.push(String(error)));
      await context.route("**/embedded-cartridge/**", async route => {
        const relative = new URL(route.request().url()).pathname.split("/embedded-cartridge/")[1];
        if (relative === "assets/image.svg") return route.fulfill({ contentType: "image/svg+xml",
          body: decodeURIComponent(pixel.split(",")[1]) });
        const value = payloads[relative];
        return route.fulfill(value ? { contentType: "application/json", body: JSON.stringify(value) } : { status: 404 });
      });
      await page.goto(`${server.url}/?mode=fixed`);
      await page.getByTestId("game-state-title").waitFor(); await idle(page, "title_menu");
      const identity = await page.evaluate(async () => {
        const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
        const { currentGame, runtimeMode } = useRuntimeStore.getState();
        return { installId: currentGame.install_id, mode: runtimeMode, unlocks: currentGame.gallery.map(g => g.unlocked) };
      });
      assert.equal(identity.installId, "fixed_embedded_game"); assert.equal(identity.mode, "fixed");
      assert.deepEqual(identity.unlocks, [phase === "restart"]); row[`${phase}Identity`] = identity;
      if (phase === "unlock") {
        await page.getByTestId("start-new-game").click(); await idle(page, "playing");
        await page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-is-typing") === "false");
        await page.locator(".story-player").click({ position: { x: 100, y: 100 } });
        await page.waitForFunction(async () => {
          const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
          return useRuntimeStore.getState().galleryUnlocks.includes("restart_anchor");
        });
        await page.keyboard.press("Escape"); await idle(page, "main_menu");
      }
      await page.getByTestId("open-gallery").click(); await idle(page, "gallery");
      const card = page.getByTestId("gallery-item-restart_anchor").getByRole("button").first();
      assert(await card.isEnabled());
      await card.click(); await page.locator(".gallery-viewer-image").evaluate(image => image.decode());
      row.screenshots.push(await captureSourceBrowser(page, path.join(out, `${theme}-${phase}.png`),
        { width: 1920, height: 1080, dpr: 1, reduced: false }));
      row[phase + "Storage"] = await page.evaluate(() => localStorage.getItem("agentvn.gamecli.gallery.fixed_embedded_game"));
      assert(row[phase + "Storage"]);
      await context.close(); context = undefined;
    }
    assert.equal(row.unlockStorage, row.restartStorage); assert.deepEqual(row.errors, []); row.status = "PASS";
  }
  assert.equal(r.cases.length, 2); r.sourcesAfter = sources(); assert.deepEqual(r.sourcesAfter, r.sourcesBefore);
  r.status = "PASS";
})().catch(error => { r.status = "FAILED"; r.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  if (context) await context.close().catch(error => { r.cleanupError = String(error); });
  if (server) { await server.stop(); r.serviceStopped = true; }
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, cases: r.cases.map(c => ({ theme: c.theme, status: c.status })), error: r.error, out }));
});
