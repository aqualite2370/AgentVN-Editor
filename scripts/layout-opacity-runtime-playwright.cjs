"use strict";
// Public live-preview protocol, controlled fixtures, actual Runtime renderer.
// This is not an installation/native-window/navigation acceptance.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { createRequire } = require("node:module");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const isolation = resolveAcceptancePaths(), root = path.resolve(__dirname, "..");
const req = createRequire(path.join(root, "editor/package.json")), mod = { exports: {} };
new Function("module", "exports", "require", req("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";
    export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";
    export { createEditorLivePreviewData } from "./editor/src/cartridge/exportCartridge";
  ` }, bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
}).outputFiles[0].text)(mod, mod.exports, req);
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "SOURCE_RUNTIME_PUBLIC_PREVIEW_CONTROLLED_FIXTURES",
  isolation, cases: [], errors: [], modelRequests: 0 };
report.sources = ["GameCli_framework/src/uiSkin/uiSkinRuntime.tsx", "GameCli_framework/src/uiSkin/UILayoutOpacitySurface.tsx",
  "GameCli_framework/src/uiSkin/ui-layout-opacity.css", "shared/cartridge/uiSkin.ts",
  ...["MainMenu", "RenpyTitleView", "SettingsScreen", "SaveLoadScreen", "HistoryScreen", "AboutScreen", "HelpScreen", "GalleryScreen"]
    .map(n => `GameCli_framework/src/components/shell/${n}.tsx`)]
  .map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) }));
const pages = [
  ["preferences", "settings_group", "settings", ".settings-renpy"],
  ["title", "main_menu_hero", "title_menu", ".main-menu-title-hero-background"],
  ["save_load", "save_slot_grid", "save_load", ".save-grid"],
  ["history", "history_list", "history", ".history-list"],
  ["about", "about_panel", "about", ".about-card"],
  ["help", "help_panel", "help", ".help-card"],
  ["gallery", "gallery_grid", "gallery", ".gallery-grid"],
];
const art = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#d94c37"/><rect width="8" height="8" fill="#38a3dd"/></svg>');
const artUrl = `data:image/svg+xml;base64,${art.toString("base64")}`;
const save = () => fs.writeFileSync(path.join(isolation.output, "report.json"), JSON.stringify(report, null, 2));
let server, browser;
async function fixture(type, screenId, style) {
  const skin = type === "renpy" ? mod.exports.createRenpyUILayout() : mod.exports.getDefaultUISkinLayout();
  const screen = skin.screens.find(s => s.screen_id === screenId);
  // AgentVN Help intentionally retains the existing About surface contract.
  if (screenId === "help" && type === "agentvn")
    skin.screens.find(s => s.screen_id === "about").components.find(c => c.component_type === "about_panel").style = style;
  else screen.components.find(c => c.component_type === pages.find(p => p[0] === screenId)[1]).style = style;
  const data = await mod.exports.createEditorLivePreviewData({
    gameId: `qa-opacity-${type}`, title: "透明度分层隔离验收", author: "QA", uiSkin: skin,
    projectAssets: [{ asset_id: "qa-material", asset_type: "ui", path: "assets/material.svg",
      filename: "material.svg", mime_type: "image/svg+xml", size_bytes: art.length }],
    projectAssetRefs: [{ asset_id: "qa-material", asset_type: "ui",
      metadata: { data_url: artUrl, filename: "material.svg", mime_type: "image/svg+xml", size_bytes: art.length } }],
    script: { schema_version: "1.1.0", game_id: `qa-opacity-${type}`, title: "透明度",
      entry_scene_id: "qa", characters: [], scenes: [{ scene_id: "qa", title: "隔离", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "分层渲染回归，不调用模型。" }] }] },
  });
  return { ...data, assetUrls: { "qa-material": artUrl } };
}
async function init(page, payload, screen) {
  const id = crypto.randomUUID();
  await page.evaluate(({ payload, screen, id }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener("message", receive); reject(new Error("Preview acknowledgement timeout")); }, 20000);
    function receive(e) {
      const m = e.data;
      if (m?.sessionId !== id || !["agentvn.live-preview.ready", "agentvn.live-preview.error"].includes(m.type)) return;
      clearTimeout(timer); window.removeEventListener("message", receive);
      if (m.type.endsWith(".error")) reject(new Error(m.message)); else resolve();
    }
    window.addEventListener("message", receive);
    window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: id, revision: 1,
      requestId: id, runId: id, ...payload, screen,
      start: { requestId: id, target: { sceneId: payload.script.entry_scene_id, commandIndex: 0 },
        entryPath: [], mode: "stable_frame", playbackRate: 1, reducedMotion: true } }, "*");
  }), { payload, screen, id });
  await page.locator('[data-runtime-presented-screen="' + screen + '"]').waitFor();
  await settleRuntime(page);
}
async function observation(page, selector) {
  return page.locator(selector).first().evaluate(n => {
    const bg = n.querySelector(":scope > [data-ui-opacity-layer=background]") ?? n;
    const content = n.matches(".main-menu-title-hero-background")
      ? n.closest(".renpy-title-view")?.querySelector(".renpy-title-heading")
        ?? n.parentElement.querySelector(".menu-hero")
      : n.querySelector(":scope > [data-ui-opacity-layer=content]");
    const b = getComputedStyle(bg), c = content && getComputedStyle(content);
    const alpha = b.backgroundColor.startsWith("rgba(") ? Number(b.backgroundColor.match(/,\s*([\d.]+)\)$/)[1]) : 1;
    const r = n.getBoundingClientRect();
    return { backgroundOpacity: Number(b.opacity), colorAlpha: alpha,
      effectiveBackground: alpha * Number(b.opacity), contentOpacity: c ? Number(c.opacity) : null,
      rootOpacity: Number(getComputedStyle(n).opacity), image: b.backgroundImage,
      navigationOpacity: n.matches(".main-menu-title-hero-background")
        ? Number(getComputedStyle(n.closest(".renpy-title-view, .main-menu").querySelector('[data-testid="main-menu-actions"]')).opacity)
        : undefined,
      rect: r.toJSON(), clientWidth: n.clientWidth, overflow: document.documentElement.scrollWidth - innerWidth,
      layerRect: bg.getBoundingClientRect().toJSON() };
  });
}
(async () => {
  fs.mkdirSync(isolation.output, { recursive: true });
  fs.copyFileSync(__filename, path.join(isolation.output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(isolation.output, "vite.log") });
  report.service = { url: server.url, pid: server.pid, runId: server.runId };
  browser = await chromium.launch();
  await server.run(async () => {
    for (const type of ["agentvn", "renpy"]) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      const cdp = await context.newCDPSession(page);
      page.on("pageerror", e => report.errors.push(String(e)));
      try {
        await page.goto(`${server.url}/?mode=preview`);
        await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
        for (const [screenId, componentType, screen, selector] of process.argv.includes("--smoke") ? pages.slice(0, 1) : pages) {
          const item = { type, screenId, componentType, status: "RUNNING" }; report.cases.push(item); save();
          // Editing foreground on a legacy material must not multiply its alpha again.
          await init(page, await fixture(type, screenId, { backgroundColor: "#24384c", opacity: .5, contentOpacity: .8 }), screen);
          item.inherited = await observation(page, selector);
          assert.equal(item.inherited.effectiveBackground, .5, "Legacy material opacity is applied once after foreground edit");
          assert.equal(item.inherited.contentOpacity, .8);
          if (screenId === "title") assert.equal(item.inherited.navigationOpacity, .8, "Title actions share foreground opacity");
          await init(page, await fixture(type, screenId, { backgroundColor: "#24384c", backgroundImage: "asset:qa-material",
            backgroundOpacity: .4, contentOpacity: .7 }), screen);
          item.art = await observation(page, selector);
          assert.equal(item.art.backgroundOpacity, .4); assert.equal(item.art.contentOpacity, .7);
          const imageBytes = await page.evaluate(async url => {
            const img = new Image(); img.src = url; await img.decode();
            return { width: img.naturalWidth, bytes: Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())) };
          }, item.art.image.match(/url\(["']?(.*?)["']?\)/)[1]);
          assert.equal(imageBytes.width, 16); assert.equal(sha(Buffer.from(imageBytes.bytes)), sha(art));
          item.image = { width: imageBytes.width, sha256: sha(art) };
          assert(item.art.rect.width > 0 && item.art.rect.height > 0 && item.art.overflow <= 1);
          assert(Math.abs(item.art.layerRect.width - item.art.clientWidth) <= 1,
            "The background covers the actual padding box, excluding borders and reserved scrollbars");
          if (!process.argv.includes("--smoke")) {
            item.matrix = [];
            for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
              const height = width * 9 / 16;
              await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
              await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              const display = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
                reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
              assert.deepEqual(display, { width, height, dpr, reduced });
              const actual = await observation(page, selector);
              assert.equal(actual.backgroundOpacity, .4); assert.equal(actual.contentOpacity, .7);
              assert(actual.rect.left >= -1 && actual.rect.right <= width + 1
                && actual.rect.top >= -1 && actual.rect.bottom <= height + 1 && actual.overflow <= 1);
              const cell = { ...display, actual, status: "PASS" }; item.matrix.push(cell);
              if (screenId === "preferences") {
                const file = path.join(isolation.output, `${type}-${width}-${dpr}-${reduced}.png`);
                const png = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
                const after = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
                  reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
                assert.deepEqual(after, display);
                assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
                fs.writeFileSync(file, png, { flag: "wx" });
                cell.screenshot = { path: file, sha256: sha(png), before: display, after };
              }
            }
            await cdp.send("Emulation.clearDeviceMetricsOverride");
            await page.emulateMedia({ reducedMotion: "no-preference" });
          }
          item.status = "PASS"; save();
          console.log(`PASS ${type} ${screenId}: inherited material, image bytes, separate foreground`);
        }
      } catch (error) {
        report.lastBody = await page.locator("body").innerText().catch(() => "");
        report.lastNavigation = await page.locator("[data-runtime-screen-transition]").evaluateAll(ns => ns.map(n => ({
          phase: n.getAttribute("data-runtime-screen-transition"), screen: n.getAttribute("data-runtime-presented-screen"),
          className: n.className,
        }))).catch(() => []);
        throw error;
      } finally { await context.close(); }
    }
  });
  assert.equal(report.cases.length, process.argv.includes("--smoke") ? 2 : 14);
  assert(report.cases.every(c => c.status === "PASS")); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  const pending = report.cases.at(-1); if (pending?.status === "RUNNING") pending.status = "FAILED";
}).finally(async () => {
  await browser?.close(); await server?.stop();
  let online = false;
  if (server) try { online = (await fetch(server.url, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
  report.cleanup = { status: online ? "FAILED" : "PASS", serviceResponds: online };
  if (online) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, output: isolation.output, error: report.error }));
});
