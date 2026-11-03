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
  : path.join(root, "output/playwright/novel-task-poll-error", runId);
const report = { runId, status: "RUNNING", scope: "controlled-task-refresh-failure", cases: [] };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let env, browser;
  try {
    env = await startEditorAcceptance(output);
    const project = JSON.parse(fs.readFileSync(env.input, "utf8"));
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const job = {
      jobId: "poll-failure-acceptance", novelTitle: "轮询异常验收", status: "running", source: "api",
      totalChunks: 4, completedChunks: 2, failedChunks: 0, cancelledChunks: 0,
      runningAgentCount: 1, progressPercent: 50, selectedChapterCount: 1,
      estimatedRemainingChunks: 2, agents: [], chapters: [],
      tokenStats: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0,
        estimatedTokens: 0, actualTokens: 0, averageChunkTokens: 0, retryExtraTokens: 0,
        byAgent: [], byChapter: [] },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await page.addInitScript(({ projectId, job }) => localStorage.setItem(
      `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(projectId)}`,
      JSON.stringify({ projectId, job, events: [] })), { projectId: project.project_id, job });
    const intervals = [];
    await page.route("**/api/novel/processing/execute/jobs/poll-failure-acceptance/panel", async route => {
      const interval = { request: route.request(), start: Date.now() };
      intervals.push(interval);
      try {
        await new Promise(resolve => setTimeout(resolve, 1200));
        await route.fulfill({ json: job });
      } finally { interval.end = Date.now(); }
    });
    await page.route("**/api/novel/processing/execute/jobs/poll-failure-acceptance/events?*",
      route => route.fulfill({ status: 503, json: { detail: "controlled-events-unavailable" } }));
    await env.server.run(async () => {
      await env.open(page);
      await page.getByTestId("novel-task-mini-entry").waitFor({ state: "visible" });
      const deadline = Date.now() + 9000;
      while (Date.now() < deadline && intervals.filter(item => item.end && !item.request.failure()).length < 3)
        await page.waitForTimeout(100);
      const live = intervals.filter(item => !item.request.failure());
      const overlaps = live.some((item, index) => live.slice(index + 1).some(other =>
        other.start < (item.end ?? Infinity) && item.start < (other.end ?? Infinity)));
      report.intervals = intervals.map(item => ({
        start: item.start, end: item.end, failure: item.request.failure(),
      }));
      assert(live.filter(item => item.end).length >= 3, "Must observe at least three completed non-aborted refreshes");
      assert(!overlaps, "An early events error must not schedule a second refresh while the panel request is still in flight");
      assert(await page.getByTestId("novel-task-mini-entry").isVisible(),
        "Transient refresh errors must retain the project's task card");
      report.cases.push({ name: "events-failure-waits-for-sibling-before-retry", status: "PASS" });
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await env?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${path.join(output, "report.json")}`);
  }
}
main();
