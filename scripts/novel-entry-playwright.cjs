"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT);
const report = { status: "RUNNING", scope: "source-editor-real-browser-real-isolated-backend-not-installed",
  project: process.env.AGENTVN_TEST_PROJECT, cases: [], modelSubmissions: 0 };
let host, browser;
function geometry(element) {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
}
(async () => {
  host = await startEditorAcceptance(output);
  report.service = { backendPid: host.backendPid, frontendPid: host.server.pid,
    backendUrl: host.backendUrl, frontendUrl: host.url };
  browser = await chromium.launch();
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2])
    for (const motion of ["no-preference", "reduce"]) {
      const context = await browser.newContext({ viewport: { width, height },
        deviceScaleFactor: dpr, reducedMotion: motion });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const item = { width, height, dpr, motion, status: "RUNNING" };
      report.cases.push(item);
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      await page.route(/\/api\/(?:assistant\/creation\/processes|novel\/.*(?:execute|analy[sz]e|generate))/, route => {
        if (route.request().method() === "POST") {
          report.modelSubmissions++;
          return route.abort();
        }
        return route.continue();
      });
      try {
        await host.open(page);
        await settleEditor(page);
        const entry = page.locator('[data-help-key="toolbar.novelImport"]');
        assert.equal(await entry.count(), 1, "Keep a single actual novel entry, not a second hidden duplicate");
        item.entry = await entry.evaluate(element => {
          const r = element.getBoundingClientRect(), hidden = [];
          for (let node = element; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") hidden.push(node.className);
          }
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
            hidden, hit: element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
            actualDpr: devicePixelRatio, actualReduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
        });
        assert(item.entry.width > 0 && item.entry.height > 0 && item.entry.hit && !item.entry.hidden.length,
          `Novel import must be a visible, genuinely clickable topbar entry: ${JSON.stringify(item.entry)}`);
        assert(item.entry.x >= 0 && item.entry.right <= width && item.entry.bottom <= height);
        assert.equal(item.entry.actualDpr, dpr);
        assert.equal(item.entry.actualReduced, motion === "reduce");
        item.topbar = await page.locator(".editor-toolbar button:visible").evaluateAll(buttons => buttons.map(button => {
          const r = button.getBoundingClientRect();
          return { label: button.textContent.trim(), x: r.x, y: r.y, right: r.right, bottom: r.bottom,
            hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
        }));
        assert(item.topbar.every(button => button.x >= 0 && button.right <= width
          && button.y >= 0 && button.bottom <= height && button.hit), "Other topbar actions must remain visible and clickable");
        const before = await page.locator(".editor-toolbar").evaluate(geometry);
        await entry.click();
        const panel = page.getByTestId("novel-import-workbench");
        await panel.waitFor();
        assert(await panel.evaluate(element => element.contains(document.activeElement)), "The opened workbench must own keyboard focus");
        await panel.locator('[data-help-key="novel.importFile"] input').waitFor({ state: "attached" });
        await panel.evaluate(async element => {
          await Promise.all(element.getAnimations({ subtree: true })
            .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {})));
        });
        const bounds = await panel.evaluate(element => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom,
            scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
            documentWidth: document.documentElement.scrollWidth };
        });
        item.panel = bounds;
        assert(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width + 1 && bounds.bottom <= height + 1,
          `Workbench must remain inside viewport: ${JSON.stringify(bounds)}`);
        assert(bounds.scrollWidth <= bounds.clientWidth + 1 && bounds.documentWidth <= width + 1,
          `Workbench must not overflow horizontally: ${JSON.stringify(bounds)}`);
        const close = panel.getByRole("button", { name: "关闭小说导入工作台", exact: true });
        await close.click();
        await panel.waitFor({ state: "detached" });
        assert(await entry.evaluate(element => document.activeElement === element), "Closing must restore focus to the real entry");
        await page.keyboard.press("Enter");
        await panel.waitFor();
        await panel.locator('[data-help-key="novel.importFile"] input').setInputFiles({
          name: "本地入口验证.txt", mimeType: "text/plain",
          buffer: Buffer.from("第一章 归来\n她推开家门，看见窗边留着一封信。\n", "utf8"),
        });
        await panel.getByRole("region", { name: "小说文件导入检测" }).waitFor();
        assert((await panel.innerText()).includes("本地入口验证.txt"));
        await panel.locator('[data-help-key="novel.cancelImport"]').click();
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "detached" });
        await entry.click();
        await panel.waitFor();
        await close.click();
        await panel.waitFor({ state: "detached" });
        assert.equal(await page.locator('[data-workspace-surface="edit"]').getAttribute("aria-current"), "page");
        const after = await page.locator(".editor-toolbar").evaluate(geometry);
        for (const key of ["x", "y", "width", "height"]) assert(Math.abs(before[key] - after[key]) < 1);
        assert.deepEqual(errors, []);
        assert.equal(report.modelSubmissions, 0);
        const screenshotPath = path.join(output, `entry-${width}-dpr${dpr}-${motion}.png`);
        const png = await page.screenshot({ path: screenshotPath });
        assert.equal(png.readUInt32BE(16), width * dpr);
        assert.equal(png.readUInt32BE(20), height * dpr);
        item.screenshot = { path: screenshotPath,
          pixels: [png.readUInt32BE(16), png.readUInt32BE(20)],
          sha256: crypto.createHash("sha256").update(png).digest("hex") };
        item.status = "PASS";
      } catch (error) {
        item.status = "FAILED";
        item.error = String(error.stack || error);
      } finally {
        await context.close();
      }
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ width, dpr, motion, status: item.status, error: item.error?.split("\n")[0] }));
    }
  assert.equal(report.cases.length, 12);
  report.status = report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => {
  report.status = "TOOL_FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await host?.stop();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    modelSubmissions: report.modelSubmissions, output, error: report.error }));
});
