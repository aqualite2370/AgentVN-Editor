"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, "..");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT, "Explicit isolated fixture/output required");
const output = path.join(process.env.AGENTVN_WORKSPACE_OUTPUT, "shared-menu", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", cases: [], scope: "actual Runtime browser, isolated two-node scene; NOT installed client" };
const compiled = require("../editor/node_modules/esbuild").buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";' }, bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
const mod = { exports: {} }; new Function("module", "exports", compiled)(mod, mod.exports);
function fixture() {
  const uiSkin = mod.exports.createRenpyUILayout();
  uiSkin.screens.find(screen => screen.screen_id === "game_menu").components.push({
    component_id: "shared-menu-artwork", component_type: "custom_component", required: false, visible: true, locked: false,
    rect: { x: 74, y: 91, width: 24, height: 6 }, label: "共享菜单组件",
    customComponent: { schemaVersion: 1, root: { tag: "div", className: "root", children: [
      { tag: "img", className: "icon", assetId: "shared-image", ariaLabel: "共享菜单徽章", children: [] },
      { tag: "button", className: "button", action: "open_about", text: "共享组件打开关于", children: [] } ] },
      styles: { ".root": { display: "flex", "align-items": "center", gap: "4px" }, ".icon": { width: "24px", height: "24px" },
        ".button": { "font-size": "14px", color: "#ffffff" } } },
  });
  uiSkin.screens.find(screen => screen.screen_id === "game_menu").components.push({ component_id: "shared-menu-mask",
    component_type: "mask", required: false, locked: false, visible: true,
    rect: { x: 93, y: 2, width: 4, height: 4 }, style: { maskMode: "solid", backgroundColor: "#123456", opacity: 0.5 } });
  return { uiSkin, manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.21.0",
    game_id: "shared-menu-runtime-fixture", title: "共享菜单临时工程", author: "QA", version: "1.0.0", language: "zh-CN",
    entry_script: "script.json", entry_scene_id: "scene", assets: [{ asset_id: "shared-image", asset_type: "ui",
      path: "assets/shared.png", filename: "共享.png", mime_type: "image/png" }], created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    script: { schema_version: "1.1.0", game_id: "shared-menu-runtime-fixture", title: "共享菜单临时工程", entry_scene_id: "scene",
      scenes: [{ scene_id: "scene", title: "隔离剧情", summary: "", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "共同菜单组件不应覆盖剧情。" }] }] },
    assetUrls: { "shared-image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=" } };
}
async function settle(page) {
  await page.waitForFunction(() => document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition === "idle"
    && !document.querySelector('[data-testid="game-launch-blackout"]'));
}
async function main() {
  let server, browser;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), port: 0,
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(output, "vite.log") });
    browser = await chromium.launch();
    await server.run(async () => {
      for (const dpr of [1, 2]) for (const motion of ["no-preference", "reduce"]) for (const [width, height] of desktopViewports) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: motion });
        const page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(String(error)));
        await page.goto(`${server.url}/?mode=preview`);
        await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
        await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
          sessionId: "shared-menu", revision: 1, requestId: "shared", runId: "shared", screen: "title_menu", ...payload }, "*"), fixture());
        await page.getByTestId("game-state-title").waitFor(); await settle(page);
        const shared = page.locator('[data-component-id="shared-menu-artwork"]');
        assert.equal(await shared.count(), 0, "Shared menu component must not render on title");
        await page.getByTestId("open-settings").click(); await page.getByTestId("settings-screen").waitFor(); await settle(page);
        assert.equal(await shared.count(), 1, "The actual shared Runtime menu must consume game_menu components");
        assert.equal(await page.locator('[data-ui-mask-id="shared-menu-mask"]').count(), 1);
        assert.equal(await page.locator('[data-ui-mask-id="shared-menu-mask"]').evaluate(element => getComputedStyle(element).backgroundColor), "rgb(18, 52, 86)");
        await shared.getByRole("img", { name: "共享菜单徽章" }).waitFor();
        await page.waitForFunction(() => document.querySelector('[data-component-id="shared-menu-artwork"] img')?.naturalWidth > 0);
        const baseline = await shared.evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
        await shared.evaluate(element => { window.__stableSharedMenuNode = element; });
        assert(baseline.left >= 0 && baseline.top >= 0 && baseline.right <= width + 1 && baseline.bottom <= height + 1);
        await shared.getByRole("button", { name: "共享组件打开关于" }).click();
        await page.getByTestId("about-screen").waitFor(); await settle(page);
        for (const [button, scope] of [["renpy-menu-help", "help"], ["renpy-menu-history", "history"], ["renpy-menu-save-load", "save_load"], ["renpy-menu-settings", "preferences"]]) {
          await page.getByTestId(button).click(); await page.locator(`[data-ui-screen="${scope}"]`).waitFor(); await settle(page);
          assert.equal(await shared.count(), 1, "Shared component has one real owner on each menu page");
          assert(await shared.evaluate(element => window.__stableSharedMenuNode === element), "Shared menu layer must not remount between menu pages");
          assert.equal(await page.locator('[data-ui-mask-id="shared-menu-mask"]').count(), 1);
          const next = await shared.evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
          for (const key of Object.keys(baseline)) assert(Math.abs(next[key] - baseline[key]) <= 1, `Shared geometry changed: ${key}`);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: path.join(output, `shared-${width}-${dpr}-${motion}.png`) });
        await page.getByTestId("renpy-menu-return").click(); await page.getByTestId("game-state-title").waitFor(); await settle(page);
        assert.equal(await shared.count(), 0);
        assert.equal(await page.locator('[data-ui-mask-id="shared-menu-mask"]').count(), 0);
        await page.getByTestId("start-new-game").click(); await page.locator('[data-ui-screen="player"]').waitFor(); await settle(page);
        assert.equal(await shared.count(), 0, "Shared menu component must not render on gameplay");
        assert.deepEqual(errors, []);
        report.cases.push({ width, height, dpr, motion, baseline, status: "PASS" }); await context.close();
      }
    });
    assert.equal(report.cases.length, 12); report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = error.stack || String(error); process.exitCode = 1; }
  finally { await browser?.close(); await server?.stop(); report.cleanup = "owned browser/server stopped";
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output, error: report.error })); }
}
main();
