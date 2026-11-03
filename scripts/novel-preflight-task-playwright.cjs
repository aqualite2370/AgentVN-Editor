"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT);
const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT);
const report = { status: "RUNNING", scope: "source-browser-local-preflight-not-installed",
  cases: [], modelSubmissions: 0 };
let host, browser;
async function sample(page) {
  return page.evaluate(async () => {
    const { useNovelImportStore } = await import("/src/store/novelImportStore.ts");
    const state = useNovelImportStore.getState();
    const cards = [...document.querySelectorAll('[data-testid="novel-task-mini-entry"]')];
    const snapshots = Object.keys(localStorage).filter(key =>
      key.startsWith("agentvn.novelProcessTaskWorkbench.snapshot")).map(key => ({
      key, value: JSON.parse(localStorage.getItem(key)),
    }));
    return { pending: Boolean(state.pendingImport), isProcessing: state.isProcessing,
      progressPhase: state.progress?.phase, cards: cards.length,
      cardText: cards.map(card => card.textContent), snapshots,
      backendJobCount: state.processing.jobs.length,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
  });
}
async function cachedTaskCases(page, item) {
  const fixture = await page.evaluate(async () => {
    const { useNovelImportStore } = await import("/src/store/novelImportStore.ts");
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { createMockNovelProcessSnapshot } = await import("/src/novel-import/novelProcessJobAdapter.ts");
    const state = useNovelImportStore.getState();
    const snapshot = createMockNovelProcessSnapshot({
      projectId: useProjectStore.getState().projectId, projectTitle: "缓存回归夹具",
      session: state.session, errors: [], warnings: [], inspectableResults: [], isProcessing: true,
      progress: { phase: "scan", current: 0, total: 1, message: "受控夹具" },
    });
    snapshot.events = snapshot.events.map(event => event.payload?.phase === "scan"
      ? { ...event, payload: { ...event.payload, phase: "import" } } : event);
    const key = `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(snapshot.projectId)}`;
    const raw = JSON.stringify(snapshot);
    localStorage.setItem(key, raw);
    return { key, raw, snapshot };
  });
  await host.open(page);
  await settleEditor(page);
  await page.waitForFunction(() => window.__AGENTVN_NOVEL_TASK_WORKBENCH_READY__);
  item.oldLocalRecovery = await sample(page);
  assert.equal(item.oldLocalRecovery.cards, 0, "Old local-only snapshot must not revive a fake task");
  assert.equal(await page.evaluate(key => localStorage.getItem(key), fixture.key), fixture.raw,
    "Ignoring old local-only cache must preserve the original bytes");
  const api = { ...fixture.snapshot,
    job: { ...fixture.snapshot.job, jobId: "preflight-preserved-api-task", source: "api" }, events: [] };
  await page.route("**/api/novel/processing/execute/jobs/preflight-preserved-api-task/panel",
    route => route.fulfill({ json: api.job }));
  await page.route("**/api/novel/processing/execute/jobs/preflight-preserved-api-task/events?*",
    route => route.fulfill({ json: [] }));
  await page.evaluate(({ key, snapshot }) => localStorage.setItem(key, JSON.stringify(snapshot)),
    { key: fixture.key, snapshot: api });
  await host.open(page);
  await settleEditor(page);
  await page.getByTestId("novel-task-mini-entry").waitFor();
  await page.locator('[data-help-key="toolbar.novelImport"]').click();
  const panel = page.getByTestId("novel-import-workbench");
  await panel.locator('[data-help-key="novel.importFile"] input').setInputFiles({
    name: "保留既有任务.txt", mimeType: "text/plain", buffer: Buffer.from("第一章\n仅预检，不执行模型。", "utf8"),
  });
  await panel.getByRole("region", { name: "小说文件导入检测" }).waitFor();
  await panel.locator('[data-help-key="novel.cancelImport"]').click();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  item.existingTaskAfterCancel = await sample(page);
  assert.equal(item.existingTaskAfterCancel.cards, 1);
  assert.equal(item.existingTaskAfterCancel.snapshots.length, 1);
  assert.equal(item.existingTaskAfterCancel.snapshots[0].value.job.jobId, api.job.jobId);
  assert.equal(item.existingTaskAfterCancel.snapshots[0].value.job.source, "api");
  assert.equal(item.existingTaskAfterCancel.snapshots[0].value.job.status, "running");
}
(async () => {
  host = await startEditorAcceptance(output);
  report.service = { backendPid: host.backendPid, frontendPid: host.server.pid,
    frontendUrl: host.url, backendUrl: host.backendUrl };
  browser = await chromium.launch();
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2])
    for (const motion of ["no-preference", "reduce"]) {
      const context = await browser.newContext({ viewport: { width, height },
        deviceScaleFactor: dpr, reducedMotion: motion });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const item = { width, height, dpr, motion, status: "RUNNING" };
      report.cases.push(item);
      await page.route(/\/api\/.*(?:process-jobs|novel.*(?:generate|analy[sz]e|process|scan)|assistant.*(?:completions|processes))/,
        route => {
          if (route.request().method() !== "POST") return route.continue();
          report.modelSubmissions++;
          return route.abort();
        });
      try {
        await host.open(page);
        await settleEditor(page);
        await page.waitForFunction(() => window.__AGENTVN_NOVEL_TASK_WORKBENCH_READY__);
        item.initial = await sample(page);
        const entry = page.locator('[data-help-key="toolbar.novelImport"]');
        await entry.click();
        const panel = page.getByTestId("novel-import-workbench");
        await panel.waitFor();
        await panel.locator('[data-help-key="novel.importFile"] input').setInputFiles({
          name: "只做本地预检.txt", mimeType: "text/plain",
          buffer: Buffer.from("第一章 雨后\n她推开窗户，阳光照进屋内。\n", "utf8"),
        });
        await panel.getByRole("region", { name: "小说文件导入检测" }).waitFor();
        item.preflight = await sample(page);
        await panel.locator('[data-help-key="novel.cancelImport"]').click();
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "detached" });
        item.cancelled = await sample(page);
        await host.open(page);
        await settleEditor(page);
        await page.waitForFunction(() => window.__AGENTVN_NOVEL_TASK_WORKBENCH_READY__);
        item.reopened = await sample(page);
        const screenshotPath = path.join(output, `preflight-${width}-dpr${dpr}-${motion}.png`);
        const png = await page.screenshot({ path: screenshotPath });
        assert.equal(png.readUInt32BE(16), width * dpr);
        assert.equal(png.readUInt32BE(20), height * dpr);
        item.screenshot = { path: screenshotPath, pixels: [png.readUInt32BE(16), png.readUInt32BE(20)],
          sha256: crypto.createHash("sha256").update(png).digest("hex") };
        assert.equal(item.initial.cards, 0, "Fresh project must start without a task");
        assert.equal(item.preflight.pending, true);
        assert.equal(item.cancelled.pending, false);
        assert.equal(item.cancelled.isProcessing, false);
        for (const state of [item.preflight, item.cancelled, item.reopened]) {
          assert.equal(state.backendJobCount, 0, "Local preflight must not create a backend task");
          assert.equal(state.cards, 0, `Local preflight must not manufacture a processing task: ${JSON.stringify(state.cardText)}`);
          assert.equal(state.snapshots.length, 0, "Local preflight must not persist a processing task");
          assert.deepEqual(state.viewport, { width, height, dpr, reduced: motion === "reduce" });
        }
        if (width === 1920 && dpr === 1 && motion === "no-preference")
          await cachedTaskCases(page, item);
        assert.equal(report.modelSubmissions, 0);
        item.status = "PASS";
      } catch (error) {
        item.status = "FAILED";
        item.error = String(error.stack || error);
      } finally { await context.close(); }
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ width, dpr, motion, status: item.status,
        error: item.error?.split("\n")[0] }));
    }
  assert.equal(report.cases.length, 12);
  report.status = report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => {
  report.status = "TOOL_FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await host?.stop();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    modelSubmissions: report.modelSubmissions, output }));
});
