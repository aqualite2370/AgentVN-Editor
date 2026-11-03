#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const backendRoot = path.join(root, "backend");
const fixture = path.join(root, "data", "backup-timeline", "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj");
const outputDir = path.join(root, "output", "playwright", "quick-menu-preview-visual-regression");
const editorUrl = "http://127.0.0.1:6767/";
const backendHealth = "http://127.0.0.1:8278/api/health";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function ready(url, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server not ready: ${url}`);
}

function start(command, args, cwd) {
  return spawn(command, args, { cwd, windowsHide: true, shell: process.platform === "win32", stdio: "ignore" });
}

function stop(child) {
  if (!child?.pid) return;
  try { spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
}

function rect(element) {
  if (!element) return null;
  const value = element.getBoundingClientRect();
  return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
}

async function importFixture(page) {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const input = page.locator(".project-import-button input").first();
  await input.waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some((candidate) => candidate instanceof HTMLInputElement && !candidate.disabled), undefined, { timeout: 30_000 });
  await input.setInputFiles(fixture);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]')].some((element) => {
    const value = element.getBoundingClientRect();
    return value.width > 0 && value.height > 0 && !(element instanceof HTMLButtonElement && element.disabled);
  }), undefined, { timeout: 60_000 });
  const openDraft = page.locator('[data-help-key="home.openDraft"]:visible:not(:disabled), [data-help-key="home.recentProject"]:visible:not(:disabled)').first();
  await openDraft.waitFor({ state: "visible", timeout: 45_000 });
  await openDraft.click({ force: true });
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"), undefined, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function openLayout(page) {
  await page.locator('[data-help-key="toolbar.advanced"]:visible').first().click({ force: true });
  await page.locator(".toolbar-popover.advanced.is-open").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').first().click({ force: true });
  await page.locator(".runtime-layout-designer").waitFor({ state: "visible", timeout: 30_000 });
  const playerScreen = page.locator('[data-help-key="layout.screen"]:visible').filter({ hasText: "播放页" }).first();
  if (await playerScreen.count()) await playerScreen.click({ force: true });
  await page.locator('[data-testid="runtime-quick-menu-preview-controls"]').waitFor({ state: "visible", timeout: 30_000 });
}

async function sample(page) {
  return page.evaluate(() => {
    const colorMetrics = (value) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context || !value || value === "transparent") return { alpha: 0, saturation: 0 };
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      const channels = [red, green, blue].map((channel) => channel / 255);
      const max = Math.max(...channels);
      const min = Math.min(...channels);
      const delta = max - min;
      const lightness = (max + min) / 2;
      return {
        alpha: alpha / 255,
        saturation: delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)),
        red,
        green,
        blue,
      };
    };
    const expected = document.querySelector(".runtime-layout-expected-preview.is-player");
    const preview = expected?.querySelector(".preview-quick-menu-preview");
    const surface = expected?.querySelector(".preview-quick-menu-surface");
    const actionLayer = expected?.querySelector(".preview-quick-menu-action-layer");
    const buttons = expected?.querySelector(".preview-quick-menu-buttons");
    const toggle = expected?.querySelector(".preview-quick-menu-toggle");
    const pageSurface = expected?.querySelector(".runtime-layout-page-surface");
    const firstButton = expected?.querySelector(".preview-quick-menu-button");
    const asRect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const intersect = (a, b) => {
      if (!a || !b) return null;
      const left = Math.max(a.left, b.left);
      const top = Math.max(a.top, b.top);
      const right = Math.min(a.right, b.right);
      const bottom = Math.min(a.bottom, b.bottom);
      return right > left && bottom > top
        ? { left, top, right, bottom, width: right - left, height: bottom - top }
        : null;
    };
    const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    const buttonRects = [...(expected?.querySelectorAll(".preview-quick-menu-button") ?? [])].map(asRect);
    const toggleRect = asRect(toggle);
      const surfaceStyle = surface ? getComputedStyle(surface) : null;
      const previewStyle = preview ? getComputedStyle(preview) : null;
    const pageSurfaceStyle = pageSurface ? getComputedStyle(pageSurface) : null;
    const firstButtonStyle = firstButton ? getComputedStyle(firstButton) : null;
    const toggleStyle = toggle ? getComputedStyle(toggle) : null;
      return {
      state: expected?.getAttribute("data-preview-quick-menu-state"),
      variant: expected?.getAttribute("data-preview-quick-menu-variant"),
      columns: Number.parseInt(expected?.getAttribute("data-preview-quick-menu-columns") ?? "1", 10),
      preview: asRect(preview),
      stage: asRect(expected),
      surface: asRect(surface),
      actionLayer: asRect(actionLayer),
      buttons: asRect(buttons),
      buttonRects,
      toggle: toggleRect,
      visibleSurfacePaint: surface ? surfaceStyle.backgroundColor !== "rgba(0, 0, 0, 0)" : false,
      surfaceBackground: surfaceStyle?.backgroundColor ?? null,
        surfaceColorMetrics: colorMetrics(surfaceStyle?.backgroundColor ?? ""),
        previewThemeQuickMenu: previewStyle?.getPropertyValue("--preview-runtime-quick-menu").trim() ?? "",
        previewThemeControl: previewStyle?.getPropertyValue("--preview-runtime-control").trim() ?? "",
        previewThemeLine: previewStyle?.getPropertyValue("--preview-runtime-line").trim() ?? "",
        previewThemeQuickMenuMetrics: colorMetrics(previewStyle?.getPropertyValue("--preview-runtime-quick-menu") ?? ""),
        previewThemeControlMetrics: colorMetrics(previewStyle?.getPropertyValue("--preview-runtime-control") ?? ""),
      surfaceBackgroundRaw: surfaceStyle?.background ?? null,
      surfaceBackdropFilter: surfaceStyle?.backdropFilter ?? null,
      surfaceBoxShadow: surfaceStyle?.boxShadow ?? null,
      surfaceTransitionProperty: surfaceStyle?.transitionProperty ?? null,
      surfaceTransitionDuration: surfaceStyle?.transitionDuration ?? null,
      legacySurfacePaint: preview ? getComputedStyle(preview, "::before").display !== "none" && getComputedStyle(preview, "::before").opacity !== "0" : false,
      previewBackgroundImage: pageSurfaceStyle?.backgroundImage ?? null,
      previewBackgroundColor: pageSurfaceStyle?.backgroundColor ?? null,
      buttonBackground: firstButtonStyle?.backgroundColor ?? null,
      buttonColorMetrics: colorMetrics(firstButtonStyle?.backgroundColor ?? ""),
      buttonColor: firstButtonStyle?.color ?? null,
      buttonBoxShadow: firstButtonStyle?.boxShadow ?? null,
      buttonOpacity: Number(firstButtonStyle?.opacity ?? 0),
      buttonFilter: firstButtonStyle?.filter ?? null,
      buttonBackdropFilter: firstButtonStyle?.backdropFilter ?? null,
      toggleBackground: toggleStyle?.backgroundColor ?? null,
      toggleColorMetrics: colorMetrics(toggleStyle?.backgroundColor ?? ""),
      toggleOpacity: Number(toggleStyle?.opacity ?? 0),
      toggleFilter: toggleStyle?.filter ?? null,
      toggleBackdropFilter: toggleStyle?.backdropFilter ?? null,
      buttonVisibility: buttons ? getComputedStyle(buttons).visibility : null,
      buttonPointerEvents: buttons ? getComputedStyle(buttons).pointerEvents : null,
      buttonCount: buttonRects.length,
      toggleActionOverlap: buttonRects
        .map((item) => intersect(item, asRect(buttons)))
        .filter((item) => overlaps(item, toggleRect)).length,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(path.join(outputDir, "error.txt"), { force: true });
  const backendAlreadyReady = await ready(backendHealth, 1_500).then(() => true).catch(() => false);
  const editorAlreadyReady = await ready(editorUrl, 1_500).then(() => true).catch(() => false);
  const backend = backendAlreadyReady ? null : start(process.env.PYTHON || "python", ["backend_launcher.py"], backendRoot);
  const editor = editorAlreadyReady ? null : start("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "6767"], editorRoot);
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    await ready(backendHealth);
    await ready(editorUrl);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await importFixture(page);
    await openLayout(page);
    const results = {};
    for (const viewport of [
      { name: "2560x1392", width: 2560, height: 1392 },
      { name: "1440x900", width: 1440, height: 900 },
      { name: "757x299", width: 757, height: 299 },
      { name: "390x844", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(250);
      const layoutVisibleAfterResize = await page.locator('[data-testid="runtime-quick-menu-preview-controls"]').isVisible().catch(() => false);
      if (!layoutVisibleAfterResize) {
        await openLayout(page);
      }
      const controls = page.locator('[data-testid="runtime-quick-menu-preview-controls"]');
      assert(
        await controls.locator('[data-preview-quick-menu-variant]').count() === 0,
        `${viewport.name}: removed quick-menu variant control returned`,
        await controls.evaluate((element) => element.outerHTML),
      );
      assert(
        await page.locator('.runtime-layout-expected-preview[data-preview-quick-menu-variant="C"]').count() === 1,
        `${viewport.name}: fixed C preview is missing`,
        await page.evaluate(() => ({
          screenId: document.querySelector(".runtime-layout-expected-preview")?.className ?? null,
          controls: document.querySelector('[data-testid="runtime-quick-menu-preview-controls"]')?.outerHTML ?? null,
          layoutReady: document.querySelector(".runtime-layout-designer")?.getAttribute("data-advanced-tab-ready") ?? null,
        })),
      );
      await controls.locator('button[data-preview-quick-menu-state="expanded"]').click();
      await page.waitForTimeout(260);
      const expanded = await sample(page);
      assert(expanded.variant === "C" && expanded.state === "expanded", `${viewport.name}: C preview did not expand`, expanded);
      assert(expanded.preview && expanded.surface && expanded.actionLayer && expanded.buttons && expanded.toggle, `${viewport.name}: preview structure incomplete`, expanded);
      assert(Math.abs(expanded.preview.width - expanded.surface.width) <= 1 && Math.abs(expanded.preview.height - expanded.surface.height) <= 1, `${viewport.name}: surface does not fill preview container`, expanded);
      assert(expanded.visibleSurfacePaint, `${viewport.name}: visible surface has no background`, expanded);
      assert(
        expanded.surfaceColorMetrics.alpha >= 0.55
          && expanded.surfaceColorMetrics.alpha <= 0.8
          && expanded.previewThemeQuickMenu
          && expanded.previewThemeQuickMenuMetrics.alpha > 0.99
          && Math.max(
            Math.abs(expanded.surfaceColorMetrics.red - expanded.previewThemeQuickMenuMetrics.red),
            Math.abs(expanded.surfaceColorMetrics.green - expanded.previewThemeQuickMenuMetrics.green),
            Math.abs(expanded.surfaceColorMetrics.blue - expanded.previewThemeQuickMenuMetrics.blue),
          ) <= 2,
        `${viewport.name}: preview surface is not bound to the current client quick-menu theme token`,
        expanded,
      );
      assert(expanded.previewBackgroundImage && !/rgb\(6, 8, 18\)|rgb\(17, 24, 39\)|rgb\(15, 23, 42\)/.test(expanded.previewBackgroundImage), `${viewport.name}: editor preview still uses the black placeholder background`, expanded);
      assert(
        expanded.buttonColorMetrics.alpha >= 0.6
          && expanded.buttonColorMetrics.alpha <= 0.85
          && expanded.previewThemeControl
          && expanded.previewThemeControlMetrics.alpha > 0.99
          && Math.max(
            Math.abs(expanded.buttonColorMetrics.red - expanded.previewThemeControlMetrics.red),
            Math.abs(expanded.buttonColorMetrics.green - expanded.previewThemeControlMetrics.green),
            Math.abs(expanded.buttonColorMetrics.blue - expanded.previewThemeControlMetrics.blue),
          ) <= 2
          && expanded.buttonOpacity >= 0.99
          && expanded.buttonFilter === "none"
          && expanded.buttonBackdropFilter.includes("blur("),
        `${viewport.name}: preview action does not use the current client control theme token`,
        expanded,
      );
      assert(
        expanded.toggleColorMetrics.alpha >= 0.6
          && expanded.toggleColorMetrics.alpha <= 0.85
          && expanded.previewThemeControl
          && expanded.previewThemeControlMetrics.alpha > 0.99
          && Math.max(
            Math.abs(expanded.toggleColorMetrics.red - expanded.previewThemeControlMetrics.red),
            Math.abs(expanded.toggleColorMetrics.green - expanded.previewThemeControlMetrics.green),
            Math.abs(expanded.toggleColorMetrics.blue - expanded.previewThemeControlMetrics.blue),
          ) <= 2
          && expanded.toggleOpacity >= 0.99
          && expanded.toggleFilter === "none"
          && expanded.toggleBackdropFilter.includes("blur("),
        `${viewport.name}: preview X does not share the current client control theme token`,
        expanded,
      );
      assert(!expanded.legacySurfacePaint, `${viewport.name}: legacy pseudo surface is still visible`, expanded);
      assert(expanded.buttonCount === 7, `${viewport.name}: quick button count mismatch`, expanded);
      assert(expanded.buttons.width >= expanded.surface.width - 28, `${viewport.name}: C action layer does not fill the surface container`, expanded);
      const expectedColumnWidth = (expanded.surface.width - 24 - Math.max(0, expanded.columns - 1) * 2) / Math.max(1, expanded.columns);
      assert(expanded.buttonRects.every((item) => item.width >= expectedColumnWidth - 4), `${viewport.name}: C action button does not fill its grid track`, { expanded, expectedColumnWidth });
      assert(expanded.toggleActionOverlap === 0, `${viewport.name}: toggle overlaps an action`, expanded);
      assert(
        expanded.stage
          && expanded.surface.left >= expanded.stage.left - 1
          && expanded.surface.right <= expanded.stage.right + 1
          && expanded.surface.top >= expanded.stage.top - 1
          && expanded.surface.bottom <= expanded.stage.bottom + 1,
        `${viewport.name}: quick-menu surface escaped the authored preview stage`,
        expanded,
      );
      assert(expanded.scrollWidth <= expanded.clientWidth + 1, `${viewport.name}: horizontal overflow`, expanded);
      await controls.locator('button[data-preview-quick-menu-state="collapsed"]').click();
      await page.waitForTimeout(260);
      const collapsed = await sample(page);
      assert(collapsed.state === "collapsed" && collapsed.buttonVisibility === "hidden" && collapsed.buttonPointerEvents === "none", `${viewport.name}: collapsed C actions remain interactive`, collapsed);
      assert(collapsed.surfaceBackground === "rgba(0, 0, 0, 0)" && (collapsed.surfaceBackdropFilter === "none" || collapsed.surfaceBackdropFilter === ""), `${viewport.name}: collapsed C surface still paints a background or blur`, collapsed);
      assert(collapsed.surfaceBoxShadow === "none" || collapsed.surfaceBoxShadow === "", `${viewport.name}: collapsed C surface still paints a shadow`, collapsed);
      results[viewport.name] = { expanded, collapsed };
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
    }
    assert(errors.length === 0, "editor emitted console/page errors", errors);
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({ ok: true, results }, null, 2)}\n`, "utf8");
    fs.rmSync(path.join(outputDir, "error.txt"), { force: true });
    console.log(`quick-menu-preview-visual-regression-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    stop(editor);
    stop(backend);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8");
  console.error(error.stack || error);
  process.exitCode = 1;
});
