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
const outputDir = path.join(root, "output", "hidden-growth", "editor-playwright");
const editorUrl = "http://127.0.0.1:6767/";
const backendUrl = "http://127.0.0.1:8278/api/health";

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
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`server not ready: ${url}`);
}

function startEditor() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "dev", "--", "--host", "127.0.0.1", "--port", "6767"], {
    cwd: editorRoot,
    windowsHide: true,
    shell: process.platform === "win32",
    stdio: "ignore",
  });
  return child;
}

function startBackend() {
  return spawn(process.env.PYTHON || "python", ["backend_launcher.py"], {
    cwd: backendRoot,
    windowsHide: true,
    shell: false,
    stdio: "ignore",
  });
}

function stop(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
  } catch {}
}

async function importFixture(page) {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const input = page.locator(".project-import-button input").first();
  await input.waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some((candidate) => candidate instanceof HTMLInputElement && !candidate.disabled), undefined, { timeout: 30_000 });
  await page.waitForFunction(() => {
    const input = document.querySelector(".project-import-button input");
    const button = document.querySelector(".project-import-button");
    return Boolean(input && !input.disabled && button?.getAttribute("aria-disabled") !== "true");
  }, undefined, { timeout: 30_000 });
  await input.setInputFiles(fixture);
  const openDraft = page.locator('[data-help-key="home.openDraft"]:visible:not(:disabled), [data-help-key="home.recentProject"]:visible:not(:disabled)').first();
  await page.waitForFunction(() => {
    const candidates = [...document.querySelectorAll('[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]')];
    return candidates.some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !(element instanceof HTMLButtonElement && element.disabled);
    });
  }, undefined, { timeout: 60_000 });
  await openDraft.waitFor({ state: "visible", timeout: 45_000 });
  await openDraft.click({ force: true });
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"), undefined, { timeout: 90_000 }).catch(() => {});
}

async function snapshot(page) {
  return page.evaluate(() => {
    const editor = window.__AGENTVN_EDITOR_STORE__?.getState?.();
    const project = window.__AGENTVN_PROJECT_STORE__?.getState?.();
    const stage = document.querySelector(".editor-stage, .visual-novel-editor, .project-editor-layout");
    return {
      title: project?.metadata?.title || project?.project?.title || document.title,
      nodes: editor?.nodes?.length ?? null,
      edges: editor?.edges?.length ?? null,
      assets: project?.assetManifest?.length ?? project?.project?.asset_manifest?.length ?? null,
      toolbar: Boolean(document.querySelector(".editor-toolbar")),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stage: stage ? stage.getBoundingClientRect().toJSON() : null,
      consoleErrors: window.__AGENTVN_QA_CONSOLE_ERRORS__ || [],
    };
  });
}

async function openLayoutDesigner(page) {
  const options = page.locator('[data-workspace-surface="options"]:visible').first();
  await options.waitFor({ state: "visible", timeout: 30_000 });
  await options.click();
  await page.locator(".toolbar-popover:visible").waitFor({ state: "visible", timeout: 30_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
    detail: { id: `hidden_growth_layout_${Date.now()}`, tab: "layout" },
  })));
  await page.waitForFunction(() => (
    document.querySelector('.advanced-tab-content.is-active[data-tab="layout"]')
  ), undefined, { timeout: 30_000 });
  await page.locator(".runtime-layout-designer").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-testid="runtime-quick-menu-preview-controls"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving"), undefined, { timeout: 30_000 });
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const value = element?.getBoundingClientRect();
      return value
        ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height }
        : null;
    };
    const expected = document.querySelector(".runtime-layout-expected-preview.is-player");
    const preview = expected?.querySelector(".preview-quick-menu-preview");
    const buttons = expected?.querySelector(".preview-quick-menu-buttons");
    const toggle = expected?.querySelector(".preview-quick-menu-toggle");
    const buttonStyle = buttons ? getComputedStyle(buttons) : null;
    const previewStyle = preview ? getComputedStyle(preview) : null;
    const designer = rect(".runtime-layout-designer");
    const center = rect(".runtime-layout-center");
    const controls = rect(".runtime-quick-menu-preview-controls");
    const stageWrap = rect(".runtime-layout-stage-wrap");
    const status = rect(".runtime-layout-status");
    return {
      variant: expected?.getAttribute("data-preview-quick-menu-variant"),
      state: expected?.getAttribute("data-preview-quick-menu-state"),
      icon: expected?.getAttribute("data-preview-quick-menu-icon"),
      previewVariant: preview?.getAttribute("data-preview-quick-menu-variant"),
      previewState: preview?.getAttribute("data-preview-quick-menu-state"),
      previewIcon: toggle?.getAttribute("data-preview-quick-menu-icon"),
      center,
      controls,
      stageWrap,
      designer,
      status,
      preview: rect(".preview-quick-menu-preview"),
      buttons: rect(".preview-quick-menu-buttons"),
      buttonsVisibility: buttonStyle?.visibility ?? null,
      buttonsOpacity: Number.parseFloat(buttonStyle?.opacity ?? "0"),
      buttonsInlineStyle: buttons?.getAttribute("style") ?? null,
      buttonsPointerEvents: buttonStyle?.pointerEvents ?? null,
      toggle: (() => {
        const element = expected?.querySelector(".preview-quick-menu-toggle");
        if (!element) return null;
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
      })(),
      toggleHit: (() => {
        const element = expected?.querySelector(".preview-quick-menu-toggle");
        if (!element) return null;
        const value = element.getBoundingClientRect();
        const hit = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
        return hit ? { tag: hit.tagName, className: hit.className, testId: hit.getAttribute("data-testid") } : null;
      })(),
      transitionDuration: Math.max(
        ...(previewStyle?.transitionDuration?.split(",") ?? []).map((value) => Number.parseFloat(value) || 0),
        0,
      ),
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      advancedScrollHeight: document.querySelector('.advanced-tab-content.is-active[data-tab="layout"] .advanced-tab-scroll')?.scrollHeight ?? 0,
      advancedClientHeight: document.querySelector('.advanced-tab-content.is-active[data-tab="layout"] .advanced-tab-scroll')?.clientHeight ?? 0,
    };
  });
}

function assertLayoutDesigner(value, viewport) {
  assert(value.center && value.controls && value.stageWrap && value.designer && value.status, `${viewport}: layout designer geometry missing`, value);
  const controlToStageGap = value.stageWrap.top - value.controls.bottom;
  const centerTopGap = value.stageWrap.top - value.center.top;
  const statusBottomGap = value.designer.bottom - value.status.bottom;
  assert(controlToStageGap >= -1 && controlToStageGap <= 16, `${viewport}: controls are not directly above stage`, { ...value, controlToStageGap });
  assert(centerTopGap <= value.controls.height + 32, `${viewport}: large blank area remains above stage`, { ...value, centerTopGap });
  if (viewport.includes("757x299")) {
    assert(value.status.top >= value.stageWrap.bottom - 1, `${viewport}: status bar overlaps the preview stage`, { ...value, statusBottomGap });
  } else {
    assert(statusBottomGap >= -1 && statusBottomGap <= 8, `${viewport}: status bar is lifted`, { ...value, statusBottomGap });
  }
  assert(value.documentScrollWidth <= value.documentClientWidth + 1, `${viewport}: editor has horizontal overflow`, value);
  if (viewport !== "narrow-mobile") {
    assert(value.advancedScrollHeight <= value.advancedClientHeight + 1, `${viewport}: layout tab has extra bottom scroll buffer`, value);
  }
}

async function assertNarrowLayoutReachability(page, viewport) {
  if (viewport !== "narrow-mobile") return;
  const scroll = page.locator('.advanced-tab-content.is-active[data-tab="layout"] .advanced-tab-scroll');
  const status = page.locator(".runtime-layout-status").first();
  await status.scrollIntoViewIfNeeded();
  const reachable = await page.evaluate(() => {
    const scrollNode = document.querySelector('.advanced-tab-content.is-active[data-tab="layout"] .advanced-tab-scroll');
    const statusNode = document.querySelector(".runtime-layout-status");
    if (!scrollNode || !statusNode) return null;
    const scrollRect = scrollNode.getBoundingClientRect();
    const statusRect = statusNode.getBoundingClientRect();
    return {
      statusTop: statusRect.top,
      statusBottom: statusRect.bottom,
      viewportTop: Math.max(0, scrollRect.top),
      viewportBottom: Math.min(window.innerHeight, scrollRect.bottom),
      remainingScroll: scrollNode.scrollHeight - scrollNode.clientHeight - scrollNode.scrollTop,
    };
  });
  assert(
    reachable
      && reachable.statusTop >= reachable.viewportTop - 1
      && reachable.statusBottom <= reachable.viewportBottom + 1
      && reachable.remainingScroll <= 2,
    `${viewport}: layout status cannot be reached at the end of the real scroll surface`,
    reachable,
  );
  await scroll.locator(".runtime-layout-stage-wrap").scrollIntoViewIfNeeded();
}

async function quickMenuPreviewPosition(page) {
  return page.evaluate(() => {
    const wrapper = document.querySelector(".runtime-layout-expected-preview.is-player .runtime-layout-page-part.part-quick_menu");
    const preview = wrapper?.querySelector(".preview-quick-menu-preview");
    const root = document.querySelector(".runtime-layout-expected-preview.is-player");
    const rect = wrapper?.getBoundingClientRect();
    return {
      authoredX: Number.parseFloat(wrapper?.getAttribute("data-preview-authored-x") ?? "NaN"),
      authoredY: Number.parseFloat(wrapper?.getAttribute("data-preview-authored-y") ?? "NaN"),
      authoredWidth: Number.parseFloat(wrapper?.getAttribute("data-preview-authored-width") ?? "NaN"),
      authoredHeight: Number.parseFloat(wrapper?.getAttribute("data-preview-authored-height") ?? "NaN"),
      authoredAnchor: wrapper?.getAttribute("data-preview-authored-anchor") ?? null,
      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      state: root?.getAttribute("data-preview-quick-menu-state") ?? null,
      variant: root?.getAttribute("data-preview-quick-menu-variant") ?? null,
      previewState: preview?.getAttribute("data-preview-quick-menu-state") ?? null,
      dragOverlayCount: document.querySelectorAll(".preview-quick-menu-drag-hit").length,
    };
  });
}

async function dragLocatorBy(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0, "drag target has no visible bounding box", { box });
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const hit = await locator.evaluate((target, point) => {
    const node = document.elementFromPoint(point.x, point.y);
    const box = (selector) => {
      const element = document.querySelector(selector);
      const value = element?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    return {
      insideTarget: Boolean(node && (node === target || target.contains(node))),
      hitTag: node?.tagName ?? null,
      hitClass: typeof node?.className === "string" ? node.className : "",
      hitTestId: node?.getAttribute("data-testid") ?? null,
      hitComponentType: node?.closest("[data-preview-component-type]")?.getAttribute("data-preview-component-type") ?? null,
      stage: box(".runtime-layout-stage"),
      stageWrap: box(".runtime-layout-stage-wrap"),
      toolbar: box(".runtime-layout-toolbar"),
      controls: box(".runtime-quick-menu-preview-controls"),
      preview: box(".preview-quick-menu-preview"),
    };
  }, start);
  assert(hit.insideTarget, "drag target center is covered or clipped", { box, start, hit });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(180);
}

async function dragLocatorIntoAvailableStageSpace(page, locator, distance = 30) {
  const direction = await page.evaluate(() => {
    const stage = document.querySelector(".runtime-layout-stage");
    const preview = stage?.querySelector(".preview-quick-menu-preview");
    if (!stage || !preview) return null;
    const stageRect = stage.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const gaps = {
      left: previewRect.left - stageRect.left,
      right: stageRect.right - previewRect.right,
      top: previewRect.top - stageRect.top,
      bottom: stageRect.bottom - previewRect.bottom,
    };
    return {
      dx: gaps.right >= gaps.left ? 1 : -1,
      dy: gaps.bottom >= gaps.top ? 1 : -1,
      gaps,
    };
  });
  assert(direction, "quick-menu stage geometry is missing");
  const horizontalRoom = Math.max(direction.gaps.left, direction.gaps.right);
  const verticalRoom = Math.max(direction.gaps.top, direction.gaps.bottom);
  const dx = horizontalRoom >= 8 ? direction.dx * Math.min(distance, Math.max(8, horizontalRoom * 0.5)) : 0;
  const dy = verticalRoom >= 8 ? direction.dy * Math.min(distance, Math.max(8, verticalRoom * 0.5)) : 0;
  assert(Math.abs(dx) >= 6 || Math.abs(dy) >= 6, "quick-menu has no available drag space inside stage", { direction, dx, dy });
  await dragLocatorBy(page, locator, dx, dy);
}

function assertAuthoredPositionChanged(before, after, message, details) {
  assert(
    Number.isFinite(before.authoredX)
      && Number.isFinite(before.authoredY)
      && Number.isFinite(after.authoredX)
      && Number.isFinite(after.authoredY)
      && (
        Math.abs(after.authoredX - before.authoredX) > 0.1
        || Math.abs(after.authoredY - before.authoredY) > 0.1
      ),
    message,
    { before, after, ...details },
  );
}

async function assertPreviewState(page, viewport) {
  const progress = (step) => console.log(`hidden-growth-editor-playwright: ${viewport} ${step}`);
  const controls = page.locator('[data-testid="runtime-quick-menu-preview-controls"]');
  progress("expand C");
  await controls.getByRole("button", { name: "展开" }).evaluate((node) => node.click());
  await page.waitForFunction(() => {
    const node = document.querySelector(".runtime-layout-expected-preview.is-player .preview-quick-menu-buttons");
    return node && getComputedStyle(node).visibility === "visible" && Number(getComputedStyle(node).opacity) > 0.8;
  }, undefined, { timeout: 3000 });
  const expanded = await layoutMetrics(page);
  assert(expanded.variant === "C" && expanded.previewVariant === "C", `${viewport}: C preview did not reach real preview`, expanded);
  assert(expanded.state === "expanded" && expanded.previewState === "expanded", `${viewport}: C preview did not expand`, expanded);
  assert(expanded.icon === "close" && expanded.previewIcon === "close", `${viewport}: C preview close icon missing`, expanded);
  assert(expanded.buttonsVisibility === "visible" && expanded.buttonsOpacity > 0.8, `${viewport}: C preview buttons are not visible`, expanded);
  assert(expanded.buttonsPointerEvents !== "none", `${viewport}: C preview buttons remain disabled`, expanded);
  assert(expanded.transitionDuration > 0, `${viewport}: C preview has no transition`, expanded);
  const previewToggle = page.locator(".runtime-layout-expected-preview.is-player").getByTestId("preview-quick-menu-toggle");
  progress("toggle C collapsed/expanded");
  await previewToggle.click({ force: true });
  await page.waitForTimeout(260);
  const previewToggleState = await layoutMetrics(page);
  assert(previewToggleState.state === "collapsed" && previewToggleState.icon === "expand", `${viewport}: preview toggle did not collapse the real preview`, previewToggleState);
  await previewToggle.click({ force: true });
  await page.waitForTimeout(260);
  const previewToggleExpanded = await layoutMetrics(page);
  assert(previewToggleExpanded.state === "expanded" && previewToggleExpanded.icon === "close", `${viewport}: preview toggle did not expand the real preview`, previewToggleExpanded);
  const overlayState = await page.locator('.runtime-layout-block[data-component-type="quick_button"]').evaluateAll((nodes) => nodes.map((node) => ({
    pointerEvents: getComputedStyle(node).pointerEvents,
    opacity: getComputedStyle(node).opacity,
  })));
  assert(overlayState.every((item) => item.pointerEvents === "none"), `${viewport}: transparent quick-button overlays still intercept preview`, overlayState);
  assert(await page.locator(".preview-quick-menu-button:visible").count() >= 7, `${viewport}: expanded preview has no visible quick buttons`, previewToggleExpanded);

  await controls.getByRole("button", { name: "收缩" }).click();
  await page.waitForTimeout(300);
  const collapsed = await layoutMetrics(page);
  assert(collapsed.state === "collapsed" && collapsed.previewState === "collapsed", `${viewport}: drawer preview did not collapse`, collapsed);
  assert(collapsed.icon === "expand" && collapsed.previewIcon === "expand", `${viewport}: collapsed preview expand icon missing`, collapsed);
  assert(collapsed.buttonsVisibility === "hidden" && collapsed.buttonsOpacity < 0.2, `${viewport}: collapsed preview buttons remain visible`, collapsed);
  assert(collapsed.buttonsPointerEvents === "none", `${viewport}: collapsed preview buttons remain interactive`, collapsed);

  const collapsedPosition = await quickMenuPreviewPosition(page);
  assert(collapsedPosition.dragOverlayCount === 0, `${viewport}: transparent quick-menu drag overlay still exists`, collapsedPosition);

  progress("click collapsed toggle");
  await previewToggle.click({ force: true });
  await page.waitForTimeout(260);
  const clickedExpanded = await quickMenuPreviewPosition(page);
  assert(clickedExpanded.state === "expanded", `${viewport}: clicking collapsed toggle did not expand`, clickedExpanded);
  assert(
    Math.abs(clickedExpanded.authoredX - collapsedPosition.authoredX) <= 0.05
      && Math.abs(clickedExpanded.authoredY - collapsedPosition.authoredY) <= 0.05,
    `${viewport}: clicking toggle moved the authored quick-menu position`,
    { collapsedPosition, clickedExpanded },
  );

  progress("drag collapsed toggle");
  await previewToggle.click({ force: true });
  await page.waitForTimeout(260);
  const beforeCollapsedToggleDrag = await quickMenuPreviewPosition(page);
  await dragLocatorIntoAvailableStageSpace(page, previewToggle, 34);
  const afterCollapsedToggleDrag = await quickMenuPreviewPosition(page);
  assertAuthoredPositionChanged(
    beforeCollapsedToggleDrag,
    afterCollapsedToggleDrag,
    `${viewport}: dragging the collapsed toggle did not change the unified rect`,
    {},
  );
  assert(afterCollapsedToggleDrag.state === "collapsed", `${viewport}: dragging collapsed toggle accidentally expanded it`, afterCollapsedToggleDrag);

  progress("drag C action");
  await previewToggle.click({ force: true });
  await page.waitForTimeout(260);
  const cAction = page.locator(".runtime-layout-expected-preview.is-player .preview-quick-menu-button:visible").first();
  const beforeCActionDrag = await quickMenuPreviewPosition(page);
  await dragLocatorIntoAvailableStageSpace(page, cAction, 30);
  const afterCActionDrag = await quickMenuPreviewPosition(page);
  assertAuthoredPositionChanged(beforeCActionDrag, afterCActionDrag, `${viewport}: dragging a real C action did not move the menu`, {});
  assert(afterCActionDrag.state === "expanded" && afterCActionDrag.variant === "C", `${viewport}: C action drag changed menu state/variant`, afterCActionDrag);

  let persistence;
  if (viewport === "wide-desktop") {
    progress("verify unified layout/tab persistence");
    const unifiedPosition = afterCActionDrag;
    const splitLayoutControls = await page.locator(
      '[data-help-key="layout.desktop"], [data-help-key="layout.mobile"], [data-help-key="layout.copyBreakpoint"]',
    ).count();
    assert(splitLayoutControls === 0, `${viewport}: split layout controls still exist`, { splitLayoutControls });
    await page.locator('[data-preview-quick-menu-state-controls] button[data-preview-quick-menu-state="collapsed"]').click({ force: true });
    await page.waitForTimeout(220);
    const unifiedBefore = await quickMenuPreviewPosition(page);
    const unifiedToggle = page.locator(".runtime-layout-expected-preview.is-player").getByTestId("preview-quick-menu-toggle");
    await dragLocatorIntoAvailableStageSpace(page, unifiedToggle, 24);
    const unifiedAfter = await quickMenuPreviewPosition(page);
    assertAuthoredPositionChanged(unifiedBefore, unifiedAfter, `${viewport}: unified toggle drag did not update rect`, {});
    assert(unifiedAfter.state === "collapsed", `${viewport}: unified toggle drag accidentally expanded`, unifiedAfter);

    const beforeTabRoundTrip = await quickMenuPreviewPosition(page);
    await page.locator('[data-help-key="advanced.tab.theme"]:visible').first().evaluate((node) => node.click());
    await page.waitForFunction(() => (
      document.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") === "theme"
      && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving")
    ), undefined, { timeout: 20_000 });
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').first().evaluate((node) => node.click());
    await page.waitForFunction(() => (
      document.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") === "layout"
      && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving")
      && document.querySelector(".runtime-layout-expected-preview.is-player")
    ), undefined, { timeout: 20_000 });
    const afterTabRoundTrip = await quickMenuPreviewPosition(page);
    assert(
      Math.abs(afterTabRoundTrip.authoredX - beforeTabRoundTrip.authoredX) <= 0.05
        && Math.abs(afterTabRoundTrip.authoredY - beforeTabRoundTrip.authoredY) <= 0.05,
      `${viewport}: quick-menu position was lost after leaving and returning to 游戏客户端`,
      { beforeTabRoundTrip, afterTabRoundTrip },
    );
    persistence = { unifiedPosition, unifiedAfter, beforeTabRoundTrip, afterTabRoundTrip };
  }

  progress("interaction checks complete");
  return { expanded, collapsed, afterCActionDrag, persistence };
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(path.join(outputDir, "error.txt"), { force: true });
  const backend = await ready(backendUrl).then(() => undefined).catch(() => startBackend());
  const server = await ready(editorUrl).then(() => undefined).catch(() => startEditor());
  let browser;
  try {
    await ready(backendUrl);
    await ready(editorUrl);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors = [];
    const cancelledAssets = new Set();
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText === "net::ERR_ABORTED" && ["image", "font"].includes(request.resourceType())) {
        cancelledAssets.add(request.url());
        return;
      }
      errors.push(`requestfailed ${request.resourceType()} ${request.url()}: ${request.failure()?.errorText || "unknown"}`);
    });
    page.on("response", (response) => {
      const request = response.request();
      const resourceType = request.resourceType();
      if (response.status() >= 400 && ["document", "script", "stylesheet", "font"].includes(resourceType)) {
        errors.push(`http ${response.status()} ${resourceType} ${response.url()}`);
      }
      const contentType = response.headers()["content-type"] || "";
      if (resourceType === "script" && contentType && !/(javascript|ecmascript|typescript)/i.test(contentType)) {
        errors.push(`script MIME ${contentType} ${response.url()}`);
      }
      if (resourceType === "stylesheet" && contentType && !/text\/css/i.test(contentType)) {
        errors.push(`stylesheet MIME ${contentType} ${response.url()}`);
      }
    });
    await importFixture(page);
    await openLayoutDesigner(page);
    const results = {};
    const requestedViewports = (process.env.HIDDEN_GROWTH_VIEWPORTS || "").split(",").map((item) => item.trim()).filter(Boolean);
    for (const viewport of [
      { name: "reported-1040x559", width: 1040, height: 559 },
      { name: "reported-2560x1392", width: 2560, height: 1392 },
      { name: "reported-2560x1440", width: 2560, height: 1440 },
      { name: "reported-757x299", width: 757, height: 299 },
      { name: "wide-desktop", width: 1440, height: 900 },
      { name: "narrow-mobile", width: 390, height: 844 },
    ].filter((item) => requestedViewports.length === 0 || requestedViewports.includes(item.name))) {
      console.log(`hidden-growth-editor-playwright: START ${viewport.name} (${viewport.width}x${viewport.height})`);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      console.log(`hidden-growth-editor-playwright: ${viewport.name} viewport resized`);
      await page.waitForTimeout(500);
      console.log(`hidden-growth-editor-playwright: ${viewport.name} resize settled`);
      // The real editor re-ports the advanced popover through a responsive
      // portal when the host viewport changes. Preserve the user path by
      // reopening the requested tab after that re-parenting instead of
      // mistaking a temporarily unmounted designer for a layout failure.
      if (!(await page.locator(".runtime-layout-designer:visible").count())) {
        await openLayoutDesigner(page);
      }
      const value = await snapshot(page);
      console.log(`hidden-growth-editor-playwright: ${viewport.name} editor snapshot captured`);
      assert(value.toolbar, `${viewport.name}: editor toolbar missing`, value);
      assert(value.nodes === 19 && value.edges === 21, `${viewport.name}: project graph mismatch`, value);
      assert(value.overflow <= 1, `${viewport.name}: editor horizontal overflow`, value);
      const layout = await layoutMetrics(page);
      console.log(`hidden-growth-editor-playwright: ${viewport.name} layout metrics captured`);
      assertLayoutDesigner(layout, viewport.name);
      await assertNarrowLayoutReachability(page, viewport.name);
      const preview = await assertPreviewState(page, viewport.name);
      results[viewport.name] = { ...value, layout, preview };
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`), fullPage: false });
      console.log(`hidden-growth-editor-playwright: PASS ${viewport.name}`);
    }
    for (const url of cancelledAssets) {
      const response = await page.request.get(url);
      assert(response.ok(), "cancelled asset cannot be retrieved", { url, status: response.status() });
      await response.dispose();
    }
    assert(errors.length === 0, "editor emitted runtime errors", errors);
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({ ok: true, results, cancelledAssetsVerified: [...cancelledAssets] }, null, 2)}\n`, "utf8");
    console.log(`hidden-growth-editor-playwright: PASS (${outputDir})`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    stop(server);
    stop(backend);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8");
  console.error(error.stack || error);
  process.exitCode = 1;
});
