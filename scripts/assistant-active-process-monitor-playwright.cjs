"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
assert(process.env.AGENTVN_TEST_PROJECT, "Specify isolated AGENTVN_TEST_PROJECT");
assert(process.env.AGENTVN_WORKSPACE_OUTPUT, "Specify independent evidence directory");
const output = path.join(process.env.AGENTVN_WORKSPACE_OUTPUT, "active-process-monitor", runId);
const report = { runId, status: "RUNNING", cases: [], project: process.env.AGENTVN_TEST_PROJECT,
  environment: "product AssistantChatPanel in isolated browser harness; controlled API; not installed/live-model evidence" };

function seed() {
  const submittedAt = Date.now() - 30000;
  const active = Array.from({ length: 11 }, (_, index) => ({
    id: `old-active-${index}`, projectId: `other-project-${index}`,
    projectTitle: `独立工程 ${index}`, conversationId: `isolated-conversation-${index}`,
    submittedAt: submittedAt + index,
    status: index === 0 ? "running" : index === 1 ? "cancelling" : "queued",
  }));
  const history = Array.from({ length: 8 }, (_, index) => ({
    id: `new-history-${index}`, projectId: "history-project", projectTitle: `已结束工程 ${index}`,
    conversationId: "history", submittedAt: submittedAt + 100 + index,
    finishedAt: submittedAt + 200 + index, status: index === 7 ? "failed" : "completed",
    ...(index === 7 ? { errorCode: "proposal_not_authorized",
      errorMessage: "提案引用了未授权素材，原工程未修改。" + "完整诊断长文本无需撑开页面。".repeat(30) } : {}),
  }));
  return [...active, ...history];
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "editor"), port: 0,
      logFile: path.join(output, "server.log") });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    await server.run(async () => {
      for (const deviceScaleFactor of [1, 2]) for (const reducedMotion of ["no-preference", "reduce"])
        for (const [width, height] of desktopViewports) {
          const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, reducedMotion });
          const page = await context.newPage();
          const errors = [];
          const records = seed();
          const cancelled = [];
          page.on("pageerror", error => errors.push(String(error)));
          await page.route("**/api/assistant/creation/processes**", async route => {
            const request = route.request();
            const pathname = new URL(request.url()).pathname;
            if (request.method() === "GET" && pathname.endsWith("/processes")) {
              await route.fulfill({ json: { processes: records } });
              return;
            }
            const match = pathname.match(/\/processes\/([^/]+)\/cancel$/);
            assert(match && request.method() === "POST", "This test must not create any model task");
            const record = records.find(item => item.id === decodeURIComponent(match[1]));
            assert(record && record.status === "queued", "Only the selected queued task may be cancelled");
            cancelled.push(record.id);
            record.status = "cancelled";
            record.finishedAt = Date.now();
            await route.fulfill({ json: record });
          });
          await page.goto(`${server.url}/assistant-session-harness.html`);
          const monitor = page.getByTestId("assistant-process-monitor");
          await monitor.waitFor();
          const rows = monitor.locator("li[data-process-id]");
          const actualIds = await rows.evaluateAll(items => items.map(item => item.dataset.processId));
          const activeIds = records.filter(item => ["queued", "running", "cancelling"].includes(item.status)).map(item => item.id);
          assert.deepEqual(actualIds.filter(id => id.startsWith("old-active")), activeIds,
            "Every active task must remain reachable, in FIFO order, even with newer terminal history");
          assert.equal(actualIds.filter(id => id.startsWith("new-history")).length, 6, "Only terminal history is bounded");
          await monitor.locator('[data-process-id="old-active-2"]').getByText("排队第 1 位", { exact: true }).waitFor();
          await monitor.locator('[data-process-id="old-active-10"]').getByText("排队第 9 位", { exact: true }).waitFor();
          assert.equal(await monitor.locator('[data-process-id="old-active-1"] button').count(), 0,
            "Cancelling task must not offer another cancel operation");

          const lastQueued = monitor.locator('[data-process-id="old-active-10"]');
          const cancelButton = lastQueued.getByRole("button", { name: "取消 独立工程 10 的创作进程" });
          await cancelButton.scrollIntoViewIfNeeded();
          await cancelButton.focus();
          const geometry = await cancelButton.evaluate(button => {
            const rect = button.getBoundingClientRect();
            const container = button.closest(".assistant-process-monitor").getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
              hit: hit === button || button.contains(hit), focused: document.activeElement === button,
              withinMonitor: rect.top >= container.top && rect.bottom <= container.bottom,
              documentWidth: document.documentElement.scrollWidth };
          });
          assert(geometry.hit && geometry.focused && geometry.withinMonitor, "Scrolled last task must be hittable and focusable");
          assert(geometry.left >= 0 && geometry.right <= width && geometry.top >= 0 && geometry.bottom <= height);
          assert(geometry.documentWidth <= width + 1, "Monitor must not overflow page horizontally");
          await cancelButton.click();
          await page.waitForFunction(() => !document.querySelector(
            '[data-process-id="old-active-10"][data-status="queued"]'));
          assert.deepEqual(cancelled, ["old-active-10"], "Actual cancellation must target the selected old queue entry");

          await monitor.locator('[data-process-id="old-active-2"]')
            .getByRole("button", { name: "取消 独立工程 2 的创作进程" }).click();
          await monitor.locator('[data-process-id="old-active-3"]')
            .getByText("排队第 1 位", { exact: true }).waitFor();
          await monitor.locator('[data-process-id="old-active-9"]')
            .getByText("排队第 7 位", { exact: true }).waitFor();
          assert.deepEqual(cancelled, ["old-active-10", "old-active-2"],
            "Cancelling the FIFO head must update the remaining positions without cancelling another task");

          const failure = monitor.locator('[data-process-id="new-history-7"]');
          await failure.getByText("失败详情", { exact: true }).click();
          const reason = failure.getByTestId("assistant-process-error");
          await reason.waitFor();
          assert((await reason.innerText()).includes("proposal_not_authorized"));
          assert((await reason.innerText()).includes("原工程未修改"));
          assert.equal(await failure.getByRole("button").count(), 0, "Terminal task must not be cancellable");
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Long error must wrap");

          await page.getByTestId("switch-project").click();
          await page.getByTestId("active-project").filter({ hasText: "project-b" }).waitFor();
          assert.equal(await monitor.locator('[data-process-id="old-active-0"]').count(), 1,
            "Cross-project global activity must remain visible");
          await page.reload();
          await page.locator('[data-process-id="old-active-0"]').waitFor();
          assert.equal(await page.locator('[data-process-id="old-active-10"][data-status="queued"]').count(), 0,
            "Reload must not resurrect cancelled queue state");
          assert.equal(await page.locator('[data-process-id="old-active-2"][data-status="queued"]').count(), 0);
          assert.deepEqual(errors, [], "No frontend exception is allowed");
          await monitor.screenshot({ path: path.join(output, `${width}-${deviceScaleFactor}-${reducedMotion}.png`) });
          report.cases.push({ width, height, deviceScaleFactor, reducedMotion, activeCount: activeIds.length,
            geometry, cancelled, status: "PASS" });
          await context.close();
        }
    });
    assert.equal(report.cases.length, 12, "Reject empty/incomplete matrix");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await server?.stop();
    report.cleanup = "owned browser/server stopped";
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output, error: report.error }));
  }
}
main();
