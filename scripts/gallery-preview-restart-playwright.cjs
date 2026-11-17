"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Gallery-Preview-")); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_REAL_PROCESS_RESTART_ISOLATED_PROFILE",
  boundaries: ["External preview disk input supplied as a controlled LibraryGame; real store/engine/storage/UI",
    "Legacy full-cartridge preview uses real packed bytes and normal message entry", "Not installed or Android"],
  cases: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const m = { exports: {} };
new Function("module", "exports", "require", buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
export {packCartridgeToUint8Array} from './shared/cartridge/packer';
export {createRenpyUILayout} from './shared/cartridge/uiLayoutProfiles';
export {getDefaultUISkinLayout} from './shared/cartridge/uiSkin';` },
  bundle: true, platform: "node", format: "cjs", write: false,
  nodePaths: [path.join(root, "editor/node_modules")] }).outputFiles[0].text)(m, m.exports, require);
let server, context, activePage;
function input(theme, suffix = "A") {
  const id = `gallery-preview-${theme}-${suffix}`;
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#66557e"/><circle cx="480" cy="270" r="150" fill="#b89bc7"/></svg>';
  const manifest = { manifest_version: "1.0.0", cartridge_version: "1.0.0", game_id: id, title: "试玩画廊持久化", author: "QA", version: "1.0.0",
    description: "", entry_script: "script.json", runtime_version: "0.32.0", tags: [], language: "zh-CN",
    entry_scene_id: "main", created_at: "2026-11-17T00:00:00.000Z", updated_at: "2026-11-17T00:00:00.000Z",
    ui_skin: { path: "ui/layout.json", version: "1.0.0" },
    assets: [{ asset_id: "cg", asset_type: "ui", path: "assets/cg.svg", filename: "cg.svg", mime_type: "image/svg+xml", size_bytes: image.length }] };
  const script = { schema_version: "1.0.0", game_id: id, title: manifest.title, entry_scene_id: "main",
    scenes: [{ scene_id: "main", title: "画廊剧情", summary: "", chapter: 1, tags: [], commands: [
      { type: "narration", text: "BEFORE_UNLOCK" },
      { type: "gallery_anchor", anchor_id: "shared_anchor", title: "试玩图片", asset_id: "cg" },
      { type: "narration", text: "AFTER_UNLOCK" }] }] };
  const item = { item_id: "shared_anchor", anchor_id: "shared_anchor", scene_id: "main", command_index: 1,
    title: "试玩图片", asset_id: "cg", unlocked: false };
  const uiSkin = theme === "renpy" ? m.exports.createRenpyUILayout() : m.exports.getDefaultUISkinLayout();
  return { manifest, script, uiSkin, image, gallery: { gallery_version: "1.0.0", items: [item] } };
}
function game(i) {
  return { install_id: "preview_gamecli", game_id: i.manifest.game_id, title: i.manifest.title, manifest: i.manifest,
    script: i.script, uiSkin: i.uiSkin, gallery: i.gallery.items,
    assetUrls: { cg: "data:image/svg+xml," + encodeURIComponent(i.image) } };
}
async function at(p, text) {
  await p.waitForFunction(t => { const s = window.__galleryStore.getState().engineState; return s.dialog?.text === t && !s.isTyping; }, text);
}
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, url: server.url, runId: server.runId };
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
  const selectedSource = process.argv.find(a => a.startsWith("--source="))?.slice(9);
  const sources = selectedSource ? [selectedSource] : ["external-preview", "cartridge-message"];
  assert(sources.every(s => ["external-preview", "cartridge-message"].includes(s)));
  for (const theme of ["agentvn", "renpy"]) for (const source of sources) {
    const row = { theme, source, status: "RUNNING", screenshots: [] }; report.cases.push(row); save();
    const i = input(theme);
    const packed = Buffer.from(await m.exports.packCartridgeToUint8Array({ ...i,
      assets: [{ path: "assets/cg.svg", data: i.image }] })).toString("base64");
    let persisted;
    for (const phase of ["unlock", "restart"]) {
      context = await chromium.launchPersistentContext(path.join(out, `profile-${theme}-${source}`), {
        headless: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
        env: { ...process.env, TEMP: temporary, TMP: temporary } });
      const p = context.pages()[0]; activePage = p; p.on("pageerror", e => report.errors.push(String(e)));
      await p.goto(server.url + "/?mode=preview");
      await p.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
      await p.evaluate(async () => { window.__galleryStore = (await import("/src/store/runtimeStore.ts")).useRuntimeStore; });
      if (source === "external-preview") {
        await p.evaluate(g => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
          sessionId: "gallery-restart", revision: 1, requestId: "init", runId: "gallery",
          manifest: g.manifest, script: g.script, uiSkin: g.uiSkin, assetUrls: g.assetUrls, screen: "title_menu" }, "*"), game(i));
        await p.getByTestId("start-new-game").waitFor(); await settleRuntime(p);
        await p.evaluate(async g => {
          window.__galleryStore.getState().setRuntimeMode("preview");
          await window.__galleryStore.getState().loadGame(g);
        }, game(i));
      }
      else await p.evaluate(cartridgeBase64 => window.postMessage({
        type: "agentvn.runtime.preview", cartridgeBase64, fileName: "gallery-preview.vncart", previewNonce: String(Date.now())
      }, "*"), packed);
      await p.getByTestId("start-new-game").waitFor();
      await settleRuntime(p);
      await p.evaluate(async () => (await import("/src/store/settingsStore.ts")).useSettingsStore.getState()
        .updateSettings({ textSpeed: 200, textSpeedCps: 200, autoSaveEnabled: false }));
      row[phase + "Initial"] = await p.evaluate(() => ({
        mode: window.__galleryStore.getState().runtimeMode,
        id: window.__galleryStore.getState().currentGame.install_id,
        unlocked: window.__galleryStore.getState().currentGame.gallery[0].unlocked }));
      assert.equal(row[phase + "Initial"].unlocked, phase === "restart");
      if (phase === "unlock") {
        await p.getByTestId("start-new-game").click(); await at(p, "BEFORE_UNLOCK");
        await p.locator(".dialog-box").click(); await at(p, "AFTER_UNLOCK");
        await p.waitForFunction(() => window.__galleryStore.getState().galleryUnlocks.includes("shared_anchor"));
        await p.evaluate(() => window.__galleryStore.getState().flushAutoSave());
        persisted = await p.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("agentvn.gamecli.gallery."))));
        assert.equal(Object.keys(persisted).length, 1);
        assert.match(Object.keys(persisted)[0], /preview_gallery_[a-f0-9]{64}$/);
      }
      await p.evaluate(() => window.__galleryStore.getState().openGallery());
      await settleRuntime(p);
      const card = p.getByTestId("gallery-item-shared_anchor").getByRole("button").first();
      assert(await card.isEnabled()); await card.click();
      await p.locator(".gallery-viewer-image").evaluate(e => e.decode());
      await settleRuntime(p);
      const viewer = await p.locator(".gallery-viewer-image").evaluate(e => {
        const r = e.getBoundingClientRect(); return { width: r.width, height: r.height };
      });
      assert(viewer.width > 500 && viewer.height > 250, "Expanded viewer must actually present its full image");
      row.screenshots.push(await captureSourceBrowser(p, path.join(out, `${theme}-${source}-${phase}.png`),
        { width: 1920, height: 1080, dpr: 1, reduced: false }));
      if (phase === "restart") {
        assert.deepEqual(await p.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) =>
          k.startsWith("agentvn.gamecli.gallery.")))), persisted);
        await p.evaluate(async b => { await window.__galleryStore.getState().loadGame(b); }, game(input(theme, "B")));
        assert(!await p.evaluate(() => window.__galleryStore.getState().currentGame.gallery[0].unlocked));
        await p.evaluate(async a => { await window.__galleryStore.getState().loadGame(a); }, game(i));
        assert(await p.evaluate(() => window.__galleryStore.getState().currentGame.gallery[0].unlocked));
      }
      await context.close(); context = undefined; activePage = undefined;
    }
    row.status = "PASS"; save();
  }
  assert.equal(report.cases.length, sources.length * 2); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = e.stack; process.exitCode = 1;
  if (activePage) {
    report.failureText = await activePage.locator("body").innerText();
    await activePage.screenshot({ path: path.join(out, "failure.png") });
  }
})
.finally(async () => {
  await context?.close(); await server?.stop(); report.cleanup = "OWNED_CONTEXT_SERVER_STOPPED"; save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, out }));
});
