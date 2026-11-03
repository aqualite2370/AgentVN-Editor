const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const OUT_DIR = path.join(ROOT, "output", "playwright", "novel-processing-runtime-perf");
const REPORT_PATH = path.join(OUT_DIR, "novel-processing-runtime-perf-audit.json");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const thresholds = {
  "render-pressure-snapshot": { maxLongTaskMs: 100, maxFrameGapMs: 150 },
  "polling-pressure-updates": { maxLongTaskMs: 50, maxFrameGapMs: 120 },
  "result-import-canvas-pressure": { maxLongTaskMs: 150, maxFrameGapMs: 180 },
};
const thresholdToleranceMs = 5;

fs.mkdirSync(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isListening(url) {
  try {
    const response = await fetch(url);
    return response.status < 500;
  } catch {
    return false;
  }
}

function startService(report) {
  const logFile = path.join(OUT_DIR, "novel-processing-runtime-editor.log");
  const child = spawn(NPM, ["run", "dev"], {
    cwd: path.join(ROOT, "editor"),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => fs.appendFileSync(logFile, chunk));
  child.stderr.on("data", (chunk) => fs.appendFileSync(logFile, chunk));
  report.logs.push(logFile);
  return child;
}

async function ensureEditor(report) {
  const started = [];
  if (!(await isListening(EDITOR_URL))) started.push(startService(report));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await isListening(EDITOR_URL)) return started;
    await sleep(700);
  }
  throw new Error(`Editor did not become ready: ${EDITOR_URL}`);
}

function stopServices(started) {
  for (const child of started) {
    if (!child.pid) continue;
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // Already stopped.
    }
  }
}

async function openEditor(page) {
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return !stage || !stage.classList.contains("is-home-hydrating");
  }, null, { timeout: 30_000 }).catch(() => {});

  async function clickFirstReady(selector) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false) && await item.isEnabled().catch(() => false)) {
        await item.click({ force: true });
        return true;
      }
    }
    return false;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.locator(".editor-toolbar").isVisible({ timeout: 800 }).catch(() => false)) return;
    if (!(await clickFirstReady('[data-help-key="home.openDraft"]'))) {
      await clickFirstReady('[data-help-key="home.createProject"]');
    }
    if (await page.locator(".editor-toolbar").isVisible({ timeout: 12_000 }).catch(() => false)) return;
  }
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 30_000 });
}

async function installProjectStateWriteGuard(page, report) {
  let interceptedWrites = 0;
  await page.route("**/api/project/state", async (route) => {
    const request = route.request();
    if (request.method().toUpperCase() !== "POST") {
      await route.continue();
      return;
    }
    interceptedWrites += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          project_graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, memoryMode: "hybrid" },
          project_metadata: {},
          recent_projects: [],
          provider_connections: [],
          provider_models: [],
          provider_selections: {},
          provider_secrets: {},
        },
      }),
    });
  });
  report.projectStateWriteGuard = {
    enabled: true,
    get interceptedWrites() {
      return interceptedWrites;
    },
  };
}

async function installProbe(page) {
  await page.evaluate(() => {
    window.__agentvnNovelRuntimePerf = {
      running: false,
      start: 0,
      lastFrame: 0,
      frameGaps: [],
      longTasks: [],
      mutationCount: 0,
    };
    try {
      const observer = new PerformanceObserver((list) => {
        const state = window.__agentvnNovelRuntimePerf;
        for (const entry of list.getEntries()) {
          if (entry.startTime >= state.start) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Diagnostic only.
    }
    try {
      const mutationObserver = new MutationObserver((records) => {
        const state = window.__agentvnNovelRuntimePerf;
        if (state.running) state.mutationCount += records.length;
      });
      mutationObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch {
      // Diagnostic only.
    }
  });
}

async function startProbe(page) {
  return page.evaluate(() => {
    const state = window.__agentvnNovelRuntimePerf;
    state.running = true;
    state.start = performance.now();
    state.lastFrame = state.start;
    state.frameGaps = [];
    state.longTasks = [];
    state.mutationCount = 0;
    const step = (time) => {
      if (!state.running) return;
      state.frameGaps.push(time - state.lastFrame);
      state.lastFrame = time;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return state.start;
  });
}

async function stopProbe(page, startedAt) {
  return page.evaluate((start) => {
    const state = window.__agentvnNovelRuntimePerf;
    state.running = false;
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => entry.startTime >= start)
      .filter((entry) => ["script", "fetch", "xmlhttprequest"].includes(entry.initiatorType))
      .map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType, duration: entry.duration, transferSize: entry.transferSize }));
    return {
      elapsedMs: performance.now() - start,
      maxFrameGapMs: Math.max(0, ...state.frameGaps),
      maxLongTaskMs: Math.max(0, ...state.longTasks.map((entry) => entry.duration)),
      longTaskCount: state.longTasks.length,
      mutationCount: state.mutationCount,
      resourceCount: resources.length,
      resources: resources.slice(0, 12),
      panelCardCount: document.querySelectorAll(".novel-agent-card").length,
      renderedLogCount: document.querySelectorAll(".novel-log-item").length,
      renderedNodeCount: document.querySelectorAll(".react-flow__node").length,
      nodeCount: window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes?.length ?? 0,
    };
  }, startedAt);
}

async function measure(page, label, action, waitFor) {
  const startedAt = await startProbe(page);
  await action();
  await waitFor();
  await page.waitForTimeout(80);
  const metrics = await stopProbe(page, startedAt);
  return { label, ...metrics };
}

function evaluateThreshold(action) {
  const threshold = thresholds[action.label];
  if (!threshold) return [];
  const failures = [];
  if (action.maxLongTaskMs > threshold.maxLongTaskMs + thresholdToleranceMs) {
    failures.push(`long task ${Math.round(action.maxLongTaskMs)}ms > ${threshold.maxLongTaskMs}ms`);
  }
  if (action.maxFrameGapMs > threshold.maxFrameGapMs + thresholdToleranceMs) {
    failures.push(`frame gap ${Math.round(action.maxFrameGapMs)}ms > ${threshold.maxFrameGapMs}ms`);
  }
  return failures;
}

function iso(baseTime, offsetMs) {
  return new Date(baseTime + offsetMs).toISOString();
}

function buildPressureSnapshot() {
  const baseTime = Date.now() - 30_000;
  const jobId = "ui_pressure_job_100_chunks";
  const chapters = Array.from({ length: 10 }, (_, index) => ({
    chapterId: `pressure_chapter_${index + 1}`,
    chapterIndex: index,
    title: `Pressure Chapter ${index + 1}`,
    totalChunks: 10,
    completedChunks: index < 5 ? 8 : 2,
    failedChunks: index === 8 ? 1 : 0,
    inputTokens: 8600 + index * 120,
    outputTokens: 4200 + index * 90,
    estimatedTokens: 13200 + index * 180,
  }));
  const agents = Array.from({ length: 8 }, (_, index) => {
    const status = index < 6 ? "running" : index === 6 ? "waiting" : "completed";
    const progressPercent = status === "completed" ? 100 : status === "waiting" ? 0 : 42 + index * 5;
    const currentChunkIndex = index * 11 + 3;
    return {
      agentTaskId: `pressure_agent_task_${index + 1}`,
      agentIndex: index,
      agentRole: "chunk_parser",
      attemptId: `attempt_${index + 1}`,
      runAttempt: index % 3 === 0 ? 2 : 1,
      status,
      phase: "chunk_parse",
      currentChapterTitle: `Pressure Chapter ${Math.floor(currentChunkIndex / 10) + 1}`,
      currentChunkId: `pressure_chunk_${String(currentChunkIndex).padStart(3, "0")}`,
      currentChunkIndex: (currentChunkIndex % 10) + 1,
      currentChunkTotal: 10,
      inputTokens: 2400 + index * 130,
      outputTokens: 980 + index * 80,
      totalTokens: 3380 + index * 210,
      tokenSource: index % 2 === 0 ? "provider" : "estimated",
      elapsedMs: 18_000 + index * 1700,
      retryCount: index % 3 === 0 ? 1 : 0,
      completedTaskCount: 7 + index,
      failedTaskCount: index === 3 ? 1 : 0,
      outputPreview: `Agent ${index + 1} result preview for chunk ${currentChunkIndex}. Scene beats and structured warnings stay compact.`,
      partialPreview: status === "running" ? `partial-${index + 1}: parsing scene continuity and branch hints...` : "",
      progressPercent,
      heartbeatAt: iso(baseTime, index * 600),
      lastHeartbeatAt: iso(baseTime, index * 600),
      assignedChunkIds: Array.from({ length: 12 }, (_, item) => `pressure_chunk_${String(index * 12 + item + 1).padStart(3, "0")}`),
      currentStepLabel: status === "running" ? "streaming" : status,
      assignmentReason: `Scheduler assigned one chunk to subagent ${index + 1}; context is compressed and not treated as output body.`,
      inputChunkChars: 5200 + index * 80,
      contextChars: 540 + index * 8,
      schemaRepairCount: index === 2 ? 1 : 0,
      sceneCount: 3 + (index % 2),
      usedFallbackScene: index === 5,
      qualityWarnings: index === 5 ? ["fallback scene needs_review"] : [],
      mergeStatus: status === "completed" ? "merged" : "pending",
      chunkStartOffset: currentChunkIndex * 5200,
      chunkEndOffset: currentChunkIndex * 5200 + 5200,
      currentChunkExcerpt: "Main chunk excerpt only. Context summaries are displayed separately and must not duplicate body output.",
      previousContextSummary: "Compressed previous context for continuity.",
      nextContextHint: "Compressed next context hint for nearby branch flow.",
      taskStartedAt: iso(baseTime, -index * 1100),
      taskCompletedAt: status === "completed" ? iso(baseTime, 10_000 + index * 500) : null,
      progressBasis: "phase:chunk_parse",
      queuePosition: status === "waiting" ? index + 1 : null,
      estimatedRemainingMs: status === "running" ? 22_000 + index * 2200 : null,
      lastMeaningfulEventAt: iso(baseTime, index * 600),
      recentEvents: [],
    };
  });
  const events = Array.from({ length: 500 }, (_, index) => {
    const agentIndex = index % agents.length;
    const type = index % 17 === 0 ? "agent_failed" : index % 7 === 0 ? "agent_completed" : "agent_output_updated";
    return {
      eventId: `pressure_event_${String(index + 1).padStart(3, "0")}`,
      jobId,
      type,
      level: type === "agent_failed" ? "warning" : type === "agent_completed" ? "success" : "info",
      createdAt: iso(baseTime, index * 350),
      title: `Agent ${agentIndex + 1} event ${index + 1}`,
      message: `pressure chunk event ${index + 1}`,
      agentTaskId: agents[agentIndex].agentTaskId,
      chapterId: chapters[Math.floor(index / 50) % chapters.length].chapterId,
      chunkId: `pressure_chunk_${String((index % 100) + 1).padStart(3, "0")}`,
      payload: { index, phase: "chunk_parse", partialChars: 180 + index },
    };
  }).reverse();
  agents.forEach((agent) => {
    agent.recentEvents = events.filter((event) => event.agentTaskId === agent.agentTaskId).slice(0, 5);
  });
  const byAgent = agents.map((agent) => ({
    id: agent.agentTaskId,
    label: `Agent ${agent.agentIndex + 1}`,
    inputTokens: agent.inputTokens,
    outputTokens: agent.outputTokens,
    totalTokens: agent.totalTokens,
    estimatedTokens: Math.round(agent.totalTokens * 1.08),
    retryExtraTokens: agent.retryCount * 420,
    chunkCount: agent.assignedChunkIds.length,
  }));
  const byChapter = chapters.map((chapter) => ({
    id: chapter.chapterId,
    label: chapter.title,
    inputTokens: chapter.inputTokens,
    outputTokens: chapter.outputTokens,
    totalTokens: chapter.inputTokens + chapter.outputTokens,
    estimatedTokens: chapter.estimatedTokens,
    retryExtraTokens: 0,
    chunkCount: chapter.totalChunks,
  }));
  const totalInputTokens = byChapter.reduce((total, row) => total + row.inputTokens, 0);
  const totalOutputTokens = byChapter.reduce((total, row) => total + row.outputTokens, 0);
  return {
    projectId: "novel_processing_runtime_perf",
    job: {
      jobId,
      bookId: "pressure_book",
      novelTitle: "Novel Processing Runtime UI Pressure Fixture",
      status: "running",
      selectedChapterCount: chapters.length,
      totalChunks: 100,
      completedChunks: 48,
      failedChunks: 1,
      cancelledChunks: 0,
      runningAgentCount: 6,
      estimatedRemainingChunks: 51,
      maxConcurrency: 8,
      queueDepth: 52,
      activePhase: "chunk_parse",
      phaseProgress: [
        { phase: "chunk_parse", label: "chunk_parse", status: "running", current: 49, total: 100, percent: 49, updatedAt: iso(baseTime, 0), etaMs: 180_000 },
        { phase: "chapter_merge", label: "chapter_merge", status: "waiting", current: 0, total: 10, percent: 0, updatedAt: iso(baseTime, 0) },
        { phase: "continuity_review", label: "continuity_review", status: "waiting", current: 0, total: 1, percent: 0, updatedAt: iso(baseTime, 0) },
      ],
      progressPercent: 49,
      qualityDimensions: [
        { key: "source_coverage", label: "source coverage", value: "49/100", score: 49, status: "warning" },
        { key: "schema_health", label: "schema health", value: "1 repair", score: 88, status: "good" },
      ],
      qualityIssues: [
        { code: "ui_pressure_fixture", severity: "info", message: "UI pressure fixture only; not a provider success.", action: "Use real API jobs for end-to-end acceptance." },
      ],
      tokenStats: {
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        estimatedTokens: byChapter.reduce((total, row) => total + row.estimatedTokens, 0),
        actualTokens: totalInputTokens + totalOutputTokens,
        averageChunkTokens: Math.round((totalInputTokens + totalOutputTokens) / 100),
        retryExtraTokens: byAgent.reduce((total, row) => total + row.retryExtraTokens, 0),
        byAgent,
        byChapter,
      },
      agents,
      chapters,
      source: "ui_pressure_fixture",
      createdAt: iso(baseTime, -5000),
      updatedAt: iso(baseTime, 0),
    },
    events,
  };
}

function updatePressureSnapshot(snapshot, tick) {
  const next = JSON.parse(JSON.stringify(snapshot));
  const now = Date.now();
  const agent = next.job.agents[tick % next.job.agents.length];
  agent.progressPercent = Math.min(95, agent.progressPercent + 3);
  agent.heartbeatAt = new Date(now).toISOString();
  agent.lastHeartbeatAt = agent.heartbeatAt;
  agent.elapsedMs += 500;
  agent.partialPreview = `poll-${tick}: updated only ${agent.agentTaskId} at ${agent.progressPercent}%`;
  agent.currentStepLabel = tick % 2 === 0 ? "streaming" : "requesting";
  next.job.updatedAt = agent.heartbeatAt;
  const event = {
    eventId: `pressure_poll_event_${tick}_${now}`,
    jobId: next.job.jobId,
    type: "agent_output_updated",
    level: "info",
    createdAt: agent.heartbeatAt,
    title: `Polling update ${tick}`,
    message: `Updated ${agent.agentTaskId}`,
    agentTaskId: agent.agentTaskId,
    chunkId: agent.currentChunkId,
    payload: { tick, progressPercent: agent.progressPercent },
  };
  next.events = [event, ...next.events].slice(0, 500);
  agent.recentEvents = [event, ...(agent.recentEvents ?? [])].slice(0, 5);
  return next;
}

function buildCanvasImportFixture() {
  const nodes = Array.from({ length: 100 }, (_, index) => {
    const id = `runtime_result_scene_${String(index + 1).padStart(3, "0")}`;
    return {
      id,
      type: "sceneNode",
      position: { x: 240 + (index % 10) * 340, y: 160 + Math.floor(index / 10) * 240 },
      data: {
        nodeKind: "scene",
        memoryMode: "hybrid",
        aiSettings: { authorGoal: "Keep the imported result coherent.", generationOutline: "", autoExtractMemory: true, autoApplyMemory: false },
        previewState: { currentCommandIndex: 0, isPlaying: false },
        editorMeta: { collapsedInspectorSections: [], source: "manual" },
        label: `Runtime Result Scene ${index + 1}`,
        description: `Result import pressure scene ${index + 1}`,
        scene: {
          scene_id: id,
          title: `Runtime Result Scene ${index + 1}`,
          summary: "Canvas growth pressure fixture for novel processing result import.",
          commands: [{ type: "dialog", character_id: "narrator", text: `Result line ${index + 1}.` }],
          tags: ["perf"],
          chapter: Math.floor(index / 10) + 1,
        },
      },
    };
  });
  const edges = Array.from({ length: 99 }, (_, index) => ({
    id: `runtime_result_edge_${index + 1}`,
    source: nodes[index].id,
    target: nodes[index + 1].id,
    sourceHandle: "default",
  }));
  return {
    schema_version: "1.0.0",
    project_id: "novel_processing_result_pressure",
    title: "Novel Processing Result Import Pressure",
    author: "AgentVN Perf Audit",
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.55 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function dispatchPressureSnapshot(page, snapshot) {
  await page.evaluate((payload) => {
    window.dispatchEvent(new CustomEvent("agentvn:novel-processing-pressure-snapshot", { detail: payload }));
  }, snapshot);
}

async function run() {
  const report = {
    ok: true,
    at: new Date().toISOString(),
    editorUrl: EDITOR_URL,
    logs: [],
    actions: [],
    screenshots: [],
    mode: "ui_pressure_fixture_contract_snapshot",
  };
  let browser;
  let started = [];
  try {
    started = await ensureEditor(report);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await installProjectStateWriteGuard(page, report);
    await openEditor(page);
    await installProbe(page);
    await page.waitForFunction(() => window.__AGENTVN_NOVEL_TASK_WORKBENCH_READY__ === true, null, { timeout: 30_000 });
    await page.evaluate(() => window.__AGENTVN_EDITOR_STORE__?.getState?.().resetGraph?.());

    let snapshot = buildPressureSnapshot();
    report.snapshot = {
      snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
      agentCount: snapshot.job.agents.length,
      chunkCount: snapshot.job.totalChunks,
      eventCount: snapshot.events.length,
      source: snapshot.job.source,
    };

    report.actions.push(await measure(
      page,
      "render-pressure-snapshot",
      async () => {
        await dispatchPressureSnapshot(page, snapshot);
      },
      async () => {
        await page.locator('[data-testid="novel-task-workbench"]').waitFor({ state: "visible", timeout: 30_000 });
        await page.waitForFunction(() => document.querySelectorAll(".novel-agent-card").length >= 8, null, { timeout: 30_000 });
      },
    ));

    report.actions.push(await measure(
      page,
      "polling-pressure-updates",
      async () => {
        for (let tick = 1; tick <= 6; tick += 1) {
          snapshot = updatePressureSnapshot(snapshot, tick);
          await dispatchPressureSnapshot(page, snapshot);
          await page.waitForTimeout(500);
        }
      },
      async () => {
        await page.waitForFunction(() => document.querySelectorAll(".novel-agent-card").length >= 8, null, { timeout: 30_000 });
      },
    ));
    report.polling = {
      snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
      agentCount: snapshot.job.agents.length,
      chunkCount: snapshot.job.totalChunks,
      eventCount: snapshot.events.length,
      renderedLogLimit: await page.locator(".novel-log-item").count(),
    };

    await page.locator(".novel-task-icon-button").first().click({ force: true }).catch(() => {});
    const importFixture = buildCanvasImportFixture();
    report.actions.push(await measure(
      page,
      "result-import-canvas-pressure",
      async () => {
        await page.evaluate((project) => {
          window.__AGENTVN_EDITOR_STORE__?.getState?.().importProjectAsRoute?.(project);
        }, importFixture);
      },
      async () => {
        await page.waitForFunction(() => window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes?.length >= 100, null, { timeout: 60_000 });
      },
    ));

    const screenshot = path.join(OUT_DIR, "novel-processing-runtime-perf.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    report.screenshots.push(screenshot);
    await context.close();
    report.thresholds = thresholds;
    report.thresholdToleranceMs = thresholdToleranceMs;
    for (const action of report.actions) {
      action.thresholdFailures = evaluateThreshold(action);
      if (action.thresholdFailures.length > 0) report.ok = false;
    }
    if (report.polling.renderedLogLimit > 80) {
      report.ok = false;
      report.logWindowFailure = `Rendered ${report.polling.renderedLogLimit} log rows; expected <= 80.`;
    }
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServices(started);
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
    console.table(report.actions.map((item) => ({
      label: item.label,
      ok: item.thresholdFailures?.length ? false : true,
      elapsedMs: Math.round(item.elapsedMs),
      maxLongTaskMs: Math.round(item.maxLongTaskMs),
      maxFrameGapMs: Math.round(item.maxFrameGapMs),
      mutationCount: item.mutationCount,
      panelCardCount: item.panelCardCount,
      renderedLogCount: item.renderedLogCount,
      nodeCount: item.nodeCount,
      renderedNodeCount: item.renderedNodeCount,
      thresholdFailures: item.thresholdFailures?.join("; ") ?? "",
    })));
    console.log(JSON.stringify({ ok: report.ok, reportPath: REPORT_PATH, snapshot: report.snapshot, polling: report.polling, screenshots: report.screenshots, error: report.error }, null, 2));
  }
  if (!report.ok) process.exit(1);
}

void run();
