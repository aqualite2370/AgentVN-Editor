const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const OUT_DIR = path.join(ROOT, "output", "playwright", "novel-import-ui-perf");
const REPORT_PATH = path.join(OUT_DIR, "novel-import-ui-perf-audit.json");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

fs.mkdirSync(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildNovelFixture() {
  const chapters = [];
  for (let chapter = 1; chapter <= 90; chapter += 1) {
    const paragraphs = [];
    for (let paragraph = 1; paragraph <= 18; paragraph += 1) {
      paragraphs.push(
        `\u7b2c${chapter}\u7ae0 \u7b2c${paragraph}\u6bb5\u3002\u96e8\u591c\u8f66\u7ad9\u7684\u706f\u5149\u95ea\u70c1\uff0c\u89d2\u8272\u4eec\u6838\u5bf9\u7ebf\u7d22\uff0c\u91cd\u590d\u4e00\u4e2a\u5173\u952e\u7ec6\u8282\uff0c\u5e76\u51c6\u5907\u4e0b\u4e00\u573a\u7684\u5206\u652f\u51b3\u5b9a\u3002`.repeat(8)
      );
    }
    chapters.push(`\u7b2c${chapter}\u7ae0 \u96e8\u591c\u8f66\u7ad9\n\n${paragraphs.join("\n\n")}`);
  }
  return chapters.join("\n\n");
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
  const logFile = path.join(OUT_DIR, "novel-import-ui-perf-editor.log");
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

  if (await page.locator(".editor-toolbar").isVisible({ timeout: 800 }).catch(() => false)) {
    await page.locator('[data-help-key="toolbar.home"]').first().click({ force: true });
    await page.locator('[data-help-key="home.createProject"]').first().waitFor({ state: "visible", timeout: 30_000 });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.locator(".editor-toolbar").isVisible({ timeout: 800 }).catch(() => false)) return;
    await clickFirstReady('[data-help-key="home.createProject"]');
    if (await page.locator(".editor-toolbar").isVisible({ timeout: 12_000 }).catch(() => false)) return;
  }
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 30_000 });
}

async function installProjectStateWriteGuard(page) {
  await page.route("**/api/project/state", async (route) => {
    const request = route.request();
    if (request.method().toUpperCase() !== "POST") {
      await route.continue();
      return;
    }
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
}

async function openNovelWorkbench(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
      detail: { id: `perf_novel_${Date.now()}`, tab: "novel" },
    }));
  });
  await page.locator('[data-testid="novel-import-workbench"], .advanced-tools-panel.novel-ai-import').first().waitFor({ state: "visible", timeout: 30_000 });
}

async function installProbe(page) {
  await page.evaluate(() => {
    window.__agentvnPerfProbe = {
      running: false,
      start: 0,
      lastFrame: 0,
      frameGaps: [],
      longTasks: [],
      mutationCount: 0,
    };
    try {
      const observer = new PerformanceObserver((list) => {
        const state = window.__agentvnPerfProbe;
        for (const entry of list.getEntries()) {
          if (entry.startTime >= state.start) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long task is not available in every browser build.
    }
    try {
      const mutationObserver = new MutationObserver((records) => {
        const state = window.__agentvnPerfProbe;
        if (state.running) state.mutationCount += records.length;
      });
      mutationObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
    } catch {
      // Mutation details are diagnostic only.
    }
  });
}

async function startProbe(page) {
  return page.evaluate(() => {
    const state = window.__agentvnPerfProbe;
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
    const state = window.__agentvnPerfProbe;
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

async function firstReadyLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false) && await item.isEnabled().catch(() => false)) {
        return item;
      }
    }
  }
  return undefined;
}

async function collectSplitDiagnostic(page) {
  return page.evaluate(() => {
    const text = (selector) => [...document.querySelectorAll(selector)]
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .slice(0, 8);
    const buttonState = (selector) => [...document.querySelectorAll(selector)].map((node) => {
      const button = node;
      const rect = button.getBoundingClientRect();
      return {
        text: button.textContent?.trim() ?? "",
        visible: rect.width > 0 && rect.height > 0,
        disabled: Boolean(button.disabled) || button.getAttribute("aria-disabled") === "true",
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      };
    });
    return {
      splitDiagnostic: window.__AGENTVN_NOVEL_IMPORT_STORE__?.getState?.().splitDiagnostic,
      largeDialogVisible: Boolean(document.querySelector(".novel-large-dialog")),
      preflightVisible: Boolean(document.querySelector(".novel-file-preflight")),
      chapterPageVisible: Boolean(document.querySelector(".novel-chapter-selection-page")),
      splitReportVisible: Boolean(document.querySelector(".novel-local-split-report")),
      chapterRows: document.querySelectorAll(".novel-chapter-table tbody tr").length,
      errors: text(".inline-error, .error-message, .novel-error, [role='alert']"),
      warnings: text(".inline-warning"),
      splitButtons: buttonState('[data-help-key="novel.startChapterSplit"], [data-help-key="novel.splitChapters"]'),
      progressText: text(".novel-ai-progress, .progress-card, [role='status']"),
    };
  });
}

function markActionFailure(report, label, error, diagnostic) {
  report.ok = false;
  report.actions.push({
    label,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    diagnostic,
  });
}

async function run() {
  const report = {
    ok: true,
    at: new Date().toISOString(),
    editorUrl: EDITOR_URL,
    logs: [],
    actions: [],
    screenshots: [],
  };
  let browser;
  let started = [];
  try {
    started = await ensureEditor(report);
    const fixturePath = path.join(OUT_DIR, "large-novel-fixture.txt");
    fs.writeFileSync(fixturePath, buildNovelFixture(), "utf8");

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await installProjectStateWriteGuard(page);
    await openEditor(page);
    await installProbe(page);

    report.actions.push(await measure(
      page,
      "open-novel-import-workbench",
      () => openNovelWorkbench(page),
      () => page.locator(".novel-ai-launchpad, .novel-chapter-selection-page").first().waitFor({ state: "visible", timeout: 30_000 }),
    ));

    const resetButton = page.locator('[data-help-key="novel.reset"]').first();
    if (await resetButton.isVisible({ timeout: 1_500 }).catch(() => false)) {
      report.actions.push(await measure(
        page,
        "reset-existing-novel-session",
        () => resetButton.click({ force: true }),
        () => page.locator('[data-help-key="novel.importFile"] input[type="file"]').first().waitFor({ state: "attached", timeout: 30_000 }),
      ));
    }

    report.actions.push(await measure(
      page,
      "select-large-novel-file",
      () => page.locator('[data-help-key="novel.importFile"] input[type="file"]').first().setInputFiles(fixturePath),
      () => page.locator(".novel-file-preflight, .novel-large-dialog, .novel-chapter-selection-page").first().waitFor({ state: "visible", timeout: 30_000 }),
    ));

    const splitButton = await firstReadyLocator(page, [
      ".novel-large-dialog [data-help-key='novel.startChapterSplit']",
      ".novel-file-preflight [data-help-key='novel.startChapterSplit']",
      "[data-help-key='novel.startChapterSplit']",
    ]);
    const splitInlineButton = await firstReadyLocator(page, [
      "[data-help-key='novel.splitChapters']",
    ]);
    if (splitButton) {
      try {
        report.actions.push(await measure(
          page,
          "confirm-large-text-split",
          () => splitButton.click(),
          () => page.locator(".novel-chapter-table tbody tr, .novel-local-split-report").first().waitFor({ state: "visible", timeout: 45_000 }),
        ));
      } catch (error) {
        markActionFailure(report, "confirm-large-text-split", error, await collectSplitDiagnostic(page));
      }
    } else if (splitInlineButton) {
      try {
        report.actions.push(await measure(
          page,
          "run-local-chapter-split",
          () => splitInlineButton.click(),
          () => page.locator(".novel-chapter-table tbody tr, .novel-local-split-report").first().waitFor({ state: "visible", timeout: 45_000 }),
        ));
      } catch (error) {
        markActionFailure(report, "run-local-chapter-split", error, await collectSplitDiagnostic(page));
      }
    } else {
      markActionFailure(report, "find-chapter-split-action", new Error("No enabled chapter split button was available."), await collectSplitDiagnostic(page));
    }

    const selectAllChapters = page.locator('[data-help-key="novel.selectAllChapters"]').first();
    if (await selectAllChapters.isVisible({ timeout: 1_500 }).catch(() => false) && await selectAllChapters.isEnabled().catch(() => false)) {
      report.actions.push(await measure(
        page,
        "select-all-chapters",
        () => selectAllChapters.click({ force: true }),
        () => page.waitForFunction(() => document.querySelectorAll(".novel-chapter-table tbody tr.is-selected").length > 0, null, { timeout: 30_000 }),
      ));
    }

    const screenshot = path.join(OUT_DIR, "novel-import-ui-perf.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    report.screenshots.push(screenshot);
    await context.close();
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServices(started);
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
    const rounded = (value) => typeof value === "number" && Number.isFinite(value) ? Math.round(value) : "";
    console.table(report.actions.map((item) => ({
      label: item.label,
      ok: item.ok === false ? false : true,
      elapsedMs: rounded(item.elapsedMs),
      maxLongTaskMs: rounded(item.maxLongTaskMs),
      maxFrameGapMs: rounded(item.maxFrameGapMs),
      mutationCount: item.mutationCount ?? "",
      resourceCount: item.resourceCount ?? "",
    })));
    console.log(JSON.stringify({ ok: report.ok, reportPath: REPORT_PATH, screenshots: report.screenshots, error: report.error }, null, 2));
  }
  if (!report.ok) process.exit(1);
}

void run();
