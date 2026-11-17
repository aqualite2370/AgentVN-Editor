"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Gallery-Preview-Options-") && !fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "REAL_REACT_CHECKBOX_IPC_ARGUMENTS_AND_RUNTIME_MESSAGES",
  boundaries: ["Editor export/native process IPC controlled; real preview transport",
    "Actual Runtime/UI, structured and packed-cartridge messages; not native installation"], cases: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const mod = { exports: {} };
new Function("module", "exports", "require", buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
export {packCartridgeToUint8Array} from './shared/cartridge/packer';
export {createRenpyUILayout} from './shared/cartridge/uiLayoutProfiles';
export {getDefaultUISkinLayout} from './shared/cartridge/uiSkin';` },
  bundle: true, platform: "node", format: "cjs", write: false,
  nodePaths: [path.join(root, "editor/node_modules")] }).outputFiles[0].text)(mod, mod.exports, require);
function fixture(theme) {
  const id = `preview-options-${theme}`;
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#66557e"/></svg>';
  const manifest = { manifest_version: "1.0.0", cartridge_version: "1.0.0", game_id: id, title: "画廊预览选项", author: "QA", version: "1.0.0",
    description: "", entry_script: "script.json", runtime_version: "0.32.0", tags: [], language: "zh-CN",
    entry_scene_id: "main", created_at: "2026-11-17T00:00:00.000Z", updated_at: "2026-11-17T00:00:00.000Z",
    ui_skin: { path: "ui/layout.json", version: "1.0.0" },
    assets: [{ asset_id: "cg", asset_type: "ui", path: "assets/cg.svg", filename: "cg.svg", mime_type: "image/svg+xml", size_bytes: image.length }] };
  const script = { schema_version: "1.0.0", game_id: id, title: manifest.title, entry_scene_id: "main",
    scenes: [{ scene_id: "main", title: "画廊剧情", summary: "", chapter: 1, tags: [], commands: [
      { type: "narration", text: "BEFORE_UNLOCK" }, { type: "gallery_anchor", anchor_id: "anchor", title: "图片", asset_id: "cg" },
      { type: "narration", text: "AFTER_UNLOCK" }] }] };
  const uiSkin = theme === "renpy" ? mod.exports.createRenpyUILayout() : mod.exports.getDefaultUISkinLayout();
  return { manifest, script, uiSkin, image, gallery: { gallery_version: "1.0.0", items: [{
    item_id: "anchor", anchor_id: "anchor", scene_id: "main", command_index: 1, title: "图片", asset_id: "cg", unlocked: false }] } };
}
let editor, runtime, browser, context, page;
const displayMatrix = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
  [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
async function newContext(display) {
  context = await browser.newContext({ viewport: { width: display.width, height: display.height }, deviceScaleFactor: display.dpr,
    reducedMotion: display.reduced ? "reduce" : "no-preference" });
  page = await context.newPage(); page.on("pageerror", e => report.errors.push(e.stack || String(e)));
  return page;
}
const localGallery = p => p.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("agentvn.gamecli.gallery."))));
(async () => {
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
  runtime = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "runtime-vite.log") });
  editor = await startOwnedViteServer({ root: path.join(root, "editor"), logFile: path.join(out, "editor-vite.log") });
  report.servers = [editor, runtime].map(s => ({ pid: s.pid, url: s.url, runId: s.runId }));
  browser = await chromium.launch({ headless: true, env: { ...process.env, TEMP: temporary, TMP: temporary } });
  for (const theme of ["agentvn", "renpy"]) for (const source of ["structured", "cartridge"])
    for (const flag of ["missing", false, true]) {
      const row = { theme, source, flag, status: "RUNNING" }; report.cases.push(row); save();
      const p = await newContext(displayMatrix[0]), f = fixture(theme);
      await p.goto(runtime.url + "/?mode=preview");
      await p.evaluate(async () => { window.__galleryStore = (await import("/src/store/runtimeStore.ts")).useRuntimeStore; });
      const options = flag === "missing" ? {} : { previewOptions: { unlockAllGallery: flag } };
      if (source === "structured") {
        await p.evaluate(({ f, options }) => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
          sessionId: "gallery-options", revision: 1, requestId: "init", runId: "gallery",
          manifest: f.manifest, script: f.script, uiSkin: f.uiSkin,
          assetUrls: { cg: "data:image/svg+xml," + encodeURIComponent(f.image) }, screen: "title_menu", ...options }, "*"), { f, options });
      } else {
        const packed = Buffer.from(await mod.exports.packCartridgeToUint8Array({ ...f, assets: [{ path: "assets/cg.svg", data: f.image }] })).toString("base64");
        await p.evaluate(({ packed, options }) => window.postMessage({ type: "agentvn.runtime.preview", cartridgeBase64: packed,
          fileName: "gallery.vncart", previewNonce: "options-launch", ...options }, "*"), { packed, options });
      }
      await p.getByTestId("start-new-game").waitFor(); await settleRuntime(p);
      assert.equal(await p.evaluate(() => window.__galleryStore.getState().currentGame.gallery[0].unlocked), flag === true);
      await p.evaluate(() => window.__galleryStore.getState().openGallery()); await settleRuntime(p);
      if (flag === true) {
        await p.getByTestId("gallery-item-anchor").getByRole("button").first().click();
        await p.locator(".gallery-viewer-image").evaluate(e => e.decode());
        await p.getByRole("button", { name: "回到剧情场景" }).click();
        await p.waitForFunction(() => window.__galleryStore.getState().galleryReplayActive);
        await p.evaluate(() => window.__galleryStore.getState().exitGalleryReplay()); await settleRuntime(p);
        assert.deepEqual(await localGallery(p), {});
      } else {
        assert(await p.getByTestId("gallery-item-anchor").getByRole("button").first().isDisabled());
      }
      row.status = "PASS"; await context.close(); context = undefined; save();
    }
  // Real React controls, actual JS preview transport; only file generation and
  // native process calls are controlled. The iframe consumes the current build.
  const f = fixture("renpy"), data = { ...f, uiSkinCompatibilityWarnings: [], assetUrls: { cg: "data:image/svg+xml," + encodeURIComponent(f.image) } };
  const exportModule = `const data=${JSON.stringify(data)};
export const createEditorLivePreviewData=async()=>data;
export const exportEditorPreviewDirectory=async()=>({fileName:'fixture',textFiles:[{path:'manifest.json',contents:'{}'}],assets:[]});
export const exportEditorCartridge=async()=>({fileName:'fixture.vncart',blob:new Blob(['fixture'])});
export const applyCharacterDialogStylesToScript=s=>s;`;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
<script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(t)=>t;window.__vite_plugin_react_preamble_installed__=true;</script>
<script type="module">
import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {PreviewWindowControls} from '/src/components/advanced/PreviewWindowControls.tsx';
import {PreviewPanel} from '/src/components/editor/PreviewPanel.tsx';
import {useProjectStore} from '/src/store/projectStore.ts';import {useEditorStore} from '/src/store/editorStore.ts';
import '/src/styles/variables.css';import '/src/styles/layout.css';import '/src/styles/editor-tokens.css';import '/src/styles/editor-preview.css';
window.projectStore=useProjectStore;useProjectStore.setState({projectId:'checkbox-project',title:'预览画廊选项',assetManifest:[{asset_id:'cg',asset_type:'ui',metadata:{data_url:${JSON.stringify(data.assetUrls.cg)}}}]});
useEditorStore.setState({nodes:[],edges:[],exportScript:()=>(${JSON.stringify(f.script)})});
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('div',{style:{height:'100vh',display:'grid',gridTemplateColumns:'420px 1fr',gap:16,padding:16,boxSizing:'border-box'}},
React.createElement('section',{'data-testid':'external'},React.createElement(PreviewWindowControls)),
React.createElement('section',{'data-testid':'embedded',style:{minWidth:0,minHeight:0,display:'grid'}},React.createElement(PreviewPanel,{collapsed:false,resizing:false,onCollapsedChange:()=>{}}))));
</script></body></html>`;
  for (const display of displayMatrix) {
    const row = { group: "editor-checkbox-launch-and-live-control", display, status: "RUNNING" }; report.cases.push(row); save();
    const p = await newContext(display);
    await p.addInitScript(() => {
      window.__previewCalls = []; window.__running = false;
      window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
        window.__previewCalls.push({ command, args });
        if (command === "get_gamecli_preview_running") return window.__running;
        if (command === "begin_gamecli_preview_directory") return { sessionId: "test", path: "F:/testavn/controlled" };
        if (command === "write_gamecli_preview_text_file" || command === "append_frontend_error") return;
        if (command === "finalize_gamecli_preview_directory") { window.__running = true; return "F:/testavn/controlled"; }
        throw Error("Unexpected IPC: " + command);
      } };
    });
    await p.route("**/__gallery_options__", r => r.fulfill({ contentType: "text/html", body: html }));
    await p.route("**/src/cartridge/exportCartridge.ts*", r => r.fulfill({ contentType: "application/javascript", body: exportModule }));
    await p.route("**/src/utils/exportScript.ts*", r => r.fulfill({ contentType: "application/javascript",
      body: `export const exportScript=()=>(${JSON.stringify(f.script)});export const applyProjectRuntimeSettingsToScript=s=>s;export const validateExportScript=()=>[];` }));
    await p.goto(editor.url + "/__gallery_options__");
    const external = p.getByTestId("external"), embedded = p.getByTestId("embedded");
    const checkbox = external.getByRole("checkbox", { name: "直接解锁全部画廊" });
    await checkbox.waitFor(); assert(!await checkbox.isChecked());
    await external.getByRole("button", { name: "启动 GameCLI 预览" }).click();
    await p.waitForFunction(() => window.__previewCalls.some(c => c.command === "finalize_gamecli_preview_directory"));
    assert.equal(await p.evaluate(() => window.__previewCalls.find(c => c.command === "finalize_gamecli_preview_directory").args.unlockAllGallery), false);
    await checkbox.check();
    await external.getByRole("button", { name: "启动 GameCLI 预览" }).click();
    await p.waitForFunction(() => window.__previewCalls.filter(c => c.command === "finalize_gamecli_preview_directory").length === 2);
    assert.equal(await p.evaluate(() => window.__previewCalls.filter(c => c.command === "finalize_gamecli_preview_directory")[1].args.unlockAllGallery), true);
    assert(await checkbox.isChecked());
    const frame = p.frameLocator('iframe[title="GameCLI 内嵌预览"]');
    // The iframe runs a production bundle, so assertions use visible controls.
    await embedded.getByRole("button", { name: "画廊", exact: true }).click();
    await frame.getByTestId("gallery-item-anchor").waitFor();
    assert(await frame.getByTestId("gallery-item-anchor").getByRole("button").first().isDisabled());
    const liveCheckbox = embedded.getByRole("checkbox", { name: "直接解锁全部画廊" });
    assert(!await liveCheckbox.isChecked()); await liveCheckbox.check();
    await frame.getByTestId("gallery-item-anchor").getByRole("button").first().waitFor({ state: "visible" });
    await p.waitForFunction(() => document.querySelector('iframe').contentDocument?.querySelector('[data-testid="gallery-item-anchor"] button')?.disabled === false);
    await frame.getByTestId("gallery-item-anchor").getByRole("button").first().click();
    await frame.locator(".gallery-viewer-image").evaluate(e => e.decode());
    await frame.getByRole("button", { name: "返回画廊" }).click();
    await liveCheckbox.uncheck();
    await p.waitForFunction(() => document.querySelector('iframe').contentDocument?.querySelector('[data-testid="gallery-item-anchor"] button')?.disabled === true);
    // Native request captures the launch choice; a new project starts unchecked.
    await p.evaluate(() => window.projectStore.setState({ projectId: "next-project" }));
    await p.waitForFunction(() => [...document.querySelectorAll('.preview-gallery-option input')].every(e => !e.checked));
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    row.screenshot = await captureSourceBrowser(p, path.join(out, `checkbox-${display.width}-${display.dpr}-${display.reduced}.png`), display);
    row.status = "PASS"; await context.close(); context = undefined; save();
  }
  assert.equal(report.cases.length, 24); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = e.stack; process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = await page.locator("body").innerText();
    await page.screenshot({ path: path.join(out, "failure.png") });
  }
}).finally(async () => {
  await context?.close(); await browser?.close(); await editor?.stop(); await runtime?.stop();
  report.cleanup = "OWNED_CONTEXT_SERVERS_STOPPED"; report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, errors: report.errors }));
});
