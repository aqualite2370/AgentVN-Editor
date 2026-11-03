const fs = require("fs");
const path = require("path");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const GAMECLI_URL = process.env.AGENTVN_GAMECLI_URL || "http://127.0.0.1:6868/";
const OUT_DIR = process.env.AGENTVN_TEXT_CRISPNESS_OUT || path.join(ROOT, "test_AgentVN", "text-crispness-audit");

fs.mkdirSync(OUT_DIR, { recursive: true });

const report = {
  ok: true,
  at: new Date().toISOString(),
  urls: { editor: EDITOR_URL, gamecli: GAMECLI_URL },
  checks: [],
  failures: [],
  warnings: [],
  screenshots: [],
};

function add(status, area, name, detail = "", evidence = "") {
  const item = { status, area, name, detail, evidence };
  report.checks.push(item);
  if (status === "FAIL") {
    report.ok = false;
    report.failures.push(item);
  } else if (status === "WARN") {
    report.warnings.push(item);
  }
}

async function screenshot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push(file);
  return file;
}

async function openIfAvailable(page, url, area) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
    await page.locator("body").waitFor({ state: "visible", timeout: 12000 });
    add("PASS", area, "open", url);
    return true;
  } catch (error) {
    add("WARN", area, "open skipped", `${url} not reachable: ${error.message}`);
    return false;
  }
}

async function clickFirstVisible(page, selectors, area, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) {
      await locator.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(600);
      add("PASS", area, label, selector);
      return true;
    }
  }
  add("WARN", area, label, "no matching visible trigger");
  return false;
}

async function waitForStableMotion(page) {
  await page.waitForTimeout(1300);
}

async function waitForEditorTransitionSettled(page) {
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await page.locator(".app-view.is-entering, .app-view.is-exiting").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await waitForStableMotion(page);
}

async function auditTextSurfaces(page, area, label, selectors) {
  const result = await page.evaluate((input) => {
    const allowTranslateOnly = (transform) => {
      if (!transform || transform === "none") return true;
      try {
        const matrix = new DOMMatrixReadOnly(transform);
        const scaleX = Math.hypot(matrix.a, matrix.b);
        const scaleY = Math.hypot(matrix.c, matrix.d);
        const hasRotationOrSkew = Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001;
        return Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001 && !hasRotationOrSkew;
      } catch {
        return !/scale|rotate|skew|matrix3d/i.test(transform);
      }
    };

    const nodeName = (element) => {
      const parts = [element.tagName.toLowerCase()];
      if (element.id) parts.push(`#${element.id}`);
      const testId = element.getAttribute("data-testid");
      if (testId) parts.push(`[data-testid="${testId}"]`);
      const cls = String(element.className || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .map((name) => `.${name}`)
        .join("");
      if (cls) parts.push(cls);
      return parts.join("");
    };

    const isVisibleTextSurface = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0.02 &&
        (element.innerText || element.textContent || "").replace(/\s+/g, "").length > 0;
    };

    const targets = Array.from(new Set(input.selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))));
    const failures = [];
    const sampled = [];

    for (const target of targets) {
      if (!(target instanceof HTMLElement) || !isVisibleTextSurface(target)) continue;
      const text = (target.innerText || target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
      const chain = [];
      let current = target;
      while (current && current instanceof HTMLElement && current !== document.documentElement) {
        chain.push(current);
        if (current === document.body) break;
        current = current.parentElement;
      }

      for (const element of chain) {
        const style = getComputedStyle(element);
        const animations = element.getAnimations({ subtree: false }).filter((animation) => animation.playState === "running" || animation.playState === "pending");
        const transform = style.transform;
        const filter = style.filter;
        const willChange = style.willChange;
        const issues = [];
        if (animations.length > 0) {
          issues.push(`active animations: ${animations.map((animation) => (
            typeof CSSAnimation !== "undefined" && animation instanceof CSSAnimation ? animation.animationName : animation.id || "waapi"
          )).join(", ")}`);
        }
        const isCanvasViewport = element.matches(".react-flow__viewport, .xyflow__viewport, .react-flow__renderer");
        if (!isCanvasViewport && !allowTranslateOnly(transform)) issues.push(`transform: ${transform}`);
        if (filter && filter !== "none" && /blur\(/i.test(filter)) issues.push(`filter: ${filter}`);
        if (/\b(transform|filter)\b/i.test(willChange)) issues.push(`will-change: ${willChange}`);
        if (issues.length > 0) {
          failures.push({
            target: nodeName(target),
            ancestor: nodeName(element),
            text,
            issues,
          });
        }
      }
      sampled.push({ node: nodeName(target), text });
    }

    return {
      label: input.label,
      sampled: sampled.slice(0, 80),
      failures,
    };
  }, { label, selectors });

  const file = path.join(OUT_DIR, `${area}-${label}.json`);
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (result.failures.length > 0) add("FAIL", area, label, `${result.failures.length} residual animation/style issues`, file);
  else add("PASS", area, label, `${result.sampled.length} visible text surfaces checked`, file);
  return result;
}

async function runEditor(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  if (!(await openIfAvailable(page, EDITOR_URL, "editor"))) {
    await context.close();
    return;
  }
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  await clickFirstVisible(page, [
    ".home-action-primary",
    "button:has-text('继续')",
    "button:has-text('Continue')",
    "button:has-text('新建项目')",
  ], "editor", "enter editor workspace");
  await page.locator(".editor-shell").waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
  await waitForEditorTransitionSettled(page);
  await clickFirstVisible(page, [
    "button:has-text('工具/设置')",
    "button:has-text('工具')",
    "button:has-text('Tools')",
    "[data-testid='open-tools']",
    ".toolbar button",
  ], "editor", "open tools/settings");
  await waitForEditorTransitionSettled(page);
  await auditTextSurfaces(page, "editor", "stable", [
    ".toolbar-popover",
    ".floating-command-workbench",
    ".workbench-detail-card",
    ".assistant-markdown-stream",
    ".novel-process-task-workbench",
    ".agentvn-panel",
    ".hover-help-card",
    ".preview-panel",
    ".blueprint-node",
    "button",
    "label",
    "p",
    "span",
  ]);
  await screenshot(page, "editor-stable-1920x1080");
  await context.close();
}

async function runGameCli(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  if (!(await openIfAvailable(page, GAMECLI_URL, "gamecli"))) {
    await context.close();
    return;
  }
  await page.locator(".boot-overlay").waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  await clickFirstVisible(page, [
    "button:has-text('开始')",
    "button:has-text('Start')",
    "button:has-text('设置')",
    "button:has-text('Settings')",
    "[data-testid='start-game']",
    "[data-testid='continue-game']",
    ".menu-actions button",
    ".ui-button.secondary",
  ], "gamecli", "enter playable/menu surface");
  await waitForStableMotion(page);
  await auditTextSurfaces(page, "gamecli", "stable", [
    ".dialog-box",
    ".dialog-text",
    ".speaker",
    ".choice-option",
    ".animation-hint",
    ".main-menu",
    ".screen-panel",
    ".library-shell",
    ".ui-button",
    "button",
    "p",
    "span",
    "strong",
  ]);
  await screenshot(page, "gamecli-stable-1920x1080");
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await runEditor(browser);
    await runGameCli(browser);
  } finally {
    await browser.close();
  }
  const reportFile = path.join(OUT_DIR, "text-crispness-audit.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: report.ok, reportFile, failures: report.failures.length, warnings: report.warnings.length }, null, 2));
  if (!report.ok) process.exitCode = 1;
})();
