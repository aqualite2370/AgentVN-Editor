const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/playwright/editor-style-restore");
const sizes = [[1440, 900], [2560, 1440], [3840, 2160], [1280, 800], [757, 299], [640, 360], [390, 844]];

async function checkControl(locator) {
  await locator.scrollIntoViewIfNeeded();
  const result = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const errors = [];
    if (rect.width < 24 || rect.height < 24) errors.push("small");
    if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) errors.push("viewport");
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (rect.left < box.left - 1 || rect.right > box.right + 1)) errors.push(`clipped-x:${parent.className}`);
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) errors.push(`clipped-y:${parent.className}`);
    }
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (!hit || !element.contains(hit)) errors.push("occluded");
    return { label: element.textContent, rect: rect.toJSON(), errors };
  });
  assert.deepEqual(result.errors, [], JSON.stringify(result));
  await locator.click({ trial: true });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { ok: false, viewports: [] };
  try {
    await page.goto(process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/");
    await page.locator(".project-import-button input").first().setInputFiles(path.join(root, "data/backup-timeline/project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj"));
    const project = page.locator(".recent-project-open:not(:disabled)").filter({ hasText: "隐忍的成长" }).first();
    await project.click({ timeout: 120000 });
    await page.locator(".editor-toolbar").waitFor({ timeout: 120000 });
    await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached", timeout: 60000 });
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(600);
      const metrics = await page.evaluate(() => {
        const shell = getComputedStyle(document.querySelector(".editor-shell"));
        return {
          padding: parseFloat(shell.paddingTop),
          background: shell.backgroundImage,
          overflow: document.documentElement.scrollWidth - innerWidth,
          status: !!document.querySelector('[data-testid="workspace-status-bar"]'),
          glass: getComputedStyle(document.querySelector(".glass-selection-indicator") || document.body).position,
        };
      });
      report.viewports.push({ width, height, metrics });
      assert.equal(metrics.status, false, "Redesign status bar must not occupy the legacy shell");
      assert.notEqual(metrics.background, "none", "Original shell material missing");
      assert.ok(metrics.overflow <= 1, "Page horizontal overflow");
      const buttons = page.locator(".editor-toolbar .toolbar-inner button:visible");
      assert.ok(await buttons.count() > 3, "Toolbar controls missing");
      for (let i = 0; i < await buttons.count(); i++) await checkControl(buttons.nth(i));
      const palette = page.locator(".node-palette button:visible");
      for (let i = 0; i < await palette.count(); i++) await checkControl(palette.nth(i));
      const advanced = page.locator('[data-help-key="toolbar.advanced"]:visible').first();
      await advanced.click();
      const popover = page.locator(".toolbar-popover.advanced");
      await popover.waitFor({ state: "visible" });
      await page.waitForTimeout(700);
      const bounds = await popover.boundingBox();
      assert.ok(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, `Popover outside viewport: ${JSON.stringify(bounds)}`);
      await page.keyboard.press("Escape");
      await popover.waitFor({ state: "detached" });
      await page.screenshot({ path: path.join(output, `${width}x${height}.png`) });
    }
    report.ok = true;
  } catch (error) {
    report.error = error.stack;
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
})();
