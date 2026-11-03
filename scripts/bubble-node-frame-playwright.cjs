"use strict";
// Parent browser viewports stay 1080p/2K/4K. The smaller child frame is the
// measured, real 1080p Editor node-preview canvas, not another viewport gate.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/playwright/bubble-node-frame", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const text = "对白呈现创作验收，隔离中文字体缺字验证。";
const moduleValue = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(moduleValue, moduleValue.exports);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "Runtime default bubble in measured node-preview child frame; parent landscape1080p/2K/4K",
  cases: [], frame: { width: 416, height: 208.984375 }, text };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let server, browser, activePage;
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), port: 0,
    logFile: path.join(out, "owned-runtime.log") });
  report.owner = { pid: server.pid, url: server.url };
  browser = await chromium.launch();
  await server.run(async () => {
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
      reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = activePage = await context.newPage();
    try {
      await page.goto(server.url);
      await page.setContent(`<iframe title="Measured node Runtime" style="border:0;width:${report.frame.width}px;height:${report.frame.height}px"></iframe>`);
      const frame = await page.locator("iframe").elementHandle().then(handle => handle.contentFrame());
      await frame.goto(`${server.url}/?mode=preview`);
      await frame.waitForFunction(() => document.querySelector("#root")?.childElementCount);
      await frame.evaluate(({ uiSkin, text }) => window.postMessage({
        type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: "bubble-node-frame", revision: 1, requestId: "init", runId: "node",
        screen: "title_menu", uiSkin,
        manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.18.0",
          game_id: "bubble-node-frame", title: "节点气泡阅读预算", author: "QA", version: "1.0.0",
          language: "zh-CN", entry_script: "script.json", entry_scene_id: "main", assets: [],
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        script: { schema_version: "1.10.0", game_id: "bubble-node-frame", title: "节点气泡阅读预算",
          entry_scene_id: "main", default_dialog_presentation: "bubble",
          characters: [{ character_id: "alice", name: "Alice", dialog_presentation: "bubble" }],
          scenes: [{ scene_id: "main", title: "节点预览", chapter: 1, tags: [],
            commands: [{ type: "dialog", character_id: "alice", text }] }] },
        assetUrls: {},
      }, "*"), { uiSkin: moduleValue.exports.createRenpyUILayout(), text });
      await frame.getByTestId("start-new-game").click();
      await A.settleRuntime(frame);
      await frame.locator('.dialog-box[data-dialog-page-done="true"]').waitFor();
      const value = await frame.locator(".dialog-box.is-bubble-presentation").evaluate(node => {
        const body = node.querySelector(".dialog-text"), stage = node.closest(".story-player");
        const r = body.getBoundingClientRect(), s = stage.getBoundingClientRect(), b = node.getBoundingClientRect();
        const css = getComputedStyle(body);
        return { text: body.textContent, pages: Number(node.dataset.dialogPages),
          font: parseFloat(css.fontSize), lineHeight: parseFloat(css.lineHeight),
          body: r.toJSON(), bubble: b.toJSON(), stage: s.toJSON(),
          clientHeight: body.clientHeight, scrollHeight: body.scrollHeight,
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      report.last = { width, height, dpr, reduced, ...value }; save();
      assert.equal(value.pages, 1, "A short line that fits the available bubble must not become one character per page");
      assert.equal(value.text, text, "The whole short line must be visible");
      assert(value.clientHeight + 1 >= value.lineHeight && value.scrollHeight <= value.clientHeight + 1,
        `Readable line is physically clipped: ${JSON.stringify(value)}`);
      const r = value.bubble, s = value.stage;
      assert(r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1
        && value.overflow <= 1, "Do not fix text by pushing the bubble out of the game frame");
      report.cases.push({ width, height, dpr, reduced, status: "PASS", ...value }); save();
      await page.screenshot({ path: path.join(out, `node-frame-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`) });
    } finally { await context.close(); activePage = undefined; }
  }
  });
  assert.equal(report.cases.length, 12);
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  await activePage?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}).finally(async () => {
  await browser?.close(); await server?.stop();
  report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${out}`);
});
