const { chromium } = require("../editor/node_modules/playwright");

const editorUrl = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const legacySnapshotKey = "agentvn.novelProcessTaskWorkbench.snapshot";

function snapshotFixture() {
  const now = new Date().toISOString();
  const agent = {
    agentTaskId: "audit-agent-1",
    agentIndex: 0,
    agentRole: "chunk_parser",
    status: "running",
    phase: "chunk_parse",
    currentChapterTitle: "第一章",
    currentChunkId: "audit-chunk-1",
    currentChunkIndex: 1,
    currentChunkTotal: 2,
    inputTokens: 320,
    outputTokens: 180,
    totalTokens: 500,
    tokenSource: "actual",
    elapsedMs: 12000,
    retryCount: 0,
    outputPreview: "正在解析章节内容。",
    progressPercent: 52,
    heartbeatAt: now,
    currentStepLabel: "解析场景",
    inputChunkChars: 1800,
    contextChars: 240,
    schemaRepairCount: 0,
    sceneCount: 2,
    usedFallbackScene: false,
    mergeStatus: "pending",
    progressBasis: "phase",
    estimatedRemainingMs: 9000,
  };
  return {
    job: {
      jobId: "audit-job",
      novelTitle: "动效验收小说",
      status: "running",
      selectedChapterCount: 1,
      totalChunks: 2,
      completedChunks: 1,
      failedChunks: 0,
      cancelledChunks: 0,
      runningAgentCount: 1,
      estimatedRemainingChunks: 1,
      maxConcurrency: 1,
      queueDepth: 0,
      activePhase: "chunk_parse",
      progressPercent: 52,
      tokenStats: {
        totalInputTokens: 320,
        totalOutputTokens: 180,
        totalTokens: 500,
        estimatedTokens: 520,
        actualTokens: 500,
        averageChunkTokens: 500,
        retryExtraTokens: 0,
        byAgent: [],
        byChapter: [],
      },
      agents: [agent],
      chapters: [],
      source: "mock",
      createdAt: now,
      updatedAt: now,
    },
    events: [],
  };
}

async function seedSnapshot(page) {
  await page.evaluate(
    ({ key, snapshot }) => window.localStorage.setItem(key, JSON.stringify(snapshot)),
    { key: legacySnapshotKey, snapshot: snapshotFixture() },
  );
}

async function openWorkbench(page) {
  const workbench = page.locator('[data-testid="novel-task-workbench"]');
  if (await workbench.isVisible().catch(() => false)) return;
  const miniEntry = page.locator('[data-testid="novel-task-mini-entry"]');
  if (!(await miniEntry.isVisible().catch(() => false))) {
    const openDraft = page.locator('[data-help-key="home.openDraft"]').first();
    const createProject = page.locator('[data-help-key="home.createProject"]').filter({ hasText: "新建项目" }).first();
    if (await openDraft.isVisible({ timeout: 5000 }).catch(() => false)) {
      await openDraft.click();
    } else if (await createProject.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createProject.click();
    }
  }
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:workspace-open-surface", {
      detail: { surface: "import" },
    }));
  });
  const importWorkbench = page.locator('[data-testid="novel-import-workbench"]');
  if (await importWorkbench.isVisible({ timeout: 5000 }).catch(() => false)) {
    await importWorkbench.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click({ force: true });
    await importWorkbench.waitFor({ state: "hidden", timeout: 5000 });
  }
  await miniEntry.waitFor({ state: "visible", timeout: 15000 });
  await miniEntry.click();
  await workbench.waitFor({ state: "visible", timeout: 10000 });
}

async function verifyTokenPanelStretch(page) {
  const tokenPanel = page.locator(".novel-token-panel");
  await tokenPanel.waitFor({ state: "visible" });
  const layout = await page.evaluate(() => {
    const body = document.querySelector(".novel-task-body");
    const token = document.querySelector(".novel-token-panel");
    const grid = document.querySelector(".novel-token-grid");
    if (!body || !token || !grid) return null;
    const bodyRect = body.getBoundingClientRect();
    const tokenRect = token.getBoundingClientRect();
    const columns = getComputedStyle(grid).gridTemplateColumns
      .split(" ")
      .filter(Boolean).length;
    return {
      bodyWidth: bodyRect.width,
      tokenWidth: tokenRect.width,
      leftInset: tokenRect.left - bodyRect.left,
      rightInset: bodyRect.right - tokenRect.right,
      columns,
    };
  });
  if (!layout) throw new Error("Token panel layout nodes were not found.");
  if (layout.tokenWidth < layout.bodyWidth * 0.9) {
    throw new Error(`Token panel did not stretch across the workbench body: ${JSON.stringify(layout)}`);
  }
  if (page.viewportSize().width > 1120 && layout.columns < 5) {
    throw new Error(`Token metrics did not use the expanded horizontal space: ${JSON.stringify(layout)}`);
  }
}

async function verifyMotion(page, viewport) {
  await page.setViewportSize(viewport);
  await openWorkbench(page);
  await verifyTokenPanelStretch(page);
  const technicalDetails = page.locator('[data-testid="novel-task-workbench"]:visible .novel-task-technical-details');
  if ((await technicalDetails.getAttribute("open")) === null) {
    await technicalDetails.locator("summary").click();
  }
  const toggle = page.locator('[data-testid="novel-task-workbench"]:visible .novel-agent-detail-toggle:visible').first();
  await toggle.waitFor({ state: "visible" });
  const regionId = await toggle.getAttribute("aria-controls");
  if (!regionId) throw new Error("详情按钮缺少 aria-controls。");
  const region = page.locator(`#${regionId}`);

  const initial = await region.evaluate((element) => ({
    expanded: element.dataset.expanded,
    ariaHidden: element.getAttribute("aria-hidden"),
    rows: getComputedStyle(element).gridTemplateRows,
    opacity: Number(getComputedStyle(element).opacity),
  }));
  if (initial.expanded !== "false" || initial.ariaHidden !== "true" || initial.opacity !== 0) {
    throw new Error(`折叠初始状态错误：${JSON.stringify(initial)}`);
  }

  await toggle.hover();
  const hoverTransition = await toggle.evaluate((element) => getComputedStyle(element).transitionDuration);
  if (!hoverTransition || hoverTransition === "0s") throw new Error("详情按钮缺少悬停动效。");

  await toggle.click();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") throw new Error("展开后 aria-expanded 未更新。");
  await page.waitForTimeout(380);
  const opened = await region.evaluate((element) => ({
    expanded: element.dataset.expanded,
    ariaHidden: element.getAttribute("aria-hidden"),
    rows: Number.parseFloat(getComputedStyle(element).gridTemplateRows),
    opacity: Number(getComputedStyle(element).opacity),
    right: element.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (opened.expanded !== "true" || opened.ariaHidden !== "false" || opened.rows <= 0 || opened.opacity < 0.99) {
    throw new Error(`展开状态错误：${JSON.stringify(opened)}`);
  }
  if (opened.right > opened.viewportWidth + 1 || opened.scrollWidth > opened.viewportWidth + 1) {
    throw new Error(`视口出现横向溢出：${JSON.stringify(opened)}`);
  }

  await toggle.click();
  await page.waitForTimeout(520);
  const closed = await region.evaluate((element) => ({
    expanded: element.dataset.expanded,
    ariaHidden: element.getAttribute("aria-hidden"),
    rows: Number.parseFloat(getComputedStyle(element).gridTemplateRows),
    opacity: Number(getComputedStyle(element).opacity),
  }));
  if (closed.expanded !== "false" || closed.ariaHidden !== "true" || closed.rows > 0.5 || closed.opacity > 0.01) {
    throw new Error(`收起状态错误：${JSON.stringify(closed)}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await seedSnapshot(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await verifyMotion(page, { width: 1440, height: 1000 });
    await verifyMotion(page, { width: 390, height: 844 });

    const reducedContext = await browser.newContext({ reducedMotion: "reduce" });
    const reducedPage = await reducedContext.newPage();
    await reducedPage.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await seedSnapshot(reducedPage);
    await reducedPage.reload({ waitUntil: "domcontentloaded" });
    await openWorkbench(reducedPage);
    const reducedDuration = await reducedPage.locator('[data-testid="novel-task-workbench"]:visible .novel-agent-detail-region').first().evaluate((element) =>
      getComputedStyle(element).transitionDuration.split(",").map((value) => Number.parseFloat(value) || 0),
    );
    if (Math.max(...reducedDuration) > 0.01) {
      throw new Error(`减少动态效果未生效：${reducedDuration.join(", ")}`);
    }
    await reducedPage.close();
    await reducedContext.close();
    console.log("Subagent 详情动效验收通过。");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
