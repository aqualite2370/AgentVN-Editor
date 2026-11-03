"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { startOwnedCreationApi, startOwnedCreationSidecar } = require("./lib/owned-creation-api.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(process.env.AGENTVN_WORKSPACE_OUTPUT || path.join(root, "output/playwright"), "assistant-creation-element-edit", runId);
const report = { runId, status: "RUNNING", cases: [] };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  let creationApi;
  try {
    if (process.env.ASSISTANT_CREATION_REAL_BACKEND === "1") {
      creationApi = process.env.ASSISTANT_CREATION_SIDECAR_EXE
        ? await startOwnedCreationSidecar(output, process.env.ASSISTANT_CREATION_SIDECAR_EXE)
        : await startOwnedCreationApi(output);
      report.creationApi = { pid: creationApi.pid, database: creationApi.database, mode: creationApi.mode,
        executable: creationApi.executable, exeSha256: creationApi.exeSha256, modelHostPid: creationApi.modelHostPid };
    }
    server = await startOwnedViteServer({
      root: path.join(root, "editor"),
      port: Number(process.env.ASSISTANT_ELEMENT_EDIT_PORT || 6953),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await context.addInitScript(() => localStorage.clear());
      const page = await context.newPage();
      const pageErrors = [];
      const creationRequests = [];
      const routeErrors = [];
      report.apiForward = [];
      let closingContext = false;
      await page.route("**/api/assistant/creation/processes**", async route => {
        const request = route.request();
        const url = new URL(request.url());
        const base = "/api/assistant/creation/processes";
        if (creationApi) {
          creationApi.assertAlive();
          let payload;
          if (request.method() === "POST" && url.pathname === base) {
            payload = request.postDataJSON();
            creationRequests.push(payload);
            payload = structuredClone(payload);
            payload.request.provider_selection.base_url = creationApi.modelUrl;
          }
          try {
            const response = await fetch(`${creationApi.apiUrl}${url.pathname}${url.search}`, {
              method: request.method(),
              headers: { "content-type": "application/json" },
              ...(payload ? { body: JSON.stringify(payload) } : {}),
              signal: AbortSignal.timeout(10000),
            });
            const body = await response.text();
            report.apiForward.push({ method: request.method(), path: url.pathname, status: response.status });
            if (!closingContext && !page.isClosed()) {
              await route.fulfill({ status: response.status, contentType: "application/json", body,
                headers: { "access-control-allow-origin": server.url, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" } });
            }
          } catch (error) {
            if (!closingContext && !page.isClosed()) {
              routeErrors.push(String(error));
              report.routeErrors = [...routeErrors];
            }
          }
          return;
        }
        if (url.pathname === base && request.method() === "POST") {
          const payload = request.postDataJSON();
          creationRequests.push(payload);
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
        const processId = decodeURIComponent(url.pathname.slice(base.length + 1));
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            id: processId,
            projectId: "assistant-creation-element-edit-project",
            projectTitle: "现有控件修改验收工程",
            conversationId: creationRequests.at(-1)?.conversation_id,
            status: "completed",
            submittedAt: Date.now() - 10,
            finishedAt: Date.now(),
            result: {
              edits: [{
                target_id: "target-1",
                screen_id: "title",
                label: "进入故事",
                rect: { x: 44, y: 66, width: 18, height: 9 },
              }],
            },
          }),
        });
      });
      page.on("pageerror", error => pageErrors.push(String(error)));
      await page.goto(`${server.url}/assistant-creation-element-edit-harness.html`);
      await page.getByTestId("open-element-edit-workbench").click();
      const workbench = page.getByTestId("assistant-creation-workbench-window");
      await workbench.getByTestId("assistant-creation-authorized-element-targets").waitFor();
      assert.match(await workbench.innerText(), /修改现有(?:布局)?控件/,
        "创造工作台应明确说明可以修改现有控件");
      assert.match(await page.getByTestId("assistant-creation-capabilities").innerText(), /已授权控件提案/,
        "能力说明不得把控件修改误称为仅有组件草稿");
      await workbench.getByRole("button", { name: "生成创作提案", exact: true }).waitFor();
      const checkbox = workbench.getByRole("checkbox", { name: "授权修改 开始游戏" });
      assert.equal(await checkbox.isChecked(), false, "现有布局控件必须默认不向 Agent 授权");
      await checkbox.check();
      assert.equal(await checkbox.isChecked(), true, "用户应能明确选择一个现有布局控件授权给当前请求");
      await page.getByTestId("switch-to-element-edit-project-b").click();
      await page.waitForFunction(() =>
        window.__assistantElementEditTestStore.getState().projectId === "assistant-creation-element-edit-project-b");
      const projectBCheckbox = workbench.getByRole("checkbox", { name: "授权修改 开始游戏" });
      assert.equal(await projectBCheckbox.isChecked(), false,
        "授权属于当前工程和单次请求；切换工程后不能沿用相同控件 ID 的授权");
      await page.getByTestId("switch-to-element-edit-project-a").click();
      await page.waitForFunction(() =>
        window.__assistantElementEditTestStore.getState().projectId === "assistant-creation-element-edit-project");
      assert.equal(await workbench.getByRole("checkbox", { name: "授权修改 开始游戏" }).isChecked(), false,
        "A→B→A 后不得复活 A 工程此前的临时授权");
      await page.getByTestId("switch-to-element-edit-project-b").click();
      await page.waitForFunction(() =>
        window.__assistantElementEditTestStore.getState().projectId === "assistant-creation-element-edit-project-b");
      const projectBRequest = page.waitForRequest(request =>
        request.url().includes("/api/assistant/creation/processes") && request.method() === "POST");
      await workbench.getByLabel("向大模型助手提问", { exact: true }).fill("修改开始游戏按钮文字");
      await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
      const unauthorizedProjectBRequest = await projectBRequest;
      const projectBPayload = unauthorizedProjectBRequest.postDataJSON();
      assert.equal(projectBPayload.request.authorized_targets?.length ?? 0, 0,
        "切换工程后发出的请求不得携带旧工程的控件授权");
      report.cases.push({
        case: "authorization-is-cleared-across-project-switch-and-a-b-a-return",
        status: "PASS",
      });

      await page.reload();
      await page.getByTestId("open-element-edit-workbench").click();
      await workbench.getByTestId("assistant-creation-authorized-element-targets").waitFor();
      const freshProjectACheckbox = workbench.getByRole("checkbox", { name: "授权修改 开始游戏" });
      assert.equal(await freshProjectACheckbox.isChecked(), false,
        "重新载入后不应恢复尚未提交的临时控件授权");
      await freshProjectACheckbox.check();
      report.cases.push({ case: "user-can-explicitly-authorize-an-existing-layout-control", status: "PASS" });
      const viewportChecks = [];
      for (const [width, height] of desktopViewports) {
        const viewport = { width, height };
        await page.setViewportSize(viewport);
        await checkbox.scrollIntoViewIfNeeded();
        const geometry = await workbench.evaluate(element => {
          const studio = element.querySelector('[data-testid="assistant-creation-workbench-studio"]');
          const authorization = element.querySelector('[data-testid="assistant-creation-authorized-element-targets"]');
          const target = authorization.querySelector('input[aria-label="授权修改 开始游戏"]');
          const workbenchRect = element.getBoundingClientRect();
          const studioRect = studio.getBoundingClientRect();
          const authorizationRect = authorization.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const hit = document.elementFromPoint(targetRect.left + targetRect.width / 2,
            targetRect.top + targetRect.height / 2);
          return {
            viewportWidth: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            window: { left: workbenchRect.left, right: workbenchRect.right },
            studio: { left: studioRect.left, right: studioRect.right, width: studioRect.width },
            authorization: {
              left: authorizationRect.left, right: authorizationRect.right,
              width: authorizationRect.width, height: authorizationRect.height,
              scrollWidth: authorization.scrollWidth, clientWidth: authorization.clientWidth,
            },
            targetHit: hit === target || target.contains(hit)
              || hit?.closest("label") === target.closest("label"),
            targetVisible: targetRect.width > 0 && targetRect.height > 0
              && targetRect.left >= 0 && targetRect.right <= window.innerWidth
              && targetRect.top >= 0 && targetRect.bottom <= window.innerHeight,
          };
        });
        viewportChecks.push({ ...viewport, ...geometry });
        assert(geometry.window.left >= 0 && geometry.window.right <= viewport.width + 1,
          `创造工作台应位于 ${viewport.width}×${viewport.height} 视口内`);
        assert(geometry.documentWidth <= viewport.width,
          `创造工作台在 ${viewport.width}×${viewport.height} 不应产生页面横向溢出`);
        assert(geometry.authorization.width > 0
          && geometry.authorization.width <= geometry.studio.width + 1,
        `授权控件面板在 ${viewport.width}×${viewport.height} 不应被压缩到容器外`);
        assert(geometry.authorization.scrollWidth <= geometry.authorization.clientWidth + 2,
          `授权控件面板在 ${viewport.width}×${viewport.height} 不得发生横向裁切`);
        assert(geometry.targetVisible && geometry.targetHit,
          `授权复选框在 ${viewport.width}×${viewport.height} 必须完整可见且真实命中`);
        await checkbox.uncheck();
        await checkbox.check();
        assert.equal(await checkbox.isChecked(), true,
          `授权复选框在 ${viewport.width}×${viewport.height} 必须能被真实点击切换`);
      }
      report.viewportChecks = viewportChecks;
      await page.setViewportSize({ width: 1920, height: 1080 });
      await checkbox.scrollIntoViewIfNeeded();
      assert.equal(await checkbox.isChecked(), true, "视口适配不得重置或吞掉用户的当前授权操作");
      const originalComponent = await page.evaluate(() => {
        const store = window.__assistantElementEditTestStore;
        const layout = store.getState().settings.runtimeUILayout;
        const component = layout.screens.find(screen => screen.screen_id === "title")
          .components.find(item => item.label === "开始游戏");
        return structuredClone(component);
      });
      await workbench.getByLabel("向大模型助手提问", { exact: true }).fill("把开始游戏改成进入故事并略微调整位置");
      await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
      await workbench.getByTestId("assistant-creation-element-edit-review").waitFor({ timeout: 10_000 });
      assert.equal(creationRequests.length, 2, "切换工程隔离和正式授权请求都应各发送一次");
      const authorizedRequests = creationRequests.filter(payload =>
        payload.request.authorized_targets?.length > 0);
      assert.equal(authorizedRequests.length, 1, "只有用户重新授权后才可提交控件目标");
      const submittedTargets = authorizedRequests[0].request.authorized_targets;
      assert.equal(submittedTargets.length, 1, "创建请求必须只包含用户勾选的控件");
      assert.equal(submittedTargets[0].target_id, "target-1");
      assert.equal(submittedTargets[0].label, "开始游戏");
      assert(!JSON.stringify(authorizedRequests[0]).includes("component_id"),
        "请求中不得泄露工程私有控件 ID");
      assert(!JSON.stringify(authorizedRequests[0]).includes("renpy-title-start"),
        "请求中不得泄露控件实现标识");
      report.cases.push({
        case: "creation-request-contains-only-authorized-minimal-target-context",
        status: "PASS",
      });
      const review = workbench.getByTestId("assistant-creation-element-edit-review");
      assert.match(await review.innerText(), /开始游戏/);
      assert.match(await review.innerText(), /进入故事/);
      const reviewCheckbox = review.getByRole("checkbox", { name: "审核修改 开始游戏" });
      await reviewCheckbox.uncheck();
      await page.getByTestId("switch-to-element-edit-project-b").click();
      await page.waitForFunction(() =>
        window.__assistantElementEditTestStore.getState().projectId === "assistant-creation-element-edit-project-b");
      assert.equal(await workbench.getByTestId("assistant-creation-element-edit-review").count(), 0,
        "切换到 B 工程时不得显示 A 工程的控件修改提案");
      await workbench.getByLabel("向大模型助手提问", { exact: true }).waitFor();
      await page.getByTestId("switch-to-element-edit-project-a").click();
      await page.waitForFunction(() =>
        window.__assistantElementEditTestStore.getState().projectId === "assistant-creation-element-edit-project");
      const projectARestoredReview = workbench.getByTestId("assistant-creation-element-edit-review");
      await projectARestoredReview.waitFor({ timeout: 10_000 });
      assert.equal(await projectARestoredReview
        .getByRole("checkbox", { name: "审核修改 开始游戏" }).isChecked(), false,
      "A→B→A 后必须保存并恢复 A 工程的审核选择");
      await workbench.getByTestId("assistant-new-conversation").click();
      assert.equal(await workbench.getByTestId("assistant-creation-element-edit-review").count(), 0,
        "切换到新会话后不得显示上一个会话的控件修改提案");
      await workbench.locator(".assistant-history-popover > summary").click();
      await workbench.locator(".assistant-history-select")
        .filter({ hasText: "把开始游戏改成进入故事并略微调整位置" }).click();
      const switchedBackReview = workbench.getByTestId("assistant-creation-element-edit-review");
      await switchedBackReview.waitFor();
      assert.equal(await switchedBackReview.getByRole("checkbox", { name: "审核修改 开始游戏" }).isChecked(), false,
        "快速切换会话时应立即保留刚变更的审核选择");
      await page.waitForTimeout(350);
      await page.reload();
      await page.getByTestId("open-element-edit-workbench").click();
      const restoredWorkbench = page.getByTestId("assistant-creation-workbench-window");
      const restoredReview = restoredWorkbench.getByTestId("assistant-creation-element-edit-review");
      await restoredReview.waitFor({ timeout: 10_000 });
      const restoredCheckbox = restoredReview.getByRole("checkbox", { name: "审核修改 开始游戏" });
      assert.equal(await restoredCheckbox.isChecked(), false,
        "刷新后必须保留用户排除的控件修改，不能悄悄重新勾选并应用");
      report.cases.push({
        case: "review-choice-survives-reload-and-new-conversation-is-isolated",
        status: "PASS",
      });
      await restoredWorkbench.getByTestId("assistant-new-conversation").click();
      assert.equal(await restoredWorkbench.getByTestId("assistant-creation-element-edit-review").count(), 0,
        "切换到新会话后不得显示上一个会话的控件修改提案");
      await restoredWorkbench.locator(".assistant-history-popover > summary").click();
      await restoredWorkbench.locator(".assistant-history-select")
        .filter({ hasText: "把开始游戏改成进入故事并略微调整位置" }).click();
      const reopenedReview = restoredWorkbench.getByTestId("assistant-creation-element-edit-review");
      await reopenedReview.waitFor();
      const reopenedCheckbox = reopenedReview.getByRole("checkbox", { name: "审核修改 开始游戏" });
      assert.equal(await reopenedCheckbox.isChecked(), false,
        "切回原会话后应恢复该会话独立的审核选择");
      await reopenedCheckbox.check();
      await reopenedReview.getByRole("button", { name: "预览修改后的 Runtime 页面" }).click();
      await reopenedReview.locator('[data-preview-phase="ready"]').waitFor({ timeout: 20_000 });
      const runtimeFrameElement = await reopenedReview
        .locator('iframe[title="Ren\'Py（进阶）实际页面预览"]').elementHandle();
      const runtimeFrame = await runtimeFrameElement.contentFrame();
      assert(runtimeFrame, "Actual Runtime iframe must have an initialized frame");
      await runtimeFrame.getByTestId("game-state-title").waitFor();
      await settleRuntime(runtimeFrame);
      const runtimeTitle = runtimeFrame.locator("body");
      const runtimeText = await runtimeTitle.innerText();
      report.runtimePreviewText = runtimeText.slice(0, 2000);
      assert.match(runtimeText, /进入故事/,
        "Runtime 预览必须呈现隔离规划结果而非工程原值");
      await page.screenshot({ path: path.join(output, "element-edit-runtime-review-1920x1080.png") });
      await reopenedReview.getByTestId("assistant-creation-merge-element-edits").click();
      await reopenedReview.locator(".assistant-creation-element-edit-actions [role='status']")
        .filter({ hasText: /已将 1 项修改应用/ }).waitFor();
      const merged = await page.evaluate(() => {
        const store = window.__assistantElementEditTestStore;
        const project = store.getState();
        const screen = project.settings.runtimeUILayout.screens.find(item => item.screen_id === "title");
        const component = screen.components.find(item => item.label === "进入故事");
        return {
          component,
          componentId: component?.component_id,
          componentType: component?.component_type,
          rect: component?.rect,
          layoutType: project.settings.runtimeUILayoutProfiles.activeType,
        };
      });
      assert(merged.componentId, "合并必须保留原控件，而不是追加一个假冒按钮");
      assert.equal(merged.componentId, originalComponent.component_id,
        "合并必须保留原 component ID");
      const componentBefore = { ...originalComponent };
      const componentAfter = { ...merged.component };
      delete componentBefore.label;
      delete componentBefore.rect;
      delete componentAfter.label;
      delete componentAfter.rect;
      assert.deepEqual(componentAfter, componentBefore,
        "合并只允许更改授权的 label/rect 字段，控件类型、动作和其他字段必须不变");
      assert.deepEqual(merged.rect, { x: 44, y: 66, width: 18, height: 9 });
      assert.equal(merged.layoutType, "renpy");
      report.cases.push({
        case: "approved-edits-merge-once-and-preserve-control-identity-type-action-and-other-fields",
        status: "PASS",
      });
      assert.deepEqual(pageErrors, [], "授权、生成、预览和应用不能产生前端异常");
      await page.screenshot({ path: path.join(output, "element-edit-applied-1920x1080.png") });
      closingContext = true;
      await page.unrouteAll({ behavior: "wait" });
      assert.deepEqual(routeErrors, [], "生产后端转发不得产生未处理的请求错误");
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
    if (creationApi) {
      report.creationApiCleanup = await creationApi.stop();
      if (report.creationApiCleanup.code !== 0 || !report.creationApiCleanup.apiStopped) {
        report.status = "FAILED";
        process.exitCode = 1;
      }
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(`Evidence: ${output}`);
  }
}

main().catch(() => { process.exitCode = 1; });
