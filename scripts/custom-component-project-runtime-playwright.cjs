"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/custom-component-project-runtime", runId);
const report = {
  runId,
  status: "RUNNING",
  testScript: {
    path: path.relative(root, __filename).replace(/\\/g, "/"),
    sha256: crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),
  },
  cases: [],
};

async function runCase(browser, server, viewport, reducedMotion = false, deviceScaleFactor = 1) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText ?? "unknown",
  }));
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`${server.url}/custom-component-project-harness.html`);
  const editor = page.getByTestId("renpy-menu-editor");
  try {
    await editor.waitFor({ timeout: 10000 });
  } catch (error) {
    report.initializationFailure = {
      errors,
      consoleErrors,
      bodyText: await page.locator("body").innerText().catch(() => ""),
      html: await page.locator("#root").innerHTML().catch(() => ""),
    };
    await page.screenshot({ path: path.join(output, `initialization-failure-${viewport.width}.png`), fullPage: true }).catch(() => {});
    throw error;
  }
  await editor.locator("details.renpy-personal-component-library > summary").click();
  const componentName = `Runtime组件${viewport.width}-${runId.slice(-5)}`;
  const imageDependency = page.getByLabel("添加组件图片依赖", { exact: true });
  await imageDependency.setInputFiles({
    name: "组件预览.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3i0AAAAASUVORK5CYII=", "base64"),
  });
  await page.getByText("已添加 1 个图片依赖", { exact: false }).waitFor();
  const personalAssetId = await page.locator(".custom-component-dependencies code").innerText();
  await page.getByLabel("组件名称", { exact: true }).fill(componentName);
  await page.getByLabel("组件 HTML", { exact: true }).fill(
    `<div class="root"><span class="title" data-bind="project.title">工程标题</span>
      <span class="label" data-bind="asset.display_name">素材显示名</span>
      <span class="label" data-bind="asset.filename">素材文件名</span>
      <img class="icon" data-asset="${personalAssetId}" aria-label="组件图片" />
      <button type="button" class="button" aria-label="打开关于" data-action="open_about">关于</button></div>`,
  );
  await page.getByLabel("组件 CSS", { exact: true }).fill(
    `.root { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
     .title { color: #ffffff; font-size: 18px; }
     .icon { width: 48px; height: 48px; object-fit: contain; }
     .button { color: #ffffff; background-color: #24324d; padding: 8px 12px; }
     .button:hover { background-color: #304050; }`,
  );
  await page.getByTestId("component-save").click();
  await page.getByText(`“${componentName}”已保存到本机个人组件库。`).waitFor();
  const add = page.getByRole("button", { name: `添加 ${componentName} 到当前页面` });
  await add.waitFor();
  await add.click();
  const editorState = await page.evaluate(() => ({
    addStatus: document.querySelector(".custom-component-library > header output")?.textContent ?? "",
    projectCount: document.querySelector(".renpy-project-components > summary")?.textContent ?? "",
    projectLabels: [...document.querySelectorAll(".renpy-project-components legend")].map((item) => item.textContent),
  }));
  report.lastEditorState = editorState;
  const addStatus = editorState.addStatus;
  assert(addStatus.includes("已复制到当前工程页面"),
    `添加工程副本应成功，实际状态：${addStatus}`);

  // This fixture has three bound text rows, an image and an action, unlike
  // the initial two-row component. Size its project copy through author
  // controls; a button outside the configured frame is intentionally clipped.
  const projectCopies = page.locator("details.renpy-project-components");
  if (!await projectCopies.evaluate(node => node.open)) {
    await projectCopies.locator("summary").click();
  }
  const componentFields = projectCopies.locator("fieldset").filter({ hasText: componentName });
  await componentFields.getByLabel("height", { exact: true }).fill("36");

  const frame = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
  await page.locator('iframe[title="Ren\'Py（进阶）实际页面预览"]').waitFor();
  await page.waitForFunction(() => {
    const status = document.querySelector(".renpy-preview-status")?.textContent ?? "";
    return status.includes("实际 Runtime 页面") || status.includes("超时") || status.includes("失败");
  }, { timeout: 25000 });
  const previewStatus = await page.locator(".renpy-preview-status").innerText();
  report.previewStatus = previewStatus;
  if (!previewStatus.includes("实际 Runtime 页面")) {
    const runtimeFrame = page.frames().find((item) =>
      item.url().includes("/gamecli-preview/") || item.url().includes("gamecli-preview"));
    report.previewFailureDiagnostics = {
      errors,
      consoleErrors,
      failedRequests,
      runtimeUrl: runtimeFrame?.url() ?? null,
      runtimeBody: await runtimeFrame?.locator("body").innerText().catch((error) => String(error)) ?? null,
      runtimeBootError: await runtimeFrame?.locator('[role="alert"]').allInnerTexts().catch(() => []),
      runtimeBootStatus: await runtimeFrame?.locator('[role="status"]').allInnerTexts().catch(() => []),
    };
  }
  assert(!errors.some((error) => error.includes("React error #185")),
    `Runtime 初始化期间不得触发 React 更新深度循环：${JSON.stringify(report.previewFailureDiagnostics ?? errors)}`);
  assert(previewStatus.includes("实际 Runtime 页面"), `Runtime 初始化必须成功：${previewStatus}`);
  const runtimeFrame = page.frames().find((item) =>
    item.url().includes("/gamecli-preview/") || item.url().includes("gamecli-preview"));
  if (runtimeFrame) {
    report.lastRuntimeState = {
      url: runtimeFrame.url(),
      bodyText: await runtimeFrame.locator("body").innerText().catch((error) => String(error)),
      customComponentCount: await runtimeFrame.locator('[data-testid="runtime-custom-component"]').count().catch(() => -1),
      uiScreens: await runtimeFrame.locator(".ui-skin-scope").evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-ui-screen"))).catch(() => []),
    };
  }
  report.lastEditorState = {
    status: await page.locator(".renpy-preview-status").innerText().catch(() => ""),
    projectCopyCount: await page.locator(".renpy-project-components").innerText().catch(() => ""),
  };
  await page.screenshot({ path: path.join(output, `before-runtime-assert-${viewport.width}.png`), fullPage: true });
  const runtimeComponent = frame.getByTestId("runtime-custom-component");
  await runtimeComponent.waitFor({ timeout: 20000 });
  const runtimeImage = runtimeComponent.locator('img[aria-label="组件图片"]');
  try {
    await runtimeImage.waitFor();
  } catch (error) {
    report.runtimeComponentHtmlBeforeImageFailure = await runtimeComponent.evaluate((element) => element.outerHTML)
      .catch((innerError) => String(innerError));
    throw error;
  }
  const imageState = await runtimeImage.evaluate((image) => ({
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    source: image.currentSrc,
    assetId: image.getAttribute("data-asset-id"),
  }));
  report.runtimeImage = imageState;
  report.runtimeBindingDiagnostics = await runtimeComponent.evaluate((element) => ({
    primaryAssetId: element.getAttribute("data-primary-asset-id"),
    primaryAssetFilename: element.getAttribute("data-primary-asset-filename"),
    primaryAssetDisplayName: element.getAttribute("data-primary-asset-display-name"),
    bindingNodes: [...element.querySelectorAll("[data-binding]")].map((node) => ({
      binding: node.getAttribute("data-binding"),
      text: node.textContent,
    })),
  }));
  assert(imageState.complete && imageState.naturalWidth > 0,
    `工程复制的 ZIP 图片依赖必须进入真实 Runtime 并成功解码：${JSON.stringify(imageState)}`);
  await page.locator(`button[aria-label="删除 ${componentName}"]`).click();
  const deletion = page.getByTestId("editor-delete-confirmation");
  await deletion.waitFor();
  await deletion.getByRole("button", { name: "确认删除", exact: true }).click();
  await deletion.waitFor({ state: "detached" });
  assert.equal(await runtimeComponent.count(), 1, "删除个人库原件不得删除工程内副本");
  await runtimeFrame.waitForFunction(() => {
    const owner = document.querySelector("[data-runtime-transition-phase]");
    return owner?.getAttribute("data-runtime-transition-phase") === "idle";
  });
  const actionButton = frame.getByRole("button", { name: "打开关于" });
  if (viewport.width <= 640) {
    await page.locator('iframe[title="Ren\'Py（进阶）实际页面预览"]').scrollIntoViewIfNeeded();
    await actionButton.scrollIntoViewIfNeeded();
  }
  const actionButtonBox = await actionButton.boundingBox();
  const harnessGeometry = await page.evaluate(() => {
    const editor = document.querySelector('[data-testid="renpy-menu-editor"]');
    const preview = document.querySelector('iframe[title="Ren\'Py（进阶）实际页面预览"]');
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      editor: rect(editor),
      preview: rect(preview),
    };
  });
  report.harnessGeometry = harnessGeometry;
  assert(actionButtonBox, "白名单操作按钮必须有可见的浏览器命中矩形");
  assert(
    actionButtonBox.x >= 0 && actionButtonBox.y >= 0
      && actionButtonBox.x + actionButtonBox.width <= harnessGeometry.viewport.width + 1
      && actionButtonBox.y + actionButtonBox.height <= harnessGeometry.viewport.height + 1,
    `Runtime 预览按钮必须位于工作台视口内，不能依赖整页滚动：${JSON.stringify({ actionButtonBox, harnessGeometry })}`,
  );
  const metrics = await runtimeComponent.evaluate((element) => {
    const frame = document.querySelector(".runtime-layout-frame").getBoundingClientRect();
    const component = element.getBoundingClientRect();
    const button = element.querySelector("button");
    const buttonRect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(buttonRect.left + buttonRect.width / 2,
      buttonRect.top + buttonRect.height / 2);
    return {
      component: { left: component.left, right: component.right, top: component.top, bottom: component.bottom },
      frame: { left: frame.left, right: frame.right, top: frame.top, bottom: frame.bottom },
      title: element.querySelector(".title")?.textContent,
      assetDisplayName: element.querySelector('[data-binding="asset.display_name"]')?.textContent
        ?? [...element.querySelectorAll(".label")][0]?.textContent,
      assetFilename: element.querySelector('[data-binding="asset.filename"]')?.textContent
        ?? [...element.querySelectorAll(".label")][1]?.textContent,
      computedDisplay: getComputedStyle(element.querySelector(".root")).display,
      buttonTransition: getComputedStyle(button).transitionDuration,
      buttonReceivesHit: hit === button || button.contains(hit),
      hit: { tag: hit?.tagName, className: hit?.className },
      overflow: getComputedStyle(element).overflow,
      buttonRect: { left: buttonRect.left, right: buttonRect.right, top: buttonRect.top, bottom: buttonRect.bottom },
    };
  });
  metrics.actionButtonBox = actionButtonBox;
  report.lastRuntimeMetrics = metrics;
  assert(metrics.component.left >= metrics.frame.left - 1 && metrics.component.right <= metrics.frame.right + 1,
    `工程组件副本必须位于 Runtime 画布内：${JSON.stringify(metrics)}`);
  assert(metrics.component.top >= metrics.frame.top - 1 && metrics.component.bottom <= metrics.frame.bottom + 1,
    `工程组件副本不得垂直越界：${JSON.stringify(metrics)}`);
  assert.equal(metrics.computedDisplay, "flex", "Runtime 应消费组件安全 CSS，而不只是输出名称");
  assert(metrics.buttonRect.top >= metrics.component.top
    && metrics.buttonRect.bottom <= metrics.component.bottom,
  "按钮必须完整位于作者设置的组件外框内，不得以放开裁切掩盖尺寸错误");
  assert(metrics.buttonReceivesHit, "白名单动作按钮必须真实可点击");
  assert.equal(metrics.title, "组件运行时验收", "工程标题绑定必须消费 Runtime 当前工程数据");
  assert.equal(metrics.assetDisplayName, "组件预览.png",
    "Runtime 必须把 asset.display_name 绑定到组件的主图片依赖");
  assert.equal(metrics.assetFilename, "组件预览.png",
    "Runtime 必须把 asset.filename 绑定到组件的主图片依赖");
  const transitionMilliseconds = metrics.buttonTransition.split(",").map((duration) => {
    const value = Number.parseFloat(duration);
    return duration.trim().endsWith("ms") ? value : value * 1000;
  });
  assert(transitionMilliseconds.length > 0
    && transitionMilliseconds.every((duration) => reducedMotion
      ? duration <= 1
      : Math.abs(duration - 200) < 0.1),
    "游戏端按钮状态只做克制的 200ms 过渡，并遵守减少动效偏好");

  // Layout-edit mode intentionally captures component clicks for selection.
  // Switch to the actual Runtime interaction owner before exercising actions.
  const runtimeModeToggle = page.getByTestId("renpy-title-runtime-preview-toggle");
  await runtimeModeToggle.click();
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="renpy-title-runtime-preview-toggle"]')
      ?.getAttribute("aria-pressed") === "true"
    && document.querySelector('[data-testid="renpy-title-static-preview-toggle"]')
      ?.getAttribute("aria-pressed") === "false",
  );
  report.runtimeInteractionMode = {
    actualRuntimeSelected: await runtimeModeToggle.getAttribute("aria-pressed"),
    layoutEditSelected: await page.getByTestId("renpy-title-static-preview-toggle").getAttribute("aria-pressed"),
  };
  assert.equal(report.runtimeInteractionMode.actualRuntimeSelected, "true",
    "白名单组件动作必须在用户可操作的实际 Runtime 模式下测试");
  assert.equal(report.runtimeInteractionMode.layoutEditSelected, "false",
    "动作测试前布局编辑模式必须退出，避免将控件选择拦截误判为 Runtime 失败");

  await actionButton.click();
  const aboutScreen = frame.locator('.ui-skin-scope[data-ui-screen="about"]');
  await aboutScreen.waitFor({ timeout: 10000 });
  assert(await aboutScreen.isVisible(), "实际 Runtime 的关于页面必须成为可见页面所有者");

  const outerGeometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    editor: (() => {
      const rect = document.querySelector(".renpy-title-editor").getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    })(),
  }));
  assert(outerGeometry.scrollWidth <= outerGeometry.innerWidth + 1,
    `工程组件流程不能引入编辑器页面横向溢出：${JSON.stringify(outerGeometry)}`);
  await page.screenshot({ path: path.join(output, `runtime-${viewport.width}x${viewport.height}${reducedMotion ? "-reduced" : ""}.png`), fullPage: true });
  assert.deepEqual(errors, [], "真实 Runtime 嵌入和组件操作不得产生前端异常");
  report.cases.push({
    case: "personal-component-copy-runtime-render-action-and-library-isolation",
    viewport,
    deviceScaleFactor,
    reducedMotion,
    runtimeInteractionMode: report.runtimeInteractionMode,
    runtimeActionResult: "about",
    metrics,
    outerGeometry,
    status: "PASS",
  });
  await context.close();
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "editor"),
      port: Number(process.env.CUSTOM_COMPONENT_RUNTIME_TEST_PORT || 6912),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      for (const deviceScaleFactor of [1, 2]) {
        for (const viewport of [
          { width: 1920, height: 1080 },
          { width: 2560, height: 1440 },
          { width: 3840, height: 2160 },
        ]) {
          for (const reducedMotion of [false, true]) {
            await runCase(browser, server, viewport, reducedMotion, deviceScaleFactor);
          }
        }
      }
    });
    assert.equal(report.cases.length, 12,
      "必须覆盖1080p、2K、4K，DPR1/2及普通/减少动效的真实 Runtime 组件流程");
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
