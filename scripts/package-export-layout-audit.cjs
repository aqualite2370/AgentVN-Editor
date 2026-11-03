const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const GAMECLI_URL = process.env.AGENTVN_GAMECLI_URL || "http://127.0.0.1:6868/";
const BACKEND_URL = process.env.AGENTVN_BACKEND_URL || "http://127.0.0.1:8278/api/health";
const OUT_DIR = path.join(ROOT, "output", "playwright");
const REPORT_PATH = path.join(OUT_DIR, "package-export-layout-audit.json");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const viewports = [
  { width: 2560, height: 1440 },
  { width: 1440, height: 1000 },
  { width: 1280, height: 720 },
  { width: 757, height: 299 },
  { width: 390, height: 844 },
];

const commonSelectors = [
  { name: "package panel", selector: ".cartridge-export-panel", required: true },
  { name: "close package panel", selector: '[data-help-key="package.close"]', required: true, button: true },
  { name: "package stage navigation", selector: ".package-stage-navigation", required: true },
  { name: "export package", selector: '[data-help-key="package.export"]', required: true, button: true },
  { name: "export console", selector: ".package-log-console", required: true },
  { name: "export console body", selector: ".package-log-console-body", required: true },
];

const settingsSelectors = [
  { name: "package mode", selector: '[data-help-key="package.mode"]', required: true, button: true },
  { name: "target platform", selector: '[data-help-key="package.platform"]', required: true, button: true },
  { name: "output directory input", selector: '[data-help-key="package.outputDir"]', required: true },
  { name: "choose output directory", selector: '[data-help-key="package.chooseOutputDir"]', required: true, button: true },
  { name: "android environment panel", selector: ".package-environment-card", required: true },
  { name: "android environment check", selector: '[data-help-key="package.androidEnvCheck"]', required: true, button: true },
  { name: "android environment install", selector: '[data-help-key="package.androidEnvInstall"]', required: true, button: true },
];

const assetSelectors = [
  { name: "runtime visual assets", selector: ".runtime-visual-assets-panel", required: true },
  { name: "asset audit", selector: ".package-asset-audit", required: true },
];

const checkSelectors = [
  { name: "preflight panel", selector: ".preflight-panel", required: true },
  { name: "preflight diagnostic trigger", selector: '[data-help-key="package.preflight.details"]', required: true, button: true },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function isListening(url) {
  try {
    const response = await fetch(url);
    return response.status < 500;
  } catch {
    return false;
  }
}

function startService(name, cwd, command, args, logs, env = {}) {
  const logFile = path.join(OUT_DIR, `${name}.log`);
  const child = spawn(command, args, {
    cwd,
    shell: process.platform === "win32" && command === NPM,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  child.stdout.on("data", (chunk) => fs.appendFileSync(logFile, chunk));
  child.stderr.on("data", (chunk) => fs.appendFileSync(logFile, chunk));
  logs.push(logFile);
  return child;
}

async function ensureServices(report, includeGameCli = false) {
  const started = [];
  if (!(await isListening(BACKEND_URL))) {
    started.push(startService("package-audit-backend", path.join(ROOT, "backend"), "powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(ROOT, "scripts", "start-backend.ps1"),
    ], report.logs));
  }
  if (!(await isListening(EDITOR_URL))) {
    started.push(startService("package-audit-editor", path.join(ROOT, "editor"), NPM, ["run", "dev"], report.logs, {
      VITE_BACKEND_URL: "http://127.0.0.1:8278",
    }));
  }
  if (includeGameCli && !(await isListening(GAMECLI_URL))) {
    started.push(startService("package-audit-gamecli", path.join(ROOT, "GameCli_framework"), NPM, ["run", "dev"], report.logs));
  }

  const endpoints = [BACKEND_URL, EDITOR_URL, ...(includeGameCli ? [GAMECLI_URL] : [])];
  for (const endpoint of endpoints) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (await isListening(endpoint)) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    if (!(await isListening(endpoint))) {
      throw new Error(`Service did not become ready: ${endpoint}`);
    }
  }
  return started;
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
      // Already exited.
    }
  }
}

async function openEditorPackagePanel(page) {
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  const createProject = page.locator('[data-help-key="home.createProject"]').first();
  if (await createProject.isVisible().catch(() => false)) {
    await createProject.click();
  }
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60000 });
  await page.locator('[data-workspace-surface="publish"]:visible').first().click();
  await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 30000 });
  await selectRichOptionByIndex(page, "package.mode", 0);
  const platform = page.locator('button[data-help-key="package.platform"][role="combobox"]').first();
  await platform.click();
  await page.locator('.rich-select-popover[role="listbox"] [role="option"]').filter({ hasText: "Android" }).click();
  await page.waitForFunction(() => document.querySelector('button[data-help-key="package.platform"][role="combobox"]')?.textContent.includes("Android"));
  await page.locator('[data-help-key="package.outputDir"]').waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".package-environment-card").waitFor({ state: "visible", timeout: 30000 });
}

async function selectRichOptionByIndex(page, helpKey, optionIndex) {
  const trigger = page.locator('button[data-help-key="' + helpKey + '"][role="combobox"]').first();
  await trigger.waitFor({ state: "visible", timeout: 30000 });
  await trigger.click({ force: true });
  const option = page.locator('.rich-select-popover[role="listbox"] button[data-help-key="' + helpKey + '"][role="option"]').nth(optionIndex);
  await option.waitFor({ state: "visible", timeout: 10000 });
  await option.click({ force: true });
  await page.waitForTimeout(420);
}

async function auditSelector(page, item) {
  const locator = page.locator(item.selector).first();
  const count = await locator.count();
  if (!count) {
    return { ...item, ok: !item.required, missing: true, failures: item.required ? ["missing"] : [] };
  }
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  return locator.evaluate((el, meta) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const failures = [];
    const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
    if (!visible) failures.push("not visible");
    const disabled = Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true";
    const clipped = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
    if (clipped && meta.button) failures.push("button text/content clipped");
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2, "center"],
      [rect.left + Math.min(8, rect.width / 3), rect.top + Math.min(8, rect.height / 3), "top-left"],
      [rect.right - Math.min(8, rect.width / 3), rect.top + Math.min(8, rect.height / 3), "top-right"],
      [rect.left + Math.min(8, rect.width / 3), rect.bottom - Math.min(8, rect.height / 3), "bottom-left"],
      [rect.right - Math.min(8, rect.width / 3), rect.bottom - Math.min(8, rect.height / 3), "bottom-right"],
    ];
    const hits = points.map(([x, y, label]) => {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        return { label, x, y, ok: false, reason: "outside viewport" };
      }
      const hit = document.elementFromPoint(x, y);
      const ok = Boolean(hit && (hit === el || el.contains(hit)));
      return {
        label,
        x: Math.round(x),
        y: Math.round(y),
        ok,
        hitTag: hit?.tagName,
        hitText: (hit?.textContent || "").trim().slice(0, 80),
        hitSelector: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}${hit.className && typeof hit.className === "string" ? `.${hit.className.trim().replace(/\s+/g, ".")}` : ""}` : null,
      };
    });
    const centerHit = hits.find((hit) => hit.label === "center");
    if (meta.button && !centerHit?.ok) failures.push("occluded at center");
    if (meta.button && hits.some((hit) => !hit.ok)) failures.push("button hit area clipped or covered");
    return {
      ...meta,
      ok: failures.length === 0,
      failures: [...new Set(failures)],
      disabled,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      scroll: {
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
      },
      style: {
        position: style.position,
        zIndex: style.zIndex,
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        pointerEvents: style.pointerEvents,
        opacity: style.opacity,
        transform: style.transform,
      },
      hits,
    };
  }, item);
}

async function auditEditorViewport(browser, viewport, report) {
  const page = await browser.newPage({ viewport });
  const label = `${viewport.width}x${viewport.height}`;
  try {
    await openEditorPackagePanel(page);
    const screenshotPath = path.join(OUT_DIR, `package-export-${label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report.screenshots.push(screenshotPath);
    const elements = [];
    for (const item of [...commonSelectors, ...settingsSelectors]) {
      elements.push(await auditSelector(page, item));
    }
    const settingsState = await page.evaluate(() => ({
      mode: document.querySelector('button[data-help-key="package.mode"][role="combobox"]')?.textContent?.trim() || "",
      platform: document.querySelector('button[data-help-key="package.platform"][role="combobox"]')?.textContent?.trim() || "",
      activeStage: document.querySelector(".package-stage-viewport")?.getAttribute("data-active-stage"),
    }));
    const expandedDockHeight = await page.locator(".package-build-dock").evaluate((element) => Math.round(element.getBoundingClientRect().height));
    await page.locator(".package-console-toggle").click();
    await page.waitForFunction(() => !document.querySelector(".package-log-console-body"));
    await page.waitForTimeout(240);
    const collapsedDockHeight = await page.locator(".package-build-dock").evaluate((element) => Math.round(element.getBoundingClientRect().height));
    await page.locator(".package-console-toggle").click();
    await page.locator(".package-log-console-body").waitFor({ state: "visible", timeout: 10000 });

    await page.locator('[data-package-stage="assets"]').click();
    await page.locator(".package-assets-stage").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(() => document.querySelector(".package-stage-viewport")?.scrollTop === 0);
    const assetsScreenshotPath = path.join(OUT_DIR, `package-export-assets-${label}.png`);
    await page.screenshot({ path: assetsScreenshotPath, fullPage: true });
    report.screenshots.push(assetsScreenshotPath);
    for (const item of assetSelectors) {
      elements.push(await auditSelector(page, item));
    }

    await page.locator('[data-package-stage="checks"]').click();
    await page.locator(".package-checks-stage").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(() => document.querySelector(".package-stage-viewport")?.scrollTop === 0);
    const checksScreenshotPath = path.join(OUT_DIR, `package-export-checks-${label}.png`);
    await page.screenshot({ path: checksScreenshotPath, fullPage: true });
    report.screenshots.push(checksScreenshotPath);
    for (const item of checkSelectors) {
      elements.push(await auditSelector(page, item));
    }

    await page.locator('[data-package-stage="settings"]').click();
    await page.locator(".package-settings-stage").waitFor({ state: "visible", timeout: 10000 });
    const restoredSettingsState = await page.evaluate(() => ({
      mode: document.querySelector('button[data-help-key="package.mode"][role="combobox"]')?.textContent?.trim() || "",
      platform: document.querySelector('button[data-help-key="package.platform"][role="combobox"]')?.textContent?.trim() || "",
      activeStage: document.querySelector(".package-stage-viewport")?.getAttribute("data-active-stage"),
    }));

    await page.locator('[data-package-stage="checks"]').click();
    await page.locator(".package-checks-stage").waitFor({ state: "visible", timeout: 10000 });
    const composition = await page.evaluate(() => {
      const panel = document.querySelector(".toolbar-popover.cartridge");
      const preflight = document.querySelector(".preflight-panel");
      const rect = panel?.getBoundingClientRect();
      const dock = document.querySelector(".package-build-dock");
      const viewport = document.querySelector(".package-stage-viewport");
      const navigation = document.querySelector(".package-stage-navigation");
      const navigationItem = document.querySelector(".package-stage-navigation-item");
      const navigationStatus = document.querySelector(".package-stage-navigation-status");
      const consoleLine = document.querySelector(".package-log-line") || document.querySelector(".package-log-empty");
      const buildStatusHint = document.querySelector(".package-build-action-status > small");
      return {
        frame: rect ? {
          top: Math.round(rect.top),
          right: Math.round(document.documentElement.clientWidth - rect.right),
          bottom: Math.round(document.documentElement.clientHeight - rect.bottom),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        } : null,
        diagnosticTextHidden: !/问题：|解决方案：/.test(preflight?.textContent || ""),
        legacyMessagePreviewCount: document.querySelectorAll(".json-preview").length,
        legacyColumnCount: document.querySelectorAll(".package-middle-column, .package-check-column, .package-export-layout").length,
        consoleInsideBuildDock: Boolean(document.querySelector(".package-build-dock > .package-log-console")),
        consoleExpandedByDefault: Boolean(dock?.classList.contains("is-open") && document.querySelector(".package-log-console-body")),
        consoleBodyHeight: Math.round(document.querySelector(".package-log-console-body")?.getBoundingClientRect().height || 0),
        buildDockHeight: Math.round(dock?.getBoundingClientRect().height || 0),
        navigationWidth: Math.round(navigation?.getBoundingClientRect().width || 0),
        navigationItemHeight: Math.round(navigationItem?.getBoundingClientRect().height || 0),
        navigationStatusFontSize: navigationStatus ? Number.parseFloat(getComputedStyle(navigationStatus).fontSize) : 0,
        consoleFontSize: consoleLine ? Number.parseFloat(getComputedStyle(consoleLine).fontSize) : 0,
        buildStatusHintFontSize: buildStatusHint ? Number.parseFloat(getComputedStyle(buildStatusHint).fontSize) : 0,
        visibleStageCount: Array.from(document.querySelectorAll(".package-stage")).filter((item) => {
          const stageRect = item.getBoundingClientRect();
          const style = getComputedStyle(item);
          return stageRect.width > 0 && stageRect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        }).length,
        activeStage: viewport?.getAttribute("data-active-stage"),
        viewportOverflowY: viewport ? getComputedStyle(viewport).overflowY : "",
        preflightSummaryMaxHeight: Math.round(Math.max(
          0,
          ...Array.from(document.querySelectorAll(".preflight-summary > span")).map((item) => item.getBoundingClientRect().height),
        )),
        primaryActionHeight: Math.round(document.querySelector('[data-help-key="package.export"]')?.getBoundingClientRect().height || 0),
      };
    });
    const failures = elements.flatMap((item) => item.failures.map((failure) => `${item.name}: ${failure}`));
    if (!composition.frame || Math.max(
      composition.frame.top,
      composition.frame.right,
      composition.frame.bottom,
      composition.frame.left,
    ) > 16) {
      failures.push(`package panel is not near-fullscreen: ${JSON.stringify(composition.frame)}`);
    }
    if (!composition.diagnosticTextHidden) failures.push("preflight diagnostics are visible before a check is opened");
    if (composition.legacyMessagePreviewCount !== 0) failures.push("legacy message preview is still rendered beside the console");
    if (composition.legacyColumnCount !== 0) failures.push(`legacy three-column layout is still rendered: ${composition.legacyColumnCount}`);
    if (!composition.consoleInsideBuildDock) failures.push("export console is not attached to the build dock");
    const minimumConsoleHeight = viewport.width < 720 ? 70 : 90;
    if (!composition.consoleExpandedByDefault || composition.consoleBodyHeight < minimumConsoleHeight) {
      failures.push(`build log is not expanded by default: ${JSON.stringify({
        open: composition.consoleExpandedByDefault,
        bodyHeight: composition.consoleBodyHeight,
      })}`);
    }
    if (composition.visibleStageCount !== 1 || composition.activeStage !== "checks") {
      failures.push(`workspace does not isolate one active stage: ${JSON.stringify({
        count: composition.visibleStageCount,
        activeStage: composition.activeStage,
      })}`);
    }
    if (!["auto", "scroll"].includes(composition.viewportOverflowY)) {
      failures.push(`stage viewport is not the main vertical scroll region: ${composition.viewportOverflowY}`);
    }
    if (settingsState.mode !== restoredSettingsState.mode || settingsState.platform !== restoredSettingsState.platform) {
      failures.push(`settings state changed across stage navigation: ${JSON.stringify({ settingsState, restoredSettingsState })}`);
    }
    if (collapsedDockHeight >= expandedDockHeight) {
      failures.push(`console dock did not collapse: ${JSON.stringify({ expandedDockHeight, collapsedDockHeight })}`);
    }
    if (composition.preflightSummaryMaxHeight > 40) {
      failures.push(`preflight summary pills are stretched: ${composition.preflightSummaryMaxHeight}px`);
    }
    if (composition.primaryActionHeight < 52) {
      failures.push(`primary package action is visually undersized: ${composition.primaryActionHeight}px`);
    }
    if (viewport.width >= 1080 && composition.navigationWidth < 230) {
      failures.push(`desktop stage navigation is too narrow: ${composition.navigationWidth}px`);
    }
    if (viewport.width >= 1080 && composition.navigationItemHeight < 88) {
      failures.push(`desktop stage navigation item is too small: ${composition.navigationItemHeight}px`);
    }
    if (composition.navigationStatusFontSize < 11) {
      failures.push(`stage status text is too small: ${composition.navigationStatusFontSize}px`);
    }
    if (composition.consoleFontSize < (viewport.width < 720 ? 10 : 11)) {
      failures.push(`console text is too small: ${composition.consoleFontSize}px`);
    }
    if (viewport.width >= 720 && composition.buildStatusHintFontSize < 11) {
      failures.push(`build status hint is too small: ${composition.buildStatusHintFontSize}px`);
    }
    report.viewports.push({
      viewport,
      ok: failures.length === 0,
      failures,
      elements,
      composition,
      settingsState,
      restoredSettingsState,
      consoleToggle: { expandedDockHeight, collapsedDockHeight },
      screenshotPath,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

async function auditFixedMode(browser, report) {
  const embedded = path.join(ROOT, "GameCli_framework", "public", "embedded-cartridge", "game.vncart");
  if (!fs.existsSync(embedded)) {
    report.fixedMode = { ok: true, skipped: true, reason: "No embedded cartridge is present for fixed-mode web smoke." };
    return false;
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(`${GAMECLI_URL}?mode=fixed`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const screenshotPath = path.join(OUT_DIR, "package-fixed-mode.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report.screenshots.push(screenshotPath);
    const forbidden = [
      '[data-testid="open-library"]',
      "text=导入卡带",
      "text=导入 .vncart",
      "text=移除",
    ];
    const found = [];
    for (const selector of forbidden) {
      if (await page.locator(selector).first().isVisible().catch(() => false)) found.push(selector);
    }
    report.fixedMode = { ok: found.length === 0, found, screenshotPath };
    return found.length === 0;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  ensureDir(OUT_DIR);
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    viewports: [],
    fixedMode: null,
    screenshots: [],
    logs: [],
    failures: [],
  };
  const includeGameCli = fs.existsSync(path.join(ROOT, "GameCli_framework", "public", "embedded-cartridge", "game.vncart"));
  const started = await ensureServices(report, includeGameCli);
  const browser = await chromium.launch();
  try {
    for (const viewport of viewports) {
      await auditEditorViewport(browser, viewport, report);
    }
    if (includeGameCli) await auditFixedMode(browser, report);
    else report.fixedMode = { ok: true, skipped: true, reason: "No embedded cartridge is present for fixed-mode web smoke." };
    report.failures = [
      ...report.viewports.flatMap((item) => item.failures.map((failure) => `${item.viewport.width}x${item.viewport.height}: ${failure}`)),
      ...(report.fixedMode?.ok ? [] : [`fixed-mode forbidden controls: ${(report.fixedMode?.found || []).join(", ")}`]),
    ];
    report.ok = report.failures.length === 0;
  } finally {
    await browser.close().catch(() => {});
    stopServices(started);
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (!report.ok) {
    console.error(JSON.stringify({ ok: false, report: REPORT_PATH, failures: report.failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, report: REPORT_PATH }, null, 2));
}

main().catch((error) => {
  ensureDir(OUT_DIR);
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify({ ok: false, error: error.stack || error.message }, null, 2)}\n`, "utf8");
  console.error(error);
  process.exit(1);
});
