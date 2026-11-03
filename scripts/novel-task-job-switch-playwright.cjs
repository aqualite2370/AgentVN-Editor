#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT
  ? path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT)
  : path.join(root, "output/playwright/novel-task-job-switch", runId);
const report = { runId, status: "RUNNING", scope: "same-project-task-operation-ownership", cases: [] };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let env, browser, releasePause;
  try {
    env = await startEditorAcceptance(output);
    const project = JSON.parse(fs.readFileSync(env.input, "utf8"));
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const base = {
      status: "running", source: "api", totalChunks: 4, completedChunks: 2,
      failedChunks: 0, cancelledChunks: 0, runningAgentCount: 1, progressPercent: 50,
      selectedChapterCount: 1, estimatedRemainingChunks: 2, agents: [], chapters: [],
      tokenStats: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0,
        estimatedTokens: 0, actualTokens: 0, averageChunkTokens: 0, retryExtraTokens: 0,
        byAgent: [], byChapter: [] },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const a = { ...base, jobId: "same-project-a", novelTitle: "同工程任务A" };
    const b = { ...base, jobId: "same-project-b", novelTitle: "同工程任务B" };
    await page.addInitScript(({ projectId, job }) => localStorage.setItem(
      `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(projectId)}`,
      JSON.stringify({ projectId, job, events: [] })), { projectId: project.project_id, job: a });
    await page.route("**/api/novel/processing/execute/jobs/same-project-a/**", async route => {
      const operation = new URL(route.request().url()).pathname.split("/").pop();
      if (operation === "events") { await route.fulfill({ json: [] }); return; }
      if (operation === "pause") {
        await new Promise(resolve => { releasePause = resolve; });
        await route.fulfill({ json: { ...a, status: "paused" } });
        return;
      }
      await route.fulfill({ json: a });
    });
    let bPauses = 0;
    await page.route("**/api/novel/processing/execute/jobs/same-project-b/**", async route => {
      const operation = new URL(route.request().url()).pathname.split("/").pop();
      if (operation === "events") { await route.fulfill({ json: [] }); return; }
      if (operation === "pause") { bPauses++; b.status = "paused"; }
      await route.fulfill({ json: b });
    });
    await env.server.run(async () => {
      await env.open(page);
      await page.getByRole("button", { name: /打开小说任务面板/ }).click();
      const panel = page.getByTestId("novel-task-workbench");
      const pauseA = page.waitForRequest(request => request.url().endsWith("/same-project-a/pause"));
      await panel.getByRole("button", { name: "暂停", exact: true }).click();
      await pauseA;
      await page.evaluate(async () => {
        const { useNovelImportStore } = await import("/src/store/novelImportStore.ts");
        const state = useNovelImportStore.getState();
        useNovelImportStore.setState({ processing: { ...state.processing, activeJobId: "same-project-b" } });
      });
      await page.waitForFunction(() =>
        document.querySelector("#novel-task-workbench-title")?.textContent === "同工程任务B");
      const response = page.waitForResponse(value => value.url().endsWith("/same-project-a/pause"));
      releasePause();
      releasePause = undefined;
      await (await response).finished();
      report.newTaskControl = await panel.getByRole("button", { name: "暂停", exact: true }).isEnabled();
      assert(report.newTaskControl, "A's stale operation must not leave B's task controls busy or disabled");
      assert.equal(await panel.getAttribute("data-job-status"), "running",
        "A's late pause must not pause B");
      await panel.getByRole("button", { name: "暂停", exact: true }).click();
      await panel.getByRole("button", { name: "继续", exact: true }).waitFor({ state: "visible" });
      assert.equal(bPauses, 1, "B's enabled control must call B, not A");
      report.cases.push({ name: "new-task-controls-do-not-inherit-stale-action", status: "PASS" });
      await page.screenshot({ path: path.join(output, "same-project-task-b.png") });
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    releasePause?.();
    await browser?.close();
    await env?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${path.join(output, "report.json")}`);
  }
}
main();
