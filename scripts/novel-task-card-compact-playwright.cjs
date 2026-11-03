"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
const out = path.join("F:/AgentVN/QA/Novel-Card-Compact-20261021-01", attempt);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const project = fixture(`compact-card-${attempt}`), input = path.join(out, "任务卡片 独立工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const now = new Date().toISOString();
const snapshot = { projectId: project.project_id, events: [], job: {
  jobId: "compact-task", novelTitle: "小说解析任务", status: "running", source: "mock",
  selectedChapterCount: 1, totalChunks: 4, completedChunks: 2, failedChunks: 0,
  cancelledChunks: 0, runningAgentCount: 1, estimatedRemainingChunks: 2, progressPercent: 50,
  tokenStats: { totalInputTokens: 320, totalOutputTokens: 180, totalTokens: 500, estimatedTokens: 1000,
    actualTokens: 500, averageChunkTokens: 250, retryExtraTokens: 0, byAgent: [], byChapter: [] },
  agents: [], chapters: [], createdAt: now, updatedAt: now,
} };
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_CONTROLLED_TASK_NO_MODEL", at: now, matrix: [], taskWrites: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, browser;
(async () => {
  save(); host = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.service = { url: host.url, backendUrl: host.backendUrl, pid: host.server.pid, backendPid: host.backendPid }; save();
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2])
    for (const reduced of [false, true]) {
      const cell = { width, height, dpr, reduced, status: "RUNNING" }; report.matrix.push(cell); save();
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      try {
        await context.addInitScript(({ snapshot, key }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(snapshot));
        }, { snapshot, key: `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(project.project_id)}` });
        const page = await context.newPage(); page.setDefaultTimeout(30000);
        await page.route(/\/api\/(?:assistant|novel)/, r => {
          if (r.request().method() === "POST") { report.taskWrites.push(r.request().url()); return r.abort(); }
          return r.continue();
        });
        await host.open(page); await settleEditor(page);
        const card = page.getByTestId("novel-task-mini-entry");
        await card.waitFor({ state: "visible" });
        const rect = await card.boundingBox();
        const close = card.getByRole("button", { name: "隐藏任务卡片", exact: true });
        cell.baseline = { rect, closeCount: await close.count() }; save();
        assert(rect.width >= 138 && rect.width <= 142 && cell.baseline.closeCount === 1,
          `Expected half-width 140px card and independent hide action: ${JSON.stringify(cell.baseline)}`);
        assert(rect.x >= 12 && rect.y >= 12 && rect.x + rect.width <= width - 12 && rect.y + rect.height <= height - 12);
        assert.equal(await card.getByRole("progressbar").getAttribute("aria-valuenow"), "50");
        const geometry = await card.locator("button").evaluateAll(ns => ns.map(n => {
          const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { label: n.getAttribute("aria-label"), rect: r.toJSON(), hit: n === hit || n.contains(hit) };
        }));
        cell.geometry = geometry; save();
        assert(geometry.every(g => g.hit && g.rect.left >= rect.x && g.rect.right <= rect.x + rect.width + 1),
          JSON.stringify(geometry));
        for (let i = 0; i < geometry.length; i++) for (let j = i + 1; j < geometry.length; j++) {
          const a = geometry[i].rect, b = geometry[j].rect;
          assert(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1
            || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, "Card actions overlap");
        }
        cell.geometry = geometry;
        const grip = card.getByRole("button", { name: "拖动小说任务卡片" });
        const g = await grip.boundingBox();
        await page.mouse.move(g.x + 8, g.y + g.height / 2); await page.mouse.down();
        await page.mouse.move(g.x - 75, g.y - 60, { steps: 5 }); await page.mouse.up();
        const moved = await card.boundingBox();
        assert(moved.x < rect.x - 50 && moved.y < rect.y - 40, "Compact card remains draggable");
        assert.equal(await page.getByTestId("novel-task-workbench").count(), 0, "Drag must not open panel");
        await card.getByRole("button", { name: "恢复任务卡片默认位置" }).click();
        await page.waitForFunction(() => !document.querySelector('[data-testid="novel-task-mini-entry"]')?.getAnimations().length);
        await page.evaluate(() => {
          window.__compactFrames = [];
          const root = document.querySelector('[data-testid="novel-task-mini-entry"]');
          const sample = () => {
            const material = root.querySelector(".novel-task-card-material");
            window.__compactFrames.push({ opacity: Number(getComputedStyle(material).opacity), inert: root.inert,
              hidden: getComputedStyle(root).visibility === "hidden", focusInside: root.contains(document.activeElement) });
            if (getComputedStyle(root).visibility !== "hidden") requestAnimationFrame(sample);
          };
          root.querySelector('[aria-label="隐藏任务卡片"]').addEventListener("click", () => requestAnimationFrame(sample), { once: true });
        });
        await close.click(); await card.waitFor({ state: "hidden" });
        cell.dismissal = await page.evaluate(() => window.__compactFrames);
        assert(cell.dismissal.some(f => f.opacity > .02 && f.opacity < .98), "Dismissal must have real intermediate frames");
        assert(cell.dismissal.every(f => f.inert && !f.focusInside), "Dismissed card immediately releases input and focus");
        // Recovery uses the real existing toolbar, without manufacturing a task or cancelling one.
        await page.locator('[data-help-key="toolbar.novelImport"]:visible').click();
        await page.getByRole("button", { name: "关闭小说导入工作台", exact: true }).click();
        await settleEditor(page); await card.waitFor({ state: "visible" });
        assert.equal(await card.getAttribute("data-job-status"), "running");
        assert.equal(await card.getAttribute("data-project-id"), project.project_id);
        await card.getByRole("button", { name: /打开小说任务面板/ }).click();
        const panel = page.getByTestId("novel-task-workbench");
        await panel.waitFor({ state: "visible" });
        await panel.getByRole("button", { name: "最小化任务面板", exact: true }).click();
        await card.waitFor({ state: "visible" }); await panel.waitFor({ state: "hidden" });
        await page.waitForFunction(() => document.activeElement?.matches(".novel-task-card-open"));
        if (width === 1920 && dpr === 1 && !reduced)
          cell.screenshot = await captureSourceBrowser(page, path.join(out, "compact-card.png"), { width, height, dpr, reduced });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.deepEqual(report.taskWrites, []);
        cell.status = "PASS"; save(); console.log(`PASS compact ${width} DPR${dpr} reduce=${reduced}`);
      } finally { await context.close(); }
    }
  assert.equal(report.matrix.length, 12); assert(report.matrix.every(c => c.status === "PASS"));
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    await browser?.close(); await host?.stop(); report.cleanup = [];
    for (const url of [host?.url, host?.backendUrl].filter(Boolean)) {
      let alive = false; try { await fetch(url, { signal: AbortSignal.timeout(1000) }); alive = true; } catch {}
      report.cleanup.push({ url, status: alive ? "FAILED" : "PASS" });
    }
    if (report.cleanup.some(c => c.status !== "PASS")) { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  });
