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
  : path.join(root, "output/playwright/novel-task-result-notice", runId);
const report = { runId, status: "RUNNING", scope: "result-navigation-and-structured-notice", cases: [] };
const matrix = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "4k", width: 3840, height: 2160 },
];
const notice = "已写入 1 个解析节点，生成结果已放在画布空白区域作为独立节点树；未覆盖原有节点，也未接入现有工程流，需要启用时请手动连线。";

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let env, browser;
  try {
    env = await startEditorAcceptance(output);
    const project = JSON.parse(fs.readFileSync(env.input, "utf8"));
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    browser = await chromium.launch();
    for (const viewport of matrix) {
      const page = await browser.newPage({ viewport });
      const job = {
        jobId: `notice-${viewport.name}`, novelTitle: "结果提示验收", status: "completed", source: "api",
        totalChunks: 1, completedChunks: 1, failedChunks: 0, cancelledChunks: 0,
        runningAgentCount: 0, progressPercent: 100, selectedChapterCount: 1, estimatedRemainingChunks: 0,
        agents: [], chapters: [],
        tokenStats: { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0,
          estimatedTokens: 0, actualTokens: 0, averageChunkTokens: 0, retryExtraTokens: 0,
          byAgent: [], byChapter: [] },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await page.addInitScript(({ projectId, job }) => localStorage.setItem(
        `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(projectId)}`,
        JSON.stringify({ projectId, job, events: [] })), { projectId: project.project_id, job });
      await page.route(`**/api/novel/processing/execute/jobs/${job.jobId}/**`, async route => {
        const operation = new URL(route.request().url()).pathname.split("/").pop();
        if (operation === "events") { await route.fulfill({ json: [] }); return; }
        if (operation === "results") {
          await route.fulfill({ json: { completedResults: [], warnings: [], completedChapterResults: [{
            chapterIndex: 0, sourceChunkIds: [`notice-chunk-${viewport.name}`], summary: "", qualityWarnings: [],
            scene: { scene_id: `notice_scene_${viewport.name}`, title: "真实结果提示", summary: "", chapter: 1,
              tags: [], is_ending: true, commands: [{ type: "narration", text: "结果提示不能在导航后丢失。" }] },
          }] } });
          return;
        }
        await route.fulfill({ json: job });
      });
      await env.server.run(async () => {
        await env.open(page);
        await page.evaluate(async () => {
          const { backendClient } = await import("/src/api/backendClient.ts");
          backendClient.polishNovelProcessLinks = async () => {
            throw Error("Result notice acceptance must not issue model requests");
          };
        });
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.getByRole("button", { name: /打开小说任务面板/ }).click();
        const panel = page.getByTestId("novel-task-workbench");
        await panel.getByRole("button", { name: "查看结果", exact: true }).click();
        await page.waitForFunction(() =>
          document.querySelector('[data-workspace-surface="edit"]')?.getAttribute("aria-current") === "page");
        await panel.waitFor({ state: "hidden" });
        const status = page.getByTestId("workspace-status-bar");
        assert((await status.textContent()).includes(notice),
          "Structured import notice must remain visible in the real editing workspace after navigation");
        const selected = await page.evaluate(async () => {
          const state = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
          const target = state.nodes.find(node => node.id === state.selectedNodeId);
          return target?.data.editorMeta?.sourceProcessJobId;
        });
        assert.equal(selected, job.jobId, "Result navigation must select the imported task's node");
        await page.getByRole("button", { name: /打开小说任务面板/ }).click();
        const message = panel.locator(".novel-task-action-message");
        assert.equal(await message.textContent(), notice,
          "Reopened task panel must retain the full notice, not only a truncated toast");
        const geometry = await message.evaluate(element => {
          const r = element.getBoundingClientRect();
          const panel = element.closest('[data-testid="novel-task-workbench"]').getBoundingClientRect();
          return { contained: r.x >= panel.x && r.right <= panel.right && r.y >= panel.y && r.bottom <= panel.bottom,
            overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        assert(geometry.contained && !geometry.overflow, "Long notices must stay inside the panel without horizontal overflow");
        const reachable = await panel.locator(".novel-task-actions button").evaluateAll(buttons => buttons.every(button => {
          const r = button.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("button") === button;
        }));
        assert(reachable, "Import notice must not obscure footer controls");
        report.cases.push({ viewport, name: "structured-notice-survives-navigation-and-reopen", status: "PASS", geometry });
        await page.screenshot({ path: path.join(output, `${viewport.name}-notice.png`) });
      });
      await page.close();
    }
    assert(report.cases.length === matrix.length, "Notice acceptance must execute its complete nonempty matrix");
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
