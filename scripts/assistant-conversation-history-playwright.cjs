"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(process.env.AGENTVN_WORKSPACE_OUTPUT || path.join(root, "output/playwright"), "assistant-conversation-history", runId);
const deviceScaleFactor = Number(process.env.ASSISTANT_HISTORY_DPR || 1);
assert([1, 2].includes(deviceScaleFactor), "History acceptance DPR must be 1 or 2");
const reducedMotion = process.env.ASSISTANT_HISTORY_REDUCED_MOTION === "1" ? "reduce" : "no-preference";
const report = { runId, status: "RUNNING", cases: [], deviceScaleFactor, reducedMotion,
  environment: "isolated browser harness; controlled provider responses; not installed-editor or live-model evidence" };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "editor"),
      port: Number(process.env.ASSISTANT_HISTORY_TEST_PORT || 6913),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor, reducedMotion });
      await context.addInitScript(() => {
        if (sessionStorage.getItem("assistant-history-test-initialized")) return;
        localStorage.clear();
        sessionStorage.setItem("assistant-history-test-initialized", "true");
      });
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      let mockedRequests = 0;
      let creationRequests = 0;
      let activeCreationRequests = 0;
      let maxConcurrentCreationRequests = 0;
      const creationRequestOrder = [];
      let queueAStartedResolve;
      let releaseQueueAResolve;
      let queueBFinishedResolve;
      const queueAStarted = new Promise((resolve) => { queueAStartedResolve = resolve; });
      const queueARelease = new Promise((resolve) => { releaseQueueAResolve = resolve; });
      const queueBFinished = new Promise((resolve) => { queueBFinishedResolve = resolve; });
      let creationPayloadSummary = null;
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await page.route("http://127.0.0.1:8278/api/assistant/chat_stream", async (route) => {
        mockedRequests += 1;
        const request = route.request().postDataJSON();
        const answer = `验收回答${mockedRequests}`;
        const body = [
          `event: delta\ndata: ${JSON.stringify(answer)}`,
          `event: final\ndata: ${JSON.stringify({ answer, citations: [] })}`,
          "",
        ].join("\n\n");
        await route.fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" },
          body,
        });
      });
      const creationProcesses = new Map();
      const creationFifo = [];
      let creationWorkerRunning = false;
      const creationResult = (userRequest) => userRequest.includes("注入测试")
        ? {
          name: "不安全组件",
          description: "不得写入",
          html: '<div class="root"><script>alert(1)</script></div>',
          css: ".root { display: block; }",
        }
        : {
          name: "AI 安全组件验收",
          description: "仅包含受限文本与白名单按钮的组件。",
          html: '<div class="root"><span class="title">欢迎</span><button type="button" class="button" aria-label="打开存档" data-action="open_save_load">存档</button></div>',
          css: ".root { display: flex; flex-direction: column; gap: 8px; padding: 12px; } .title { color: #ffffff; font-size: 18px; } .button { color: #ffffff; background-color: #24324d; padding: 8px 12px; border-radius: 4px; }",
        };
      const publicCreationProcess = (process) => {
        const { request: _request, ...publicProcess } = process;
        return publicProcess;
      };
      const pumpCreationQueue = async () => {
        if (creationWorkerRunning) return;
        let process = creationFifo.shift();
        while (process?.status === "cancelled") process = creationFifo.shift();
        if (!process) return;
        creationWorkerRunning = true;
        process.status = "running";
        process.startedAt = Date.now();
        creationRequests += 1;
        const request = process.request;
        const userRequest = String(request.user_request);
        creationRequestOrder.push(userRequest);
        activeCreationRequests += 1;
        maxConcurrentCreationRequests = Math.max(maxConcurrentCreationRequests, activeCreationRequests);
        creationPayloadSummary = {
          keys: Object.keys(request).sort(),
          userRequest: request.user_request,
          messages: request.messages ?? [],
          currentDraft: request.current_draft ?? null,
          providerSelection: request.provider_selection,
        };
        if (userRequest.includes("队列 A")) {
          queueAStartedResolve();
          await queueARelease;
        }
        process.status = process.status === "cancelling" ? "cancelled" : "completed";
        process.finishedAt = Date.now();
        if (process.status === "completed") process.result = creationResult(userRequest);
        activeCreationRequests -= 1;
        creationWorkerRunning = false;
        if (userRequest.includes("队列 B")) queueBFinishedResolve();
        void pumpCreationQueue();
      };
      await page.route("http://127.0.0.1:8278/api/assistant/creation/processes**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const base = "/api/assistant/creation/processes";
        if (url.pathname === base && request.method() === "POST") {
          const payload = request.postDataJSON();
          const process = {
            id: payload.id,
            projectId: payload.project_id,
            projectTitle: payload.project_title,
            conversationId: payload.conversation_id,
            request: payload.request,
            status: "queued",
            submittedAt: Date.now(),
          };
          creationProcesses.set(process.id, process);
          creationFifo.push(process);
          void pumpCreationQueue();
          await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(process) });
          return;
        }
        const match = url.pathname.slice(base.length).match(/^\/([^/]+)(?:\/(cancel))?$/);
        if (url.pathname === base && request.method() === "GET") {
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ processes: [...creationProcesses.values()].map(publicCreationProcess) }),
          });
          return;
        }
        const process = match && creationProcesses.get(decodeURIComponent(match[1]));
        if (!process) {
          await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
          return;
        }
        if (match[2] === "cancel" && request.method() === "POST") {
          if (process.status === "queued") {
            process.status = "cancelled";
            const index = creationFifo.indexOf(process);
            if (index >= 0) creationFifo.splice(index, 1);
          } else if (process.status === "running") process.status = "cancelling";
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(publicCreationProcess(process)),
        });
      });
      await page.goto(`${server.url}/assistant-session-harness.html`);
      await page.getByTestId("active-project").filter({ hasText: "assistant-history-project-a" }).waitFor();
      const input = page.getByLabel("向大模型助手提问", { exact: true });
      await page.waitForFunction(() => {
        const element = document.querySelector('textarea[aria-label="向大模型助手提问"]');
        return Boolean(element && !element.disabled);
      }, { timeout: 10000 });
      assert.notEqual(
        await page.locator(".assistant-history-status").innerText(),
        "正在读取本机会话…",
        "本机会话读取完成后必须清除加载状态文案",
      );
      await input.fill("请说明工程内会话历史是否会保留。");
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page.getByText("验收回答1", { exact: true }).waitFor({ timeout: 10000 });
      await page.reload();

      const restoredAnswer = page.getByText("验收回答1", { exact: true });
      await restoredAnswer.waitFor({ timeout: 5000 });

      await page.getByRole("button", { name: "创造模式", exact: true }).click();
      await page.getByTestId("assistant-creation-capabilities").waitFor();
      assert.equal(await page.getByText("验收回答1", { exact: true }).count(), 0,
        "切入创造模式后不能残留问询内容");
      assert.equal(await page.getByText(
        "AI 只提交隔离的组件或已授权控件提案；个人组件和工程图片仅在你勾选后进入本会话。",
        { exact: true },
      ).count(), 1,
        "创造模式必须明确展示受限能力范围");
      await page.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
      const creationWorkbench = page.getByTestId("assistant-creation-workbench-window");
      await creationWorkbench.waitFor();
      await creationWorkbench.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
      });
      const initialWorkbenchGeometry = await creationWorkbench.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      assert(initialWorkbenchGeometry.left >= 0 && initialWorkbenchGeometry.top >= 0
        && initialWorkbenchGeometry.right <= 1920 && initialWorkbenchGeometry.bottom <= 1080,
      `创造工作台默认位置必须完整位于 1920×1080 视口内：${JSON.stringify(initialWorkbenchGeometry)}`);
      assert(initialWorkbenchGeometry.width <= 1920 * 0.8
        && initialWorkbenchGeometry.height <= 1080 * 0.85,
      `创造工作台默认应保持为可见编辑器画布的浮动窗口，而不是近全屏铺满：${JSON.stringify(initialWorkbenchGeometry)}`);
      const resizeHandle = page.getByRole("separator", { name: "调整创造工作台大小" });
      const resizeBox = await resizeHandle.boundingBox();
      assert(resizeBox, "创造工作台应提供可访问的调整尺寸把手");
      await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 72, resizeBox.y + resizeBox.height / 2 + 48, { steps: 4 });
      await page.mouse.up();
      const resizedWorkbenchGeometry = await creationWorkbench.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      assert(resizedWorkbenchGeometry.width >= initialWorkbenchGeometry.width + 48
        && resizedWorkbenchGeometry.height >= initialWorkbenchGeometry.height + 24,
      `拖动尺寸把手应调整工作台宽高：${JSON.stringify({ initialWorkbenchGeometry, resizedWorkbenchGeometry })}`);
      assert(resizedWorkbenchGeometry.right <= 1920 && resizedWorkbenchGeometry.bottom <= 1080,
        `调整尺寸后工作台不得越界：${JSON.stringify(resizedWorkbenchGeometry)}`);
      const titlebar = creationWorkbench.locator(".assistant-creation-workbench-titlebar");
      const titlebarBox = await titlebar.boundingBox();
      assert(titlebarBox, "创造工作台标题栏应可用于拖动");
      await page.mouse.move(titlebarBox.x + 120, titlebarBox.y + titlebarBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(72, 72, { steps: 5 });
      await page.mouse.up();
      let movedWorkbenchGeometry = await creationWorkbench.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
      assert(movedWorkbenchGeometry.left < resizedWorkbenchGeometry.left
        || movedWorkbenchGeometry.top !== resizedWorkbenchGeometry.top,
      `标题栏拖动至少应沿未受边界约束的轴移动工作台：${JSON.stringify({ resizedWorkbenchGeometry, movedWorkbenchGeometry })}`);
      await page.getByRole("button", { name: "停靠右侧" }).click();
      movedWorkbenchGeometry = await creationWorkbench.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      assert(Math.abs(1920 - movedWorkbenchGeometry.right - 12) <= 1,
        `工作台停靠右侧应留出 12px 安全边距：${JSON.stringify(movedWorkbenchGeometry)}`);
      await page.getByRole("button", { name: "恢复默认位置和尺寸" }).click();
      const defaultedWorkbenchGeometry = await creationWorkbench.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      });
      assert(Math.abs(defaultedWorkbenchGeometry.width - initialWorkbenchGeometry.width) <= 1
        && Math.abs(defaultedWorkbenchGeometry.height - initialWorkbenchGeometry.height) <= 1,
      `恢复默认应同时还原窗口尺寸：${JSON.stringify({ initialWorkbenchGeometry, defaultedWorkbenchGeometry })}`);
      await page.getByRole("button", { name: "最小化工作台" }).click();
      assert.equal(await creationWorkbench.getAttribute("data-minimized"), "true",
        "最小化只应收起面板，不卸载全局任务视图");
      assert.equal(await creationWorkbench.locator("textarea[aria-label='向大模型助手提问']").isVisible(), false,
        "最小化后工作台编辑区不得仍处于可交互状态");
      await page.getByRole("button", { name: "恢复工作台" }).click();
      await creationWorkbench.getByLabel("向大模型助手提问", { exact: true }).waitFor();
      await page.getByRole("button", { name: "停靠左侧" }).click();
      const persistedWorkbenchGeometry = await creationWorkbench.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      });
      await page.getByRole("button", { name: "关闭工作台" }).click();
      await creationWorkbench.waitFor({ state: "detached" });
      await page.reload();
      await page.getByRole("button", { name: "创造模式", exact: true }).click();
      await page.getByTestId("assistant-creation-capabilities").waitFor();
      await page.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
      await creationWorkbench.waitFor();
      await creationWorkbench.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
      });
      const restoredWorkbenchGeometry = await creationWorkbench.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      });
      assert.deepEqual(
        Object.fromEntries(Object.entries(restoredWorkbenchGeometry).map(([key, value]) => [key, Math.round(value)])),
        Object.fromEntries(Object.entries(persistedWorkbenchGeometry).map(([key, value]) => [key, Math.round(value)])),
        "关闭并重新载入页面后应恢复本机保存的窗口位置与尺寸",
      );
      const workbenchViewportGeometry = [];
      for (const [width, height] of desktopViewports) {
        const viewport = { width, height };
        await page.setViewportSize(viewport);
        await page.waitForFunction(() => {
          const windowElement = document.querySelector("[data-testid='assistant-creation-workbench-window']");
          if (!windowElement) return false;
          const rect = windowElement.getBoundingClientRect();
          return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
        });
        const viewportGeometry = await creationWorkbench.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { viewport: { width: innerWidth, height: innerHeight }, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        });
        workbenchViewportGeometry.push(viewportGeometry);
      }
      report.creationWorkbenchViewportGeometry = workbenchViewportGeometry;
      assert.equal(workbenchViewportGeometry.length, 3, "创造工作台几何至少覆盖 1080p、1440p、4K 三类桌面");
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForFunction(() => {
        const element = document.querySelector("[data-testid='assistant-creation-workbench-window']");
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.right <= innerWidth && rect.bottom <= innerHeight;
      });
      const finalResizeBox = await page.getByRole("separator", { name: "调整创造工作台大小" }).boundingBox();
      assert(finalResizeBox, "切换主面板前应能调整工作台尺寸");
      await page.mouse.move(finalResizeBox.x + finalResizeBox.width / 2, finalResizeBox.y + finalResizeBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(finalResizeBox.x + finalResizeBox.width / 2 - 720,
        finalResizeBox.y + finalResizeBox.height / 2 - 260, { steps: 5 });
      await page.mouse.up();
      await page.getByRole("button", { name: "停靠右侧" }).click();
      await page.getByTestId("toggle-primary-assistant").click();
      assert.equal(await creationWorkbench.count(), 1,
        "主助手面板卸载后，独立创造工作台仍应保持挂载");
      await page.screenshot({ path: path.join(output, "creation-workbench-desktop.png") });
      await page.getByLabel("向大模型助手提问", { exact: true }).fill("队列 A：构建第一个隔离组件");
      await page.getByRole("button", { name: "生成创作提案", exact: true }).click();
      await queueAStarted;
      try {
        await page.getByTestId("switch-project").click();
        await page.getByTestId("active-project").filter({ hasText: "assistant-history-project-b" }).waitFor();
        await page.waitForFunction(() => {
          const textarea = document.querySelector('textarea[aria-label="向大模型助手提问"]');
          return Boolean(textarea && !textarea.disabled);
        }, { timeout: 10000 });
        await page.getByLabel("向大模型助手提问", { exact: true }).fill("队列 B：构建第二个隔离组件");
        await page.getByRole("button", { name: "生成创作提案", exact: true }).click();
        const processMonitor = page.getByTestId("assistant-process-monitor");
        await processMonitor.locator('li[data-status="running"]').filter({ hasText: "AI 会话工程 A" }).waitFor();
        await processMonitor.locator('li[data-status="queued"]').filter({ hasText: "AI 会话工程 B" }).waitFor();
        assert.equal(creationRequests, 1,
          "其他工程的创造请求必须排在全局活动进程之后，不能并发调用模型");
        await page.getByRole("button", { name: "关闭工作台" }).click();
        await page.waitForFunction(() =>
          document.querySelector("[data-testid='assistant-creation-workbench-window']")?.getAttribute("aria-hidden") === "true");
        assert.equal(await creationWorkbench.getAttribute("inert"), "",
          "关闭转场开始时工作台应立即退出键盘与指针交互路径");
        await creationWorkbench.waitFor({ state: "detached" });
        const processSnapshotBeforeRelease = JSON.parse(await page.getByTestId("creation-process-snapshot").innerText());
        assert(processSnapshotBeforeRelease.some((process) => process.projectTitle === "AI 会话工程 A" && process.status === "running"),
          "关闭创造工作台不能取消正在运行的全局任务");
        assert(processSnapshotBeforeRelease.some((process) => process.projectTitle === "AI 会话工程 B" && process.status === "queued"),
          "关闭创造工作台不能丢弃全局队列中的任务");
      } finally {
        releaseQueueAResolve();
      }
      await queueBFinished;
      assert.equal(creationRequests, 2, "第一任务结束后必须继续执行排队中的第二工程请求");
      await page.waitForFunction(() => {
        const processes = JSON.parse(document.querySelector("[data-testid='creation-process-snapshot']").textContent);
        return processes
          .filter((process) => ["AI 会话工程 A", "AI 会话工程 B"].includes(process.projectTitle))
          .every((process) => process.status === "completed");
      });
      const processSnapshotAfterFinish = JSON.parse(await page.getByTestId("creation-process-snapshot").innerText());
      assert(processSnapshotAfterFinish
        .filter((process) => ["AI 会话工程 A", "AI 会话工程 B"].includes(process.projectTitle))
        .every((process) => process.status === "completed"),
      `关闭工作台后在途及排队任务仍须成功完成：${JSON.stringify(processSnapshotAfterFinish)}`);
      assert.equal(maxConcurrentCreationRequests, 1, "全局构建队列任何时刻最多运行一个模型请求");
      assert.deepEqual(creationRequestOrder.slice(0, 2), [
        "队列 A：构建第一个隔离组件",
        "队列 B：构建第二个隔离组件",
      ], "排队进程必须遵循提交顺序");
      await page.getByTestId("toggle-primary-assistant").click();
      await page.getByRole("button", { name: "创造模式", exact: true }).click();
      await page.getByTestId("assistant-process-monitor")
        .locator('li[data-status="completed"]').filter({ hasText: "AI 会话工程 B" }).waitFor();
      await page.getByTestId("switch-project").click();
      await page.getByTestId("active-project").filter({ hasText: "assistant-history-project-a" }).waitFor();
      await page.getByRole("button", { name: "新对话", exact: true }).click();
      assert.equal(await page.getByTestId("assistant-creation-draft").count(), 0,
        "新建创造会话不得继承跨工程队列任务草稿");
      const primaryAssistant = page.locator(".assistant-chat-panel:not(.is-creation-workbench-layout)");
      const authorization = primaryAssistant.locator(".assistant-context-details");
      await authorization.locator("summary").click();
      await primaryAssistant.getByTestId("assistant-creation-capability-list")
        .getByText("提交组件与控件修改提案", { exact: true }).waitFor();
      await authorization.locator("summary").click();
      assert.equal(await page.getByRole("button", { name: "导入工程素材", exact: true }).count(), 0,
        "未授权的工程素材不能出现在创造 Agent 的工具栏");
      await authorization.locator("summary").click();
      assert.equal(await authorization.evaluate(element => element.open), true,
        "授权说明必须在用户展开后显示");
      const authorizationText = await primaryAssistant.getByTestId("assistant-creation-capability-list").innerText();
      assert(authorizationText.includes("不会读取工程图、工程文件、路径、密钥或未授权资源"),
        `授权说明展开后必须包含密钥边界说明：${authorizationText}`);
      await authorization.locator("summary").click();
      await page.getByLabel("向大模型助手提问", { exact: true }).fill("生成安全组件草稿：一个标题和存档按钮");
      await page.getByRole("button", { name: "生成创作提案", exact: true }).click();
      await page.getByTestId("assistant-creation-draft").waitFor({ timeout: 10000 });
      assert.equal(await page.getByTestId("assistant-creation-draft")
        .getByText("仅包含受限文本与白名单按钮的组件。", { exact: true }).count(), 1,
        "通过安全结构解析的模型结果应形成隔离草稿");
      const draftCard = page.getByTestId("assistant-creation-draft");
      await draftCard.getByText("审核组件结构与权限", { exact: true }).click();
      await draftCard.getByTestId("assistant-draft-actions")
        .getByText("打开存档/读档", { exact: true }).waitFor();
      await draftCard.getByLabel("组件源码（只读文本）")
        .getByText(/data-action="open_save_load"/).waitFor();
      assert.equal(await draftCard.getByText("隔离草稿 · 尚未应用到工程", { exact: true }).count(), 1,
        "草稿审核必须明确尚未写入工程");
      const desktopGeometry = [];
      for (const [width, height] of desktopViewports) {
        const viewport = { width, height };
        await page.setViewportSize(viewport);
        const geometry = await page.evaluate(() => {
          const panel = document.querySelector(".assistant-chat-panel").getBoundingClientRect();
          const draft = document.querySelector("[data-testid='assistant-creation-draft']").getBoundingClientRect();
          return {
            viewport: { width: innerWidth, height: innerHeight },
            documentWidth: document.documentElement.scrollWidth,
            panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom },
            processMonitor: (() => {
              const element = document.querySelector("[data-testid='assistant-process-monitor']");
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            })(),
            draft: { left: draft.left, right: draft.right, top: draft.top, bottom: draft.bottom },
            saveButtonVisible: document.querySelector("[data-testid='assistant-creation-draft'] button").getBoundingClientRect().width > 0,
          };
        });
        desktopGeometry.push(geometry);
        assert(geometry.documentWidth <= viewport.width + 1,
          `创造工作区在 ${viewport.width}×${viewport.height} 不得横向溢出：${JSON.stringify(geometry)}`);
        assert(geometry.panel.left >= -1 && geometry.panel.right <= viewport.width + 1,
          `助手面板在宽桌面必须完整落入视口：${JSON.stringify(geometry)}`);
        assert(geometry.processMonitor
          && geometry.processMonitor.left >= geometry.panel.left - 1
          && geometry.processMonitor.right <= geometry.panel.right + 1,
        `全局进程监视器不得横向溢出助手面板：${JSON.stringify(geometry)}`);
        assert(geometry.draft.left >= geometry.panel.left - 1 && geometry.draft.right <= geometry.panel.right + 1,
          `草稿卡片不得溢出助手面板：${JSON.stringify(geometry)}`);
        assert(geometry.saveButtonVisible, "草稿审核/保存操作必须可见");
      }
      report.creationDesktopGeometry = desktopGeometry;
      report.cases.push({
        case: "creation-mode-builds-isolated-component-draft-and-exposes-safe-review-before-save",
        status: "PASS",
      });
      await page.screenshot({ path: path.join(output, "creation-mode-3840x2160.png"), fullPage: true });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.getByTestId("assistant-creation-draft").scrollIntoViewIfNeeded();
      const creationReviewGeometry = await page.evaluate(() => {
        const draft = document.querySelector("[data-testid='assistant-creation-draft']").getBoundingClientRect();
        const panel = document.querySelector(".assistant-chat-panel").getBoundingClientRect();
        return {
          viewport: { width: innerWidth, height: innerHeight },
          documentWidth: document.documentElement.scrollWidth,
          panel: { left: panel.left, right: panel.right },
          processMonitor: document.querySelector("[data-testid='assistant-process-monitor']")?.getBoundingClientRect().toJSON() ?? null,
          draft: { left: draft.left, right: draft.right, width: draft.width },
          saveButtonWidth: document.querySelector("[data-testid='assistant-creation-draft'] footer button").getBoundingClientRect().width,
        };
      });
      report.creationReviewGeometry = creationReviewGeometry;
      assert(creationReviewGeometry.documentWidth <= creationReviewGeometry.viewport.width + 1,
        `创造工作区不得横向溢出：${JSON.stringify(creationReviewGeometry)}`);
      assert(creationReviewGeometry.draft.left >= -1 && creationReviewGeometry.draft.right <= creationReviewGeometry.viewport.width + 1,
        `草稿卡片不得越界：${JSON.stringify(creationReviewGeometry)}`);
      assert(creationReviewGeometry.processMonitor
        && creationReviewGeometry.processMonitor.left >= creationReviewGeometry.panel.left - 1
        && creationReviewGeometry.processMonitor.right <= creationReviewGeometry.panel.right + 1,
      `全局进程监视器不得溢出面板：${JSON.stringify(creationReviewGeometry)}`);
      assert(creationReviewGeometry.saveButtonWidth > 0, "草稿保存操作必须可见可点");
      await page.screenshot({ path: path.join(output, "creation-review-1920x1080.png"), fullPage: true });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.getByRole("button", { name: "保存到个人组件库", exact: true }).click();
      await page.getByText("已保存到本机个人组件库", { exact: true }).waitFor({ timeout: 5000 });
      await page.getByLabel("向大模型助手提问", { exact: true }).fill("注入测试：执行脚本");
      await page.getByRole("button", { name: "生成创作提案", exact: true }).click();
      await page.locator(".assistant-inline-status")
        .getByText(/未创建草稿：.*不在安全子集中/).waitFor({ timeout: 10000 });
      assert.equal(await page.getByTestId("assistant-creation-draft")
        .getByRole("heading", { name: "AI 安全组件验收", exact: true }).count(), 1,
        "拒绝不安全修改时须保留上一份有效草稿");
      assert.deepEqual(creationPayloadSummary.keys,
        ["agent_tools", "authorized_assets", "authorized_components", "authorized_targets", "current_draft", "messages", "provider_selection", "user_request"],
        "创造接口只接收本会话明确授权的组件/控件上下文、当前需求、会话消息、可选草稿和模型连接");
      assert.equal(creationPayloadSummary.providerSelection.api_key, "browser-test-only-key",
        "连接凭据只作为模型连接配置传给本机后端");
      assert(creationPayloadSummary.userRequest.includes("注入测试"),
        "结构化接口传递当前创造需求");
      assert(!JSON.stringify(creationPayloadSummary).includes("assistant-history-project-a"),
        "创造 Agent 请求不得披露工程 ID");
      assert(!JSON.stringify(creationPayloadSummary).includes("AI 会话工程 A"),
        "创造 Agent 请求不得披露工程元数据");
      await page.reload();
      await page.getByRole("button", { name: "创造模式", exact: true }).click();
      await page.getByTestId("assistant-creation-draft").waitFor({ timeout: 5000 });
      await page.getByTestId("assistant-creation-draft")
        .getByRole("button", { name: "已保存到个人组件库", exact: true }).waitFor();
      assert.equal(creationRequests, 4, "跨工程队列、创建与拒绝四个草稿请求必须使用结构化创造接口");
      assert.equal(mockedRequests, 1, "问询历史恢复不能重复请求模型");
      await page.getByRole("button", { name: "新对话", exact: true }).click();
      assert.equal(await page.getByTestId("assistant-creation-draft").count(), 0,
        "新建创造会话不得继承或覆盖上一会话草稿");
      await page.locator(".assistant-history-popover > summary").click();
      await page.locator(".assistant-history-menu .assistant-history-item:not(.is-archived) .assistant-history-select")
        .filter({ hasText: "生成安全组件草稿：一个标题和存档按钮" }).click();
      await page.getByTestId("assistant-creation-draft").waitFor();

      await page.getByRole("button", { name: "问询模式", exact: true }).click();
      await page.getByText("验收回答1", { exact: true }).waitFor();
      assert.equal(await page.getByTestId("assistant-creation-capabilities").count(), 0,
        "问询模式不能暴露创造 Agent 能力");
      assert.equal(await page.getByTestId("assistant-creation-draft").count(), 0,
        "切回问询后不能残留创造草稿");

      await page.getByTestId("seed-creation-history").click();
      await page.waitForFunction(() => {
        const value = document.querySelector('[data-testid="mode-isolation-summary"]').textContent;
        return Boolean(value);
      });
      const modeSummary = JSON.parse(await page.getByTestId("mode-isolation-summary").innerText());
      assert(modeSummary.inquiry.includes("请说明工程内会话历史是否会保留。"),
        "问询记录必须保留在问询模式分区");
      assert(!modeSummary.inquiry.includes("创造模式隔离样例"),
        "问询模式不能读取创造模式历史");
      assert(modeSummary.creation.includes("创造模式隔离样例"),
        "创造模式历史必须能够独立持久化");
      assert(modeSummary.creation.includes("生成安全组件草稿：一个标题和存档按钮"),
        "AI 创造会话必须与问询历史分开保存");
      await page.getByRole("button", { name: "新对话", exact: true }).click();
      await page.getByText("询问 AgentVN 的编辑方法", { exact: true }).waitFor();
      assert.equal(await page.getByText("验收回答1", { exact: true }).count(), 0,
        "新问询必须与已保存的对话隔离");
      await page.locator(".assistant-history-popover > summary").click();
      await page.locator(".assistant-history-menu .assistant-history-item:not(.is-archived) .assistant-history-select").first().click();
      await page.getByText("验收回答1", { exact: true }).waitFor();

      await page.getByTestId("switch-project").click();
      await page.getByTestId("active-project").filter({ hasText: "assistant-history-project-b" }).waitFor();
      await page.getByText("询问 AgentVN 的编辑方法", { exact: true }).waitFor();
      await page.locator(".assistant-history-popover > summary").click();
      await page.locator(".assistant-history-menu").getByText("尚无已保存的问询。", { exact: true }).waitFor();
      assert.equal(await page.getByText("验收回答1", { exact: true }).count(), 0,
        "切换工程不得显示其他工程的会话");

      await page.getByTestId("switch-project").click();
      await page.getByTestId("active-project").filter({ hasText: "assistant-history-project-a" }).waitFor();
      await page.getByText("验收回答1", { exact: true }).waitFor();
      await page.locator(".assistant-history-popover > summary").click();
      const archiveButton = page.locator(".assistant-history-menu")
        .getByRole("button", { name: "归档 请说明工程内会话历史是否会保留。" });
      await archiveButton.click();
      await page.locator(".assistant-history-menu .assistant-history-item.is-archived .assistant-history-select").waitFor();
      const restoreButton = page.locator(".assistant-history-menu")
        .getByRole("button", { name: "恢复 请说明工程内会话历史是否会保留。" });
      await page.locator(".assistant-history-menu .assistant-history-item.is-archived .assistant-history-select").click();
      await page.getByText("已归档 · 只读历史", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "发送", exact: true }).isDisabled(), true,
        "已归档历史必须只读");
      await page.locator(".assistant-history-popover > summary").click();
      await restoreButton.click();
      await page.getByText("已载入本机历史", { exact: true }).waitFor();

      await page.locator(".assistant-history-popover > summary").click();
      await page.locator(".assistant-history-menu")
        .getByRole("button", { name: "永久删除 请说明工程内会话历史是否会保留。" }).click();
      const deletion = page.getByTestId("editor-delete-confirmation");
      await deletion.waitFor();
      await deletion.getByRole("button", { name: "确认删除", exact: true }).click();
      await deletion.waitFor({ state: "detached" });
      await page.getByText("已永久删除该对话", { exact: true }).waitFor();
      assert.equal(await page.getByText("验收回答1", { exact: true }).count(), 0,
        "永久删除后不能继续在当前视图显示该会话");
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForFunction(() => {
        const trigger = document.querySelector(".assistant-history-popover > summary").getBoundingClientRect();
        const menu = document.querySelector(".assistant-history-menu").getBoundingClientRect();
        return menu.top >= trigger.bottom + 4;
      }, { timeout: 3000 });
      const historyGeometry = await page.evaluate(() => {
        const viewport = { width: innerWidth, height: innerHeight };
        const menu = document.querySelector(".assistant-history-menu").getBoundingClientRect();
        const trigger = document.querySelector(".assistant-history-popover > summary").getBoundingClientRect();
        return {
          viewport,
          documentWidth: document.documentElement.scrollWidth,
          menu: { left: menu.left, right: menu.right, top: menu.top, bottom: menu.bottom },
          trigger: { left: trigger.left, right: trigger.right, top: trigger.top, bottom: trigger.bottom },
        };
      });
      report.historyGeometry = historyGeometry;
      assert(historyGeometry.documentWidth <= historyGeometry.viewport.width + 1,
        `会话历史不得造成横向溢出：${JSON.stringify(historyGeometry)}`);
      assert(historyGeometry.menu.left >= -1
        && historyGeometry.menu.right <= historyGeometry.viewport.width + 1
        && historyGeometry.menu.top >= -1
        && historyGeometry.menu.bottom <= historyGeometry.viewport.height + 1,
      `会话历史面板必须位于视口内：${JSON.stringify(historyGeometry)}`);
      await page.screenshot({ path: path.join(output, "history-1920x1080.png"), fullPage: true });
      await page.getByRole("button", { name: "新对话", exact: true }).waitFor({ timeout: 3000 });
      assert.equal(mockedRequests, 1, "恢复会话不能再次请求模型");
      assert.deepEqual(pageErrors, [], "会话恢复不能产生前端异常");
      assert.deepEqual(consoleErrors, [], "会话恢复不能产生控制台错误");
      report.cases.push({
        case: "assistant-history-persists-isolates-per-project-and-supports-new-archive-restore-delete",
        status: "PASS",
      });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.locator(".assistant-history-popover").evaluate((node) => { node.open = false; });
      await page.screenshot({ path: path.join(output, "conversation-history-1920x1080.png"), fullPage: true });
      await context.close();
    });
    const dprContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    const dprPage = await dprContext.newPage();
    let releaseHandoffResponse;
    let handoffRequestStarted;
    const handoffStarted = new Promise((resolve) => { handoffRequestStarted = resolve; });
    const handoffRelease = new Promise((resolve) => { releaseHandoffResponse = resolve; });
    const handoffProcesses = new Map();
    await dprPage.route("http://127.0.0.1:8278/api/assistant/creation/processes**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const base = "/api/assistant/creation/processes";
      if (url.pathname === base && request.method() === "POST") {
        const payload = request.postDataJSON();
        const process = {
          id: payload.id, projectId: payload.project_id, projectTitle: payload.project_title,
          conversationId: payload.conversation_id, status: "queued", submittedAt: Date.now(),
        };
        handoffProcesses.set(process.id, process);
        handoffRequestStarted();
        await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(process) });
        return;
      }
      if (url.pathname === base && request.method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ processes: [...handoffProcesses.values()] }),
        });
        return;
      }
      const match = url.pathname.slice(base.length).match(/^\/([^/]+)$/);
      const process = match && handoffProcesses.get(decodeURIComponent(match[1]));
      if (!process) {
        await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        return;
      }
      await handoffRelease;
      process.status = "completed";
      process.finishedAt = Date.now();
      process.result = {
        name: "窗口交接草稿",
        description: "主助手发起后在独立工作台完成的草稿。",
        html: '<div class="root"><span class="title">交接成功</span></div>',
        css: ".root { display: flex; padding: 12px; } .title { color: #ffffff; font-size: 18px; }",
      };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(process) });
    });
    await dprPage.goto(`${server.url}/assistant-session-harness.html`);
    await dprPage.getByTestId("active-project").waitFor();
    const modeGeometryBefore = await dprPage.locator(".assistant-mode-switch button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }));
    await dprPage.getByRole("button", { name: "创造模式", exact: true }).click();
    await dprPage.getByLabel("向大模型助手提问", { exact: true }).fill("在窗口交接期间保留生成结果");
    await dprPage.getByRole("button", { name: "生成创作提案", exact: true }).click();
    await handoffStarted;
    await dprPage.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
    const dprWorkbench = dprPage.getByTestId("assistant-creation-workbench-window");
    await dprWorkbench.getByLabel("向大模型助手提问", { exact: true }).waitFor();
    const modeGeometryAfterWorkbenchOpen = await dprPage.locator(".assistant-mode-switch button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }));
    assert.deepEqual(modeGeometryAfterWorkbenchOpen, modeGeometryBefore,
      "打开独立工作台不得改变主助手模式导航几何");
    await dprPage.getByTestId("toggle-primary-assistant").evaluate((button) => button.click());
    await dprPage.waitForFunction(() => document.querySelectorAll(".assistant-chat-panel").length === 1);
    const mirrorPage = await dprContext.newPage();
    await mirrorPage.goto(`${server.url}/assistant-session-harness.html`);
    await mirrorPage.getByTestId("active-project").filter({ hasText: "assistant-history-project-a" }).waitFor();
    await mirrorPage.getByRole("button", { name: "创造模式", exact: true }).click();
    await mirrorPage.getByTestId("assistant-creation-capabilities").waitFor();
    releaseHandoffResponse();
    await dprWorkbench.getByTestId("assistant-creation-draft")
      .getByRole("heading", { name: "窗口交接草稿", exact: true }).waitFor({ timeout: 5000 });
    await mirrorPage.getByTestId("assistant-creation-draft")
      .getByRole("heading", { name: "窗口交接草稿", exact: true }).waitFor({ timeout: 5000 });
    await mirrorPage.close();
    const dprGeometry = await dprPage.evaluate(() => {
      const panel = document.querySelector(".assistant-chat-panel").getBoundingClientRect();
      const processMonitor = document.querySelector("[data-testid='assistant-process-monitor']");
      const buttons = [...document.querySelectorAll(".assistant-mode-switch button")].map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      return {
        dpr: devicePixelRatio,
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom },
        modeButtons: buttons,
        motionPreference: matchMedia("(prefers-reduced-motion: reduce)").matches,
          modeTransitionDuration: Number.parseFloat(getComputedStyle(document.querySelector(".assistant-context-strip")).animationDuration) || 0,
          processMonitorTransitionDuration: processMonitor
            ? Number.parseFloat(getComputedStyle(processMonitor).animationDuration) || 0
            : null,
      };
    });
    report.dpr2Geometry = dprGeometry;
    assert.equal(dprGeometry.dpr, 2, "高 DPI 回归必须确实运行于 DPR=2");
    assert(dprGeometry.motionPreference, "减少动效模式应在测试上下文中生效");
    assert(dprGeometry.documentWidth <= 1921, `DPR=2 下助手工作区不得横向溢出：${JSON.stringify(dprGeometry)}`);
    assert(dprGeometry.panel.left >= -1 && dprGeometry.panel.right <= 1921,
      `DPR=2 下助手工作区不得越界：${JSON.stringify(dprGeometry)}`);
    assert.equal(dprGeometry.modeButtons.length, 0,
      "主助手卸载后，独立创造工作台不得重复显示问询/创造模式导航");
    assert(dprGeometry.modeTransitionDuration <= 0.08,
      "减少动效模式的模式切换反馈不得超过 80ms");
    assert(dprGeometry.processMonitorTransitionDuration !== null
      && dprGeometry.processMonitorTransitionDuration <= 0.08,
    "减少动效模式下全局进程监视器的进入动画不得超过 80ms");
    await dprWorkbench.waitFor();
    await dprWorkbench.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    });
    const dprWorkbenchGeometry = await dprWorkbench.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        dpr: devicePixelRatio,
        animationDuration: Number.parseFloat(getComputedStyle(element).animationDuration) || 0,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      };
    });
    assert.equal(dprWorkbenchGeometry.dpr, 2, "DPR=2 必须覆盖独立创造工作台");
    assert(dprWorkbenchGeometry.rect.left >= 0 && dprWorkbenchGeometry.rect.top >= 0
      && dprWorkbenchGeometry.rect.right <= 1920 && dprWorkbenchGeometry.rect.bottom <= 1080,
    `DPR=2 下独立创造工作台不得越界：${JSON.stringify(dprWorkbenchGeometry)}`);
    assert(dprWorkbenchGeometry.animationDuration <= 0.08,
      `减少动效模式下窗口进入反馈不得超过 80ms：${JSON.stringify(dprWorkbenchGeometry)}`);
    report.creationWorkbenchDpr2Geometry = dprWorkbenchGeometry;
    await dprPage.screenshot({ path: path.join(output, "assistant-creation-dpr2-reduced-motion.png"), fullPage: true });
    await dprContext.close();
    // A small floating window on a 2K desktop tests scrolling without reintroducing obsolete mobile viewports.
    const mobileContext = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 2 });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${server.url}/assistant-session-harness.html`);
    await mobilePage.getByRole("button", { name: "创造模式", exact: true }).waitFor();
    await mobilePage.getByRole("button", { name: "创造模式", exact: true }).click();
    await mobilePage.getByTestId("assistant-creation-capabilities").waitFor();
    await mobilePage.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
    const mobileWorkbench = mobilePage.getByTestId("assistant-creation-workbench-window");
    await mobileWorkbench.waitFor();
    await mobileWorkbench.getByLabel("向大模型助手提问", { exact: true }).waitFor();
    await mobilePage.getByTestId("toggle-primary-assistant").evaluate((button) => button.click());
    await mobilePage.waitForFunction(() => document.querySelectorAll(".assistant-chat-panel").length === 1);
    assert.equal(await mobilePage.locator(".assistant-chat-panel").count(), 1,
      "卸载主助手后，移动端视口只能保留浮动工作台内的唯一助手面板");
    await mobileWorkbench.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    });
    const compactResize = await mobileWorkbench.getByRole("separator", { name: "调整创造工作台大小" }).boundingBox();
    assert(compactResize, "工作台必须提供可命中的尺寸调整控件");
    await mobilePage.mouse.move(compactResize.x + compactResize.width / 2, compactResize.y + compactResize.height / 2);
    await mobilePage.mouse.down();
    await mobilePage.mouse.move(compactResize.x - 2000, compactResize.y - 1000, { steps: 5 });
    await mobilePage.mouse.up();
    const mobileWorkbenchGeometry = await mobileWorkbench.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const content = element.querySelector(".assistant-creation-workbench-content");
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        titlebar: element.querySelector(".assistant-creation-workbench-titlebar").getBoundingClientRect().toJSON(),
        content: { ...content.getBoundingClientRect().toJSON(), clientHeight: content.clientHeight,
          scrollHeight: content.scrollHeight, scrollTop: content.scrollTop },
        chatPanel: element.querySelector(".assistant-chat-panel").getBoundingClientRect().toJSON(),
        inputArea: element.querySelector(".assistant-input-area").getBoundingClientRect().toJSON(),
      };
    });
    report.creationWorkbenchMobileGeometry = mobileWorkbenchGeometry;
    assert(mobileWorkbenchGeometry.documentWidth <= mobileWorkbenchGeometry.viewport.width + 1,
      `窄屏独立工作台不得导致页面横向溢出：${JSON.stringify(mobileWorkbenchGeometry)}`);
    assert(mobileWorkbenchGeometry.rect.left >= 0 && mobileWorkbenchGeometry.rect.top >= 0
      && mobileWorkbenchGeometry.rect.right <= mobileWorkbenchGeometry.viewport.width && mobileWorkbenchGeometry.rect.bottom <= mobileWorkbenchGeometry.viewport.height,
    `窄屏独立工作台必须完整留在视口内：${JSON.stringify(mobileWorkbenchGeometry)}`);
    assert(mobileWorkbenchGeometry.rect.width <= mobileWorkbenchGeometry.viewport.width - 24,
      `独立工作台应留出至少 12px 两侧边距：${JSON.stringify(mobileWorkbenchGeometry)}`);
    await mobileWorkbench.locator(".assistant-input-area").scrollIntoViewIfNeeded();
    const mobileInputGeometry = await mobileWorkbench.evaluate((element) => {
      const content = element.querySelector(".assistant-creation-workbench-content");
      const contentRect = content.getBoundingClientRect();
      const input = element.querySelector(".assistant-input-area");
      const inputRect = input.getBoundingClientRect();
      const ancestorGeometry = [];
      for (let ancestor = input; ancestor && ancestor !== element; ancestor = ancestor.parentElement) {
        const rect = ancestor.getBoundingClientRect();
        const style = getComputedStyle(ancestor);
        ancestorGeometry.push({
          className: typeof ancestor.className === "string" ? ancestor.className : ancestor.tagName,
          top: rect.top,
          bottom: rect.bottom,
          clientHeight: ancestor.clientHeight,
          scrollHeight: ancestor.scrollHeight,
          scrollTop: ancestor.scrollTop,
          overflowY: style.overflowY,
          display: style.display,
          gridTemplateRows: style.gridTemplateRows,
          minHeight: style.minHeight,
          height: style.height,
          position: style.position,
        });
      }
      return {
        content: { top: contentRect.top, bottom: contentRect.bottom, clientHeight: content.clientHeight,
          scrollHeight: content.scrollHeight, scrollTop: content.scrollTop },
        inputArea: { top: inputRect.top, bottom: inputRect.bottom },
        ancestorGeometry,
      };
    });
    assert(mobileInputGeometry.inputArea.top >= mobileInputGeometry.content.top - 1
      && mobileInputGeometry.inputArea.bottom <= mobileInputGeometry.content.bottom + 1,
    `横屏紧凑工作台的输入与提交区必须完整进入浮窗可视区域：${JSON.stringify(mobileInputGeometry)}`);
    if (mobileInputGeometry.content.scrollHeight > mobileInputGeometry.content.clientHeight + 1) {
      assert(mobileInputGeometry.content.scrollTop > 0,
        `正文实际溢出时必须可滚动到输入区：${JSON.stringify(mobileInputGeometry)}`);
    }
    await mobileWorkbench.getByLabel("向大模型助手提问", { exact: true }).fill("仅检查按钮命中，不提交模型请求");
    await mobileWorkbench.getByRole("button", { name: "生成创作提案", exact: true }).click({ trial: true });
    report.creationWorkbenchMobileInputGeometry = mobileInputGeometry;
    await mobilePage.screenshot({ path: path.join(output, "creation-workbench-compact-on-2560x1440.png") });
    await mobileContext.close();
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
