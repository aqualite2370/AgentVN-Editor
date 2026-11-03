"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/assistant-creation-batch-review", runId);
const report = { runId, status: "RUNNING", cases: [] };

async function selectBatchConversation(workbench) {
  await workbench.locator(".assistant-history-popover > summary").click();
  await workbench.locator(".assistant-history-menu .assistant-history-select")
    .filter({ hasText: "多组件批量审核验收" }).click();
  await workbench.getByTestId("assistant-creation-review-batch").waitFor();
}

async function getProjectSnapshot(page) {
  return page.evaluate(() => window.__creationBatchHarnessState());
}

async function assertCenterReceivesPointer(locator, label) {
  const hitTest = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      target: hit?.getAttribute("aria-label") || hit?.textContent?.trim() || hit?.tagName,
      receivesPointer: Boolean(hit && (hit === element || element.contains(hit))),
    };
  });
  assert(hitTest.receivesPointer, `${label}中心必须由控件本身接收点击：${JSON.stringify(hitTest)}`);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "editor"),
      port: Number(process.env.ASSISTANT_CREATION_BATCH_REVIEW_PORT || 6951),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await context.addInitScript(() => localStorage.clear());
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", error => pageErrors.push(String(error)));
      await page.route("**/api/assistant/creation/processes**", async route => {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(route.request().method() === "GET" ? { processes: [] } : {}),
        });
      });

      await page.goto(`${server.url}/assistant-creation-workbench-harness.html`);
      await page.getByTestId("draft-seeded").filter({ hasText: "empty" }).waitFor();
      const workbench = page.getByTestId("assistant-creation-workbench-window");
      await page.getByTestId("seed-component-batch").click();
      await page.getByTestId("draft-seeded").filter({ hasText: "ready" }).waitFor();
      await selectBatchConversation(workbench);

      const batch = workbench.getByTestId("assistant-creation-review-batch");
      const items = batch.locator("ol > li");
      assert.equal(await items.count(), 2, "两个候选必须分别呈现在可审核清单中");
      await items.nth(0).getByRole("checkbox").uncheck();
      assert.match(await batch.locator(".assistant-creation-review-batch-actions [role='status']").innerText(), /1 项已选中/,
        "取消第一项后，应明确显示只剩一个候选将被写入");
      report.cases.push({ case: "review-items-can-be-included-or-excluded-independently", status: "PASS" });

      const runtimePreview = batch.getByTestId("assistant-creation-batch-runtime");
      await runtimePreview.getByRole("button", { name: "预览所选候选组合" }).click();
      await runtimePreview.locator('[data-preview-phase="ready"]').waitFor({ timeout: 20_000 });
      assert.equal(await runtimePreview.locator(".renpy-editor-runtime-viewport")
        .getAttribute("data-preview-page"), "preferences",
      "排除默认首项后，组合 Runtime 预览必须自动切到仍被选中的选项页候选");
      await runtimePreview.getByRole("button", { name: "收起 Runtime 预览" }).click();
      report.cases.push({
        case: "runtime-preview-follows-first-included-candidate-after-exclusion",
        status: "PASS",
      });

      if (!await items.nth(0).getByRole("checkbox").isChecked()) {
        await items.nth(0).getByRole("checkbox").check();
      }
      await items.nth(1).getByLabel("选项批量候选 目标页面").selectOption("title");
      await items.nth(1).getByLabel("选项批量候选 X").fill("10");
      await items.nth(1).getByLabel("选项批量候选 Y").fill("70");
      const overlapWarning = batch.getByTestId("assistant-creation-placement-conflicts");
      await overlapWarning.waitFor({ timeout: 1000 });
      assert.match(await overlapWarning.innerText(), /重叠|覆盖/,
        "同一页面的组件区域重叠时必须给出明确审核提示");
      const applyBatch = batch.getByTestId("assistant-creation-merge-batch");
      assert.equal(await applyBatch.isDisabled(), true,
        "未经用户调整，不得把重叠的多个候选直接批量写入页面");
      report.cases.push({ case: "same-screen-overlapping-review-items-are-explicitly-blocked", status: "PASS" });

      await items.nth(1).getByLabel("选项批量候选 目标页面").selectOption("preferences");
      await items.nth(1).getByLabel("选项批量候选 X").fill("40");
      await items.nth(1).locator(".assistant-creation-review-item-heading button").click();
      await runtimePreview.getByRole("button", { name: "预览所选候选组合" }).click();
      await runtimePreview.locator('[data-preview-phase="ready"]').waitFor({ timeout: 20_000 });
      const frame = runtimePreview.locator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
      await frame.waitFor();
      await frame.evaluate(element => { window.__trackedBatchPreviewFrame = element; });
      const readyPageBeforeSwitch = await runtimePreview.locator(".renpy-editor-runtime-viewport")
        .getAttribute("data-preview-page");
      assert.equal(readyPageBeforeSwitch, "preferences",
        "选择组合中剩余的选项页候选后，完整 Runtime 预览必须展示对应页面");
      await items.nth(0).locator(".assistant-creation-review-item-heading button").click();
      await runtimePreview.locator('[data-preview-phase="ready"]').waitFor({ timeout: 20_000 });
      const previewFrameIdentityStable = await runtimePreview.evaluate(element =>
        element.querySelector("iframe") === window.__trackedBatchPreviewFrame);
      assert(previewFrameIdentityStable,
        "切换候选预览页不得销毁并重建 Runtime iframe；应复用已就绪 Runtime 更新页面");
      assert.equal(await runtimePreview.locator(".renpy-editor-runtime-viewport")
        .getAttribute("data-preview-page"), "title");
      report.cases.push({
        case: "batch-runtime-preview-keeps-ready-runtime-mounted-while-switching-reviewed-pages",
        status: "PASS",
      });

      const selectedBeforeConflict = await getProjectSnapshot(page);
      await page.getByTestId("introduce-review-conflict").click();
      const afterExternalConflict = await getProjectSnapshot(page);
      await applyBatch.click();
      await batch.locator(".assistant-creation-review-batch-actions [role='status']")
        .filter({ hasText: /已变化|整批|冲突|未写入/ }).waitFor();
      const afterRejectedBatch = await getProjectSnapshot(page);
      assert.deepEqual(afterRejectedBatch.screenComponentIds, afterExternalConflict.screenComponentIds,
        "页面基线冲突时工程布局必须整批保持不变");
      assert.deepEqual(afterRejectedBatch.assetIds, afterExternalConflict.assetIds,
        "页面基线冲突时不得留下部分导入素材");
      assert.notDeepEqual(afterExternalConflict.screenComponentLabels, selectedBeforeConflict.screenComponentLabels,
        "并发修改夹具必须确实改变了工程，以证明冲突路径被触发");
      report.cases.push({ case: "stale-screen-baseline-rejects-the-entire-batch-without-losing-concurrent-edit", status: "PASS" });

      const successContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await successContext.addInitScript(() => localStorage.clear());
      const successPage = await successContext.newPage();
      const successErrors = [];
      successPage.on("pageerror", error => successErrors.push(String(error)));
      await successPage.route("**/api/assistant/creation/processes**", async route => {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ processes: [] }) });
      });
      await successPage.goto(`${server.url}/assistant-creation-workbench-harness.html`);
      await successPage.getByTestId("seed-component-batch").click();
      await successPage.getByTestId("draft-seeded").filter({ hasText: "ready" }).waitFor();
      let successWorkbench = successPage.getByTestId("assistant-creation-workbench-window");
      await selectBatchConversation(successWorkbench);
      const successBatch = successWorkbench.getByTestId("assistant-creation-review-batch");
      const successItems = successBatch.locator("ol > li");
      await successItems.nth(0).getByRole("checkbox").uncheck();
      await successPage.waitForTimeout(350);
      await successPage.reload();
      successWorkbench = successPage.getByTestId("assistant-creation-workbench-window");
      await selectBatchConversation(successWorkbench);
      const restoredItems = successWorkbench.getByTestId("assistant-creation-review-batch").locator("ol > li");
      assert.equal(await restoredItems.nth(0).getByRole("checkbox").isChecked(), false,
        "刷新后必须恢复用户排除的候选选择，不得静默把它重新加入批量写入");
      assert.equal(await restoredItems.nth(1).getByRole("checkbox").isChecked(), true);
      await successWorkbench.getByTestId("assistant-creation-merge-batch").click();
      const successStatus = successWorkbench.locator(
        ".assistant-creation-review-batch-actions [role='status']",
      );
      await successStatus.filter({ hasText: /已将 1 个候选一次性应用到工程/ }).waitFor();
      const successProject = await successPage.evaluate(() => window.__creationBatchHarnessState());
      assert(!successProject.screenComponentLabels.title.includes("标题批量候选"),
        "已排除的标题候选不得写入工程");
      assert(successProject.screenComponentLabels.preferences.includes("选项批量候选"),
        "被选中的候选必须写入用户指定的目标页面");
      const savedReview = await successPage.evaluate(async () => {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open("agentvn-assistant-workbench");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return await new Promise((resolve, reject) => {
          const transaction = database.transaction("conversations", "readonly");
          const request = transaction.objectStore("conversations").getAll();
          request.onsuccess = () => {
            database.close();
            resolve(request.result.find(item => item.projectId === "assistant-creation-workbench-project"
              && item.title === "多组件批量审核验收"));
          };
          request.onerror = () => reject(request.error);
        });
      });
      assert.equal(savedReview.creationReviewItems[0].included, false,
        "批量应用后审核历史仍须保留被排除项状态");
      assert.equal(savedReview.creationReviewItems[0].draft.projectMerge, undefined,
        "被排除的候选不得伪标记为已应用");
      assert.equal(savedReview.creationReviewItems[1].draft.projectMerge.screenId, "preferences",
        "审核记录必须能追溯应用候选的实际目标页面");
      assert.deepEqual(successErrors, [], "刷新恢复和批量提交不能产生前端异常");
      await successPage.screenshot({
        path: path.join(output, "batch-review-success-1920x1080.png"),
      });
      report.cases.push({
        case: "review-selection-survives-reload-and-only-selected-item-is-atomically-merged",
        status: "PASS",
      });
      await successContext.close();

      const generationContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await generationContext.addInitScript(() => localStorage.clear());
      const generationPage = await generationContext.newPage();
      const generationErrors = [];
      const generationTrace = [];
      let generationRequestCount = 0;
      let submittedGenerationRequest;
      generationPage.on("pageerror", error => generationErrors.push(String(error)));
      await generationPage.route("**/api/assistant/creation/processes**", async route => {
        const request = route.request();
        const url = new URL(request.url());
        generationTrace.push({ method: request.method(), path: url.pathname });
        const base = "/api/assistant/creation/processes";
        if (url.pathname === base && request.method() === "POST") {
          const payload = request.postDataJSON();
          generationRequestCount += 1;
          submittedGenerationRequest = payload.request;
          await route.fulfill({
            status: 202,
            contentType: "application/json",
            body: JSON.stringify({
              id: payload.id,
              projectId: payload.project_id,
              projectTitle: payload.project_title,
              conversationId: payload.conversation_id,
              status: "queued",
              submittedAt: Date.now(),
            }),
          });
          return;
        }
        if (url.pathname === base && request.method() === "GET") {
          await route.fulfill({ contentType: "application/json", body: JSON.stringify({ processes: [] }) });
          return;
        }
        const match = url.pathname.slice(base.length).match(/^\/([^/]+)$/);
        if (!match) {
          await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
          return;
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            id: decodeURIComponent(match[1]),
            projectId: "assistant-creation-authorization-project",
            projectTitle: "素材授权验收工程",
            conversationId: "controlled-generated-batch",
            status: "completed",
            submittedAt: Date.now() - 100,
            finishedAt: Date.now(),
            result: {
              components: [
                {
                  name: "生成的标题批量组件",
                  description: "通过受控创建进程生成的标题候选。",
                  html: '<div class="root"><span>标题操作</span></div>',
                  css: ".root { display: flex; padding: 8px; }",
                  screen_id: "title",
                },
                {
                  name: "生成的选项批量组件",
                  description: "通过受控创建进程生成的选项候选。",
                  html: '<div class="root"><span>选项行</span></div>',
                  css: ".root { display: flex; padding: 8px; }",
                  screen_id: "preferences",
                },
              ],
            },
          }),
        });
      });
      await generationPage.goto(`${server.url}/assistant-creation-authorization-harness.html`);
      await generationPage.getByTestId("authorization-harness-ready").filter({ hasText: "ready" }).waitFor();
      await generationPage.getByRole("button", { name: "打开创造工作台" }).click();
      const generationWorkbench = generationPage.getByTestId("assistant-creation-workbench-window");
      await generationWorkbench.getByLabel("向大模型助手提问", { exact: true })
        .fill("按标题和选项页各生成一个候选");
      await generationWorkbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
      const generatedBatch = generationWorkbench.getByTestId("assistant-creation-review-batch");
      try {
        await generatedBatch.waitFor({ timeout: 20_000 });
      } catch (error) {
        report.generationDebug = {
          requestTrace: generationTrace,
          requestCount: generationRequestCount,
          errors: generationErrors,
          panelText: (await generationWorkbench.innerText()).slice(-1800),
        };
        throw error;
      }
      const generatedItems = generatedBatch.locator("ol > li");
      assert.equal(await generatedItems.count(), 2,
        "创造请求返回 components[] 后应生成独立逐项审核卡片");
      assert.equal(await generatedItems.nth(0).getByLabel("生成的标题批量组件 目标页面").inputValue(), "title",
        "创建 API 的第一候选 screen_id 必须映射到标题页");
      assert.equal(await generatedItems.nth(1).getByLabel("生成的选项批量组件 目标页面").inputValue(), "preferences",
        "创建 API 的第二候选 screen_id 必须映射到选项页");
      assert.equal(generationRequestCount, 1, "端到端验收只能发起一次受控创造请求");
      assert.equal(submittedGenerationRequest.user_request, "按标题和选项页各生成一个候选");
      assert(submittedGenerationRequest.provider_selection,
        "端到端测试应使用受控模型配置，而不是跳过模型配置门槛");
      assert.equal(Object.hasOwn(submittedGenerationRequest, "projectBaseline"), false,
        "本机工程基线不得发送给创建 Agent");
      assert.deepEqual(generationErrors, [], "批量创建结果接入审核工作台不能产生前端异常");
      report.cases.push({
        case: "user-submitted-creation-process-result-opens-multi-candidate-review-with-page-mapping",
        status: "PASS",
        creationRequestCount: generationRequestCount,
      });
      await generationContext.close();

      for (const viewport of [
        { width: 1920, height: 1080, dpr: 1 },
        { width: 2560, height: 1440, dpr: 1 },
        { width: 3840, height: 2160, dpr: 1 },
        { width: 1920, height: 1080, dpr: 2 },
        { width: 2560, height: 1440, dpr: 2 },
        { width: 3840, height: 2160, dpr: 2 },
      ]) {
        const targetContext = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.dpr,
          reducedMotion: viewport.dpr === 2 && viewport.width === 1920 ? "reduce" : "no-preference",
        });
        await targetContext.addInitScript(() => localStorage.clear());
        const targetPage = await targetContext.newPage();
        await targetPage.route("**/api/assistant/creation/processes**", async route => {
          await route.fulfill({ contentType: "application/json", body: JSON.stringify({ processes: [] }) });
        });
        await targetPage.goto(`${server.url}/assistant-creation-workbench-harness.html`);
        await targetPage.getByTestId("seed-component-batch").click();
        await targetPage.getByTestId("draft-seeded").filter({ hasText: "ready" }).waitFor();
        const targetWorkbench = targetPage.getByTestId("assistant-creation-workbench-window");
        await selectBatchConversation(targetWorkbench);
        const geometry = await targetPage.getByTestId("assistant-creation-workbench-window").evaluate(element => {
          const windowRect = element.getBoundingClientRect();
          const studio = element.querySelector("[data-testid='assistant-creation-workbench-studio']");
          const batchElement = studio.querySelector("[data-testid='assistant-creation-review-batch']");
          const panelRect = batchElement.getBoundingClientRect();
          const scroller = element.querySelector(".assistant-creation-workbench-content");
          return {
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            documentWidth: document.documentElement.scrollWidth,
            window: { left: windowRect.left, right: windowRect.right, top: windowRect.top, bottom: windowRect.bottom },
            studio: { clientWidth: studio.clientWidth, scrollWidth: studio.scrollWidth },
            batch: { left: panelRect.left, right: panelRect.right, width: panelRect.width },
            scroller: { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth },
          };
        });
        assert(geometry.window.left >= 0 && geometry.window.top >= 0
          && geometry.window.right <= viewport.width + 1 && geometry.window.bottom <= viewport.height + 1,
        `审核工作台不得越界：${JSON.stringify(geometry)}`);
        assert(geometry.documentWidth <= viewport.width + 1
          && geometry.studio.scrollWidth <= geometry.studio.clientWidth + 1
          && geometry.scroller.scrollWidth <= geometry.scroller.clientWidth + 1,
        `审核候选不得产生横向溢出：${JSON.stringify(geometry)}`);

        const batch = targetWorkbench.getByTestId("assistant-creation-review-batch");
        const typography = await batch.evaluate(element => {
          const fontSize = selector => {
            const target = element.querySelector(selector);
            return target ? Number.parseFloat(getComputedStyle(target).fontSize) : null;
          };
          return {
            title: fontSize(":scope > header"),
            helper: fontSize(":scope > header span"),
            candidate: fontSize(".assistant-creation-review-item-heading > label"),
            fieldLabel: fontSize(".assistant-creation-review-item-fields label > span"),
            fieldControl: fontSize(".assistant-creation-review-item-fields input"),
            status: fontSize(".assistant-creation-review-batch-actions > span"),
            conflict: fontSize(".assistant-creation-placement-conflicts"),
          };
        });
        const authorizationTypography = await targetWorkbench.getByTestId("assistant-creation-authorized-components")
          .evaluate(element => {
            const fontSize = selector => {
              const target = element.querySelector(selector);
              return target ? Number.parseFloat(getComputedStyle(target).fontSize) : null;
            };
            return {
              title: fontSize(":scope > header strong"),
              helper: fontSize(":scope > header span"),
              searchLabel: fontSize(".assistant-creation-component-search > span"),
              emptyState: fontSize(":scope > p"),
            };
          });
        assert(typography.title >= 13 && typography.helper >= 11 && typography.candidate >= 12
          && typography.fieldLabel >= 11 && typography.fieldControl >= 12
          && typography.status >= 11 && typography.conflict >= 11,
        `审核区正文与表单控件须保持 1080p 可读字号：${JSON.stringify({ viewport, typography })}`);
        assert(authorizationTypography.title >= 13 && authorizationTypography.helper >= 11
          && authorizationTypography.searchLabel >= 11 && authorizationTypography.emptyState >= 12,
        `授权素材区域的权限说明和空状态须可读：${JSON.stringify({ viewport, authorizationTypography })}`);
        report.cases.push({ case: `batch-review-readable-typography-${viewport.width}x${viewport.height}-dpr${viewport.dpr}`,
          status: "PASS", typography, authorizationTypography });
        const previewButton = batch.getByRole("button", { name: "预览所选候选组合" });
        await previewButton.scrollIntoViewIfNeeded();
        assert(await previewButton.isVisible(),
          `Runtime 预览操作必须可滚动至并完整显示：${viewport.width}x${viewport.height}`);
        await assertCenterReceivesPointer(previewButton, "批量 Runtime 预览按钮");
        await previewButton.click();
        const runtimePreview = batch.getByTestId("assistant-creation-batch-runtime");
        await runtimePreview.locator('[data-preview-phase="ready"]').waitFor({ timeout: 20_000 });
        const runtimeStage = runtimePreview.locator(".assistant-creation-runtime-preview-stage");
        await runtimeStage.scrollIntoViewIfNeeded();
        const previewGeometry = await runtimeStage.evaluate(stage => {
          const rect = stage.getBoundingClientRect();
          const studio = stage.closest("[data-testid='assistant-creation-workbench-studio']");
          const studioRect = studio.getBoundingClientRect();
          const viewport = stage.querySelector(".renpy-editor-runtime-viewport");
          const viewportRect = viewport?.getBoundingClientRect();
          const frame = stage.querySelector("iframe");
          const frameRect = frame?.getBoundingClientRect();
          return {
            stage: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
            studio: { left: studioRect.left, right: studioRect.right, top: studioRect.top, bottom: studioRect.bottom },
            viewport: viewportRect && {
              left: viewportRect.left, right: viewportRect.right, top: viewportRect.top, bottom: viewportRect.bottom,
              width: viewportRect.width, height: viewportRect.height,
            },
            frame: frameRect && { left: frameRect.left, right: frameRect.right, top: frameRect.top, bottom: frameRect.bottom },
            iframeStyle: frame && {
              position: getComputedStyle(frame).position,
              inset: getComputedStyle(frame).inset,
              transform: getComputedStyle(frame).transform,
              transformOrigin: getComputedStyle(frame).transformOrigin,
            },
          };
        });
        assert(previewGeometry.stage.left >= previewGeometry.studio.left - 1
          && previewGeometry.stage.right <= previewGeometry.studio.right + 1,
        `实际 Runtime 预览不得横向溢出属性面板：${JSON.stringify(previewGeometry)}`);
        assert(previewGeometry.frame
          && previewGeometry.frame.left >= previewGeometry.stage.left - 1
          && previewGeometry.frame.right <= previewGeometry.stage.right + 1,
        `Runtime iframe 必须完整落在预览舞台内：${JSON.stringify(previewGeometry)}`);

        const applyButton = batch.getByTestId("assistant-creation-merge-batch");
        await applyButton.scrollIntoViewIfNeeded();
        assert(await applyButton.isVisible() && await applyButton.isEnabled(),
          `批量应用操作在该视口中必须可达且可用：${viewport.width}x${viewport.height}`);
        await assertCenterReceivesPointer(applyButton, "批量应用按钮");
        await applyButton.click();
        await batch.locator(".assistant-creation-review-batch-actions [role='status']")
          .filter({ hasText: /已将 2 个候选一次性应用到工程/ }).waitFor();
        const appliedSnapshot = await getProjectSnapshot(targetPage);
        assert(appliedSnapshot.screenComponentIds.title.length > 0
          && appliedSnapshot.screenComponentIds.preferences.length > 0,
        `实际点击后两页均应有批量候选：${viewport.width}x${viewport.height}`);
        report.cases.push({
          case: `batch-review-geometry-interaction-${viewport.width}x${viewport.height}-dpr${viewport.dpr}`,
          status: "PASS",
          geometry,
          previewGeometry,
          batchApplied: true,
        });
        await targetContext.close();
      }

      const reducedMotionContext = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
      });
      await reducedMotionContext.addInitScript(() => localStorage.clear());
      const reducedMotionPage = await reducedMotionContext.newPage();
      await reducedMotionPage.route("**/api/assistant/creation/processes**", async route => {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ processes: [] }) });
      });
      await reducedMotionPage.goto(`${server.url}/assistant-creation-workbench-harness.html`);
      const reducedMotionWindow = reducedMotionPage.getByTestId("assistant-creation-workbench-window");
      await reducedMotionWindow.evaluate(async workbench => {
        await Promise.all(workbench.getAnimations().map(animation => animation.finished.catch(() => undefined)));
      });
      const reducedMotionExit = await reducedMotionWindow.evaluate(workbench => {
        workbench.classList.add("is-closing");
        return {
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          closing: workbench.classList.contains("is-closing"),
        };
      });
      await reducedMotionPage.waitForTimeout(40);
      const reducedMotionExitFrame = await reducedMotionWindow.evaluate(workbench => {
        const style = getComputedStyle(workbench);
        return {
          opacity: style.opacity,
          transform: style.transform,
          transitionDuration: style.transitionDuration,
        };
      });
      assert(reducedMotionExit.reducedMotion && reducedMotionExit.closing,
        `减少动效回归必须实际触发工作台关闭状态：${JSON.stringify(reducedMotionExit)}`);
      assert(["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(reducedMotionExitFrame.transform),
        `减少动效关闭工作台时应去掉空间位移，只保留淡出：${JSON.stringify(reducedMotionExitFrame)}`);
      assert(Number(reducedMotionExitFrame.opacity) < 1,
        `关闭状态应在 80ms 内开始透明度淡出：${JSON.stringify(reducedMotionExitFrame)}`);
      assert(reducedMotionExitFrame.transitionDuration.split(",")
        .every(value => Number.parseFloat(value) <= 0.08),
      `减少动效模式下关闭过渡不得超过 80ms：${JSON.stringify(reducedMotionExitFrame)}`);
      report.cases.push({
        case: "reduced-motion-workbench-close-keeps-fade-but-removes-spatial-movement",
        status: "PASS",
        geometry: { ...reducedMotionExit, ...reducedMotionExitFrame },
      });
      await reducedMotionContext.close();

      assert.deepEqual(pageErrors, [], "批量审核、冲突与 Runtime 切换不能产生前端异常");
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
