#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, viewports, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { armFloatingMotion, finishFloatingMotion, assertFloatingMotion } = require("./lib/floating-motion-probe.cjs");
// Multiple acceptance slices can start in the same clock millisecond. Keep
// every run's backend log and report directory exclusive even under parallel
// execution.
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const output = process.env.AGENTVN_WORKSPACE_OUTPUT
  ? path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT)
  : path.join(root, "output/playwright/novel-task-floating", runId);
const selected = (process.env.FLOATING_VIEWPORTS || "1080p,1440p,4k").split(",").filter(Boolean);
const matrix = selected.length ? viewports.filter(item => selected.includes(item.name)) : viewports;
const report = { runId, scope: "novel-task-floating-not-installed-final", status: "RUNNING", cases: [] };
const caseName = process.argv.find(arg => arg.startsWith("--case="))?.slice(7) || "ui";
assert(["ui", "ownership", "controller", "initial-refresh", "motion", "handoff", "local-actions", "workspace"].includes(caseName), `Unknown case: ${caseName}`);
assert(selected.every(name => matrix.some(viewport => viewport.name === name)), "Unknown floating viewport requested");

async function handoffCase(page, viewport, mini) {
  const panel = page.getByTestId("novel-task-workbench");
  const reduced = process.env.FLOATING_REDUCED === "1";
  const open = mini.getByRole("button", { name: /打开小说任务面板/ });
  const minimize = panel.getByRole("button", { name: "最小化任务面板", exact: true });
  const panelSelector = '[data-testid="novel-task-workbench"]';
  for (const keyboard of [false, true]) {
    const input = keyboard ? { input: "keydown", key: "Enter" } : {};
    if (keyboard) await open.focus();
    await armFloatingMotion(page, panelSelector, input);
    if (keyboard) await page.keyboard.press("Enter");
    else await open.click();
    const entry = await finishFloatingMotion(page);
    // Persist the raw frames even when the new contract fails against old code.
    const evidence = { viewport, name: `${keyboard ? "keyboard" : "pointer"}-continuous-task-handoff`,
      status: "RUNNING", entry };
    report.cases.push(evidence);
    evidence.entrySummary = assertFloatingMotion(entry, viewport, { reduced, duration: reduced ? 80 : 240 });
    assert(entry.frames.filter(frame => frame.rendered && frame.panel.visible)
      .every(frame => frame.panel.ownsFocus && !frame.panel.inert),
    "New panel must own focus and input during its entrance, without waiting for decoration");
    const token = panel.locator(".novel-token-panel");
    const tab = token.getByRole("tab", { name: keyboard ? "按章节" : "按处理槽" });
    if (keyboard) await tab.focus();
    await armFloatingMotion(page, ".novel-token-view-content", {
      ...input, settledView: keyboard ? "chapter" : "agent",
    });
    if (keyboard) await page.keyboard.press("Enter");
    else await tab.click();
    evidence.token = await finishFloatingMotion(page);
    evidence.tokenSummary = assertFloatingMotion(evidence.token, viewport, {
      reduced, duration: reduced ? 80 : 160, minOpacity: .65,
    });
    await armFloatingMotion(page, panelSelector,
      keyboard ? { input: "keydown", key: "Escape", visible: false } : { visible: false });
    if (keyboard) await page.keyboard.press("Escape");
    else await minimize.click();
    evidence.exit = await finishFloatingMotion(page);
    evidence.exitSummary = assertFloatingMotion(evidence.exit, viewport, { reduced, duration: reduced ? 80 : 240 });
    assert(evidence.exit.frames.filter(frame => frame.rendered)
      .every(frame => !frame.card.inert && frame.card.visible), "The card must be usable throughout panel exit");
    assert(evidence.exit.frames.some(frame => frame.rendered
      && frame.card.opacity > .55 && frame.card.opacity < .99
      && frame.card.animations.some(animation => animation.duration === (reduced ? 80 : 160))),
    "Keyboard and pointer panel exits must both continuously restore the card material");
    await page.waitForFunction(() => document.activeElement?.matches(".novel-task-card-open"));
    assert.equal(await page.locator('[data-workspace-surface="options"]:visible').getAttribute("aria-current"), "page",
      "Task Escape must not close the underlying options workspace");
    evidence.status = "PASS";
  }
  await page.screenshot({ path: path.join(output, `${viewport.name}-handoff.png`) });
}

async function ownershipCase(page) {
  return page.evaluate(async () => {
    const { useNovelImportStore: novel } = await import("/src/store/novelImportStore.ts");
    const { useEditorStore: editor } = await import("/src/store/editorStore.ts");
    const { useProjectStore: project } = await import("/src/store/projectStore.ts");
    const { backendClient } = await import("/src/api/backendClient.ts");
    const before = JSON.stringify({ nodes: editor.getState().nodes, edges: editor.getState().edges });
    let resolve;
    let modelRequests = 0;
    backendClient.getNovelProcessJobResults = () => new Promise(done => { resolve = done; });
    backendClient.polishNovelProcessLinks = async () => { modelRequests++; throw Error("Unexpected model request"); };
    const pending = novel.getState().importNovelProcessJobResults("old_project_job");
    project.setState({ projectId: "new_project" });
    novel.getState().hydratePersistence(undefined);
    resolve({ completedResults: [], warnings: [], completedChapterResults: [{
      chapterIndex: 0, sourceChunkIds: ["old_chunk"], summary: "", qualityWarnings: [],
      scene: { scene_id: "old_project_scene", title: "旧工程结果", summary: "", chapter: 1, tags: [],
        is_ending: true, commands: [{ type: "narration", text: "旧响应不能写入新工程。" }] },
    }] });
    const result = await pending;
    const after = JSON.stringify({ nodes: editor.getState().nodes, edges: editor.getState().edges });
    if (result !== undefined || before !== after)
      throw Error("A delayed result from the previous project mutated the current project's graph");
    if (modelRequests !== 0) throw Error("Ownership acceptance must not issue model requests");
    const cases = [{ name: "stale-result-does-not-mutate-next-project", status: "PASS" }];
    const currentProject = project.getState().projectId;
    let fail;
    backendClient.getNovelProcessJobResults = () => new Promise((_, reject) => { fail = reject; });
    const oldError = novel.getState().importNovelProcessJobResults("stale_error_job");
    novel.getState().hydratePersistence(undefined);
    const errors = JSON.stringify(novel.getState().errors);
    fail(Error("old-project-transport-error"));
    await oldError;
    if (JSON.stringify(novel.getState().errors) !== errors) throw Error("A stale error leaked into the new session");
    cases.push({ name: "stale-error-does-not-change-current-session", status: "PASS" });
    let finish;
    backendClient.getNovelProcessJobResults = () => new Promise(done => { finish = done; });
    const aba = novel.getState().importNovelProcessJobResults("aba_job");
    project.setState({ projectId: "aba-other" });
    novel.getState().hydratePersistence(undefined);
    project.setState({ projectId: currentProject });
    novel.getState().hydratePersistence(undefined);
    finish({ completedResults: [], warnings: [], completedChapterResults: [] });
    const warnings = JSON.stringify(novel.getState().errors);
    await aba;
    if (JSON.stringify(novel.getState().errors) !== warnings) throw Error("A→B→A accepted an obsolete response");
    cases.push({ name: "aba-generation-rejects-old-response", status: "PASS" });
    let fetches = 0;
    backendClient.getNovelProcessJobResults = async () => {
      fetches++;
      return { completedResults: [], warnings: [], completedChapterResults: [{
        chapterIndex: 0, sourceChunkIds: ["shared_chunk"], summary: "", qualityWarnings: [],
        scene: { scene_id: "shared_scene", title: "合并请求", summary: "", chapter: 1, tags: [],
          is_ending: true, commands: [{ type: "narration", text: "重复点击只写一次。" }] },
      }] };
    };
    const imported = await Promise.all([novel.getState().importNovelProcessJobResults("shared_job"),
      novel.getState().importNovelProcessJobResults("shared_job")]);
    if (fetches !== 1 || editor.getState().nodes.filter(node => node.data.editorMeta?.sourceProcessJobId === "shared_job").length !== 1
      || imported.some(item => !item)) throw Error("Concurrent result requests must coalesce and import one chapter only");
    cases.push({ name: "concurrent-result-import-is-single-flight", status: "PASS" });
    novel.getState().updateNovelProcessingDraft({ userInstruction: "仅属于工程A的草稿" });
    project.setState({ projectId: "cache_project_b",
      settings: { ...project.getState().settings, novelPersistence: undefined } });
    novel.getState().hydratePersistence(undefined);
    await new Promise(done => setTimeout(done, 450));
    const cachedA = JSON.parse(localStorage.getItem(`agentvn.novelProcessing.v1.${encodeURIComponent(currentProject)}`) || "null");
    if (cachedA?.userInstruction !== "仅属于工程A的草稿"
      || novel.getState().processing.userInstruction === "仅属于工程A的草稿"
      || project.getState().settings.novelPersistence?.processingSnapshot?.userInstruction === "仅属于工程A的草稿")
      throw Error("Project switch must retain A's task draft without persisting it into B");
    project.setState({ projectId: currentProject,
      settings: { ...project.getState().settings, novelPersistence: undefined } });
    novel.getState().hydratePersistence(undefined);
    if (novel.getState().processing.userInstruction !== "仅属于工程A的草稿")
      throw Error("Returning to A must restore its scoped task draft");
    cases.push({ name: "project-cache-and-delayed-persistence-are-isolated", status: "PASS" });
    const { readPersistedNovelProcessTaskSnapshot } = await import("/src/novel-import/novelProcessJobAdapter.ts");
    const legacy = { events: [], job: { jobId: "unknown_owner", status: "running" } };
    localStorage.setItem("agentvn.novelProcessTaskWorkbench.snapshot", JSON.stringify(legacy));
    localStorage.setItem("agentvn.novelProcessing.v1", JSON.stringify({ jobs: [{ jobId: "unknown_owner" }] }));
    const unknown = readPersistedNovelProcessTaskSnapshot("never_loaded_project");
    novel.getState().hydratePersistence(undefined);
    if (unknown || !localStorage.getItem("agentvn.novelProcessTaskWorkbench.snapshot")
      || !localStorage.getItem("agentvn.novelProcessing.v1"))
      throw Error("Unattributed legacy snapshots must be retained, not assigned to the current project");
    cases.push({ name: "unattributed-legacy-caches-remain-unassigned", status: "PASS" });
    const provider = await import("/src/providers/providerRegistry.ts");
    const { saveApiKey } = await import("/src/providers/apiKeyStorage.ts");
    provider.saveProviderConnection({ connection_id: "isolated_acceptance_provider",
      provider_type: "openai_compatible", display_name: "隔离验收", base_url: "http://127.0.0.1:1",
      api_key_storage: "session", enabled: true, supports_model_discovery: false });
    provider.createProviderModel("isolated_acceptance_provider", { provider_id: "isolated_acceptance_model",
      model_id: "acceptance-only", model_name: "acceptance-only", enabled: true, capabilities: ["text_generation"] });
    provider.setCapabilitySelection("text_generation", "isolated_acceptance_model");
    saveApiKey("isolated_acceptance_provider", "acceptance-only-not-real-key", "session");
    novel.getState().resetSession();
    await novel.getState().importFile(new File(["这是只用于工程归属验收的小说原文。".repeat(50)], "归属验收.txt", { type: "text/plain" }));
    novel.getState().confirmDirectImport();
    let finishCreate;
    backendClient.createNovelProcessJob = () => new Promise(done => { finishCreate = done; });
    let obsoletePanelReads = 0;
    backendClient.getNovelProcessJob = async () => { obsoletePanelReads++; throw Error("obsolete creation follow-up"); };
    const creating = novel.getState().createNovelProcessingJob();
    if (!finishCreate) throw Error("Controlled creation did not reach the transport boundary");
    project.setState({ projectId: "creation_project_b",
      settings: { ...project.getState().settings, novelPersistence: undefined } });
    novel.getState().hydratePersistence(undefined);
    finishCreate({ jobId: "old_created_job" });
    await creating;
    if (obsoletePanelReads || novel.getState().processing.jobs.some(job => job.jobId === "old_created_job")
      || novel.getState().jobCreation.status !== "idle")
      throw Error("An obsolete create-job response must not attach a task or follow-up requests to B");
    cases.push({ name: "stale-job-creation-does-not-attach-to-next-project", status: "PASS" });
    const { requestCanvasNodeFocus } = await import("/src/components/workspace/workspaceContracts.ts");
    const { captureNovelTaskOwnership, isNovelTaskOwnershipCurrent } = await import("/src/store/novelImportStore.ts");
    const focusOwner = captureNovelTaskOwnership("focus-generation");
    const focusAbort = new AbortController();
    const staleFocus = requestCanvasNodeFocus("scene", .82,
      () => isNovelTaskOwnershipCurrent(focusOwner), focusAbort.signal);
    novel.getState().hydratePersistence(undefined);
    if (await staleFocus) throw Error("A canvas focus request must not survive a same-project session reset");
    focusAbort.abort();
    await new Promise(requestAnimationFrame);
    if (document.activeElement?.getAttribute("data-id") === "scene")
      throw Error("An obsolete canvas focus callback stole DOM focus");
    cases.push({ name: "canvas-focus-rejects-obsolete-session-generation", status: "PASS" });
    const currentFocusOwner = captureNovelTaskOwnership("focus-abort");
    const cancelledFocus = new AbortController();
    const pendingFocus = requestCanvasNodeFocus("scene", .82,
      () => isNovelTaskOwnershipCurrent(currentFocusOwner), cancelledFocus.signal);
    cancelledFocus.abort();
    if (await pendingFocus) throw Error("Cancelled canvas focus must resolve without success");
    await new Promise(requestAnimationFrame);
    if (document.activeElement?.getAttribute("data-id") === "scene")
      throw Error("Cancelled canvas focus stole DOM focus");
    cases.push({ name: "canvas-focus-abort-cleans-pending-render-callback", status: "PASS" });
    return cases;
  });
}

function snapshot(projectId) {
  const now = new Date().toISOString();
  return { projectId, events: [], job: {
    jobId: "floating-acceptance", novelTitle: "解析悬浮窗验收", status: "running",
    selectedChapterCount: 1, totalChunks: 4, completedChunks: 2, failedChunks: 0,
    cancelledChunks: 0, runningAgentCount: 1, estimatedRemainingChunks: 2,
    progressPercent: 50, tokenStats: { totalInputTokens: 320, totalOutputTokens: 180,
      totalTokens: 500, estimatedTokens: 1000, actualTokens: 500, averageChunkTokens: 250,
      retryExtraTokens: 0, byAgent: [], byChapter: [] },
    agents: [], chapters: [], source: "mock", createdAt: now, updatedAt: now,
  } };
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let env, browser, page;
  try {
    assert(matrix.length > 0, "Floating acceptance must execute a nonempty viewport matrix");
    env = await startEditorAcceptance(output);
    const project = JSON.parse(fs.readFileSync(env.input, "utf8"));
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    report.isolation = { input: env.input, output: env.output,
      backendPid: env.backendPid, backendUrl: env.backendUrl, fixtureProjectId: env.fixtureProjectId };
    report.matrix = { viewports: matrix, dpr: Number(process.env.FLOATING_DPR || 1),
      reduced: process.env.FLOATING_REDUCED === "1" };
    const headless = process.env.FLOATING_HEADFUL !== "1";
    const args = ["--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])];
    browser = await chromium.launch({ headless, args });
    report.browser = { version: browser.version(), headless, args };
    const browserCdp = await browser.newBrowserCDPSession();
    report.browser.gpu = (await browserCdp.send("SystemInfo.getInfo")).gpu;
    await browserCdp.detach();
    if (caseName === "initial-refresh") {
      page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      const value = snapshot(project.project_id);
      value.job.jobId = "creation-refresh";
      value.job.source = "api";
      const intervals = [];
      let initialPauseCalls = 0;
      await page.route("**/api/novel/processing/execute/jobs/creation-refresh/panel", async route => {
        const interval = { request: route.request(), start: Date.now() };
        intervals.push(interval);
        try {
          await new Promise(done => setTimeout(done, 3000));
          await route.fulfill({ json: value.job });
        } finally { interval.end = Date.now(); }
      });
      await page.route("**/api/novel/processing/execute/jobs/creation-refresh/events?*",
        route => route.fulfill({ json: [] }));
      await page.route("**/api/novel/processing/execute/jobs/creation-refresh/pause", async route => {
        initialPauseCalls++;
        value.job.status = "paused";
        await route.fulfill({ json: value.job });
      });
      await env.server.run(async () => {
        await env.open(page);
        await page.evaluate(async () => {
          const provider = await import("/src/providers/providerRegistry.ts");
          const { saveApiKey } = await import("/src/providers/apiKeyStorage.ts");
          provider.saveProviderConnection({ connection_id: "creation_refresh_provider",
            provider_type: "openai_compatible", display_name: "受控创建验收", base_url: "http://127.0.0.1:1",
            api_key_storage: "session", enabled: true, supports_model_discovery: false });
          provider.createProviderModel("creation_refresh_provider", { provider_id: "creation_refresh_model",
            model_id: "acceptance-only", model_name: "acceptance-only", enabled: true, capabilities: ["text_generation"] });
          provider.setCapabilitySelection("text_generation", "creation_refresh_model");
          saveApiKey("creation_refresh_provider", "not-a-real-key", "session");
          const { backendClient } = await import("/src/api/backendClient.ts");
          // Only the external create transport is controlled. Initial reads,
          // polling, ownership, task UI and persistence use production code.
          backendClient.createNovelProcessJob = async () => ({ jobId: "creation-refresh" });
          backendClient.polishNovelProcessLinks = async () => { throw Error("Unexpected model request"); };
          const novel = (await import("/src/store/novelImportStore.ts")).useNovelImportStore;
          await novel.getState().importFile(new File(["受控任务创建与刷新验收。".repeat(50)],
            "创建刷新.txt", { type: "text/plain" }));
          novel.getState().confirmDirectImport();
          await novel.getState().createNovelProcessingJob();
          if (novel.getState().jobCreation.status !== "created") throw Error("Controlled job creation did not finish");
        });
        await page.getByTestId("novel-task-mini-entry").waitFor({ state: "visible" });
        await page.getByRole("button", { name: /打开小说任务面板/ }).click();
        await page.getByTestId("novel-task-workbench").getByRole("button", { name: "暂停", exact: true }).click();
        await page.getByTestId("novel-task-workbench").getByRole("button", { name: "继续", exact: true })
          .waitFor({ state: "visible" });
        assert.equal(initialPauseCalls, 1,
          "Controls before the first refresh must operate the created backend task, not a local mock task");
        const deadline = Date.now() + 9000;
        while (Date.now() < deadline && intervals.filter(item => item.end && !item.request.failure()).length < 2)
          await page.waitForTimeout(100);
        const live = intervals.filter(item => !item.request.failure());
        report.intervals = intervals.map(item => ({ start: item.start, end: item.end, failure: item.request.failure() }));
        assert(live.filter(item => item.end).length >= 2, "Creation acceptance must observe multiple actual refreshes");
        assert(!live.some((item, index) => live.slice(index + 1).some(other =>
          other.start < (item.end ?? Infinity) && item.start < (other.end ?? Infinity))),
        "Create-job initial load and mounted workbench polling must not overlap for the same task");
        assert.equal(await page.getByTestId("novel-task-workbench").getAttribute("data-job-status"), "paused",
          "Created task must reach the real API-backed workbench");
        report.cases.push({ name: "creation-and-polling-share-one-refresh-owner", status: "PASS" });
      });
      report.status = "PASS";
      return;
    }
    if (caseName === "ownership") {
      page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await env.server.run(async () => {
        await env.open(page);
        report.cases.push(...await ownershipCase(page));
      });
      report.status = "PASS";
      return;
    }
    if (caseName === "controller") {
      page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      const value = snapshot(project.project_id);
      value.job.source = "api";
      await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
        { key: `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(project.project_id)}`, value });
      let active = 0, maxActive = 0, requests = 0;
      const intervals = [];
      await page.route("**/api/novel/processing/execute/jobs/floating-acceptance/panel", async route => {
        requests++; active++; maxActive = Math.max(active, maxActive);
        const interval = { request: route.request(), start: Date.now(), end: undefined };
        intervals.push(interval);
        try {
          await new Promise(done => setTimeout(done, 1200));
          await route.fulfill({ json: value.job });
        } finally { active--; interval.end = Date.now(); }
      });
      await page.route("**/api/novel/processing/execute/jobs/floating-acceptance/events?*", route => route.fulfill({ json: [] }));
      await env.server.run(async () => {
        await env.open(page);
        await page.waitForFunction(() => document.querySelector('[data-testid="novel-task-mini-entry"]'));
        await new Promise(done => setTimeout(done, 1800));
        const live = intervals.filter(item => !item.request.failure());
        const overlaps = live.some((item, index) => live.slice(index + 1)
          .some(other => other.start < (item.end ?? Infinity) && item.start < (other.end ?? Infinity)));
        assert(requests > 0 && live.some(item => item.end) && !overlaps,
          `Task polling must be single-flight (aborted mount requests excluded), requests=${requests}, rawMax=${maxActive}`);
        report.cases.push({ name: "slow-task-polling-does-not-overlap", status: "PASS", requests,
          rawMaxActive: maxActive, cancelledMountRequests: intervals.length - live.length,
          intervals: intervals.map(item => ({ start: item.start, end: item.end, failure: item.request.failure() })) });
        let releasePause;
        let pauseFinished;
        const finished = new Promise(done => { pauseFinished = done; });
        await page.route("**/api/novel/processing/execute/jobs/floating-acceptance/pause", async route => {
          await new Promise(done => { releasePause = done; });
          await route.fulfill({ json: { ...value.job, status: "paused" } });
          pauseFinished();
        });
        await page.getByRole("button", { name: /打开小说任务面板/ }).click();
        const pauseRequest = page.waitForRequest(request => request.url().endsWith("/floating-acceptance/pause"));
        await page.getByRole("button", { name: "暂停", exact: true }).click();
        await pauseRequest;
        const next = snapshot("controller_b");
        next.job.novelTitle = "工程B独立任务";
        next.job.jobId = "controller_b_job";
        next.job.source = "api";
        const taskActions = [];
        await page.route("**/api/novel/processing/execute/jobs/controller_b_job/**", async route => {
          const operation = new URL(route.request().url()).pathname.split("/").pop();
          if (operation === "events") { await route.fulfill({ json: [] }); return; }
          const states = { pause: "paused", resume: "running", retry_failed_chunks: "retrying", cancel: "cancelled" };
          if (states[operation]) { taskActions.push(operation); next.job.status = states[operation]; }
          await route.fulfill({ json: next.job });
        });
        await page.evaluate(async next => {
          const { useProjectStore } = await import("/src/store/projectStore.ts");
          const { useNovelImportStore } = await import("/src/store/novelImportStore.ts");
          localStorage.setItem(`agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(next.projectId)}`, JSON.stringify(next));
          useProjectStore.setState({ projectId: next.projectId,
            settings: { ...useProjectStore.getState().settings, novelPersistence: undefined } });
          useNovelImportStore.getState().hydratePersistence(undefined);
        }, next);
        await page.waitForFunction(() => document.querySelector('[data-testid="novel-task-mini-entry"]')?.getAttribute("data-job-status") === "running");
        releasePause();
        await finished;
        await page.waitForTimeout(150);
        assert(await page.getByRole("button", { name: /打开小说任务面板/ }).isVisible(),
          "Old action response must not replace or hide project B's task card");
        const title = await page.getByTestId("novel-task-mini-entry").getAttribute("title");
        assert((title || await page.getByTestId("novel-task-mini-entry").textContent()).includes("工程B独立任务"),
          "Old action response must preserve project B's task identity");
        report.cases.push({ name: "stale-task-action-keeps-new-project-card", status: "PASS" });
        await page.getByRole("button", { name: /打开小说任务面板/ }).click();
        const workbench = page.getByTestId("novel-task-workbench");
        await workbench.getByRole("button", { name: "暂停", exact: true }).click();
        await workbench.getByRole("button", { name: "继续", exact: true }).waitFor({ state: "visible" });
        await workbench.getByRole("button", { name: "继续", exact: true }).click();
        await workbench.getByRole("button", { name: "暂停", exact: true }).waitFor({ state: "visible" });
        next.job.status = "failed_partial";
        await workbench.getByRole("button", { name: "重试失败项", exact: true }).waitFor({ state: "visible" });
        await workbench.getByRole("button", { name: "重试失败项", exact: true }).click();
        await workbench.getByRole("button", { name: "暂停", exact: true }).waitFor({ state: "visible" });
        await workbench.getByRole("button", { name: "取消", exact: true }).click();
        await workbench.getByRole("button", { name: "查看已完成结果", exact: true }).waitFor({ state: "visible" });
        assert.deepEqual(taskActions, ["pause", "resume", "retry_failed_chunks", "cancel"]);
        report.cases.push({ name: "real-task-buttons-preserve-pause-resume-retry-cancel", status: "PASS", taskActions });
      });
      report.status = "PASS";
      return;
    }
    for (const viewport of matrix) {
      page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: Number(process.env.FLOATING_DPR || 1),
        reducedMotion: process.env.FLOATING_REDUCED === "1" ? "reduce" : "no-preference",
      });
      await page.addInitScript(({ key, value }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
      }, { key: `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(project.project_id)}`,
        value: snapshot(project.project_id) });
      await page.bringToFront();
      await page.waitForFunction(() => document.visibilityState === "visible");
      await env.server.run(async () => {
        await env.open(page);
        const mini = page.getByTestId("novel-task-mini-entry");
        await mini.waitFor({ state: "visible" });
        const workspaceBefore = caseName === "workspace" ? await page.evaluate(() => {
          const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
          };
          return { palette: rect(".node-palette"), flow: rect(".flow-surface"), inspector: rect(".scene-editor-pane") };
        }) : null;
        const geometry = await mini.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            right: rect.right, bottom: rect.bottom, text: element.textContent,
            viewportWidth: innerWidth, viewportHeight: innerHeight,
            pageWidth: document.documentElement.scrollWidth,
            hasProgress: Boolean(element.querySelector('[role="progressbar"]')),
          };
        });
        assert(geometry.width >= 138 && geometry.width <= 142 && geometry.height >= 80 && geometry.height <= 96,
          `Collapsed task must be a compact ~140×88 card, not an icon: ${JSON.stringify(geometry)}`);
        assert(geometry.text.includes("解析悬浮窗验收") && geometry.text.includes("处理中") && geometry.hasProgress,
          `Title, status and progress must be visible without hover: ${JSON.stringify(geometry)}`);
        assert(geometry.x >= 12 && geometry.y >= 12 && geometry.right <= viewport.width - 12
          && geometry.bottom <= viewport.height - 12 && geometry.pageWidth <= viewport.width + 1,
          `Collapsed task must stay inside viewport without overflow: ${JSON.stringify(geometry)}`);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle"));
        const rect = await mini.boundingBox();
        const hit = await page.evaluate(({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="novel-task-mini-entry"]')),
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
        assert(hit, "Options workspace must not cover the task card's real pointer target");
        if (caseName === "handoff") {
          await handoffCase(page, viewport, mini);
          return;
        }
        await mini.getByRole("button", { name: /打开小说任务面板/ }).click();
        const panel = page.getByTestId("novel-task-workbench");
        await page.waitForTimeout(300);
        if (!await panel.isVisible()) {
          const diagnostic = await page.evaluate(() => ({
            cardInert: document.querySelector('[data-testid="novel-task-mini-entry"]')?.inert,
            cardSuppressed: document.querySelector('[data-testid="novel-task-mini-entry"]')?.getAttribute("data-suppressed"),
            modalBlockers: [...document.querySelectorAll('[aria-modal="true"]')].map(node => ({
              tag: node.tagName, className: node.className, hidden: node.hidden,
              visibility: getComputedStyle(node).visibility, rects: node.getClientRects().length,
            })),
          }));
          throw Error(`Task panel did not open after clicking its visible action: ${JSON.stringify(diagnostic)}`);
        }
        await panel.waitFor({ state: "visible" });
        const panelRect = await panel.boundingBox();
        assert(panelRect.x >= 0 && panelRect.y >= 0 && panelRect.x + panelRect.width <= viewport.width + 1
          && panelRect.y + panelRect.height <= viewport.height + 1, "Expanded task panel must not be clipped");
        const footerTargets = await panel.locator(".novel-task-actions button").evaluateAll(buttons => buttons.map(button => {
          const r = button.getBoundingClientRect();
          return { label: button.textContent, x: r.x, y: r.y, right: r.right, bottom: r.bottom,
            hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("button") === button };
        }));
        assert(footerTargets.length > 0 && footerTargets.every(target => target.hit && target.x >= panelRect.x
          && target.y >= panelRect.y && target.right <= panelRect.x + panelRect.width
          && target.bottom <= panelRect.y + panelRect.height),
          `Every footer operation must be fully visible and own its real hit target: ${JSON.stringify(footerTargets)}`);
        if (caseName === "workspace") {
          const probe = await page.evaluate(() => {
            const rect = selector => {
              const node = document.querySelector(selector), r = node.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
            };
            const ancestors = [];
            for (let node = document.querySelector(".node-palette"); node; node = node.parentElement) {
              const style = getComputedStyle(node);
              if (style.filter !== "none" || style.visibility === "hidden" || style.display === "none")
                ancestors.push({ tag: node.tagName, filter: style.filter, visibility: style.visibility, display: style.display });
            }
            const backdrop = document.querySelector(".novel-task-backdrop");
            return { palette: rect(".node-palette"), flow: rect(".flow-surface"),
              inspector: rect(".scene-editor-pane"), panel: rect('[data-testid="novel-task-workbench"]'),
              backdrop: rect(".novel-task-backdrop"), backdropFilter: getComputedStyle(backdrop).backdropFilter,
              paletteAffectedAncestors: ancestors };
          });
          assert(probe.backdrop.x >= probe.palette.right && probe.backdrop.right <= probe.inspector.x,
            `Task backdrop must soften only the retained canvas, never the node rail or Inspector: ${JSON.stringify(probe)}`);
          assert(probe.panel.x >= probe.flow.x && probe.panel.right <= probe.flow.right
            && probe.panel.y >= probe.flow.y && probe.panel.bottom <= probe.flow.bottom,
          `Task panel must use the actual canvas track without covering Inspector: ${JSON.stringify(probe)}`);
          assert.equal(probe.paletteAffectedAncestors.length, 0, "Node rail must remain clear and visible");
          for (const track of ["palette", "flow", "inspector"]) {
            for (const field of ["x", "y", "width", "height"])
              assert(Math.abs(probe[track][field] - workspaceBefore[track][field]) < 1,
                `${track}.${field} changed after task-panel entrance`);
          }
          await page.locator('[data-workspace-surface="edit"]:visible').click();
          await page.waitForFunction(() => {
            const flow = document.querySelector(".flow-surface");
            return !flow.closest("[inert]") && !document.querySelector(".toolbar-popover.advanced.is-open");
          });
          const countBefore = await page.locator(".react-flow__node").count();
          await page.locator(".node-palette").getByRole("button", { name: /场景节点/ }).click();
          await page.waitForFunction(count => document.querySelectorAll(".react-flow__node").length === count + 1, countBefore);
          assert(await panel.isVisible(), "Nonmodal task must stay open while the node rail remains usable");
          await page.screenshot({ path: path.join(output, `${viewport.name}-workspace.png`) });
          await panel.getByRole("button", { name: "最小化任务面板", exact: true }).click();
          await panel.waitFor({ state: "hidden" });
          assert.equal(await page.locator(".novel-task-backdrop").count(), 0, "Task backdrop must leave with its owner");
          report.cases.push({ viewport, name: "task-panel-preserves-clear-usable-workspace-tracks", status: "PASS", probe });
          return;
        }
        if (caseName === "local-actions") {
          // Control execution at the task boundary; the actual rendered buttons,
          // adapter, state updates and persistence remain production code.
          await page.evaluate(async () => {
            const { useNovelImportStore } = await import("/src/store/novelImportStore.ts");
            window.__floatingLocalActions = [];
            useNovelImportStore.setState({
              pauseBlueprintGeneration: () => window.__floatingLocalActions.push("pause"),
              resumeBlueprintGeneration: async () => { window.__floatingLocalActions.push("resume"); },
              retryFailedNovelAgentTasks: () => window.__floatingLocalActions.push("retry"),
              cancelBlueprintGeneration: () => window.__floatingLocalActions.push("cancel"),
            });
          });
          const action = async (label, status, nextLabel) => {
            await panel.getByRole("button", { name: label, exact: true }).click();
            await page.waitForFunction(status => {
              const panel = document.querySelector('[data-testid="novel-task-workbench"]');
              return panel && panel.getAttribute("data-job-status") === status;
            }, status, { timeout: 3000 });
            assert(await panel.isVisible(), `Local ${label} must not hide its project-owned panel`);
            await panel.getByRole("button", { name: nextLabel, exact: true }).waitFor({ state: "visible" });
            const saved = await page.evaluate(projectId => JSON.parse(localStorage.getItem(
              `agentvn.novelProcessTaskWorkbench.snapshot.${encodeURIComponent(projectId)}`) || "null"),
            project.project_id);
            assert.equal(saved?.projectId, project.project_id, "Local actions must retain persisted ownership");
            assert.equal(saved?.job.jobId, "floating-acceptance", "Local actions must retain task identity");
            assert.equal(saved?.job.status, status, "Persisted status must match the displayed status");
          };
          await action("暂停", "paused", "继续");
          await action("继续", "running", "暂停");
          await page.evaluate(value => window.dispatchEvent(new CustomEvent(
            "agentvn:novel-processing-pressure-snapshot",
            { detail: { ...value, job: { ...value.job, status: "failed_partial" } } })),
          snapshot(project.project_id));
          await action("重试失败项", "retrying", "暂停");
          await action("取消", "cancelled", "查看已完成结果");
          assert.deepEqual(await page.evaluate(() => window.__floatingLocalActions),
            ["pause", "resume", "retry", "resume", "cancel"]);
          await panel.getByRole("button", { name: "收起面板", exact: true }).click();
          await panel.waitFor({ state: "hidden" });
          assert.equal(await mini.getAttribute("data-job-status"), "cancelled");
          await env.open(page);
          await mini.waitFor({ state: "visible" });
          assert.equal(await mini.getAttribute("data-job-status"), "cancelled",
            "Reload must retain the current project's final local task state");
          await page.screenshot({ path: path.join(output, `${viewport.name}-local-actions.png`) });
          report.cases.push({ viewport, name: "local-task-actions-retain-identity-and-reload", status: "PASS" });
          return;
        }
        if (caseName === "motion") {
          const opacityFrames = await panel.evaluate(async element => {
            const frames = [];
            const until = performance.now() + 280;
            while (performance.now() < until) {
              await new Promise(requestAnimationFrame);
              const r = element.getBoundingClientRect();
              frames.push({ time: performance.now(), x: r.x, y: r.y, width: r.width, height: r.height,
                opacity: Number(getComputedStyle(element).opacity) });
            }
            return frames;
          });
          assert(opacityFrames.length > 0, "Panel motion acceptance must sample actual rendered frames");
          const firstFrame = opacityFrames[0];
          assert(opacityFrames.every(frame =>
            Math.abs(frame.width - firstFrame.width) <= 1
            && Math.abs(frame.height - firstFrame.height) <= 1
            && frame.x >= 0 && frame.y >= 0
            && frame.x + frame.width <= viewport.width + 1
            && frame.y + frame.height <= viewport.height + 1),
          "Panel motion must preserve dimensions and remain within the actual viewport on every sampled frame");
          const token = panel.locator(".novel-token-panel");
          const tokenBefore = await token.boundingBox();
          await token.getByRole("tab", { name: "按处理槽" }).click();
          const tokenMotion = await token.evaluate(element => ({
            height: element.getBoundingClientRect().height,
            frames: element.getAnimations({ subtree: true }).flatMap(animation =>
              animation.effect?.getKeyframes().map(frame => Object.keys(frame)) || []),
            durations: element.getAnimations({ subtree: true }).map(animation => animation.effect?.getTiming().duration),
          }));
          assert(Math.abs(tokenBefore.height - tokenMotion.height) <= 1
            && tokenMotion.frames.every(keys => !keys.includes("height") && !keys.includes("width"))
            && tokenMotion.durations.every(duration => typeof duration === "number" && duration <= 240),
            `Token tabs must not morph layout or exceed motion budget: ${JSON.stringify({ tokenBefore, tokenMotion })}`);
          // Mount the real confirmation component, not a synthetic DOM overlay.
          await page.evaluate(async () => {
            const reactModule = await import("/node_modules/.vite/deps/react.js");
            const React = reactModule.default ?? reactModule;
            const domModule = await import("/node_modules/.vite/deps/react-dom_client.js");
            const createRoot = domModule.createRoot ?? domModule.default.createRoot;
            const { OperationResultDialog } = await import("/src/components/common/OperationResultDialog.tsx");
            const host = document.createElement("div");
            document.body.append(host);
            const root = createRoot(host);
            root.render(React.createElement(OperationResultDialog, {
              open: true, tone: "warning", label: "确认", title: "真实弹窗优先级",
              message: "任务浮层不得抢焦点", icon: null, testId: "floating-modal-proof",
              onDismiss: () => { root.unmount(); host.remove(); },
            }));
          });
          await page.getByTestId("floating-modal-proof").waitFor({ state: "visible" });
          const blocked = await panel.evaluate(element => Boolean(element.closest("[inert]")));
          assert(blocked, "Task panel must become inert while a confirmation modal is open");
          const modalHit = await page.getByTestId("floating-modal-proof").locator('[role="dialog"]').evaluate(element => {
            const r = element.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[role="dialog"]') === element;
          });
          assert(modalHit, "The real confirmation must own its visible hit target above the task surface");
          await page.keyboard.press("Escape");
          await page.getByTestId("floating-modal-proof").waitFor({ state: "hidden" });
          assert(await panel.isVisible(), "Escape must close only the confirmation, not the task panel");
          report.cases.push({ viewport, name: "bounded-token-motion-and-modal-priority", status: "PASS", tokenMotion, opacityFrames });
          const minimizeRect = await panel.getByRole("button", { name: "最小化任务面板", exact: true }).boundingBox();
          await page.mouse.click(minimizeRect.x + minimizeRect.width / 2, minimizeRect.y + minimizeRect.height / 2);
          const exitState = await page.evaluate(() => {
            const panel = document.querySelector('[data-testid="novel-task-workbench"]');
            const card = document.querySelector('[data-testid="novel-task-mini-entry"]');
            const button = card.querySelector(".novel-task-card-open");
            const r = button.getBoundingClientRect();
            return { mounted: Boolean(panel), blocked: !panel || Boolean(panel.closest("[inert]")),
              cardVisible: getComputedStyle(card).visibility === "visible",
              x: r.x + r.width / 2, y: r.y + r.height / 2 };
          });
          assert(exitState.cardVisible, "Collapsed card must become available immediately to reverse an exit");
          assert(exitState.blocked, "Exiting panel must be inert or already unmounted, never interactive");
          // Real consecutive input, without locator auto-waits outlasting the
          // reduced-motion exit. No forced clicks or synthetic click events.
          await page.mouse.click(exitState.x, exitState.y);
          await page.waitForFunction(() => {
            const panel = document.querySelector('[data-testid="novel-task-workbench"]');
            return panel && !panel.closest("[inert]") && Number(getComputedStyle(panel).opacity) > .99;
          });
          assert(await panel.isVisible(), "Latest reopen must win over the obsolete exit callback");
          await panel.getByRole("button", { name: "最小化任务面板", exact: true }).click();
          await panel.waitFor({ state: "hidden" });
          await page.waitForFunction(() => document.activeElement?.matches(".novel-task-card-open"),
            undefined, { timeout: 500 });
          assert(await mini.getByRole("button", { name: /打开小说任务面板/ }).evaluate(element => element === document.activeElement),
            "Minimizing must restore focus to the card");
          report.cases.push({ viewport, name: "interruptible-panel-exit-and-focus-restore", status: "PASS", exitState });
          await mini.getByRole("button", { name: /打开小说任务面板/ }).focus();
          await page.keyboard.press("Enter");
          await panel.waitFor({ state: "visible" });
          assert(await panel.evaluate(element => element.contains(document.activeElement)),
            "Keyboard opening must immediately move focus into the task panel");
          await page.keyboard.press("Escape");
          await panel.waitFor({ state: "hidden" });
          assert.equal(await page.locator('[data-workspace-surface="options"]:visible').getAttribute("aria-current"), "page",
            "Task Escape must not close the underlying options workspace");
          report.cases.push({ viewport, name: "keyboard-open-focus-and-topmost-escape", status: "PASS" });
          return;
        }
        await page.screenshot({ path: path.join(output, `${viewport.name}-expanded.png`) });
        report.cases.push({ viewport, name: "readable-card-and-workspace-hit-target", status: "PASS", geometry, panelRect });
        await panel.getByRole("button", { name: "最小化任务面板", exact: true }).click();
        await mini.waitFor({ state: "visible" });
        const original = await mini.boundingBox();
        const grip = mini.getByRole("button", { name: "拖动小说任务卡片" });
        const gripRect = await grip.boundingBox();
        await page.mouse.move(gripRect.x + 20, gripRect.y + gripRect.height / 2);
        await page.mouse.down();
        await page.mouse.move(gripRect.x + 24, gripRect.y + gripRect.height / 2);
        const belowThreshold = await mini.boundingBox();
        assert(Math.abs(original.x - belowThreshold.x) < 1, "Sub-6px movement must not drag the card");
        await page.mouse.move(gripRect.x - 140, gripRect.y - 45, { steps: 8 });
        await page.mouse.up();
        const dragged = await mini.boundingBox();
        assert(original.x - dragged.x >= Math.min(100, original.x - 12) - 1 && dragged.y >= 12,
          `Title handle must drag horizontally while respecting the available vertical bounds: ${JSON.stringify({ viewport, original, dragged })}`);
        const panelRemainsInteractive = await page.evaluate(() => {
          const element = document.querySelector('[data-testid="novel-task-workbench"]');
          return Boolean(element && !element.closest("[inert]")
            && getComputedStyle(element).visibility !== "hidden");
        });
        assert(!panelRemainsInteractive,
          "Drag release must not reopen an interactive task panel");
        await panel.waitFor({ state: "hidden" });
        const position = await page.evaluate(projectId => JSON.parse(localStorage.getItem(
          `agentvn.novelTask.position.${encodeURIComponent(projectId)}`) || "null"), project.project_id);
        assert(position && position.x >= 0 && position.x <= 1 && position.y >= 0 && position.y <= 1,
          "Drag position must persist as project-scoped normalized coordinates");
        // A restart opens the project home. Reopen through the actual import
        // control rather than assuming the editor auto-resumes after reload.
        await env.open(page);
        await mini.waitFor({ state: "visible" });
        const restored = await mini.boundingBox();
        assert(Math.abs(restored.x - dragged.x) < 2 && Math.abs(restored.y - dragged.y) < 2,
          `Reload must restore the current project's position: ${JSON.stringify({ restored, dragged })}`);
        const resizedViewport = matrix.find(item => item.name !== viewport.name) || { width: 2560, height: 1440 };
        await page.setViewportSize({ width: resizedViewport.width, height: resizedViewport.height });
        await page.waitForFunction(viewport => {
          const r = document.querySelector('[data-testid="novel-task-mini-entry"]')?.getBoundingClientRect();
          return r && r.x >= 12 && r.y >= 12 && r.right <= viewport.width - 12 && r.bottom <= viewport.height - 12;
        }, resizedViewport);
        const resized = await mini.boundingBox();
        assert(resized.x >= 12 && resized.y >= 12 && resized.x + resized.width <= resizedViewport.width - 12
          && resized.y + resized.height <= resizedViewport.height - 12, "Resize must constrain restored coordinates into the viewport");
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForFunction(width => innerWidth === width, viewport.width);
        await mini.getByRole("button", { name: "恢复任务卡片默认位置" }).click();
        await page.waitForFunction(original => {
          const r = document.querySelector('[data-testid="novel-task-mini-entry"]')?.getBoundingClientRect();
          return r && Math.abs(r.x - original.x) < 2 && Math.abs(r.y - original.y) < 2;
        }, original);
        const reset = await mini.boundingBox();
        assert(Math.abs(original.x - reset.x) < 2 && Math.abs(original.y - reset.y) < 2,
          "Reset must restore the default bottom-right position");
        report.cases.push({ viewport, name: "drag-threshold-persistence-resize-and-reset", status: "PASS",
          original, dragged, restored, resized, resizedViewport, reset });
        // Lose native capture mid-drag, then exercise real Chromium multi-touch
        // cancellation. These are browser input events, not dispatched React
        // handlers or synthetic click events.
        await grip.evaluate(button => button.addEventListener("pointerdown", event => {
          button.dataset.acceptancePointerId = String(event.pointerId);
        }, { once: true }));
        const captureGrip = await grip.boundingBox();
        await page.mouse.move(captureGrip.x + 40, captureGrip.y + captureGrip.height / 2);
        await page.mouse.down();
        await page.mouse.move(captureGrip.x + 16, captureGrip.y + captureGrip.height / 2);
        await grip.evaluate(button => button.releasePointerCapture(Number(button.dataset.acceptancePointerId)));
        await page.mouse.move(captureGrip.x + 15, captureGrip.y + captureGrip.height / 2);
        await page.waitForFunction(() =>
          !document.querySelector('[data-testid="novel-task-mini-entry"]')?.classList.contains("is-dragging"));
        await page.mouse.up();
        assert(!(await panel.isVisible()), "Capture loss must not turn drag release into panel opening");
        const touch = await page.context().newCDPSession(page);
        try {
          const touchGrip = await grip.boundingBox();
          const first = { id: 1, x: touchGrip.x + 40, y: touchGrip.y + touchGrip.height / 2 };
          await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
          first.x -= 24;
          await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [first] });
          await page.waitForFunction(() =>
            document.querySelector('[data-testid="novel-task-mini-entry"]')?.classList.contains("is-dragging"));
          const singlePointer = await mini.boundingBox();
          const second = { id: 2, x: singlePointer.x + 110, y: first.y };
          await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first, second] });
          second.x += 30;
          await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [first, second] });
          const multiplePointers = await mini.boundingBox();
          assert(Math.abs(singlePointer.x - multiplePointers.x) < 1 && Math.abs(singlePointer.y - multiplePointers.y) < 1,
            "An additional pointer must not take ownership or move the task card");
          await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
          await page.waitForFunction(() =>
            !document.querySelector('[data-testid="novel-task-mini-entry"]')?.classList.contains("is-dragging"));
          assert(!(await panel.isVisible()), "Touch cancellation must leave the panel collapsed");
          await mini.getByRole("button", { name: "恢复任务卡片默认位置" }).click();
          report.cases.push({ viewport, name: "lost-capture-multitouch-and-cancel-recover", status: "PASS" });
        } finally {
          await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }).catch(() => {});
          await touch.detach();
        }
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle"));
        await mini.getByRole("button", { name: /打开小说任务面板/ }).click();
        // Existing task fixture event changes status only; actual navigation and
        // result selection use the production handlers, without force clicks.
        await page.evaluate(async ({ projectId, value }) => {
          const { useEditorStore } = await import("/src/store/editorStore.ts");
          const { useNovelImportStore } = await import("/src/store/novelImportStore.ts");
          const store = useEditorStore.getState();
          const target = structuredClone(store.nodes.find(node => node.type === "sceneNode"));
          target.id = "task_owned_result";
          target.data.editorMeta = { ...target.data.editorMeta, source: "imported",
            importSessionId: useNovelImportStore.getState().session.session_id };
          const unrelated = structuredClone(target);
          unrelated.id = "unrelated_import";
          unrelated.data.editorMeta.importSessionId = "other_session";
          useEditorStore.setState({ nodes: [...store.nodes, target, unrelated] });
          window.dispatchEvent(new CustomEvent("agentvn:novel-processing-pressure-snapshot",
            { detail: { ...value, projectId, job: { ...value.job, status: "completed" } } }));
        }, { projectId: project.project_id, value: snapshot(project.project_id) });
        await panel.getByRole("button", { name: "查看结果", exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-workspace-surface="edit"]')?.getAttribute("aria-current") === "page");
        const selected = await page.evaluate(async () => (await import("/src/store/editorStore.ts")).useEditorStore.getState().selectedNodeId);
        assert.equal(selected, "task_owned_result", "View result must select this task's node, not an unrelated imported node");
        await page.waitForFunction(() => {
          const target = document.querySelector('.react-flow__node[data-id="task_owned_result"]');
          const flow = target?.closest(".flow-surface");
          return target && document.activeElement === target && flow && !flow.closest("[inert]");
        }, undefined, { timeout: 2000 });
        const resultFocus = await page.locator('.react-flow__node[data-id="task_owned_result"]').evaluate(element => ({
          nodeId: element.getAttribute("data-id"),
          ownsFocus: document.activeElement === element,
          interactive: !element.closest("[inert]"),
        }));
        assert(resultFocus.ownsFocus && resultFocus.interactive,
          "View result must focus the owned node in the interactive editor, not merely select it in the store");
        report.cases.push({ viewport, name: "view-result-navigates-to-edit-and-selects-owned-node",
          status: "PASS", resultFocus });
      });
      await page.close();
    }
    assert(report.cases.length > 0, "No floating task behavior assertions executed");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    if (page && !page.isClosed()) report.failedProbe = await page.evaluate(() => {
      const probe = window.__floatingMotionProbe;
      if (!probe) return undefined;
      const { cancel, ...evidence } = probe;
      return evidence;
    }).catch(() => undefined);
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
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
