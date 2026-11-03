"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/assistant-creation-resource-authorization", runId);
const report = { runId, status: "RUNNING", cases: [] };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "editor"),
      port: Number(process.env.ASSISTANT_CREATION_AUTH_PORT || 6947),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await context.addInitScript(() => localStorage.clear());
      const page = await context.newPage();
      const pageErrors = [];
      let submittedRequest;
      page.on("pageerror", error => pageErrors.push(String(error)));
      await page.route("**/api/assistant/creation/processes**", async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (request.method() === "POST" && pathname.endsWith("/processes")) {
          const payload = request.postDataJSON();
          submittedRequest = payload.request;
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
        if (request.method() === "GET" && pathname.endsWith("/processes")) {
          await route.fulfill({ contentType: "application/json", body: JSON.stringify({ processes: [] }) });
          return;
        }
        const result = {
          name: "徽章标题卡",
          description: "引用用户选入会话的徽章素材。",
          html: '<div class="root"><img class="icon" data-asset="selected-1-badge" aria-label="徽章" /></div>',
          css: ".root { display: flex; } .icon { width: 24px; height: 24px; }",
        };
        const match = pathname.match(/\/processes\/([^/]+)$/);
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            id: decodeURIComponent(match?.[1] ?? "missing"),
            projectId: "assistant-creation-authorization-project",
            projectTitle: "素材授权验收工程",
            conversationId: "controlled",
            status: "completed",
            submittedAt: Date.now(),
            result,
          }),
        });
      });

      await page.goto(`${server.url}/assistant-creation-authorization-harness.html`);
      await page.getByTestId("authorization-harness-ready").filter({ hasText: "ready" }).waitFor();
      await page.getByRole("button", { name: "打开创造工作台" }).click();
      const workbench = page.getByTestId("assistant-creation-workbench-window");
      await workbench.getByTestId("assistant-creation-authorized-components").waitFor();
      const chosen = workbench.getByRole("checkbox", { name: "授权组件 用户选中徽章" });
      const unchosen = workbench.getByRole("checkbox", { name: "授权组件 未选中卡片" });
      assert.equal(await chosen.isChecked(), false, "个人组件必须默认不向创造 Agent 授权");
      assert.equal(await unchosen.isChecked(), false, "未选中的其他组件不得进入当前会话");
      await chosen.check();
      await page.waitForTimeout(100);
      assert.equal(await chosen.isChecked(), true);

      for (const project of [
        { id: "assistant-creation-authorization-project-b", title: "隔离工程 B" },
        { id: "assistant-creation-authorization-project", title: "素材授权验收工程" },
      ]) {
        await page.evaluate(({ id, title }) => {
          window.dispatchEvent(new CustomEvent("assistant-auth-test-project", { detail: { id, title } }));
        }, project);
        await page.waitForTimeout(200);
        const checkbox = workbench.getByRole("checkbox", { name: "授权组件 用户选中徽章" });
        if (project.id.endsWith("-project-b")) {
          await checkbox.waitFor();
          assert.equal(await checkbox.isChecked(), false, "授权选择不得泄漏到另一工程");
        } else {
          await page.waitForFunction(() => {
            const input = [...document.querySelectorAll('input[type="checkbox"]')]
              .find(element => element.getAttribute("aria-label") === "授权组件 用户选中徽章");
            return input?.checked === true;
          });
        }
      }

      await workbench.getByLabel("向大模型助手提问", { exact: true }).fill("请用已授权的徽章素材重新设计标题卡。");
      await workbench.getByRole("button", { name: "生成创作提案" }).click();
      await page.waitForFunction(() => {
        const send = document.querySelector("[data-testid='assistant-creation-workbench-chat'] [data-help-key='assistant.send']");
        const status = document.querySelector("[data-testid='assistant-creation-workbench-chat'] .assistant-inline-status");
        return Boolean(send?.textContent?.includes("生成中") || status?.textContent || document.querySelector(
          "[data-testid='assistant-creation-workbench-studio'] [data-testid='assistant-creation-draft']",
        ));
      }, null, { timeout: 10_000 });
      report.afterSubmit = await workbench.evaluate(element => ({
        status: element.querySelector(".assistant-inline-status")?.textContent ?? null,
        historyStatus: element.querySelector(".assistant-history-status")?.textContent ?? null,
        sendLabel: element.querySelector("[data-help-key='assistant.send']")?.textContent ?? null,
        selected: [...element.querySelectorAll('input[type="checkbox"][aria-checked], input[type="checkbox"]')]
          .map(input => ({ label: input.getAttribute("aria-label"), checked: input.checked })),
      }));
      await workbench.getByTestId("assistant-creation-draft").waitFor({ timeout: 10_000 });
      await page.waitForFunction(() => Boolean(document.querySelector(
        '[data-testid="assistant-creation-workbench-studio"] [data-testid="assistant-creation-draft"] img',
      )));

      assert(submittedRequest, "创建组件时必须提交模型请求");
      assert.equal(submittedRequest.authorized_components.length, 1,
        "请求只能包含本会话明确勾选的组件");
      const [authorized] = submittedRequest.authorized_components;
      assert.equal(authorized.id, "selected-1", "不应暴露个人库内部 ID");
      assert.equal(authorized.name, "用户选中徽章");
      assert.equal(authorized.assets.length, 1);
      assert.equal(authorized.assets[0].id, "selected-1-badge");
      assert.equal(Object.hasOwn(authorized.assets[0], "bytes"), false,
        "请求只能包含获准素材元数据，不应上传素材字节");
      assert.equal(JSON.stringify(submittedRequest.authorized_components).includes("test-only-secret"), false,
        "凭据不得混入 Agent 的组件授权上下文");
      assert.equal(JSON.stringify(submittedRequest.authorized_components).includes("未选中卡片"), false,
        "未选中组件不得进入 Agent 上下文");
      assert.equal(JSON.stringify(submittedRequest).includes("projectBaseline"), false,
        "工程页面基线必须只留在本机，不发送给模型");
      const imageSource = await workbench.locator(
        '[data-testid="assistant-creation-workbench-studio"] [data-testid="assistant-creation-draft"] img',
      ).getAttribute("src");
      assert.match(imageSource, /^data:image\/png;base64,/,
        "获准素材字节应留在本机并用于草稿预览");
      await workbench.getByRole("button", { name: "预览完整 Runtime 页面", exact: true }).click();
      const runtimePreview = workbench.locator('[data-testid="assistant-creation-runtime-preview"]');
      await runtimePreview.locator(".assistant-creation-runtime-preview-stage").waitFor();
      const loadingStage = await runtimePreview.locator(".assistant-creation-runtime-preview-stage")
        .evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
      try {
        await runtimePreview.locator('[data-preview-phase="ready"]').waitFor({ timeout: 20_000 });
      } catch (error) {
        report.runtimePreviewDebug = await runtimePreview.evaluate(element => {
          const viewport = element.querySelector(".renpy-editor-runtime-viewport");
          const iframe = viewport?.querySelector("iframe");
          return {
            phase: viewport?.getAttribute("data-preview-phase") ?? null,
            page: viewport?.getAttribute("data-preview-page") ?? null,
            iframeSrc: iframe?.getAttribute("src") ?? null,
            iframeDocumentUrl: iframe?.contentDocument?.URL ?? null,
            iframeTitle: iframe?.contentDocument?.title ?? null,
            iframeBodyText: iframe?.contentDocument?.body?.innerText?.slice(0, 1200) ?? null,
            previewStatus: element.querySelector(".renpy-preview-status")?.textContent ?? null,
            statusText: element.innerText.slice(0, 1600),
          };
        });
        throw error;
      }
      const readyStage = await runtimePreview.locator(".assistant-creation-runtime-preview-stage")
        .evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
      assert(loadingStage.width > 0 && loadingStage.height > 0,
        `懒加载 Runtime 前应预留可见预览空间：${JSON.stringify(loadingStage)}`);
      assert(Math.abs(readyStage.width - loadingStage.width) <= 1
        && Math.abs(readyStage.height - loadingStage.height) <= 1,
      `Runtime 就绪不得导致预览容器跳动：加载中 ${JSON.stringify(loadingStage)}，就绪后 ${JSON.stringify(readyStage)}`);
      report.runtimePreviewGeometry = { loadingStage, readyStage };
      const runtimeFrame = runtimePreview.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
      await runtimeFrame.getByTestId("runtime-custom-component").waitFor({ timeout: 10_000 });
      const runtimeAsset = runtimeFrame.getByTestId("runtime-custom-component").getByRole("img", { name: "徽章" });
      await runtimeAsset.waitFor();
      assert.notEqual(await runtimeAsset.getAttribute("data-asset-missing"), "true",
        "真实 Runtime 草稿预览必须解析本会话授权素材");
      const mergePanel = workbench.getByTestId("assistant-creation-project-merge");
      const mergeButton = mergePanel.getByTestId("assistant-creation-merge-button");
      await mergeButton.scrollIntoViewIfNeeded();
      await mergeButton.click();
      await mergePanel.getByText(/已将“徽章标题卡”应用到“title”页面/).waitFor({ timeout: 5000 });
      const mergedProject = await page.evaluate(() => {
        const store = window.__assistantCreationTestStore;
        const state = store.getState();
        const layout = state.settings.runtimeUILayout;
        const title = layout.screens.find(screen => screen.screen_id === "title");
        const component = title.components.find(item => item.label === "徽章标题卡");
        return {
          activeType: state.settings.runtimeUILayoutProfiles.activeType,
          component: component && {
            id: component.component_id,
            rect: component.rect,
            assetId: component.customComponent.root.children[0].assetId,
          },
          projectAsset: component
            ? state.assetManifest.find(asset => asset.asset_id === component.customComponent.root.children[0].assetId)
            : null,
          personalSourceStillUnchanged: component?.customComponent.root.children[0].assetId !== "selected-1-badge",
        };
      });
      assert.equal(mergedProject.activeType, "renpy", "合并只能进入活动的进阶布局");
      assert.deepEqual(mergedProject.component.rect, { x: 35, y: 68, width: 30, height: 12 },
        "合并使用审核面板内确认的布局位置");
      assert(mergedProject.projectAsset, "引用素材必须一起复制进工程素材清单");
      assert.equal(mergedProject.projectAsset.metadata.data_url, imageSource,
        "工程导出所用素材字节必须与本地授权预览保持一致");
      assert(mergedProject.personalSourceStillUnchanged,
        "工程中的素材引用不得沿用个人组件库内部编号");
      assert.equal(await mergePanel.getByTestId("assistant-creation-merge-button").count(), 0,
        "同一草稿成功合并后不得重复应用");
      await workbench.getByText(/审核记录已保存到本机/).waitFor();
      const savedConversation = await page.evaluate(async () => {
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
            resolve(request.result.find(item => item.projectId === "assistant-creation-authorization-project"
              && item.mode === "creation" && item.creationDraft?.projectMerge));
          };
          request.onerror = () => reject(request.error);
        });
      });
      assert.equal(savedConversation.creationDraft.projectBaseline.projectId,
        "assistant-creation-authorization-project",
        "工程归属及页面基线需留在本机会话历史中以支持恢复审核");
      assert.equal(typeof savedConversation.creationDraft.projectBaseline.screens.title, "string");
      assert.equal(savedConversation.creationDraft.projectMerge.componentId, mergedProject.component.id);
      report.cases.push({
        case: "reviewed-creation-draft-merges-into-owned-advanced-layout-with-remapped-assets",
        status: "PASS",
        componentId: mergedProject.component.id,
        projectAssetId: mergedProject.component.assetId,
        assetByteMatch: true,
        localBaselineAndMergeRecordPersisted: true,
      });
      await workbench.getByTestId("assistant-creation-draft")
        .getByRole("button", { name: "保存到个人组件库" }).click();
      await workbench.getByTestId("assistant-creation-draft")
        .getByRole("button", { name: "已保存到个人组件库" }).waitFor();
      const savedRecord = await page.evaluate(async () => {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open("agentvn-personal-component-library");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return await new Promise((resolve, reject) => {
          const transaction = database.transaction("components", "readonly");
          const request = transaction.objectStore("components").getAll();
          request.onsuccess = () => {
            database.close();
            resolve(request.result.find(item => item.name === "徽章标题卡"));
          };
          request.onerror = () => reject(request.error);
        });
      });
      assert(savedRecord, "保存草稿应在个人组件库创建新组件记录");
      assert.equal(savedRecord.assets.length, 1, "保存时必须保留被引用图片依赖");
      assert.equal(savedRecord.assets[0].id, "selected-1-badge");
      assert.equal(savedRecord.definition.root.children[0].assetId, "selected-1-badge",
        "组件结构引用与图片依赖 ID 必须一致");
      report.cases.push({
        case: "explicit-component-consent-is-session-and-project-scoped-with-local-asset-preview",
        status: "PASS",
        authorizedComponentCount: submittedRequest.authorized_components.length,
        transmittedAssetBytes: false,
        savedAssetCount: savedRecord.assets.length,
      });

      const measurements = [];
      for (const viewport of [
        { width: 1920, height: 1080 },
        { width: 2560, height: 1440 },
        { width: 3840, height: 2160 },
      ]) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(() => {
          const element = document.querySelector("[data-testid='assistant-creation-workbench-window']");
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
        }, null, { timeout: 3000 });
        const geometry = await workbench.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const studio = element.querySelector("[data-testid='assistant-creation-workbench-studio']");
          const rectStudio = studio.getBoundingClientRect();
          const mergePanel = studio.querySelector("[data-testid='assistant-creation-project-merge']");
          const mergeRect = mergePanel.getBoundingClientRect();
          return {
            window: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            studio: { left: rectStudio.left, top: rectStudio.top, right: rectStudio.right, bottom: rectStudio.bottom },
            viewport: { width: innerWidth, height: innerHeight },
            documentWidth: document.documentElement.scrollWidth,
            studioClientWidth: studio.clientWidth,
            studioScrollWidth: studio.scrollWidth,
            mergePanel: {
              left: mergeRect.left,
              right: mergeRect.right,
              clientWidth: mergePanel.clientWidth,
              scrollWidth: mergePanel.scrollWidth,
            },
          };
        });
        assert(geometry.window.left >= 0 && geometry.window.top >= 0
          && geometry.window.right <= viewport.width && geometry.window.bottom <= viewport.height,
        `创造工作台不得越出 ${viewport.width}×${viewport.height} 视口：${JSON.stringify(geometry)}`);
        assert(geometry.documentWidth <= viewport.width + 1,
          `授权组件选择不得造成页面横向溢出：${JSON.stringify(geometry)}`);
        assert(geometry.studioScrollWidth <= geometry.studioClientWidth + 1,
          `授权列表不得造成预览侧栏横向溢出：${JSON.stringify(geometry)}`);
        assert(geometry.mergePanel.left >= geometry.studio.left - 1
          && geometry.mergePanel.right <= geometry.studio.right + 1
          && geometry.mergePanel.scrollWidth <= geometry.mergePanel.clientWidth + 1,
        `草稿合并审核区域不得裁切或横向溢出：${JSON.stringify(geometry)}`);
        measurements.push(geometry);
      }
      report.measurements = measurements;

      const dprContext = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 2,
      });
      await dprContext.addInitScript(() => localStorage.clear());
      const dprPage = await dprContext.newPage();
      await dprPage.route("**/api/assistant/creation/processes**", async route => {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ processes: [] }),
        });
      });
      await dprPage.goto(`${server.url}/assistant-creation-authorization-harness.html`);
      await dprPage.getByTestId("authorization-harness-ready").filter({ hasText: "ready" }).waitFor();
      await dprPage.getByRole("button", { name: "打开创造工作台" }).click();
      const dprWorkbench = dprPage.getByTestId("assistant-creation-workbench-window");
      await dprWorkbench.getByTestId("assistant-creation-workbench-studio").waitFor();
      const dprGeometry = await dprWorkbench.evaluate(element => {
        const windowRect = element.getBoundingClientRect();
        const studio = element.querySelector("[data-testid='assistant-creation-workbench-studio']");
        return {
          dpr: devicePixelRatio,
          window: { left: windowRect.left, top: windowRect.top, right: windowRect.right, bottom: windowRect.bottom },
          studioClientWidth: studio.clientWidth,
          studioScrollWidth: studio.scrollWidth,
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      assert.equal(dprGeometry.dpr, 2);
      assert(dprGeometry.window.left >= 0 && dprGeometry.window.top >= 0
        && dprGeometry.window.right <= 1920 && dprGeometry.window.bottom <= 1080,
      `DPR=2 下工作台不得越出 1920×1080：${JSON.stringify(dprGeometry)}`);
      assert(dprGeometry.studioScrollWidth <= dprGeometry.studioClientWidth + 1
        && dprGeometry.documentWidth <= 1920,
      `DPR=2 下预览区不得横向溢出：${JSON.stringify(dprGeometry)}`);
      report.dpr2 = dprGeometry;
      await dprContext.close();
      await page.screenshot({ path: path.join(output, "authorized-component-workbench.png") });
      assert.deepEqual(pageErrors, [], "授权素材流程不能产生前端异常");
      await context.close();
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.submittedRequest = typeof submittedRequest === "undefined" ? null : submittedRequest;
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
