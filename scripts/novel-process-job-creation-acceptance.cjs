const { chromium } = require("../editor/node_modules/playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultNovelPath = "C:/Users/1/Downloads/雷狼龙学长与下头太刀(1).txt";
const novelPath = path.resolve(process.env.AGENTVN_NOVEL_PATH || process.argv[2] || defaultNovelPath);
const editorUrl = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const outputDir = path.join(root, "output", "playwright", "novel-process-job-creation");
const reportPath = path.join(outputDir, "report.json");
const directNovelPath = path.join(outputDir, "direct-no-chapter-sample.txt");

fs.mkdirSync(outputDir, { recursive: true });

function ensureDirectNovelSample() {
  const paragraphs = Array.from({ length: 260 }, (_, index) => (
    `雾线在第 ${index + 1} 次潮声里慢慢退开。旧灯塔没有章节标题，只有连续的脚步、海风和门轴声。` +
    `主角沿着湿冷的石阶向上走，墙面渗出的盐粒像星点一样发亮。她没有立刻遇见任何人，先听见远处玻璃罩内的微弱蜂鸣。`
  ));
  fs.writeFileSync(directNovelPath, paragraphs.join("\n\n"), "utf8");
}

function loadProviderState() {
  const appDataRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || root, "AppData", "Roaming");
  const systemDbPath = process.env.DATABASE_PATH || path.join(appDataRoot, "com.agentvn.editor", "backend", "vn_engine.db");
  const legacyDbPath = path.join(root, "backend", "data", "vn_engine.db");
  const dbPath = fs.existsSync(systemDbPath) ? systemDbPath : legacyDbPath;
  const script = String.raw`
import sqlite3, json, sys
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
state = {}
for key in ['provider_connections','provider_models','provider_selections','provider_secrets']:
    row = conn.execute('select value from editor_shared_state where key=?', (key,)).fetchone()
    if row:
        state[key] = json.loads(row['value'])
    elif key in ['provider_connections','provider_models']:
        state[key] = []
    else:
        state[key] = {}
state['project_graph'] = {'nodes': [], 'edges': [], 'viewport': {'x': 0, 'y': 0, 'zoom': 1}, 'memoryMode': 'hybrid'}
state['project_metadata'] = {}
state['recent_projects'] = []
print(json.dumps(state, ensure_ascii=False))
`;
  return JSON.parse(execFileSync("python", ["-c", script, dbPath], { cwd: root, encoding: "utf8" }));
}

function makePanelJob(jobId, payload, status) {
  const now = new Date().toISOString();
  const totalChunks = payload.chunks.length;
  const chapterGroups = Array.from(
    payload.chunks.reduce((groups, chunk) => {
      const key = `${chunk.chapterIndex}:${chunk.chapterTitle}`;
      const rows = groups.get(key) ?? [];
      rows.push(chunk);
      groups.set(key, rows);
      return groups;
    }, new Map()).entries(),
  )
    .map(([key, chunks]) => {
      const [chapterIndexText, ...titleParts] = key.split(":");
      return { chapterIndex: Number(chapterIndexText), title: titleParts.join(":"), chunks };
    })
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
  const runningCompletedChapterLimit = Math.min(3, chapterGroups.length);
  const panelChapters = chapterGroups.map((chapter, index) => {
    const completedChunks = status === "completed"
      ? chapter.chunks.length
      : status === "running" && index < runningCompletedChapterLimit
        ? chapter.chunks.length
        : 0;
    return {
      chapterId: `chapter_${chapter.chapterIndex}`,
      chapterIndex: chapter.chapterIndex,
      title: chapter.title || `Chapter ${chapter.chapterIndex + 1}`,
      totalChunks: chapter.chunks.length,
      completedChunks,
      failedChunks: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedTokens: 0,
    };
  });
  const completedChunks = panelChapters.reduce((sum, chapter) => sum + chapter.completedChunks, 0);
  return {
    jobId,
    bookId: payload.bookId,
    novelTitle: payload.title,
    status,
    selectedChapterCount: new Set(payload.chunks.map((chunk) => chunk.chapterIndex)).size,
    totalChunks,
    completedChunks: status === "completed" ? totalChunks : completedChunks,
    failedChunks: 0,
    cancelledChunks: 0,
    runningAgentCount: status === "running" ? Math.min(payload.maxConcurrency, totalChunks) : 0,
    estimatedRemainingChunks: status === "completed" ? 0 : totalChunks,
    maxConcurrency: payload.maxConcurrency,
    queueDepth: status === "completed" ? 0 : totalChunks,
    activePhase: status === "completed" ? "result_merge" : "chunk_parse",
    phaseProgress: [],
    progressPercent: status === "completed" ? 100 : Math.round((completedChunks / Math.max(1, totalChunks)) * 100),
    qualityDimensions: [],
    qualityIssues: [],
    tokenStats: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      estimatedTokens: 0,
      actualTokens: 0,
      averageChunkTokens: 0,
      retryExtraTokens: 0,
      byAgent: [],
      byChapter: [],
    },
    agents: [],
    chapters: panelChapters,
    source: "api",
    createdAt: now,
    updatedAt: now,
    ...(status === "completed" ? { completedAt: now } : {}),
  };
}

function createRun(name) {
  return {
    name,
    status: "running",
    assertions: [],
    postCount: 0,
    consoleErrors: [],
    screenshots: [],
  };
}

function record(run, name, passed, detail) {
  run.assertions.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}

async function waitForOverlays(page) {
  await page.waitForFunction(() => {
    const overlays = Array.from(document.querySelectorAll(".project-entry-loading-overlay, .app-transition-stage.is-switching"));
    return !overlays.some((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.01 && rect.width > 0 && rect.height > 0;
    });
  }, null, { timeout: 20000 }).catch(() => {});
}

async function clickVisibleEnabled(page, selectors, label, timeout = 30000) {
  const clicked = await page.waitForFunction((targetSelectors) => {
    function isVisibleEnabled(element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0.01 &&
        !element.disabled &&
        element.getAttribute("aria-disabled") !== "true";
    }
    for (const selector of targetSelectors) {
      const target = Array.from(document.querySelectorAll(selector)).find(isVisibleEnabled);
      if (target) {
        target.click();
        return true;
      }
    }
    return false;
  }, selectors, { timeout }).catch(() => false);
  if (!clicked) throw new Error(`No visible enabled target was found for ${label}.`);
}

async function openNovelWorkbench(page) {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForOverlays(page);
  const workspace = page.locator(".editor-workspace");
  if (!(await workspace.isVisible({ timeout: 2500 }).catch(() => false))) {
    await clickVisibleEnabled(page, ['[data-help-key="home.createProject"]', '[data-help-key="home.openDraft"]'], "project entry");
    await page.waitForTimeout(800);
    await waitForOverlays(page);
    await workspace.waitFor({ state: "visible", timeout: 20000 });
  }
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"), null, { timeout: 30000 });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:workspace-open-surface", {
      detail: { surface: "import" },
    }));
  });
  await page.locator('[data-testid="novel-import-workbench"]').waitFor({ state: "visible", timeout: 15000 });
}

async function closeNovelWorkbench(page) {
  const workbench = page.locator('[data-testid="novel-import-workbench"]').first();
  if (!(await workbench.isVisible().catch(() => false))) return;
  await workbench.locator('[data-help-key="toolbar.novelImport.closeWorkbench"], button[aria-label]').first().click({ force: true });
  await workbench.waitFor({ state: "hidden", timeout: 5000 });
}

async function reopenNovelWorkbench(page) {
  if (await page.locator('[data-testid="novel-import-workbench"]').first().isVisible().catch(() => false)) return;
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:workspace-open-surface", {
      detail: { surface: "import" },
    }));
  });
  await page.locator('[data-testid="novel-import-workbench"]').waitFor({ state: "visible", timeout: 5000 });
}

async function importAndSplit(page) {
  const input = page.locator('[data-help-key="novel.importFile"] input[type="file"], input[type="file"][data-help-key="novel.importFile"]').first();
  await input.setInputFiles(novelPath);
  await page.locator(".novel-large-dialog").waitFor({ state: "visible", timeout: 30000 });
  const dialogSplit = page.locator('.novel-large-dialog [data-help-key="novel.startChapterSplit"]').first();
  await dialogSplit.waitFor({ state: "visible", timeout: 30000 });
  await dialogSplit.click();
  await page.locator(".novel-large-dialog").waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  const create = page.locator('[data-testid="novel-create-process-job"]');
  await create.waitFor({ state: "visible", timeout: 60000 });
  await page.locator(".novel-chapter-table tbody tr").first().waitFor({ state: "visible", timeout: 30000 });
}

async function importDirectWithoutChapterSplit(page) {
  const input = page.locator('[data-help-key="novel.importFile"] input[type="file"], input[type="file"][data-help-key="novel.importFile"]').first();
  await input.setInputFiles(directNovelPath);
  const directInLargeDialog = page.locator('.novel-large-dialog [data-help-key="novel.continueDirect"]').first();
  const directInPreflight = page.locator('.novel-preflight-actions [data-help-key="novel.continueDirect"]').first();
  const direct = (await directInLargeDialog.isVisible({ timeout: 30000 }).catch(() => false)) ? directInLargeDialog : directInPreflight;
  await direct.waitFor({ state: "visible", timeout: 30000 });
  await direct.click();
  await page.locator(".novel-large-dialog").waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  const create = page.locator('[data-testid="novel-create-process-job"]');
  await create.waitFor({ state: "visible", timeout: 60000 });
}

async function seedDirectNoChapterSession(page) {
  const text = fs.readFileSync(directNovelPath, "utf8");
  await page.waitForFunction(() => Boolean(window.__AGENTVN_NOVEL_IMPORT_STORE__), null, { timeout: 10000 });
  await page.evaluate((input) => {
    const store = window.__AGENTVN_NOVEL_IMPORT_STORE__;
    const state = store.getState();
    const now = new Date().toISOString();
    const document = {
      document_id: "direct_no_chapter_document",
      title: "direct-no-chapter-sample",
      file_name: "direct-no-chapter-sample.txt",
      file_type: "txt",
      language: "zh-CN",
      raw_text: input.text,
      normalized_text: input.text,
      imported_at: now,
      total_chars: input.text.length,
      file_size: input.text.length,
      metadata: {
        import_preflight: {
          file_name: "direct-no-chapter-sample.txt",
          total_chars: input.text.length,
          estimated_tokens: Math.ceil(input.text.length / 2),
          has_chapter_structure: false,
          chapter_structure: {
            method: "none",
            confidence: 0,
            sample_headings: [],
          },
          processing_tier: "large",
          recommended_action: "split_recommended",
          warnings: ["acceptance: no chapter split selected"],
          errors: [],
        },
      },
    };
    store.setState({
      session: {
        ...state.session,
        document,
        import_record: {
          record_id: "direct_no_chapter_record",
          document_id: document.document_id,
          file_name: document.file_name,
          entry_mode: "direct",
          status: "direct_ready",
          created_at: now,
          preflight: document.metadata.import_preflight,
        },
        chunks: [],
        chapters: [],
        chapter_split_report: undefined,
        scenes: [],
        characters: [],
        character_candidates_review: [],
        adapted_scenes: [],
        asset_suggestions: [],
        branch_suggestions: [],
        conflict_points: [],
        ai_chunk_analyses: [],
        scan_partials: {},
        outline_partials: {},
        planned_chapter_ids: [],
        validation_reports: [],
        quality_report: undefined,
        ai_outline: undefined,
        quality_risk_accepted: false,
        ai_stage: "landing",
        status: "chapters_split",
        updated_at: now,
      },
      processing: {
        ...state.processing,
        selectedChapterIds: [],
        chapterSnapshots: [],
        chunks: [],
        chunkResults: [],
        tasks: [],
        jobs: [],
        activeJobId: undefined,
        updatedAt: now,
      },
      jobCreation: { status: "idle" },
      errors: [],
      warnings: [],
    });
  }, { text });
  await page.locator('[data-testid="novel-create-process-job"]').waitFor({ state: "visible", timeout: 10000 });
}

async function screenshot(page, run, name) {
  const filePath = path.join(outputDir, `${run.name}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  run.screenshots.push(path.relative(root, filePath).replaceAll("\\", "/"));
}

async function installProjectRoute(page, providerState) {
  let projectState = structuredClone(providerState);
  await page.route("**/api/project/state", async (route) => {
    if (route.request().method() === "POST") {
      const update = route.request().postDataJSON();
      projectState = { ...projectState, ...update };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: projectState }),
    });
  });
}

async function runSuccess(browser, providerState) {
  const run = createRun("success");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let createPayload;
  let panelStatus = "running";
  const jobId = "novel_job_acceptance_success";

  page.on("console", (message) => {
    if (message.type() === "error") run.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => run.consoleErrors.push(error.stack || error.message));
  await installProjectRoute(page, providerState);
  await page.route("**/api/novel/processing/execute/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    run.postCount += 1;
    createPayload = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...createPayload, jobId, status: "waiting" }),
    });
  });
  await page.route("**/api/novel/processing/execute/jobs/*/panel", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makePanelJob(jobId, createPayload, panelStatus)),
    });
  });
  await page.route("**/api/novel/processing/execute/jobs/*/events?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  try {
    await openNovelWorkbench(page);
    await importAndSplit(page);
    const create = page.locator('[data-testid="novel-create-process-job"]');
    record(run, "首次创建前按钮可点击", !(await create.isDisabled()), "创建按钮应在无历史任务时可点击");

    await create.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="novel-create-process-job"]')?.disabled === true);
    const creatingStatus = page.locator('[data-testid="novel-process-job-creation-status"].is-creating');
    await creatingStatus.waitFor({ state: "visible", timeout: 1000 });
    record(run, "请求发出后立即禁用", await create.isDisabled(), "创建请求等待期间按钮必须禁用");
    record(run, "创建中状态显眼显示", await creatingStatus.getAttribute("role") === "status", "创建中提示必须使用 role=status");

    await create.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.waitForTimeout(250);
    record(run, "快速重复点击只发送一次 POST", run.postCount === 1, `实际 POST 次数：${run.postCount}`);

    const createdStatus = page.locator('[data-testid="novel-process-job-creation-status"].is-created');
    await createdStatus.waitFor({ state: "visible", timeout: 10000 });
    record(run, "成功提示包含任务 ID", (await createdStatus.textContent()).includes(jobId), `提示内容：${await createdStatus.textContent()}`);
    record(run, "成功后创建按钮持续禁用", await create.isDisabled(), "成功后相同章节组合不得再次创建");
    record(run, "真实文章生成了切片", createPayload?.chunks?.length > 0, `切片数量：${createPayload?.chunks?.length ?? 0}`);

    await page.waitForFunction(() => Array.from(document.querySelectorAll(".novel-process-chunk-progress")).some((element) => /^[1-9]\d*\/\d+ (?:chunk|段)/.test(element.textContent?.trim() || "")), null, { timeout: 10000 });
    const chapterProgressTexts = await page.locator(".novel-process-chunk-progress").evaluateAll((elements) => elements.slice(0, 6).map((element) => element.textContent?.trim() || ""));
    record(run, "API panel chapter progress syncs into table", chapterProgressTexts.some((text) => /^[1-9]\d*\/\d+ (?:chunk|段)/.test(text)), `first rows: ${chapterProgressTexts.join(" | ")}`);

    const miniEntry = page.locator('[data-testid="novel-task-mini-entry"]');
    await closeNovelWorkbench(page);
    await miniEntry.waitFor({ state: "visible", timeout: 10000 });
    await miniEntry.click();
    await page.locator('[data-testid="novel-task-workbench"]').waitFor({ state: "visible", timeout: 5000 });
    record(run, "成功后进入任务工作台", true, jobId);
    await page.locator('[data-testid="novel-task-workbench"] .novel-task-icon-button').click({ force: true });
    await page.locator('[data-testid="novel-task-workbench"]').waitFor({ state: "hidden", timeout: 5000 });
    await reopenNovelWorkbench(page);

    const regenerate = page.locator('[data-testid="novel-regenerate-process-job"]');
    record(run, "运行中任务禁止重新生成", await regenerate.isDisabled(), "后端任务 running 时重新生成必须禁用");
    await screenshot(page, run, "desktop-created");

    panelStatus = "completed";
    await page.waitForFunction(() => document.querySelector('[data-testid="novel-task-mini-entry"]')?.getAttribute("data-job-status") === "completed", null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="novel-regenerate-process-job"]')?.disabled === false, null, { timeout: 10000 });
    record(run, "任务结束后允许重新生成", !(await regenerate.isDisabled()), "completed 状态应解锁重新生成");
    record(run, "任务结束后创建仍禁用", await create.isDisabled(), "历史任务存在时创建按钮仍应禁用");

    await closeNovelWorkbench(page);
    await reopenNovelWorkbench(page);
    const reopenedCreate = page.locator('[data-testid="novel-create-process-job"]');
    await reopenedCreate.waitFor({ state: "visible", timeout: 5000 });
    record(run, "重新打开工作台后仍识别历史任务", await reopenedCreate.isDisabled(), "工作台重开后创建按钮必须保持禁用");
    record(run, "重新打开不产生额外 POST", run.postCount === 1, `实际 POST 次数：${run.postCount}`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-testid="novel-process-job-creation-status"]').scrollIntoViewIfNeeded();
    await screenshot(page, run, "narrow-reopened");
    run.status = "passed";
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.stack || error.message : String(error);
    await screenshot(page, run, "failure").catch(() => {});
  } finally {
    await context.close();
  }
  return run;
}

async function runFailure(browser, providerState) {
  const run = createRun("failure-retry");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") run.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => run.consoleErrors.push(error.stack || error.message));
  await installProjectRoute(page, providerState);
  await page.route("**/api/novel/processing/execute/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    run.postCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "acceptance injected failure" }),
    });
  });

  try {
    await openNovelWorkbench(page);
    await importAndSplit(page);
    const create = page.locator('[data-testid="novel-create-process-job"]');
    await create.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="novel-create-process-job"]')?.disabled === true);
    record(run, "失败请求等待期间按钮禁用", await create.isDisabled(), "失败响应返回前也必须防止重复点击");

    const failedStatus = page.locator('[data-testid="novel-process-job-creation-status"].is-failed');
    await failedStatus.waitFor({ state: "visible", timeout: 10000 });
    record(run, "失败状态使用 role=alert", await failedStatus.getAttribute("role") === "alert", "失败提示必须及时被辅助技术播报");
    record(run, "失败错误就地可见", (await failedStatus.textContent()).includes("acceptance injected failure"), `提示内容：${await failedStatus.textContent()}`);
    record(run, "失败后创建按钮恢复可点击", !(await create.isDisabled()), "请求失败不应锁死重试入口");
    record(run, "失败请求只发送一次 POST", run.postCount === 1, `实际 POST 次数：${run.postCount}`);
    await screenshot(page, run, "desktop-error");
    run.status = "passed";
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.stack || error.message : String(error);
    await screenshot(page, run, "failure").catch(() => {});
  } finally {
    await context.close();
  }
  return run;
}

async function runDirectNoChapter(browser, providerState) {
  const run = createRun("direct-no-chapter");
  const context = await browser.newContext({ viewport: { width: 1366, height: 920 } });
  const page = await context.newPage();
  let createPayload;
  const jobId = "novel_job_acceptance_direct_no_chapter";
  page.on("console", (message) => {
    if (message.type() === "error") run.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => run.consoleErrors.push(error.stack || error.message));
  await installProjectRoute(page, providerState);
  await page.route("**/api/novel/processing/execute/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    run.postCount += 1;
    createPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...createPayload, jobId, status: "waiting" }),
    });
  });
  await page.route("**/api/novel/processing/execute/jobs/*/panel", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makePanelJob(jobId, createPayload, "running")),
    });
  });
  await page.route("**/api/novel/processing/execute/jobs/*/events?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  try {
    await openNovelWorkbench(page);
    await seedDirectNoChapterSession(page);
    const noRows = await page.locator(".novel-chapter-table tbody tr").count().catch(() => 0);
    record(run, "直接处理路径没有章节表选择", noRows === 0, `chapter rows: ${noRows}`);
    const create = page.locator('[data-testid="novel-create-process-job"]');
    record(run, "未拆章直接处理仍可创建任务", !(await create.isDisabled()), "create button must be enabled after direct import");
    await create.click();
    const createdStatus = page.locator('[data-testid="novel-process-job-creation-status"].is-created');
    await createdStatus.waitFor({ state: "visible", timeout: 10000 });
    record(run, "直接处理只发送一次真实 job 创建请求", run.postCount === 1, `POST count: ${run.postCount}`);
    record(run, "直接处理生成全文合成章节 payload", createPayload?.chunks?.length > 0 && createPayload.chunks.every((chunk) => chunk.chapterIndex === 0), JSON.stringify({
      chunkCount: createPayload?.chunks?.length ?? 0,
      chapterIndexes: [...new Set((createPayload?.chunks ?? []).map((chunk) => chunk.chapterIndex))],
      firstTitle: createPayload?.chunks?.[0]?.chapterTitle,
    }));
    record(run, "直接处理全文章节标题可追踪", /direct-no-chapter-sample|全文处理|direct-no-chapter/i.test(createPayload?.chunks?.[0]?.chapterTitle || createPayload?.title || ""), `title=${createPayload?.title}; chapter=${createPayload?.chunks?.[0]?.chapterTitle}`);
    const miniEntry = page.locator('[data-testid="novel-task-mini-entry"]');
    await miniEntry.waitFor({ state: "visible", timeout: 10000 });
    const miniText = await miniEntry.textContent();
    record(run, "直接处理小控制面板显示切片进度", /\d+\/\d+/.test(miniText || "") && (miniText || "").includes("%"), `mini text: ${miniText}`);
    record(run, "直接处理小控制面板总切片数匹配 payload", (miniText || "").includes(`/${createPayload.chunks.length}`), `mini text: ${miniText}; chunks: ${createPayload.chunks.length}`);
    await closeNovelWorkbench(page);
    await miniEntry.click();
    await page.locator('[data-testid="novel-task-workbench"]').waitFor({ state: "visible", timeout: 5000 });
    record(run, "直接处理任务小控制面板可打开", true, jobId);
    await screenshot(page, run, "direct-no-chapter-workbench");
    run.status = "passed";
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.stack || error.message : String(error);
    await screenshot(page, run, "failure").catch(() => {});
  } finally {
    await context.close();
  }
  return run;
}

async function main() {
  ensureDirectNovelSample();
  if (!fs.existsSync(novelPath)) throw new Error(`Novel file does not exist: ${novelPath}`);
  const providerState = loadProviderState();
  if (!providerState.provider_selections?.text_generation) {
    throw new Error("No text_generation provider is configured; the UI correctly blocks task creation without one.");
  }

  const browser = await chromium.launch({ headless: true });
  const startedAt = new Date().toISOString();
  let runs;
  try {
    runs = [
      await runSuccess(browser, providerState),
      await runFailure(browser, providerState),
      await runDirectNoChapter(browser, providerState),
    ];
  } finally {
    await browser.close();
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    novelPath,
    novelBytes: fs.statSync(novelPath).size,
    editorUrl,
    status: runs.every((run) => run.status === "passed") ? "passed" : "failed",
    runs,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({
    status: report.status,
    report: path.relative(root, reportPath),
    runs: runs.map((run) => ({ name: run.name, status: run.status, postCount: run.postCount, assertions: run.assertions.length })),
  }, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  fs.writeFileSync(reportPath, JSON.stringify({
    status: "failed",
    novelPath,
    error: error instanceof Error ? error.stack || error.message : String(error),
  }, null, 2), "utf8");
  console.error(error);
  process.exitCode = 1;
});
