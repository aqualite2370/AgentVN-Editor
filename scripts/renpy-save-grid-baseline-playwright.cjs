"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/playwright/renpy-save-grid-baseline",
  new Date().toISOString().replace(/[:.]/g, "-"));
const api = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(api, api.exports);
const deviceScaleFactor = Number(process.env.PROFILE_DPR || 1);
const report = { status: "RUNNING", deviceScaleFactor, cases: [] };
async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server, browser, page;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 6899,
      logFile: path.join(output, "server.log") });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160], [390, 844]]) {
      page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor });
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      const layout = api.exports.createRenpyUILayout();
      const component = layout.screens.find(screen => screen.screen_id === "save_load").components
        .find(component => component.component_type === "save_slot_grid");
      component.style = { ...component.style, columns: 2, gap: 30 };
      await page.goto(`${server.url}/?mode=preview`);
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
      await page.evaluate(uiSkin => window.postMessage({
        type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "legacy-grid",
        revision: 1, requestId: "legacy-grid", runId: "legacy-grid", screen: "title_menu", uiSkin,
        manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.10.0",
          game_id: "legacy-grid", title: "旧布局保全", author: "QA", version: "1.0.0", language: "zh-CN",
          entry_script: "script.json", entry_scene_id: "main", assets: [],
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        script: { schema_version: "1.1.0", game_id: "legacy-grid", title: "旧布局保全",
          entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "主场景",
            chapter: 1, tags: [], commands: [{ type: "narration", text: "保全旧存档页。" }] }] },
        assetUrls: {},
      }, "*"), layout);
      await page.getByTestId("game-state-title").waitFor();
      await page.getByTestId("open-save-load").click();
      await page.getByTestId("save-slot-grid").waitFor();
      const geometry = await page.getByTestId("save-slot-grid").evaluate(node => {
        const style = getComputedStyle(node);
        return { columns: style.gridTemplateColumns.split(" ").length, gap: parseFloat(style.gap),
          authoredScaledGap: parseFloat(node.style.gap),
          inlineStyle: node.getAttribute("style"), rect: node.getBoundingClientRect().toJSON(),
          documentOverflow: document.documentElement.scrollWidth - innerWidth };
      });
      const entry = { case: "legacy-authored-grid-preserved-before-new-overrides", width, height, geometry };
      report.cases.push(entry);
      await page.screenshot({ path: path.join(output, `legacy-grid-${width}x${height}.png`) });
      assert.equal(geometry.columns, width <= 600 ? 1 : 2,
        "新结构控件未被启用时，Runtime 必须保留旧布局已保存的两列及既有窄屏规则");
      assert.equal(geometry.gap, geometry.authoredScaledGap, "继承间距必须使用原组件的 Runtime 缩放值");
      if (width >= 1920) assert(geometry.gap >= 30, "不能将旧间距覆盖为模板14px");
      assert(geometry.documentOverflow <= 1 && geometry.rect.left >= -1 && geometry.rect.right <= width + 1,
        "旧网格继承不得引入水平溢出或边界裁切");
      assert.deepEqual(errors, []);
      entry.status = "PASS";
      await page.close();
      }
      assert.equal(report.cases.length, 4, "旧网格回归不得以零用例或缺失尺寸报告通过");
      report.status = "PASS";
    });
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); throw error;
  } finally {
    await browser?.close();
    await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${path.join(output, "report.json")}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
