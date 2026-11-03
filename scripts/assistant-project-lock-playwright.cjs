"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/assistant-project-lock", runId);
const report = { runId, status: "RUNNING", cases: [] };
const activeStatuses = new Set(["queued", "running", "cancelling"]);

function installProcessApi(page, state) {
  return page.route("http://127.0.0.1:8278/api/assistant/creation/processes**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const base = "/api/assistant/creation/processes";
    const publicRecord = (record) => {
      const { request: _request, ...result } = record;
      return result;
    };
    if (url.pathname === base && request.method() === "POST") {
      const payload = request.postDataJSON();
      const record = {
        id: payload.id,
        projectId: payload.project_id,
        projectTitle: payload.project_title,
        conversationId: payload.conversation_id,
        status: "running",
        submittedAt: Date.now(),
        startedAt: Date.now(),
        request: payload.request,
      };
      state.processes.set(record.id, record);
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(publicRecord(record)) });
      return;
    }
    if (url.pathname === base && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ processes: [...state.processes.values()].map(publicRecord) }),
      });
      return;
    }
    const match = url.pathname.slice(base.length).match(/^\/([^/]+)(?:\/(cancel))?$/);
    const record = match && state.processes.get(decodeURIComponent(match[1]));
    if (!record) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    if (match[2] === "cancel" && request.method() === "POST") {
      record.status = record.status === "queued" ? "cancelled" : "cancelling";
      if (record.status === "cancelled") record.finishedAt = Date.now();
      else setTimeout(() => {
        record.status = "cancelled";
        record.finishedAt = Date.now();
      }, 300);
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(publicRecord(record)) });
  });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "editor"),
      port: Number(process.env.ASSISTANT_PROJECT_LOCK_TEST_PORT || 6917),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      const state = { processes: new Map() };
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const owner = await context.newPage();
      const observer = await context.newPage();
      await installProcessApi(owner, state);
      await installProcessApi(observer, state);
      await owner.goto(`${server.url}/assistant-project-lock-harness.html`);
      await observer.goto(`${server.url}/assistant-project-lock-harness.html`);
      await owner.getByTestId("active-project").filter({ hasText: "project-a" }).waitFor();
      await observer.getByTestId("active-project").filter({ hasText: "project-a" }).waitFor();
      await owner.getByTestId("open-selected-project").click();
      await observer.getByTestId("open-selected-project").click();

      await observer.getByTestId("return-project-list").click();
      await observer.getByTestId("switch-project-b").click();
      await observer.getByTestId("open-selected-project").click();
      const submitResponse = observer.waitForResponse((response) =>
        response.url().includes("/api/assistant/creation/processes")
        && response.request().method() === "POST");
      await observer.getByTestId("submit-test-creation").click();
      await submitResponse;
      const record = [...state.processes.values()][0];
      assert(record, "第二个编辑器进程应提交一个真实后端队列请求");
      assert.equal(record.projectId, "project-b", "任务必须归属提交时的工程");

      // The first editor has been idle: it still must discover another process'
      // newly queued lock by polling the shared process service.
      await owner.getByTestId("return-project-list").click();
      await owner.getByTestId("switch-project-b").click();
      await owner.getByTestId("open-selected-project").click();
      await owner.waitForFunction(() => document.querySelector('[data-testid="assistant-project-lock-dialog"]'), null, { timeout: 6000 });
      const lockedGeometry = await owner.evaluate(() => {
        const dialogElement = document.querySelector('[data-testid="assistant-project-lock-dialog"]');
        const dialog = dialogElement.getBoundingClientRect();
        const host = document.querySelector('[data-testid="assistant-project-lock-host"]');
        const edit = document.querySelector('[data-testid="project-edit-action"]');
        return {
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          documentWidth: document.documentElement.scrollWidth,
          dialog: { left: dialog.left, right: dialog.right, top: dialog.top, bottom: dialog.bottom },
          focusInDialog: dialogElement.contains(document.activeElement),
          inert: host.querySelector("[data-testid='locked-project-content']")?.hasAttribute("inert") ?? false,
          editDisabledByInert: edit.closest("[inert]") !== null,
        };
      });
      assert(lockedGeometry.inert && lockedGeometry.editDisabledByInert,
        "同工程所有编辑内容必须退出指针与焦点路径");
      assert(lockedGeometry.focusInDialog, "工程进入锁定态时焦点必须移入最上层锁定对话框");
      const cancelButton = owner.getByRole("button", { name: /取消此创造任务/ });
      const homeButton = owner.getByRole("button", { name: /返回工程列表/ });
      await owner.keyboard.press("Tab");
      assert.equal(await cancelButton.evaluate((element) => element === document.activeElement),
        true, "Tab 应从锁定说明进入首个对话框操作");
      await owner.keyboard.press("Shift+Tab");
      assert.equal(await homeButton.evaluate((element) => element === document.activeElement),
        true, "Shift+Tab 应在对话框边界内循环至末项");
      await owner.keyboard.press("Tab");
      assert.equal(await cancelButton.evaluate((element) => element === document.activeElement),
        true, "Tab 不得逃出最上层锁定对话框");
      assert(lockedGeometry.dialog.left >= 0 && lockedGeometry.dialog.right <= 1920
        && lockedGeometry.dialog.top >= 0 && lockedGeometry.dialog.bottom <= 1080,
      `锁定状态卡片不能越界：${JSON.stringify(lockedGeometry)}`);
      assert(lockedGeometry.documentWidth <= 1920, "锁定遮罩不能导致横向溢出");
      report.desktop = lockedGeometry;

      await owner.getByRole("button", { name: /返回工程列表/ }).click();
      await owner.getByTestId("switch-project-a").click();
      await owner.getByTestId("open-selected-project").click();
      assert.equal(await owner.getByTestId("assistant-project-lock-dialog").count(), 0,
        "其他工程保持可查看和编辑");
      await owner.getByTestId("project-edit-action").click();
      assert.equal(await owner.getByTestId("editing-count").innerText(), "1",
        "其他工程编辑操作应保持可用");

      await owner.setViewportSize({ width: 3840, height: 2160 });
      await owner.getByTestId("return-project-list").click();
      await owner.getByTestId("switch-project-b").click();
      await owner.getByTestId("open-selected-project").click();
      await owner.getByTestId("assistant-project-lock-dialog").waitFor();
      const wideGeometry = await owner.getByTestId("assistant-project-lock-dialog").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      assert(wideGeometry.left >= 0 && wideGeometry.right <= 3840
        && wideGeometry.top >= 0 && wideGeometry.bottom <= 2160,
      `4K 锁定视图应保持完整：${JSON.stringify(wideGeometry)}`);
      await owner.screenshot({ path: path.join(output, "project-lock-3840x2160.png") });
      report.wide = wideGeometry;

      await owner.setViewportSize({ width: 2560, height: 1440 });
      const qhdGeometry = await owner.getByTestId("assistant-project-lock-dialog").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: innerWidth, height: innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      assert(qhdGeometry.documentWidth <= 2561 && qhdGeometry.left >= 0
        && qhdGeometry.right <= 2561 && qhdGeometry.top >= 0 && qhdGeometry.bottom <= 1440,
      `2K锁定说明应完整、无横向溢出：${JSON.stringify(qhdGeometry)}`);
      await owner.screenshot({ path: path.join(output, "project-lock-2560x1440.png") });
      report.qhd = qhdGeometry;

      await owner.getByRole("button", { name: /取消此创造任务/ }).click();
      await owner.getByText("正在结束任务…").waitFor();
      assert.equal(await owner.getByTestId("assistant-project-lock-dialog").count(), 1,
        "取消尚未到终态时工程仍保持锁定");
      await owner.waitForFunction(() => !document.querySelector('[data-testid="assistant-project-lock-dialog"]'), null, { timeout: 4000 });
      await owner.getByTestId("project-edit-action").click();
      assert.equal(await owner.getByTestId("editing-count").innerText(), "2",
        "任务进入已取消终态后必须解除该工程锁");

      await context.close();
      report.cases.push({ case: "cross-process-project-lock-isolation-release-and-responsive-geometry", status: "PASS" });
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(`Evidence: ${output}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
