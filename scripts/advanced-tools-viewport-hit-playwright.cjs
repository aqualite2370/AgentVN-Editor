"use strict";
// Editor only: an oversized warm page must not pan the presentation viewport
// when focus or a real click scrolls a compact page's controls into view.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(root, "output/playwright/advanced-tools-viewport-hit", runId);
fs.mkdirSync(out, { recursive: true });
const input = path.join(out, "isolated-small.vnproj");
const project = fixture(`viewport-hit-${runId}`);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#334455"/></svg>');
project.asset_manifest = [{
  asset_id: "viewport_background", asset_type: "background",
  metadata: { display_name: "命中验收素材", filename: "原素材.svg",
    mime_type: "image/svg+xml", data_url: `data:image/svg+xml;base64,${svg.toString("base64")}`,
    width: 600, height: 400 },
}];
fs.writeFileSync(input, JSON.stringify(project));
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = { status: "RUNNING", scope: "Editor source browser; not installed Release",
  input, cases: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function geometry(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".advanced-tab-viewport");
    const active = viewport.querySelector(".advanced-tab-content.is-active");
    const warm = viewport.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    const dialog = active.querySelector('[role="dialog"]');
    const rect = node => node.getBoundingClientRect().toJSON();
    return {
      scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop,
      scrollWidth: viewport.scrollWidth, clientWidth: viewport.clientWidth,
      overflow: getComputedStyle(viewport).overflow,
      viewport: rect(viewport), active: rect(active),
      warm: warm && { rect: rect(warm), inert: warm.inert, opacity: getComputedStyle(warm).opacity },
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      dialog: dialog && rect(dialog),
      buttons: dialog && [...dialog.querySelectorAll("button")].map(button => {
        const r = button.getBoundingClientRect();
        return { text: button.textContent, rect: r.toJSON(),
          hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }),
      activeFocus: active.contains(document.activeElement),
    };
  });
}
(async () => {
  let env, browser, page;
  try {
    env = await startEditorAcceptance();
    browser = await chromium.launch({ headless: process.env.ADVANCED_TOOLS_HEADFUL !== "1" });
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const cdp = await page.context().newCDPSession(page);
    page.setDefaultTimeout(45000);
    page.on("pageerror", error => report.errors.push(String(error)));
    report.owner = { pid: env.server.pid, backendPid: env.backendPid, url: env.url };
    await env.open(page);
    await settleEditor(page);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.waitForFunction(() => document.querySelector('[data-workspace-surface="options"]')
      ?.getAttribute("aria-current") === "page");
    await settleEditor(page);
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    await settleEditor(page);
    await page.locator(".runtime-layout-designer:visible").waitFor();
    await page.locator('[data-help-key="advanced.tab.library"]:visible').click();
    await settleEditor(page);
    for (const [width, height] of desktopViewports)
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const item = { width, height, dpr, reduced, status: "RUNNING" };
        report.cases.push(item); save();
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width, height, deviceScaleFactor: dpr, mobile: false,
        });
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await settleEditor(page);
        item.viewport = await page.evaluate(() => ({
          width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        }));
        assert.deepEqual(item.viewport, { width, height, dpr, reduced });
        const card = page.locator('.asset-library-card[data-asset-id="viewport_background"]');
        await card.locator('[data-help-key="asset.card.menu"]').click();
        await card.getByRole("menuitem", { name: "替换文件", exact: true }).click();
        await page.locator('[data-help-key="asset.replace.file"]').setInputFiles({
          name: "升级素材.svg", mimeType: "image/svg+xml", buffer: svg,
        });
        const dialog = page.getByRole("dialog", { name: "确认替换素材" });
        await dialog.waitFor();
        item.before = await geometry(page); save();
        assert.equal(item.before.scrollLeft, 0, "Opening replacement must not pan the presentation viewport");
        assert(item.before.buttons.every(button => button.hit),
          "Opening replacement must leave both controls pointer-accessible before focus repair");
        // Separate invariant probe, not a simulated user action: this layer
        // only clips presentation; even programmatic scrolling must belong
        // to the active page body, never to an oversized warm page's parent.
        await page.evaluate(() => {
          const viewport = document.querySelector(".advanced-tab-viewport");
          const warm = viewport.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
          viewport.scrollBy({
            left: Math.max(1, warm.getBoundingClientRect().width - viewport.clientWidth),
            top: 6,
            behavior: "instant",
          });
        });
        item.scrollOwnerProbe = await geometry(page); save();
        assert.equal(item.scrollOwnerProbe.scrollLeft, 0, "Presentation layer must not own horizontal programmatic scrolling");
        assert.equal(item.scrollOwnerProbe.scrollTop, 0, "Presentation layer must not own vertical programmatic scrolling");
        // This is the same focus/scroll path invoked by real keyboard input
        // and Playwright's ordinary click, not an assignment to scrollLeft.
        await dialog.getByRole("button", { name: "确认替换", exact: true }).focus();
        await dialog.getByRole("button", { name: "取消", exact: true }).scrollIntoViewIfNeeded();
        item.after = await geometry(page); save();
        const g = item.after;
        assert(g.warm?.inert && Number(g.warm.opacity) <= 0.001, "Warm layout must remain mounted and visually inactive");
        assert.equal(g.scrollLeft, 0, "Focus must not horizontally pan the presentation viewport");
        assert.equal(g.scrollTop, 0, "Only the active page body may scroll");
        assert(Math.abs(g.active.left - g.viewport.left) <= 1, "Active layer must retain the viewport origin");
        assert(g.documentOverflow <= 1, "No document horizontal overflow");
        assert(g.buttons?.length === 2 && g.buttons.every(button => button.hit),
          "Both replacement controls must receive actual pointer hits without clipping");
        for (const button of g.buttons) {
          assert(button.rect.left >= g.viewport.left - 1 && button.rect.right <= g.viewport.right + 1);
          assert(button.rect.top >= 0 && button.rect.bottom <= height + 1);
        }
        assert(g.activeFocus, "Focus belongs to the active page");
        const confirmation = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(out, `${width}-${dpr}-${reduced}-confirmation.png`), Buffer.from(confirmation.data, "base64"));
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        for (const file of [
          { name: "不兼容.wav", mimeType: "audio/wav", buffer: Buffer.from("invalid") },
          { name: "损坏.svg", mimeType: "image/svg+xml", buffer: Buffer.from("invalid") },
        ]) {
          await card.locator('[data-help-key="asset.card.menu"]').click();
          await card.getByRole("menuitem", { name: "替换文件", exact: true }).click();
          await page.locator('[data-help-key="asset.replace.file"]').setInputFiles(file);
          await page.locator(".asset-library-panel [role=alert]").filter({
            hasText: file.name.endsWith(".wav") ? "不兼容" : "原素材未改变",
          }).waitFor();
        }
        item.status = "PASS";
        const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(out, `${width}-${dpr}-${reduced}.png`), Buffer.from(screenshot.data, "base64"));
        save();
      }
    assert.equal(report.cases.length, 12);
    assert.equal(report.errors.length, 0);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    const current = report.cases.at(-1);
    if (current?.status === "RUNNING") current.status = "FAILED";
    await page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close(); await env?.stop();
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
      error: report.error, report: path.join(out, "report.json") }, null, 2));
  }
})();
