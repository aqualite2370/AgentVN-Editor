"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/custom-component-library", runId);
const report = { runId, status: "RUNNING", cases: [] };

async function inspectGeometry(page, width, height) {
  return page.evaluate(({ width, height }) => {
    const panel = document.querySelector(".custom-component-library").getBoundingClientRect();
    const controls = [...document.querySelectorAll(".custom-component-library :is(input, textarea, select, button, .custom-component-preview)")]
      .filter((node) => node.getBoundingClientRect().width > 0)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { tag: node.tagName, label: node.getAttribute("aria-label") ?? node.textContent.trim().slice(0, 30),
          left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    return {
      panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom,
        width: panel.width, height: panel.height },
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      viewport: { width, height },
      controls,
    };
  }, { width, height });
}

async function runViewport(browser, server, size) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${server.url}/custom-component-library-harness.html`);
  const library = page.getByTestId("custom-component-library");
  await library.waitFor();
  await page.getByLabel("添加组件图片依赖").setInputFiles({
    name: "分享预览.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/4GkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByText(/已添加 1 个图片依赖/u).waitFor();
  const assetId = await page.locator(".custom-component-dependencies code").innerText();
  await page.getByLabel("组件 HTML").fill(
    `<div class="root"><img data-asset="${assetId}" aria-label="分享预览图" /></div>`,
  );
  const draftImage = page.locator(".custom-component-live-preview img");
  await draftImage.waitFor();
  assert((await draftImage.getAttribute("src")).startsWith("data:image/png;base64,"),
    "隔离草稿预览必须显示已授权的本地组件素材");
  await page.getByTestId("component-save").click();
  await page.getByText("“我的组件”已保存到本机个人组件库。").waitFor();
  assert.equal(await page.getByText(/预览资源映射待接入/u).count(), 0,
    "个人库已映射素材，不应显示过期的待接入提示");
  const savedImage = page.locator(".custom-component-saved-preview img");
  await savedImage.waitFor();
  assert((await savedImage.getAttribute("src")).startsWith("data:image/png;base64,"),
    "个人库预览必须继续显示保存的素材字节");
  const originalItem = page.locator(".custom-component-list li").first();
  await originalItem.waitFor();
  const originalName = await originalItem.locator("label span").innerText();
  await originalItem.getByRole("checkbox").check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("component-export").click();
  const download = await downloadPromise;
  const archivePath = path.join(output, `component-${size.width}.zip`);
  await download.saveAs(archivePath);
  assert(fs.statSync(archivePath).size > 0, "个人组件 ZIP 应生成非空文件");

  await page.getByTestId("component-import-file").setInputFiles(archivePath);
  await page.getByText(/扫描通过：1 个组件/).waitFor();
  const importedSelector = page.getByRole("combobox", { name: "待导入组件", exact: true });
  await importedSelector.click();
  await page.getByRole("option").filter({ hasText: originalName }).click();
  assert.equal(await importedSelector.getAttribute("aria-expanded"), "false",
    "真实选择组件后应收口主题选择器");
  await page.getByRole("region", { name: "导入预览" }).getByTestId("custom-component-preview").waitFor();
  const importedImage = page.getByRole("region", { name: "导入预览" }).locator("img");
  await importedImage.waitFor();
  assert((await importedImage.getAttribute("src")).startsWith("data:image/png;base64,"),
    "ZIP 扫描预览必须解析并显示随包图片素材");
  await page.getByTestId("component-confirm-import").click();
  await page.getByText(/已将 1 个组件另存为本机副本/).waitFor();
  assert.equal(await page.locator(".custom-component-list li").count(), 2,
    "导入组件应作为个人库副本新增，不覆盖原件");
  const names = await page.locator(".custom-component-list li label span").allTextContents();
  assert(names.includes(originalName));
  assert(names.some((name) => name.includes("副本")));
  assert.equal(await page.locator(".custom-component-list input[type=checkbox]:checked").count(), 1);
  await page.reload();
  await page.locator(".custom-component-list li").first().waitFor();
  assert.equal(await page.locator(".custom-component-list li").count(), 2,
    "个人库内容必须在重新打开页面后继续存在");
  const geometry = await inspectGeometry(page, size.width, size.height);
  assert(geometry.panel.left >= -1 && geometry.panel.right <= size.width + 1,
    `组件库面板必须保持在视口内：${JSON.stringify(geometry.panel)}`);
  assert(geometry.pageOverflow <= 1, `组件库不能制造页面横向溢出：${JSON.stringify(geometry)}`);
  for (const control of geometry.controls) {
    assert(control.left >= -1 && control.right <= size.width + 1,
      `控件 ${control.label} 不得越界：${JSON.stringify(control)}`);
  }
  await page.screenshot({ path: path.join(output, `library-${size.width}x${size.height}.png`), fullPage: true });
  assert.deepEqual(errors, []);
  report.cases.push({ case: "personal-library-create-export-import-copy-persistence", ...size, geometry, status: "PASS" });
  await context.close();
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server, browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "editor"),
      port: Number(process.env.COMPONENT_LIBRARY_TEST_PORT || 6911),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      await runViewport(browser, server, { width: 1920, height: 1080 });
      await runViewport(browser, server, { width: 2560, height: 1440 });
      await runViewport(browser, server, { width: 3840, height: 2160 });
    });
    assert.equal(report.cases.length, 3, "必须覆盖用户当前指定的三档横屏行为");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    throw error;
  } finally {
    await browser?.close();
    await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
