import { chromium } from "playwright";

const baseUrl = process.env.AGENTVN_EDITOR_URL ?? "http://127.0.0.1:6767";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 926 } });
const consoleErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => {
  consoleErrors.push(error.stack ?? error.message);
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const recentProjects = page.getByRole("region", { name: "最近项目" });
  if (await recentProjects.isVisible().catch(() => false)) {
    await recentProjects.locator("article").first().getByRole("button").first().click();
  }

  const toolsButton = page.getByRole("button", { name: "工具 / 设置" });
  await toolsButton.waitFor({ state: "visible" });
  if ((await toolsButton.getAttribute("aria-expanded")) !== "true") {
    await toolsButton.click();
  }

  await page.getByRole("button", { name: "客户端布局" }).click();
  await page.getByRole("button", { name: "50%", exact: true }).click();

  const block = page.locator('.runtime-layout-block[data-component-id="quick_menu"]');
  await block.waitFor({ state: "visible" });
  await block.scrollIntoViewIfNeeded();

  const start = await block.boundingBox();
  if (!start) throw new Error("对话框组件没有可用的边界框。");

  const before = await block.getAttribute("style");
  const startX = start.x + start.width / 2;
  const startY = start.y + start.height / 2;
  const hitTarget = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element ? {
      tagName: element.tagName,
      className: element.className,
      componentId: element.getAttribute("data-component-id"),
    } : null;
  }, { x: startX, y: startY });

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 80, startY - 48, { steps: 6 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(50);

  const afterRelease = await block.getAttribute("style");
  await page.mouse.move(startX + 90, startY + 54, { steps: 6 });
  await page.waitForTimeout(50);
  const afterFreeMove = await block.getAttribute("style");

  if (before === afterRelease) {
    throw new Error(`拖动没有改变组件位置，回归测试未触发真实拖动路径。边界框：${JSON.stringify(start)}；落点：${JSON.stringify(hitTarget)}；浏览器错误：\n${consoleErrors.join("\n")}`);
  }
  if (afterRelease !== afterFreeMove) {
    throw new Error("鼠标松开后组件仍跟随指针移动。");
  }

  const resizeHandle = block.locator(".runtime-layout-resize-handle");
  await resizeHandle.waitFor({ state: "visible" });
  const resizeStart = await resizeHandle.boundingBox();
  if (!resizeStart) throw new Error("组件缩放手柄没有可用的边界框。");

  const beforeResize = await block.getAttribute("style");
  const resizeX = resizeStart.x + resizeStart.width / 2;
  const resizeY = resizeStart.y + resizeStart.height / 2;
  await page.mouse.move(resizeX, resizeY);
  await page.mouse.down();
  await page.mouse.move(resizeX + 48, resizeY + 32, { steps: 6 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(50);

  const afterResizeRelease = await block.getAttribute("style");
  await page.mouse.move(resizeX - 90, resizeY - 54, { steps: 6 });
  await page.waitForTimeout(50);
  const afterResizeFreeMove = await block.getAttribute("style");

  if (beforeResize === afterResizeRelease) {
    throw new Error("拖动缩放手柄没有改变组件尺寸。");
  }
  if (afterResizeRelease !== afterResizeFreeMove) {
    throw new Error("鼠标松开缩放手柄后组件仍继续改变尺寸。");
  }
  if (consoleErrors.length > 0) {
    throw new Error(`拖动期间出现浏览器错误：\n${consoleErrors.join("\n")}`);
  }

  console.log("PASS: 客户端布局组件会在 pointerup 后结束移动和缩放。");
} finally {
  await browser.close();
}
