"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/assistant-creation-workbench-visual", runId);
const report = { runId, status: "RUNNING", cases: [] };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "editor"),
      port: Number(process.env.ASSISTANT_CREATION_VISUAL_PORT || 6921),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await context.addInitScript(() => localStorage.clear());
      const page = await context.newPage();
      let creationRequests = 0;
      page.on("pageerror", error => report.pageErrors ??= [String(error)]);
      await page.route("http://127.0.0.1:8278/api/assistant/creation/processes**", async route => {
        if (route.request().method() === "POST") creationRequests++;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(
          route.request().method() === "GET" ? { processes: [] } : {},
        ) });
      });
      await page.goto(`${server.url}/assistant-creation-workbench-harness.html`);
      const workbench = page.getByTestId("assistant-creation-workbench-window");
      await workbench.waitFor();
      await workbench.getByLabel("向大模型助手提问", { exact: true }).waitFor();

      assert.equal(await workbench.getByTestId("assistant-creation-example-preview").count(), 1,
        "创造工作台首次打开即应在同窗提供可见的组件效果预览");
      assert.equal(await workbench.getByTestId("assistant-creation-integration-example").count(), 1,
        "工作台应提供组件接入方式和白名单动作调用示例");
      assert.equal(await workbench.getByTestId("assistant-creation-example-choice").count(), 3,
        "工作台应提供多种可直接带入提示词的组件构建示例");
      const exampleAction = workbench.getByRole("button", {
        name: "用“标题页操作”填入构建需求",
        exact: true,
      });
      await exampleAction.scrollIntoViewIfNeeded();
      const exampleButtonHitTest = await exampleAction.evaluate(element => {
        const box = (node) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const studio = element.closest("[data-testid='assistant-creation-workbench-studio']");
        const previewShell = studio?.querySelector(".assistant-creation-studio-preview-shell");
        const previewCard = previewShell?.querySelector("[data-testid='assistant-creation-example-preview']");
        const previewFooter = element.closest("[data-testid='assistant-creation-workbench-studio']")
          ?.querySelector(".assistant-creation-studio-preview-shell [data-testid='assistant-creation-example-preview'] > footer");
        return {
          button: box(element),
          hitTag: hit?.tagName ?? null,
          hitClass: typeof hit?.className === "string" ? hit.className : null,
          hitIsButton: hit === element || element.contains(hit),
          studio: box(studio),
          studioScrollHeight: studio?.scrollHeight,
          previewShell: box(previewShell),
          previewCard: box(previewCard),
          previewCardScrollHeight: previewCard?.scrollHeight,
          previewFooter: box(previewFooter),
          previewGrid: previewShell && getComputedStyle(previewShell).gridTemplateRows,
          studioGrid: studio && getComputedStyle(studio).gridTemplateRows,
        };
      });
      assert(exampleButtonHitTest.hitIsButton,
        `预览内容不能覆盖“填入构建需求”按钮的真实点击区域：${JSON.stringify(exampleButtonHitTest)}`);
      const requestBeforeExamples = creationRequests;
      const selectedExample = workbench.getByRole("button", { name: "用“标题页操作”填入构建需求", exact: true });
      const beforeClick = Date.now();
      await selectedExample.click();
      await page.waitForFunction(() => {
        const input = document.querySelector("[data-testid='assistant-creation-workbench-window'] textarea");
        return input?.value.includes("标题页");
      });
      const exampleLatencyMs = Date.now() - beforeClick;
      assert.equal(creationRequests, requestBeforeExamples,
        "选用示例只应填入提示词，不得自动发起模型调用");
      await workbench.getByTestId("assistant-creation-example-preview").screenshot({
        path: path.join(output, "creation-example-preview.png"),
      });

      const desktopMeasurements = [];
      for (const viewport of [
        { width: 1920, height: 1080 },
        { width: 2560, height: 1440 },
        { width: 3840, height: 2160 },
      ]) {
        await page.setViewportSize(viewport);
        const measurement = await workbench.evaluate(element => {
          const rectOf = selector => {
            const rect = element.querySelector(selector).getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              width: rect.width, height: rect.height };
          };
          const rect = element.getBoundingClientRect();
          return {
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            documentWidth: document.documentElement.scrollWidth,
            window: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              width: rect.width, height: rect.height },
            conversation: rectOf("[data-testid='assistant-creation-workbench-conversation']"),
            studio: rectOf("[data-testid='assistant-creation-workbench-studio']"),
            preview: rectOf("[data-testid='assistant-creation-example-preview']"),
            overlap: element.querySelector("[data-testid='assistant-creation-workbench-conversation']")
              .getBoundingClientRect().right
              - element.querySelector("[data-testid='assistant-creation-workbench-studio']")
                .getBoundingClientRect().left,
          };
        });
        assert(measurement.window.left >= 0 && measurement.window.top >= 0
          && measurement.window.right <= viewport.width && measurement.window.bottom <= viewport.height,
        `工作台 ${viewport.width}×${viewport.height} 不得越界：${JSON.stringify(measurement)}`);
        assert(measurement.documentWidth <= viewport.width + 1,
          `工作台 ${viewport.width}×${viewport.height} 不得造成页面横向溢出`);
        assert(measurement.overlap <= 1,
          `对话与预览工作区不得重叠：${JSON.stringify(measurement)}`);
        assert(measurement.conversation.width > 0 && measurement.studio.width > 0
          && measurement.preview.width > 0 && measurement.preview.height > 0,
        `对话、调用示例和预览都必须可见：${JSON.stringify(measurement)}`);
        desktopMeasurements.push(measurement);
      }
      report.desktopMeasurements = desktopMeasurements;
      report.exampleLatencyMs = exampleLatencyMs;
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.screenshot({ path: path.join(output, "creation-workbench-1920x1080.png") });

      await page.getByTestId("seed-generated-draft").click();
      await page.getByTestId("draft-seeded").filter({ hasText: "ready" }).waitFor();
      await workbench.locator(".assistant-history-popover > summary").click();
      await workbench.locator(".assistant-history-menu .assistant-history-select")
        .filter({ hasText: "已生成的验收组件草稿" }).click();
      await workbench.getByTestId("assistant-creation-draft")
        .getByRole("heading", { name: "已生成的标题操作组件", exact: true }).waitFor();
      await workbench.getByTestId("assistant-creation-workbench-studio").getByTestId("assistant-creation-draft")
        .getByRole("button", { name: "打开存档", exact: true }).waitFor();
      assert.equal(creationRequests, requestBeforeExamples,
        "加载已生成草稿的验收夹具不得发起新模型请求");
      report.cases.push({
        case: "same-window-component-examples-live-preview-and-generated-draft-review",
        status: "PASS",
      });
      await page.setViewportSize({ width: 800, height: 900 });
      await page.waitForFunction(() => {
        const rect = document.querySelector("[data-testid='assistant-creation-workbench-window']")?.getBoundingClientRect();
        return Boolean(rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight);
      }, { timeout: 3000 });
      const tablet = await workbench.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const conversation = element.querySelector("[data-testid='assistant-creation-workbench-conversation']").getBoundingClientRect();
        const studio = element.querySelector("[data-testid='assistant-creation-workbench-studio']");
        const draft = studio.querySelector("[data-testid='assistant-creation-draft']");
        return {
          viewport: { width: innerWidth, height: innerHeight },
          documentWidth: document.documentElement.scrollWidth,
          window: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          conversation: { left: conversation.left, right: conversation.right, top: conversation.top, bottom: conversation.bottom },
          studio: {
            left: studio.getBoundingClientRect().left,
            right: studio.getBoundingClientRect().right,
            top: studio.getBoundingClientRect().top,
            bottom: studio.getBoundingClientRect().bottom,
            children: [...studio.children].map(child => {
              const childRect = child.getBoundingClientRect();
              return { className: child.className, top: childRect.top, bottom: childRect.bottom };
            }),
          },
          draft: { clientHeight: draft.clientHeight, scrollHeight: draft.scrollHeight },
        };
      });
      assert(tablet.documentWidth <= 801
        && tablet.window.left >= 0 && tablet.window.right <= 800
        && tablet.window.top >= 0 && tablet.window.bottom <= 900,
      `窄桌面工作台不得越界或产生横向溢出：${JSON.stringify(tablet)}`);
      assert(tablet.studio.top >= tablet.conversation.bottom - 1,
        `960px 以下工作台应纵向排列：${JSON.stringify(tablet)}`);
      assert(tablet.draft.scrollHeight <= tablet.draft.clientHeight + 1,
        `窄桌面生成草稿卡片不得裁切：${JSON.stringify(tablet.draft)}`);
      for (let index = 1; index < tablet.studio.children.length; index += 1) {
        assert(tablet.studio.children[index].top >= tablet.studio.children[index - 1].bottom - 1,
          `窄桌面工作台区块不得互相覆盖：${JSON.stringify(tablet.studio.children)}`);
      }
      report.tablet = tablet;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => {
        const windowElement = document.querySelector("[data-testid='assistant-creation-workbench-window']");
        if (!windowElement) return false;
        const rect = windowElement.getBoundingClientRect();
        return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
      }, { timeout: 3000 });
      const mobile = await workbench.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const conversation = element.querySelector("[data-testid='assistant-creation-workbench-conversation']").getBoundingClientRect();
        const studio = element.querySelector("[data-testid='assistant-creation-workbench-studio']").getBoundingClientRect();
        const content = element.querySelector(".assistant-creation-workbench-content");
        return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
          window: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
          content: { clientWidth: content.clientWidth, scrollWidth: content.scrollWidth,
            clientHeight: content.clientHeight, scrollHeight: content.scrollHeight },
          conversation: { left: conversation.left, right: conversation.right, top: conversation.top, bottom: conversation.bottom },
          studio: { left: studio.left, right: studio.right, top: studio.top, bottom: studio.bottom,
            clientWidth: element.querySelector("[data-testid='assistant-creation-workbench-studio']").clientWidth,
            scrollWidth: element.querySelector("[data-testid='assistant-creation-workbench-studio']").scrollWidth,
            children: [...element.querySelector("[data-testid='assistant-creation-workbench-studio']").children]
              .map(child => {
                const rect = child.getBoundingClientRect();
                return { className: child.className, top: rect.top, bottom: rect.bottom, height: rect.height };
              }) } };
      });
      assert(mobile.documentWidth <= 391 && mobile.window.left >= 0 && mobile.window.right <= 390
        && mobile.window.top >= 0 && mobile.window.bottom <= 844,
      `窄屏工作台必须位于视口内且无横向溢出：${JSON.stringify(mobile)}`);
      assert(mobile.studio.top >= mobile.conversation.top - 1,
        `窄屏工作台应采用单列顺序，而非挤成两列：${JSON.stringify(mobile)}`);
      assert(mobile.studio.scrollWidth <= mobile.studio.clientWidth + 1,
        `窄屏预览工作区不得产生内部横向溢出：${JSON.stringify(mobile)}`);
      await workbench.locator(".assistant-creation-workbench-content").evaluate(element => {
        element.scrollTop = element.scrollHeight;
      });
      const reviewActionGeometry = await workbench.getByTestId("assistant-creation-draft")
        .getByRole("button", { name: "打开存档", exact: true }).evaluate(element => {
          const rect = element.getBoundingClientRect();
          const contentRect = element.closest(".assistant-creation-workbench-content").getBoundingClientRect();
          const draft = element.closest("[data-testid='assistant-creation-draft']");
          const draftRect = draft.getBoundingClientRect();
          const scrollAncestors = [];
          for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            const ancestorRect = ancestor.getBoundingClientRect();
            scrollAncestors.push({
              className: typeof ancestor.className === "string" ? ancestor.className : ancestor.tagName,
              overflowX: style.overflowX,
              overflowY: style.overflowY,
              clientWidth: ancestor.clientWidth,
              scrollWidth: ancestor.scrollWidth,
              clientHeight: ancestor.clientHeight,
              scrollHeight: ancestor.scrollHeight,
              top: ancestorRect.top,
              bottom: ancestorRect.bottom,
            });
            if (ancestor.classList.contains("assistant-creation-workbench-content")) break;
          }
          return {
            action: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
            draft: { top: draftRect.top, bottom: draftRect.bottom,
              clientHeight: draft.clientHeight, scrollHeight: draft.scrollHeight },
            content: { left: contentRect.left, right: contentRect.right, top: contentRect.top, bottom: contentRect.bottom,
              scrollTop: element.closest(".assistant-creation-workbench-content").scrollTop,
              scrollHeight: element.closest(".assistant-creation-workbench-content").scrollHeight },
            scrollAncestors,
          };
        });
      assert(reviewActionGeometry.action.top >= reviewActionGeometry.content.top - 1
        && reviewActionGeometry.action.bottom <= reviewActionGeometry.content.bottom + 1,
      `窄屏滚动后，生成草稿预览操作必须实际进入可视工作区：${JSON.stringify(reviewActionGeometry)}`);
      assert(reviewActionGeometry.draft.scrollHeight <= reviewActionGeometry.draft.clientHeight + 1,
        `窄屏生成草稿卡片不得将审核内容挤压裁切：${JSON.stringify(reviewActionGeometry)}`);
      const studioChildren = mobile.studio.children;
      for (let index = 1; index < studioChildren.length; index += 1) {
        assert(studioChildren[index].top >= studioChildren[index - 1].bottom - 1,
          `窄屏工作台区块不得互相覆盖：${JSON.stringify(studioChildren)}`);
      }
      report.mobile = mobile;
      await workbench.locator(".assistant-creation-workbench-content").evaluate(element => {
        element.scrollTop = 0;
      });
      await page.screenshot({ path: path.join(output, "creation-workbench-390x844.png") });
      assert.deepEqual(report.pageErrors ?? [], [], "工作台交互不能产生前端异常");
      await context.close();
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(`Evidence: ${output}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
