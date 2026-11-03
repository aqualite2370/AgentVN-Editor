"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const output = process.env.AGENTVN_QA_OUTPUT || path.join(root, "output/playwright/renpy-help", new Date().toISOString().replace(/[:.]/g, "-"));
const mod = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports);
const deviceScaleFactor = Number(process.env.PROFILE_DPR || 1);
const report = { status: "RUNNING", deviceScaleFactor, scope: "help-runtime-browser-not-installed", cases: [] };
const viewports = process.env.PROFILE_VIEWPORTS ? JSON.parse(process.env.PROFILE_VIEWPORTS)
  : [[1920, 1080], [2560, 1440], [3840, 2160]];
function fixture() {
  const uiSkin = mod.exports.createRenpyUILayout();
  uiSkin.renpy = { shared: { fontSize: 28, x: 52, spacing: 6 }, about: { fontSize: 40 }, help: { fontSize: 24 } };
  const about = uiSkin.screens.find(screen => screen.screen_id === "about").components[0];
  about.style = { color: "#ee3322" };
  let help = uiSkin.screens.find(screen => screen.screen_id === "help");
  if (!help) {
    help = { screen_id: "help", components: [{ component_id: "help_panel", component_type: "help_panel",
      rect: { x: 5, y: 18, width: 90, height: 68 } }] };
    uiSkin.screens.push(help);
  }
  help.components[0].style = { color: "#12abcd" };
  return {
    uiSkin, assetUrls: {},
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.10.0",
      game_id: "help-regression", title: "帮助独立性回归", author: "QA", version: "1.0.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    script: { schema_version: "1.1.0", game_id: "help-regression", title: "帮助独立性回归",
      entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1,
        tags: [], commands: [{ type: "narration", text: "验证菜单往返不会推进剧情。" }] }] },
  };
}
async function screenReady(page, screen) {
  await page.locator(`[data-ui-screen="${screen}"]`).waitFor({ timeout: 5000 });
  await page.locator('[data-runtime-screen-transition="idle"]').waitFor();
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server, browser, page;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(output, "server.log") });
    browser = await chromium.launch({args:process.env.RUNTIME_QA_GPU==="1"?["--use-angle=d3d11"]:[]});
    for (const [width, height] of viewports) {
      page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor, hasTouch: width <= 915 });
      await server.run(async () => {
        const activate = locator => width <= 915 ? locator.tap() : locator.click();
        await page.goto(`${server.url}/?mode=preview`);
        await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
        await page.evaluate(payload => window.postMessage({
          type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "help-regression",
          revision: 1, requestId: "help", runId: "help", screen: "title_menu", ...payload,
        }, "*"), fixture());
        await page.getByTestId("game-state-title").waitFor();
        await activate(page.getByTestId("open-help"));
        await screenReady(page, "help");
        const helpColor = await page.locator(".help-card").evaluate(node => getComputedStyle(node).color);
        assert.equal(helpColor, "rgb(18, 171, 205)", "帮助内容必须使用自身样式，而不是关于样式");
        const geometry = await page.getByTestId("help-screen").evaluate(frame => {
          const menu = frame.closest("[data-renpy-menu-frame]");
          const nav = menu.querySelector("[data-testid='renpy-menu-navigation']");
          const content = menu.querySelector("[data-testid='renpy-menu-content']");
          const card = content.querySelector(".help-card");
          const bounds = content.getBoundingClientRect();
          const cardBounds = card.getBoundingClientRect();
          const buttons = [...nav.querySelectorAll("button")].map(button => {
            const r = button.getBoundingClientRect();
            return { rect: r.toJSON(), clipped: button.scrollWidth > button.clientWidth + 1,
              hit: button.disabled || button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
              fontSize: parseFloat(getComputedStyle(button).fontSize) };
          });
          return { nav: nav.getBoundingClientRect().toJSON(), bounds: bounds.toJSON(), card: cardBounds.toJSON(),
            buttons, scale: Number(menu.getAttribute("data-renpy-menu-scale")),
            overflow: document.documentElement.scrollWidth - innerWidth,
            cardOverflow: card.scrollWidth - card.clientWidth };
        });
        assert(geometry.overflow <= 1 && geometry.cardOverflow <= 1, "帮助横向溢出");
        assert(geometry.nav.right <= geometry.bounds.left + 1, "帮助导航覆盖内容");
        assert(geometry.card.left >= geometry.bounds.left - 1 && geometry.card.right <= geometry.bounds.right + 1
          && geometry.card.top >= geometry.bounds.top - 1 && geometry.card.bottom <= geometry.bounds.bottom + 1,
          "帮助内容被外层裁切");
        for (const button of geometry.buttons) {
          assert(button.hit && !button.clipped && button.rect.left >= 0 && button.rect.top >= 0
            && button.rect.right <= width + 1 && button.rect.bottom <= height + 1, "帮助导航裁切/越界/不可点击");
          assert(Math.abs(button.fontSize / geometry.scale - 24) < .1, "帮助必须使用独立导航覆盖");
        }
        const text = await page.locator(".help-card").innerText();
        assert.match(text, /PageDown 恢复已回退的进度/);
        assert(!/手柄/.test(text), "帮助不能承诺未实现硬件");
        const screenshot = path.join(output, `${width}x${height}-help.png`);
        await page.screenshot({ path: screenshot });
        await activate(page.getByTestId("renpy-menu-about"));
        await screenReady(page, "about");
        assert.equal(await page.locator(".about-card").evaluate(node => getComputedStyle(node).color),
          "rgb(238, 51, 34)", "帮助样式不得污染关于");
        await activate(page.getByTestId("renpy-menu-help"));
        await screenReady(page, "help");
        await activate(page.getByTestId("renpy-menu-return"));
        await page.getByTestId("game-state-title").waitFor();
        await activate(page.getByTestId("start-new-game"));
        await screenReady(page, "player");
        await page.waitForFunction(() => !document.querySelector(".game-launch-blackout"));
        const command = await page.getByTestId("game-state-playing").getAttribute("data-current-command-index");
        if (await page.getByTestId("renpy-quick-bar").count()) {
          assert.equal(await page.getByTestId("renpy-quick-bar").locator("button").count(), 9,
            "Ren’Py布局应保留原八项并加入隐藏，共九项单行快捷栏");
          await page.getByTestId("renpy-quick-hide").waitFor({ state: "visible" });
          await activate(page.getByTestId("renpy-quick-history"));
        } else {
          await activate(page.getByTestId("quick-menu-toggle"));
          await activate(page.getByRole("button", { name: "打开历史记录", exact: true }));
        }
        await screenReady(page, "history");
        await activate(page.getByTestId("renpy-menu-settings"));
        await screenReady(page, "preferences");
        await activate(page.getByTestId("renpy-menu-help"));
        await screenReady(page, "help");
        await page.keyboard.press("Escape");
        await page.getByTestId("game-state-playing").waitFor();
        assert.equal(await page.getByTestId("help-screen").count(), 0, "剧情来源帮助应返回剧情");
        assert.equal(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"),
          command, "帮助往返不能改变剧情位置");
        report.cases.push({ width, height, geometry, screenshot, status: "PASS" });
      });
      await page.close(); page = undefined;
    }
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close(); await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
