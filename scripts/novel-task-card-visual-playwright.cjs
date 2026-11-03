#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT
  ? path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT)
  : path.join(root, "output/playwright/novel-task-card-visual", runId);
const report = { runId, scope: "browser-card-evidence-not-installed-final", status: "RUNNING", cases: [] };
const matrix = [
  { name: "1080p", width: 1920, height: 1080, dpr: 1 },
  { name: "1440p", width: 2560, height: 1440, dpr: 1 },
  { name: "4k", width: 3840, height: 2160, dpr: 1 },
].flatMap(viewport => [1, 2].flatMap(dpr => [false, true].map(reduced =>
  ({ ...viewport, name: `${viewport.name}-dpr${dpr}-${reduced ? "reduced" : "normal"}`, dpr, reduced }))));
(async () => {
  let env, browser;
  try {
    env = await startEditorAcceptance(output, { isolateBackendWorkingDirectory: true });
    const projectId = JSON.parse(fs.readFileSync(env.input, "utf8")).project_id;
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    browser = await chromium.launch();
    for (const viewport of matrix) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr,
        reducedMotion: viewport.reduced ? "reduce" : "no-preference",
      });
      await page.addInitScript(projectId => {
        const now = new Date().toISOString();
        localStorage.setItem(`agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(projectId)}`,
          JSON.stringify({ projectId, events: [], job: {
            jobId: "card-visual", novelTitle: "小说解析任务", status: "running", source: "mock",
            selectedChapterCount: 1, totalChunks: 4, completedChunks: 2, failedChunks: 0, cancelledChunks: 0,
            runningAgentCount: 1, estimatedRemainingChunks: 2, progressPercent: 50,
            agents: [], chapters: [], createdAt: now, updatedAt: now,
            tokenStats: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0,
              estimatedTokens: 0, actualTokens: 0, averageChunkTokens: 0, retryExtraTokens: 0,
              byAgent: [], byChapter: [] },
          } }));
      }, projectId);
      await env.server.run(async () => {
        await env.open(page);
        const card = page.getByTestId("novel-task-mini-entry");
        await card.waitFor({ state: "visible" });
        await card.evaluate(async element => {
          await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
        });
        const geometry = await card.evaluate(element => {
          const r = element.getBoundingClientRect();
          const status = document.querySelector(".workspace-status-bar")?.getBoundingClientRect();
          const button = element.querySelector(".novel-task-card-open");
          const b = button.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
            statusTop: status?.height > 0 ? status.top : undefined,
            hit: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest("button") === button,
            nestedButtons: element.querySelectorAll("button button").length,
            overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        const cell = { viewport, name: "default-card-and-real-workspace-operation", status: "RUNNING", geometry };
        report.cases.push(cell);
        // The later user request halves the original 280px card and adds hide.
        // Keep the 88px reading/progress area; do not restore the retired width.
        assert(Math.abs(geometry.width - 140) < 1 && Math.abs(geometry.height - 88) < 1,
          `Expected current compact 140×88 card: ${JSON.stringify(geometry)}`);
        assert(geometry.x >= 12 && geometry.y >= 12 && geometry.right <= viewport.width - 12 + 1
          && geometry.bottom <= viewport.height - 12 + 1 && !geometry.overflow);
        if (geometry.statusTop !== undefined) assert(geometry.bottom <= geometry.statusTop - 12 + 1);
        assert(geometry.hit && geometry.nestedButtons === 0);
        assert.equal(await card.getByRole("progressbar").getAttribute("aria-valuenow"), "50");
        assert.equal(await card.getByRole("button", { name: "隐藏任务卡片", exact: true }).count(), 1);
        const screenshot = path.join(output, `${viewport.name}-card.png`);
        const expected = { width: viewport.width, height: viewport.height, dpr: viewport.dpr, reduced: viewport.reduced };
        cell.screenshot = await captureSourceBrowser(page, screenshot, expected);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        const open = card.getByRole("button", { name: /打开小说任务面板/ });
        await open.click();
        await page.getByTestId("novel-task-workbench").getByRole("button", { name: "最小化任务面板", exact: true }).click();
        await page.getByTestId("novel-task-workbench").waitFor({ state: "hidden" });
        assert(await card.isVisible(), "Options navigation and minimize must retain the same task card");
        cell.optionsScreenshot = await captureSourceBrowser(page,
          path.join(output, `${viewport.name}-options-card.png`), expected);
        cell.status = "PASS";
      });
      await page.close();
    }
    assert.equal(report.cases.length, matrix.length, "Visual evidence requires its complete nonempty behavior matrix");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await env?.stop();
    report.cleanup = [];
    for (const url of [env?.url, env?.backendUrl].filter(Boolean)) {
      let alive = false;
      try { await fetch(url, { signal: AbortSignal.timeout(1000) }); alive = true; } catch {}
      report.cleanup.push({ url, status: alive ? "FAILED" : "PASS" });
    }
    if (report.cleanup.some(item => item.status !== "PASS")) {
      report.status = "FAILED";
      process.exitCode = 1;
    }
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${path.join(output, "report.json")}`);
  }
})();
