"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join("F:/AgentVN/QA/Component-Preview-Isolation-20261021-01", runId);
const report = { status: "RUNNING", runId, scope: "SOURCE_EDITOR_SAFE_PREVIEW_NOT_INSTALLED", cases: [] };
const html = '<div class="root"><button class="button" aria-label="样式隔离按钮" data-action="open_help">帮助</button></div>';
const css = ".root { padding: 12px; } .button { color: #ffffff; background-color: #223344; padding: 8px 12px; border-radius: 4px; }";

async function inspect(button, label) {
  const sample = await button.evaluate(async node => {
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await new Promise(requestAnimationFrame);
      const s = getComputedStyle(node), r = node.getBoundingClientRect();
      samples.push({ background: s.backgroundColor, image: s.backgroundImage, color: s.color,
        shadow: s.boxShadow, transform: s.transform, rect: r.toJSON() });
    }
    return samples;
  });
  for (const s of sample) {
    assert.equal(s.background, "rgb(34, 51, 68)", `${label}: authored solid background`);
    assert.equal(s.color, "rgb(255, 255, 255)", `${label}: authored text`);
    assert.equal(s.image, "none", `${label}: undeclared Editor gradient must not cover component`);
    assert.equal(s.shadow, "none", `${label}: no Editor elevation`);
    assert.equal(s.transform, "none", `${label}: no Editor hover displacement`);
    assert(s.rect.width > 0 && s.rect.height > 0, `${label}: visible component`);
  }
  return sample;
}

async function runCase(browser, server, viewport, dpr, reducedMotion) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, reducedMotion });
  try {
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto(`${server.url}/custom-component-library-harness.html`);
    await page.getByLabel("组件 HTML", { exact: true }).fill(html);
    await page.getByLabel("组件 CSS", { exact: true }).fill(css);
    const author = page.locator(".custom-component-live-preview").getByRole("button", { name: "样式隔离按钮" });
    await author.waitFor();
    const samples = { author: await inspect(author, "author") };
    await author.hover();
    samples.hover = await inspect(author, "author hover");
    await author.focus();
    samples.focus = await inspect(author, "author focus");
    assert(await author.isDisabled(), "Safe preview must not execute an action or submit a surrounding form");
    assert(!await author.evaluate(n => n === document.activeElement), "Inert preview must not capture keyboard focus");
    const outer = page.getByTestId("component-save");
    assert.notEqual(await outer.evaluate(n => getComputedStyle(n).backgroundImage), "none",
      "Editor save control must retain its own theme");
    await outer.click();
    const saved = page.locator(".custom-component-saved-preview").getByRole("button", { name: "样式隔离按钮" });
    samples.saved = await inspect(saved, "saved");
    await page.locator(".custom-component-list input[type=checkbox]").first().check();
    const downloading = page.waitForEvent("download");
    await page.getByTestId("component-export").click();
    const download = await downloading;
    const archive = path.join(output, `${viewport.width}-${dpr}-${reducedMotion}.zip`);
    await download.saveAs(archive);
    await page.getByTestId("component-import-file").setInputFiles(archive);
    const imported = page.getByRole("region", { name: "导入预览" })
      .getByTestId("custom-component-preview").getByRole("button", { name: "样式隔离按钮" });
    await imported.waitFor();
    samples.imported = await inspect(imported, "ZIP import");
    await imported.hover();
    samples.importedHover = await inspect(imported, "ZIP import hover");
    const geometry = await imported.evaluate(n => {
      const r = n.getBoundingClientRect();
      return { rect: r.toJSON(), viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        overflow: document.documentElement.scrollWidth - innerWidth,
        hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    assert.equal(geometry.viewport.dpr, dpr);
    assert.equal(geometry.viewport.width, viewport.width);
    assert(geometry.overflow <= 1 && geometry.rect.x >= 0 && geometry.rect.right <= viewport.width);
    assert(geometry.rect.y >= 0 && geometry.rect.bottom <= viewport.height && geometry.hit);
    assert.deepEqual(errors, []);
    if (viewport.width === 1920 && dpr === 1 && reducedMotion === "no-preference")
      await page.screenshot({ path: path.join(output, "import-preview.png") });
    report.cases.push({ viewport, dpr, reducedMotion, samples, geometry, status: "PASS" });
  } finally {
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server, browser;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "editor"), port: 0,
      logFile: path.join(output, "server.log") });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
        for (const dpr of [1, 2])
          for (const motion of ["no-preference", "reduce"])
            await runCase(browser, server, { width, height }, dpr, motion);
    });
    assert.equal(report.cases.length, 12);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    await browser?.close();
    await server?.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, output }));
  }
})();
