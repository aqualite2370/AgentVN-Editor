"use strict";
// Shared title default-path regression: actual Runtime without Editor viewport override.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { resolveAcceptancePaths, viewports, root } = require("./lib/editor-ui-acceptance.cjs");
const paths = resolveAcceptancePaths();
const report = { status: "RUNNING", scope: "Shared title Runtime default measurement regression; not installed/device acceptance",
  isolation: paths, dpr: Number(process.env.RENPY_MOTION_DPR || 1),
  reduced: process.env.RENPY_MOTION_REDUCED === "1", cases: [] };
const mod = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports);

async function main() {
  let server, browser;
  fs.mkdirSync(paths.output, { recursive: true });
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0,
      logFile: path.join(paths.output, "server.log") });
    report.owner = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({ headless: process.env.RENPY_MOTION_HEADFUL !== "1" });
    const skin = mod.exports.createRenpyUILayout();
    skin.renpy = { ...skin.renpy, shared: { ...skin.renpy?.shared, fontSize: 28 } };
    for (const viewport of viewports.slice(0, 3)) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: report.dpr,
        reducedMotion: report.reduced ? "reduce" : "no-preference" });
      await page.bringToFront();
      await server.run(async () => {
        await page.goto(`${server.url}/?mode=preview`);
        await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
        await page.evaluate(uiSkin => window.postMessage({
          type: "agentvn.live-preview.init", protocolVersion: 2,
          sessionId: "title-scale-regression", revision: 1, requestId: "title", runId: "title",
          screen: "title_menu", uiSkin,
          manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.8.0",
            game_id: "isolated-title-scale", title: "独立标题测量", author: "QA", version: "1.0.0",
            language: "zh-CN", entry_script: "script.json", entry_scene_id: "main", assets: [] },
          script: { schema_version: "1.1.0", game_id: "isolated-title-scale", title: "独立标题测量",
            entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "主场景",
              chapter: 1, tags: [], commands: [{ type: "narration", text: "隔离测试。" }] }] },
        }, "*"), skin);
        await page.getByTestId("renpy-title-view").waitFor();
        await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
          ?.getAttribute("data-runtime-screen-transition") === "idle");
        const value = await page.getByTestId("renpy-title-view").evaluate(view => ({
          rect: view.getBoundingClientRect().toJSON(), scale: Number(view.dataset.renpyScale),
          font: parseFloat(getComputedStyle(view.querySelector("button")).fontSize),
          overflow: document.documentElement.scrollWidth - innerWidth,
          buttons: [...view.querySelectorAll("button")].map(button => {
            const rect = button.getBoundingClientRect();
            return { rect: rect.toJSON(), hit: button.contains(document.elementFromPoint(
              rect.x + rect.width / 2, rect.y + rect.height / 2)) };
          }),
        }));
        const expected = Math.min(value.rect.width / 1280, value.rect.height / 720);
        assert(Math.abs(value.scale - expected) < .003, "Runtime must still measure its actual frame");
        assert(Math.abs(value.font - 28 * expected) < .15, "Runtime default font scale changed");
        assert(value.overflow <= 1, "Runtime title overflows");
        for (const button of value.buttons) assert(button.hit && button.rect.top >= value.rect.top - 1
          && button.rect.bottom <= value.rect.bottom + 1, "Runtime title action is clipped or unclickable");
        await page.screenshot({ path: path.join(paths.output, `${viewport.name}-runtime-title.png`) });
        await page.getByTestId("start-new-game").click();
        await page.locator('[data-ui-screen="player"]').waitFor();
        report.cases.push({ viewport, value, status: "PASS" });
      });
      await page.close();
    }
    assert.equal(report.cases.length, 3);
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = error.stack; }
  finally {
    await browser?.close();
    await server?.stop();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output: paths.output, error: report.error }));
  }
  if (report.status !== "PASS") process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
