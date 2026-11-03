#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { saveProjectContainerSync } = require("./project-container.cjs");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
const { verifyDetachedPreviewCancellation } = require("./lib/preview-cancellation-evidence.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const acceptancePaths = resolveAcceptancePaths();
const output = acceptancePaths.output;
let origin, backendUrl;
const deviceScaleFactor = Number(process.env.PROFILE_DPR || 1);
const motionPreference = process.env.PROFILE_REDUCED === "1" ? "reduce" : "no-preference";
const headless = process.env.PROFILE_HEADFUL !== "1";
const report = { runId, deviceScaleFactor, browserMode: headless ? "headless" : "visible-chromium",
  isolation: acceptancePaths, status: "RUNNING", cases: [], saveRequests: [], snapshots: [],
  browserErrors: [], failedResponses: [], failedRequests: [], expectedCanceledRequests: [],
  runtimePreviewDist: process.env.AGENTVN_GAMECLI_PREVIEW_DIST
    ? path.resolve(process.env.AGENTVN_GAMECLI_PREVIEW_DIST)
    : path.join(root, "GameCli_framework", "dist") };
async function reloadAfterRequests(page, { waitForCreationPoll = true } = {}) {
  // Reload is a test action, not an application navigation. Do not turn a
  // pending save or background API response into an artificial abort.
  // The editor intentionally keeps assistant/process and preview polling
  // requests alive, so `networkidle` is not a meaningful readiness signal.
  // Wait for the document and the owned background response instead; this
  // keeps reload deterministic without hiding an application error.
  await page.waitForLoadState("domcontentloaded");
  if (waitForCreationPoll) {
    const background = await page.waitForResponse(response => response.request().method() === "GET"
      && response.url() === `${backendUrl}/api/assistant/creation/processes`
      && response.ok());
    assert.equal(await background.finished(), null, "刷新前进程查询必须完整结束");
  }
  await page.reload();
}
const loaded = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { contents: 'export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin"; export { createRenpyUILayout, switchRuntimeUILayoutType } from "./shared/cartridge/uiLayoutProfiles";',
    resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(loaded, loaded.exports);
const original = loaded.exports.getDefaultUISkinLayout();
if (process.argv.includes("--case=agentvn-page-availability")) {
  const legacyNavigation = original.screens.find(screen => screen.screen_id === "game_menu")
    .components.find(component => component.component_type === "game_menu_nav");
  legacyNavigation.label = "旧工程保留的菜单配置";
  legacyNavigation.style = { ...legacyNavigation.style, backgroundColor: "#2a394c", borderRadius: 7 };
}
const cartridgeIO = require("../editor/node_modules/esbuild").buildSync({
  stdin: { contents: 'export { loadCartridgeFromFile, disposeAssetBlobUrls } from "./shared/cartridge/unpacker";',
    resolveDir: root, loader: "ts" },
  bundle: true, platform: "browser", format: "iife", globalName: "ProfileCartridgeIO",
  nodePaths: [path.join(root, "editor/node_modules")], write: false,
}).outputFiles[0].text;
const inactive = structuredClone(original);
inactive.name = "未激活的布局，不得被保存覆盖";
const legacySaveGrid = inactive.screens.find(screen => screen.screen_id === "save_load").components
  .find(component => component.component_type === "save_slot_grid");
legacySaveGrid.style = { ...legacySaveGrid.style, columns: 2, gap: 30 };
let expectedActivatedRenpy = loaded.exports.switchRuntimeUILayoutType({
  runtimeUILayoutProfiles: { version: 1, activeType: "agentvn",
    profiles: { agentvn: original, renpy: inactive } },
}, "renpy").runtimeUILayout;
const title = `布局配置隔离 ${runId}`;
function fixture() {
  const common = { description: "", memoryMode: "hybrid",
    aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
    previewState: { currentCommandIndex: 0, isPlaying: false },
    editorMeta: { collapsedInspectorSections: [], source: "manual" } };
  const authoredCommands = (process.argv.includes("--case=player-layout-export")
    || process.argv.includes("--case=menu-page-export"))
    ? [
      ...(process.argv.includes("--case=menu-page-export") ? [{
        type: "gallery_anchor", anchor_id: "menu-gallery", title: "菜单导出画廊",
        asset_id: "menu-gallery-art", description: "隔离工程画廊入口",
      }] : []),
      { type: "narration", text: "导出布局验收对白。" },
      ...(process.argv.includes("--dialogue-modes") ? [
        { type: "narration", presentation_mode: "nvl", text: "NVL 模式外观导出验收。" },
        { type: "narration", presentation_mode: "bubble", text: "气泡模式外观导出验收。" },
      ] : []),
      { type: "choice", choices: [
        { choice_id: "continue", choice_display_name: "继续", text: "继续", target_scene_id: "profiles", conditions: [] },
        { choice_id: "pause", choice_display_name: "稍后", text: "稍后", target_scene_id: "profiles", conditions: [] },
      ] },
    ]
    : [{ type: "narration", text: "隔离布局验收。" }];
  return {
    schema_version: "1.0.0", project_id: acceptancePaths.fixtureProjectId, title, author: "QA",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    memory_mode: "hybrid", viewport: { x: 0, y: 0, zoom: 1 },
    asset_manifest: process.argv.includes("--case=menu-page-export") ? [{
      asset_id: "menu-gallery-art", asset_type: "ui", metadata: {
        filename: "菜单画廊.svg", mime_type: "image/svg+xml", source: "imported",
        project_path: "assets/ui/menu-gallery.svg",
        width: 64, height: 64, data_url: `data:image/svg+xml;base64,${Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#324d61"/></svg>',
        ).toString("base64")}`,
      },
    }] : [],
    nodes: [
      { id: "start", type: "startNode", position: { x: 40, y: 200 },
        data: { ...common, nodeKind: "start", label: "入口" } },
      { id: "scene", type: "sceneNode", position: { x: 320, y: 180 },
        data: { ...common, nodeKind: "scene", label: "场景",
          scene: { scene_id: "profiles", title: "场景", summary: "", chapter: 1, tags: [],
            commands: authoredCommands } } },
    ],
    edges: [{ id: "edge", source: "start", target: "scene", sourceHandle: "default" }],
    editor_settings: { runtimeUILayout: original,
      runtimeUILayoutProfiles: { version: 1, activeType: "agentvn",
        profiles: { agentvn: original, renpy: (process.argv.includes("--case=player-layout-export")
          || process.argv.includes("--case=menu-page-export"))
          ? loaded.exports.createRenpyUILayout()
          : inactive } } },
  };
}
async function openLayout(page) {
  await page.locator(".editor-toolbar").waitFor();
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.waitForFunction(() => document.querySelector(".advanced-tab-content.is-active[data-tab='layout']")
    && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving"));
  await page.locator('.runtime-layout-component-list button[data-component-id="speaker_label"]').click();
}
async function componentGeometryInput(page, index = 0) {
  const fieldset = page.locator(".runtime-layout-inspector details.runtime-layout-fieldset")
    .filter({ has: page.locator("summary", { hasText: /^位置与尺寸$/ }) });
  await fieldset.waitFor({ state: "visible" });
  if (!await fieldset.evaluate((element) => element.open))
    await fieldset.locator("summary").click();
  const input = fieldset.locator('input[type="number"]').nth(index);
  await input.waitFor({ state: "visible" });
  return input;
}
async function verifyGeometry(page) {
  const result = await page.evaluate(() => {
    const nodes = [".runtime-layout-sidebar", ".runtime-layout-center", ".runtime-layout-inspector"]
      .map((selector) => {
        const node = document.querySelector(selector), rect = node.getBoundingClientRect();
        return { selector, rect: rect.toJSON(), overflow: node.scrollWidth - node.clientWidth };
      });
    const grid = document.querySelector(".runtime-layout-grid");
    const gridRect = grid?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      grid: gridRect?.toJSON() ?? null,
      nodes,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  const detail = JSON.stringify(result);
  assert(result.overflow <= 1, `页面横向溢出：${detail}`);
  for (const { selector, rect, overflow } of result.nodes) {
    assert(rect.width > 0 && rect.left >= -1 && rect.right <= page.viewportSize().width + 1,
      `${selector}越界或被裁切：${detail}`);
    assert(overflow <= 2, `${selector}内部横向溢出：${detail}`);
  }
  for (let a = 0; a < result.nodes.length; a++) for (let b = a + 1; b < result.nodes.length; b++) {
    const l = result.nodes[a].rect, r = result.nodes[b].rect;
    assert(Math.min(l.right, r.right) - Math.max(l.left, r.left) <= 1
      || Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top) <= 1, `布局面板重叠：${detail}`);
  }
  return result;
}
async function waitForStableLayoutGeometry(page, width, height) {
  const result = await page.evaluate(({ width, height }) => new Promise(resolve => {
    const selectors = [".runtime-layout-grid", ".runtime-layout-sidebar",
      ".runtime-layout-center", ".runtime-layout-inspector"];
    const startedAt = performance.now();
    let previous;
    let stableFrames = 0;
    const sample = () => {
      const nodes = selectors.map(selector => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height,
          node.scrollWidth, node.clientWidth].map(value => Math.round(value * 100) / 100);
      });
      const current = {
        viewport: [innerWidth, innerHeight, devicePixelRatio],
        documentWidth: document.documentElement.scrollWidth,
        nodes,
      };
      if (innerWidth === width && innerHeight === height && nodes.every(Boolean)) {
        if (previous && current.viewport.every((value, index) => value === previous.viewport[index])
          && current.documentWidth === previous.documentWidth
          && nodes.every((node, index) => node.every((value, field) => value === previous.nodes[index][field]))) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        if (stableFrames >= 3) {
          resolve({ stable: true, viewport: current.viewport, nodes: current.nodes });
          return;
        }
      } else {
        stableFrames = 0;
      }
      if (performance.now() - startedAt >= 10000) {
        resolve({ stable: false, viewport: current.viewport, nodes: current.nodes });
        return;
      }
      previous = current;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { width, height });
  assert(result.stable, `布局几何未在目标视口稳定：${JSON.stringify(result)}`);
}

async function waitForStablePlayerGeometry(page, width, height) {
  return page.evaluate(({ width, height }) => new Promise((resolve, reject) => {
    const selectors = [".ui-skin-scope", ".story-player", ".dialog-box",
      ".choice-panel", '[data-testid="renpy-quick-bar"]'];
    const frameWidth = Math.min(width, height * 16 / 9);
    const frameHeight = frameWidth * 9 / 16;
    const startedAt = performance.now();
    let previous;
    let stableFrames = 0;
    const sample = () => {
      const nodes = selectors.map(selector => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          selector, rect: rect.toJSON(), inlineWidth: element.style.width,
          width: style.width, gap: style.gap, scale: element.dataset.uniformScale,
          running: element.getAnimations().some(animation =>
            ["running", "pending"].includes(animation.playState)
            && animation.effect?.getComputedTiming().iterations !== Infinity),
          buttons: selector.includes("renpy-quick-bar")
            ? [...element.querySelectorAll("button")].map(button => button.getBoundingClientRect().toJSON())
            : [],
        };
      });
      const scope = nodes[0]?.rect;
      const player = nodes[1]?.rect;
      const ready = innerWidth === width && innerHeight === height
        && scope && Math.abs(scope.width - width) <= 1 && Math.abs(scope.height - height) <= 1
        && player && Math.abs(player.width - frameWidth) <= 1 && Math.abs(player.height - frameHeight) <= 1
        && nodes.filter(Boolean).every(node => !node.running);
      const current = JSON.stringify(nodes);
      stableFrames = ready && current === previous ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames >= 3) {
        resolve({ elapsedMs: performance.now() - startedAt, stableFrames, nodes });
      } else if (performance.now() - startedAt >= 5000) {
        reject(new Error(`Runtime resize did not settle: ${JSON.stringify({ width, height, nodes })}`));
      } else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { width, height });
}
async function verifyTypeSwitchMotion(page, target, input) {
  await page.waitForFunction(() => {
    const root = document.querySelector(".runtime-layout-type-switch");
    return root && !root.getAnimations().some((animation) => animation.playState === "running")
      && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false";
  });
  await page.evaluate((target) => {
    const root = document.querySelector(".runtime-layout-type-switch");
    const read = () => {
      const style = getComputedStyle(root, "::before");
      const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
      const rect = root.getBoundingClientRect();
      return { at: performance.now(), x: matrix.m41, rect: rect.toJSON(),
        activeType: root.querySelector('[aria-pressed="true"]')?.getAttribute("data-layout-type-option"),
        layoutType: document.querySelector(".runtime-layout-designer")?.getAttribute("data-layout-type"),
        busy: document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy"),
        sectionInert: Boolean(root.closest("[inert]")),
        targetDisabled: Boolean(root.querySelector(`[data-layout-type-option="${target}"]`)?.disabled),
        activeElement: document.activeElement?.tagName,
        focusedType: root.contains(document.activeElement)
          ? document.activeElement.getAttribute("data-layout-type-option") : null,
        running: root.getAnimations().filter((animation) => animation.playState === "running").length };
    };
    const trace = window.__layoutTypeMotion = { target, before: read(), inputAt: null, frames: [], done: false };
    const started = performance.now();
    const onInput = (event) => {
      if (!event.target.closest?.(".runtime-layout-type-switch")
        || (event.type === "keydown" && event.key !== "Enter")) return;
      trace.inputAt ??= performance.now();
    };
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    let steady = 0;
    const sample = () => {
      const frame = read();
      const previous = trace.frames.at(-1);
      if (trace.inputAt !== null) {
        trace.frames.push(frame);
        const finalOwner = frame.activeType === target && frame.layoutType === target
          && frame.busy === "false" && frame.running === 0;
        steady = finalOwner && previous && Math.abs(frame.x - previous.x) < .01
          && Math.abs(frame.x - trace.before.x) > 1 ? steady + 1 : 0;
      }
      if (steady >= 2 || performance.now() - started > 10000) {
        trace.done = true;
        window.removeEventListener("pointerdown", onInput, true);
        window.removeEventListener("keydown", onInput, true);
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, target);
  await input();
  await page.waitForFunction(() => window.__layoutTypeMotion?.done, null, { timeout: 15000 });
  const trace = await page.evaluate(() => window.__layoutTypeMotion);
  report.snapshots.push({ case: "layout-type-motion-captured-before-validation", target, trace });
  const final = trace.frames.at(-1);
  assert(trace.inputAt !== null && final, "必须在真实输入之前启动类型高亮采样");
  assert.equal(final.activeType, target);
  assert.equal(final.layoutType, target);
  assert.equal(final.busy, "false");
  assert.equal(final.running, 0, "状态收口不得留下活动动画");
  const low = Math.min(trace.before.x, final.x), high = Math.max(trace.before.x, final.x);
  const intermediate = trace.frames.filter((frame) => frame.x > low + .5 && frame.x < high - .5);
  assert(intermediate.length >= 2, `类型切换必须保留真实连续中间帧: ${JSON.stringify(trace)}`);
  for (const frame of trace.frames) {
    for (const key of ["x", "y", "width", "height"]) {
      assert(Math.abs(frame.rect[key] - trace.before.rect[key]) <= 1,
        `类型高亮交接不能改变切换栏几何 ${key}: ${JSON.stringify(frame)}`);
    }
  }
  assert.equal(final.focusedType, target, "焦点应属于真实点击或键盘触发的目标按钮");
  return trace;
}
async function waitSaveGrid(page, columns, gap) {
  try {
    await page.waitForFunction(({ columns, gap }) => {
      const grid = document.querySelector('iframe[title="Ren\'Py（进阶）实际页面预览"]')?.contentDocument
        ?.querySelector('[data-testid="save-slot-grid"]');
      if (!grid) return false;
      const style = grid.ownerDocument.defaultView.getComputedStyle(grid);
      return style.gridTemplateColumns.split(" ").length === columns && Math.abs(parseFloat(style.gap) - gap) < .1;
    }, { columns, gap }, { timeout: 10000 });
  } catch (error) {
    const diagnostic = await page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]')
      .getByTestId("save-slot-grid").evaluate(grid => ({
        style: grid.getAttribute("style"), columns: getComputedStyle(grid).gridTemplateColumns,
        gap: getComputedStyle(grid).gap, columnsAttribute: grid.dataset.renpySaveColumns,
        gapAttribute: grid.dataset.renpySaveGap,
      })).catch(() => null);
    report.snapshots.push({ case: "save-grid-response-failure", expected: { columns, gap }, diagnostic });
    throw error;
  }
}
async function assertSaveGridGeometry(page) {
  // A live-preview acknowledgement precedes the Runtime's cover/swap/reveal
  // transaction. Measure actionable geometry only after the real page owner
  // has finished that transaction, rather than treating receipt as idle.
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[title="Ren\'Py（进阶）实际页面预览"]');
    const viewport = frame?.closest(".renpy-editor-runtime-viewport");
    const owner = frame?.contentDocument?.querySelector("[data-runtime-transition-phase]");
    return viewport?.getAttribute("data-preview-phase") === "ready"
      && viewport.getAttribute("data-frame-phase") !== "moving"
      && !frame.closest("[inert]")
      && owner?.getAttribute("data-runtime-transition-phase") === "idle"
      && owner.getAttribute("data-runtime-presented-screen") === "save_load";
  }, null, { timeout: 15000 });
  const runtime = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
  const grid = runtime.getByTestId("save-slot-grid");
  // A same-page desktop/mobile change has no navigation transaction. Its
  // iframe resize and Runtime ResizeObserver commit on separate frames.
  // Await actual stable geometry, never "wait until the boundary assertion
  // becomes true"; a permanently overflowing final grid still fails below.
  const resizeSettled = await grid.evaluate(async node => {
    let previous = "", stable = 0;
    const frames = [];
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const menu = node.closest("[data-renpy-menu-frame]");
      const rect = node.getBoundingClientRect();
      const value = { viewport: { width: innerWidth, height: innerHeight },
        rect: rect.toJSON(), menu: menu?.getBoundingClientRect().toJSON(),
        menuScale: menu?.dataset.renpyMenuScale };
      frames.push(value);
      const key = JSON.stringify(value);
      stable = key === previous ? stable + 1 : 0;
      previous = key;
      if (stable >= 2) return { settled: true, frames };
    }
    return { settled: false, frames };
  });
  assert(resizeSettled.settled, "设备预览尺寸必须根据真实连续帧收敛");
  report.snapshots.push({ case: "save-grid-resize-settled", ...resizeSettled });
  const readLayout = async () => grid.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { rect: rect.toJSON(), overflow: node.scrollWidth - node.clientWidth,
      viewport: { width: innerWidth, height: innerHeight },
      columns: getComputedStyle(node).gridTemplateColumns,
      gap: getComputedStyle(node).gap };
  });
  const layout = await readLayout();
  if (!(layout.overflow <= 1 && layout.rect.left >= -1
    && layout.rect.right <= layout.viewport.width + 1 && layout.rect.top >= -1
    && layout.rect.bottom <= layout.viewport.height + 1)) {
    const resizeTrace = await grid.evaluate(async node => {
      const frames = [];
      for (let index = 0; index < 12; index++) {
        const menu = node.closest("[data-renpy-menu-frame]");
        frames.push({ at: performance.now(), viewport: { width: innerWidth, height: innerHeight },
          rect: node.getBoundingClientRect().toJSON(),
          menu: menu?.getBoundingClientRect().toJSON(), menuScale: menu?.dataset.renpyMenuScale,
          scope: node.closest(".ui-skin-scope")?.getBoundingClientRect().toJSON(),
          phase: document.querySelector("[data-runtime-transition-phase]")?.getAttribute("data-runtime-transition-phase") });
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return frames;
    });
    report.snapshots.push({ case: "save-grid-resize-failure", layout, resizeTrace });
  }
  assert(layout.overflow <= 1 && layout.rect.left >= -1 && layout.rect.right <= layout.viewport.width + 1
    && layout.rect.top >= -1 && layout.rect.bottom <= layout.viewport.height + 1,
  `存档网格越界或横向溢出: ${JSON.stringify(layout)}`);
  const controls = [];
  for (const card of await grid.locator(".save-card-main").all()) {
    await card.scrollIntoViewIfNeeded();
    const result = await card.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const grid = button.closest(".save-grid").getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const text = button.querySelector("strong");
      const textRect = text.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(text);
      const letters = range.getBoundingClientRect();
      const ancestors = [];
      for (let parent = button; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        ancestors.push({ tag: parent.tagName, className: parent.className,
          inert: parent.inert, hidden: parent.getAttribute("aria-hidden"),
          pointerEvents: style.pointerEvents, opacity: style.opacity,
          rect: parent.getBoundingClientRect().toJSON() });
      }
      return { rect: rect.toJSON(), grid: grid.toJSON(),
        hit: hit === button || button.contains(hit),
        hitElement: hit ? { tag: hit.tagName, className: hit.className,
          text: hit.textContent?.slice(0, 100), pointerEvents: getComputedStyle(hit).pointerEvents } : null,
        disabled: button.disabled, viewport: { width: innerWidth, height: innerHeight },
        ancestors, transition: document.querySelector("[data-runtime-transition-phase]")?.getAttribute("data-runtime-transition-phase"),
        clippedText: letters.left < rect.left - 1 || letters.right > rect.right + 1
          || (text.clientWidth > 0 && text.scrollWidth > text.clientWidth + 1),
        textRect: textRect.toJSON(), letters: letters.toJSON(),
        text: text.textContent };
    });
    assert(result.hit && !result.clippedText && result.rect.width > 0 && result.rect.height > 0
      && result.rect.left >= result.grid.left - 1 && result.rect.right <= result.grid.right + 1
      && result.rect.top >= result.grid.top - 1 && result.rect.bottom <= result.grid.bottom + 1,
    `存档卡片裁切或未命中真实按钮: ${JSON.stringify(result)}`);
    controls.push(result);
  }
  assert.equal(controls.length, 6, "每页必须只呈现六个稳定手动槽位");
  await runtime.getByTestId("save-page-next").click();
  await runtime.getByTestId("save-slot-manual-7").waitFor();
  const secondPage = await grid.locator(".save-card-main").evaluateAll(nodes => nodes.map(node =>
    node.closest("[data-testid^='save-slot-']")?.getAttribute("data-testid")));
  assert.deepEqual(secondPage, Array.from({ length: 6 }, (_, index) => `save-slot-manual-${index + 7}`),
    "第二页必须保留旧手动槽位 7–12 的稳定 ID 与顺序");
  for (const card of await grid.locator(".save-card-main").all()) {
    await card.scrollIntoViewIfNeeded();
    const result = await card.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const grid = button.closest(".save-grid").getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { hit: hit === button || button.contains(hit),
        visible: rect.left >= grid.left - 1 && rect.right <= grid.right + 1
          && rect.top >= grid.top - 1 && rect.bottom <= grid.bottom + 1 };
    });
    assert(result.hit && result.visible, "第二页旧槽位必须完整可见并可点击");
  }
  assert.equal(await grid.locator(".save-card-main").count(), 6);
  await runtime.getByTestId("save-page-previous").click();
  await runtime.getByTestId("save-slot-manual-1").waitFor();
  await grid.evaluate(node => { node.scrollTop = 0; });
  return { layout, controls, secondPage };
}

const guiBindingLabels = {
  button_normal: "共享按钮 · 普通状态", button_hover: "共享按钮 · 悬停/聚焦状态",
  button_selected: "共享按钮 · 选中状态", button_disabled: "共享按钮 · 禁用状态",
  title_background: "标题页主视觉", dialog_panel: "对白面板背景",
  choice_button: "分支选项按钮背景", interface_font: "全局界面字体",
};
async function selectGuiBinding(page, assetPath, binding) {
  const label = `${assetPath} 游戏界面用途`;
  const trigger = page.getByRole("combobox", { name: label, exact: true });
  await trigger.click();
  await page.getByRole("listbox", { name: label, exact: true }).getByRole("option", {
    name: guiBindingLabels[binding], exact: true }).click();
  assert.match(await trigger.innerText(), new RegExp(guiBindingLabels[binding]));
}
async function runGuiImportCase(page) {
  const jszip = new (require("../editor/node_modules/jszip"))();
  const bundledFontPath = path.join(root, "GameCli_framework/src-tauri/resources/embedded-cartridge/assets/font/unifont_jp-17_0_05-unifont_jp-17.0.05.woff2");
  const hasValidFontFixture = fs.existsSync(bundledFontPath);
  const fontBytes = hasValidFontFixture ? fs.readFileSync(bundledFontPath) : Buffer.from([0, 1, 0, 0]);
  const fontArchivePath = hasValidFontFixture ? "gui/fonts/interface.woff2" : "gui/fonts/interface.ttf";
  const statePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2sAAAAASUVORK5CYII=",
    "base64");
  jszip.file("gui.rpy", [
    "define gui.interface_text_size = 27",
    "define gui.navigation_xpos = 44",
    "define gui.navigation_spacing = 8",
    "define gui.button_borders = Borders(6, 8, 10, 12)",
    "define gui.button_tile = True",
    'define gui.idle_color = "#bbbbbb"',
    'define gui.hover_color = "#ffffff"',
    "define gui.button_text_idle_color = gui.idle_color",
    "define gui.button_text_hover_color = gui.hover_color",
    'define gui.button_text_selected_color = "#00ccdd"',
    'define gui.button_text_insensitive_color = "#777777"',
  ].join("\n"));
  const statePaths = [
    ["gui/button/idle.png", "button_normal", 1],
    ["gui/button/hover.png", "button_hover", 2],
    ["gui/button/selected.png", "button_selected", 3],
    ["gui/button/insensitive.png", "button_disabled", 4],
  ];
  for (const [assetPath, , marker] of statePaths) {
    jszip.file(assetPath, Buffer.concat([statePng, Buffer.from([marker])]));
  }
  jszip.file("gui/images/background.png", Buffer.concat([statePng, Buffer.from([5])]));
  jszip.file(fontArchivePath, fontBytes);
  jszip.file("screens.rpy", "screen custom_menu():\n    pass");
  const archive = await jszip.generateAsync({ type: "nodebuffer" });
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.waitForFunction(() => document.querySelector(".advanced-tab-content.is-active[data-tab='layout']")
    && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving"));
  await page.locator('.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .runtime-layout-type-switch [data-layout-type-option="renpy"]').click();
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  const interfaceFontSelector = page.getByRole("combobox", { name: "Ren'Py（进阶）全局界面字体", exact: true });
  assert.equal(await interfaceFontSelector.count(), 1,
    "Ren’Py 布局应提供可查看、切换和恢复默认字体的控件");
  await page.getByTestId("renpy-gui-import-open").click();
  const originalAssetCount = await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    return useProjectStore.getState().assetManifest.length;
  });

  async function scanAgain() {
    await page.getByTestId("renpy-gui-import-open").click();
    await page.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
      name: "模板 GUI.zip", mimeType: "application/zip", buffer: archive,
    });
    await page.locator(".renpy-gui-import-summary").waitFor();
  }
  await page.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
    name: "模板 GUI.zip", mimeType: "application/zip", buffer: archive,
  });
  await page.locator(".renpy-gui-import-summary").waitFor();
  const buttonBorderParameter = page.locator(".renpy-gui-import-row")
    .filter({ hasText: "shared.buttonBorders" });
  assert.equal(await buttonBorderParameter.count(), 1,
    "导入预览必须识别 button_borders，并显示四边切片值而不是标记为不支持");
  assert.match(await buttonBorderParameter.locator("small").innerText(),
    /导入：左 6 · 上 8 · 右 10 · 下 12/,
    "边缘切片映射必须按 Ren’Py 的 left/top/right/bottom 顺序清晰呈现");
  const buttonTileParameter = page.locator(".renpy-gui-import-row")
    .filter({ hasText: "shared.buttonTile" });
  assert.equal(await buttonTileParameter.count(), 1,
    "导入预览必须识别 gui.button_tile");
  assert.match(await buttonTileParameter.locator("small").innerText(), /导入：平铺/,
    "gui.button_tile=True 必须显示明确的平铺含义");
  assert.equal(await page.locator('[aria-label="扫描问题"] li').count(), 1,
    "自定义 screens.rpy 必须显示为不导入问题");
  assert.equal(await page.locator('.renpy-gui-import-asset-row').count(), 6,
    "四种按钮状态、背景图片和字体都应出现在用途审阅列表中");
  const imagePurpose = page.getByLabel("gui/images/background.png 游戏界面用途");
  assert.equal(await imagePurpose.count(), 1,
    "图片审阅行应提供实际游戏界面用途绑定，而不只显示路径名推断");
  for (const [assetPath] of statePaths) {
    const purpose = page.getByLabel(`${assetPath} 游戏界面用途`);
    await purpose.click();
    const popup = page.getByRole("listbox", { name: `${assetPath} 游戏界面用途`, exact: true });
    for (const [, binding] of statePaths) {
      assert.equal(await popup.getByRole("option", { name: guiBindingLabels[binding], exact: true }).count(), 1,
        `${assetPath} 应能绑定为 ${binding}`);
    }
    await page.keyboard.press("Escape");
  }
  const fontPurpose = page.getByLabel(`${fontArchivePath} 游戏界面用途`);
  assert.equal(await fontPurpose.count(), 1,
    "字体审阅行应提供全局界面字体绑定，而不只是素材库导入");
  await selectGuiBinding(page, fontArchivePath, "interface_font");
  await selectGuiBinding(page, "gui/images/background.png", "title_background");
  assert.equal(await page.getByRole("button", { name: "确认应用已选项目" }).isDisabled(), true,
    "选择素材时，未确认授权不得应用");

  const geometry = [];
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
    await page.setViewportSize({ width, height });
    const measured = await page.getByTestId("renpy-gui-import-dialog").evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      const footer = dialog.querySelector("footer").getBoundingClientRect();
      const body = dialog.querySelector(".renpy-gui-import-body");
      return {
        rect: rect.toJSON(), footer: footer.toJSON(),
        overflowX: dialog.scrollWidth - dialog.clientWidth,
        pageOverflowX: document.documentElement.scrollWidth - innerWidth,
        bodyScroll: body.scrollHeight - body.clientHeight,
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    assert(measured.rect.left >= -1 && measured.rect.right <= width + 1
      && measured.rect.top >= -1 && measured.rect.bottom <= height + 1,
    `导入预览弹窗越界: ${JSON.stringify(measured)}`);
    assert(measured.overflowX <= 1 && measured.pageOverflowX <= 1,
      `导入预览出现横向溢出: ${JSON.stringify(measured)}`);
    assert(measured.footer.height > 0 && measured.footer.top >= 0 && measured.footer.bottom <= height + 1,
      `导入操作区不可达: ${JSON.stringify(measured)}`);
    geometry.push({ width, height, ...measured });
    await page.screenshot({ path: path.join(output, `gui-import-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "取消，不修改工程" }).click();
  await page.getByTestId("renpy-gui-import-dialog").waitFor({ state: "detached" });
  assert.equal(await page.locator('input[aria-label="共享导航左边距"]').inputValue(), "40",
    "取消预览不能改变布局草稿");
  assert.equal(await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    return useProjectStore.getState().assetManifest.length;
  }), originalAssetCount, "取消预览不能写入素材库");

  await scanAgain();
  await selectGuiBinding(page, "gui/images/background.png", "title_background");
  for (const [assetPath, binding] of statePaths) {
    await selectGuiBinding(page, assetPath, binding);
  }
  await selectGuiBinding(page, fontArchivePath, "interface_font");
  const parameter = page.locator('.renpy-gui-import-row').filter({ hasText: "shared.x" }).locator('input[type="checkbox"]');
  assert(await parameter.isChecked(), "当前未覆盖的参数应默认选择导入");
  await page.locator(".renpy-gui-import-license input").check();
  await page.getByRole("button", { name: "确认应用已选项目" }).click();
  await page.getByTestId("renpy-gui-import-dialog").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector('input[aria-label="共享导航左边距"]')?.value === "44");
  const imported = await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const state = useProjectStore.getState();
    return {
      assets: await Promise.all(state.assetManifest.filter((asset) => asset.metadata.tags?.includes("renpy_gui_import")).map(async (asset) => {
        const source = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
        if (!source) throw new Error(`Imported asset ${asset.asset_id} has no readable source`);
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Imported asset read failed: ${response.status}`);
        const bytes = await response.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          byte => byte.toString(16).padStart(2, "0")).join("");
        return { id: asset.asset_id, type: asset.asset_type, size: bytes.byteLength,
          displayName: asset.metadata.display_name || asset.metadata.filename || asset.asset_id,
          mimeType: asset.metadata.mime_type, hash, source: asset.metadata.tags,
          storage: source.startsWith("data:") ? "embedded" : "persisted" };
      })),
    };
  });
  const importedAssets = imported.assets;
  assert.equal(importedAssets.length, 6, "确认后应一次性将按钮状态图、背景和字体写入当前工程素材库");
  const importedImage = importedAssets.find(asset => asset.source.includes("renpy_gui_path:gui/images/background.png"));
  const importedFont = importedAssets.find(asset => asset.source.includes(`renpy_gui_path:${fontArchivePath}`));
  assert(importedImage && importedFont, "导入资源清单应保留背景图片和字体来源路径");
  assert.equal(importedImage.type, "ui");
  assert.equal(importedImage.mimeType, "image/png");
  const hash = bytes => require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  assert.equal(importedImage.hash, hash(await jszip.file("gui/images/background.png").async("nodebuffer")),
    "Background bytes must survive actual asynchronous asset persistence, not just a transient data_url");
  assert.equal(importedFont.type, "font");
  assert.equal(importedFont.mimeType, hasValidFontFixture ? "font/woff2" : "font/ttf");
  assert.equal(importedFont.hash, hash(fontBytes), "Imported font bytes must be readable after persistence");
  assert((await interfaceFontSelector.innerText()).includes(importedFont.displayName),
    "导入并绑定字体后，布局字体选择器应显示当前字体");
  await interfaceFontSelector.click();
  await page.getByRole("option", { name: "主题默认 / 系统字体回退", exact: true }).click();
  assert.equal(await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    return useProjectStore.getState().settings.runtimeUILayoutProfiles?.profiles.renpy.tokens.fontAssetId ?? "";
  }), "", "恢复默认字体后不得残留旧 asset_id 引用");
  await interfaceFontSelector.click();
  await page.getByRole("option", { name: importedFont.displayName, exact: true }).click();
  if (hasValidFontFixture) {
    await page.waitForFunction((family) => [...document.fonts].some(face =>
      face.family === family && face.status === "loaded"), `AgentVNFont_${importedFont.id}`);
    assert(!(await page.locator(".renpy-preview-status").innerText()).includes("字体无法加载"),
      "有效 GUI 字体应在标题预览中成功加载");
  } else {
    await page.locator(".renpy-preview-status").getByText(/导入字体无法加载/).waitFor();
  }
  const titleFont = await page.getByTestId("renpy-title-view").evaluate(node => getComputedStyle(node).fontFamily);
  assert(titleFont.includes(`AgentVNFont_${importedFont.id}`),
    "标题实际预览应使用所绑定的导入字体 family");
  const titleAction = page.getByTestId("renpy-preview-0");
  const buttonStateImages = {};
  const buttonStateColors = {};
  const settleButton = async () => titleAction.evaluate(async (button) => {
    await Promise.all(button.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  await settleButton();
  const normalButtonFrame = await titleAction.evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      mode: button.getAttribute("data-renpy-button-frame"),
      borderImageSource: style.borderImageSource,
      borderImageSlice: style.borderImageSlice,
      borderImageRepeat: style.borderImageRepeat,
      borderImageWidth: style.borderImageWidth,
      scale: Number(button.closest("[data-renpy-scale]")?.getAttribute("data-renpy-scale")),
      borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      backgroundImage: style.backgroundImage,
    };
  });
  assert.equal(normalButtonFrame.mode, "nine-slice",
    "导入 button_borders 后实际标题按钮必须使用九宫格渲染模式");
  assert.notEqual(normalButtonFrame.borderImageSource, "none",
    "实际标题按钮九宫格边框必须解析到导入的普通状态图");
  assert.equal(normalButtonFrame.borderImageSlice, "8 10 12 6 fill",
    "CSS 九宫格顺序必须将 Ren’Py left/top/right/bottom 转为 top/right/bottom/left");
  assert.equal(normalButtonFrame.borderImageRepeat, "repeat",
    "gui.button_tile=True 必须让按钮边缘与中心按原尺寸平铺");
  assert.equal(normalButtonFrame.backgroundImage, "none",
    "九宫格启用后不得再叠一张被拉伸的完整按钮背景");
  const renderedBorderWidths = normalButtonFrame.borderImageWidth.split(/\s+/).map(parseFloat);
  assert.equal(renderedBorderWidths.length, 4, "九宫格绘制宽度必须显式保持四边方向");
  for (const [index, edge] of [8, 10, 12, 6].entries()) {
    assert(Math.abs(renderedBorderWidths[index] - edge * normalButtonFrame.scale) < .02,
      `九宫格边缘必须跟随实际标题画布比例，不能沿用原图像素：${JSON.stringify(normalButtonFrame)}`);
  }
  buttonStateImages.normal = await titleAction.evaluate((button) => {
    const style = getComputedStyle(button);
    return style.borderImageSource !== "none" ? style.borderImageSource : style.backgroundImage;
  });
  buttonStateColors.normal = await titleAction.evaluate((button) => getComputedStyle(button).color);
  await titleAction.hover();
  await settleButton();
  buttonStateImages.hover = await titleAction.evaluate((button) => {
    const style = getComputedStyle(button);
    return style.borderImageSource !== "none" ? style.borderImageSource : style.backgroundImage;
  });
  buttonStateColors.hover = await titleAction.evaluate((button) => getComputedStyle(button).color);
  await titleAction.evaluate((button) => button.setAttribute("aria-current", "page"));
  await settleButton();
  buttonStateImages.selected = await titleAction.evaluate((button) => {
    const style = getComputedStyle(button);
    return style.borderImageSource !== "none" ? style.borderImageSource : style.backgroundImage;
  });
  buttonStateColors.selected = await titleAction.evaluate((button) => getComputedStyle(button).color);
  await titleAction.evaluate((button) => { button.disabled = true; });
  await settleButton();
  buttonStateImages.disabled = await titleAction.evaluate((button) => {
    const style = getComputedStyle(button);
    return style.borderImageSource !== "none" ? style.borderImageSource : style.backgroundImage;
  });
  buttonStateColors.disabled = await titleAction.evaluate((button) => getComputedStyle(button).color);
  const decodedButtonImages = await page.evaluate(async (backgroundImages) => {
    const urls = Object.fromEntries(Object.entries(backgroundImages).map(([state, value]) => {
      const match = /^url\(["']?(.*?)["']?\)$/.exec(value);
      return [state, match?.[1]];
    }));
    const decoded = await Promise.all(Object.entries(urls).map(async ([state, url]) => {
      if (!url) return { state, url, width: 0, height: 0, error: "no-background-url" };
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
        return { state, url, width: image.naturalWidth, height: image.naturalHeight };
      } catch (error) {
        return { state, url, width: image.naturalWidth, height: image.naturalHeight, error: String(error) };
      }
    }));
    return decoded;
  }, buttonStateImages);
  assert(decodedButtonImages.every((image) => image.width > 0 && image.height > 0 && !image.error),
    `四态按钮背景都必须是浏览器可解码的真实图片资源：${JSON.stringify(decodedButtonImages)}`);
  assert.equal(new Set(decodedButtonImages.map((image) => image.url)).size, 4,
    `normal/hover/selected/disabled 必须分别显示对应资源：${JSON.stringify(buttonStateImages)}`);
  assert.deepEqual(buttonStateColors, {
    normal: "rgb(187, 187, 187)",
    hover: "rgb(255, 255, 255)",
    selected: "rgb(0, 204, 221)",
    disabled: "rgb(119, 119, 119)",
  }, `实际标题按钮必须按交互状态显示导入的文字颜色：${JSON.stringify(buttonStateColors)}`);
  report.snapshots.push({ case: "renpy-gui-button-state-rendering",
    buttonStateImages, decodedButtonImages, buttonStateColors, status: "PASS" });
  const importedPreview = page.getByTestId("renpy-imported-title-background");
  await importedPreview.waitFor();
  const titleBackground = await importedPreview.evaluate(async (element) => {
    const backgroundImage = getComputedStyle(element).backgroundImage;
    const match = /^url\(["']?(.*?)["']?\)$/.exec(backgroundImage);
    if (!match) return { backgroundImage, width: 0, height: 0, error: "no-background-url" };
    const image = new Image();
    image.src = match[1];
    try {
      await image.decode();
      return { backgroundImage, url: match[1], width: image.naturalWidth, height: image.naturalHeight };
    } catch (error) {
      return { backgroundImage, url: match[1], width: image.naturalWidth, height: image.naturalHeight,
        error: String(error) };
    }
  });
  assert(titleBackground.width > 0 && titleBackground.height > 0 && !titleBackground.error,
    `选择标题背景用途后，实际标题预览必须加载并解码导入图片：${JSON.stringify(titleBackground)}`);
  report.snapshots.push({ case: "renpy-gui-title-background-rendering", ...titleBackground, status: "PASS" });
  await page.locator('[data-help-key="layout.save"]').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  const savedButtonFrame = await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    return useProjectStore.getState().settings.runtimeUILayoutProfiles?.profiles.renpy.renpy?.shared;
  });
  assert.deepEqual(savedButtonFrame?.buttonBorders, { left: 6, top: 8, right: 10, bottom: 12 },
    "保存完成后工程布局必须持久化四边切片值");
  assert.equal(savedButtonFrame?.buttonTile, true,
    "保存完成后工程布局必须持久化按钮背景平铺策略");
  const importedButtonStates = await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    return useProjectStore.getState().settings.runtimeUILayoutProfiles?.profiles.renpy
      ?.renpy?.shared?.buttonImages ?? {};
  });
  assert.deepEqual(Object.keys(importedButtonStates).sort(), ["disabled", "hover", "normal", "selected"],
    "保存后的工程活动布局必须包含四种按钮状态图绑定");
  for (const [state, reference] of Object.entries(importedButtonStates)) {
    assert.match(reference, /^asset:/, `${state} 状态必须保存为工程素材引用`);
  }
  const savedBinding = await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    return useProjectStore.getState().settings.runtimeUILayoutProfiles?.profiles.renpy.screens
      ?.find((screen) => screen.screen_id === "title")?.components
      ?.find((component) => component.component_id === "title_hero")?.style?.backgroundImage;
  });
  assert.equal(savedBinding, `asset:${importedImage.id}`,
    "保存完成后，工程活动 Ren’Py 布局必须保留实际素材引用");
  const savedFontBinding = await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    return useProjectStore.getState().settings.runtimeUILayoutProfiles?.profiles.renpy.tokens.fontAssetId;
  });
  assert.equal(savedFontBinding, importedFont.id,
    "保存完成后，Ren’Py 布局令牌必须保留导入字体引用");
  const projectRoundtrip = await page.evaluate(async (assetId) => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { buildProjectBundle, readProjectJsonFromBundle } = await import("/src/utils/projectBundle.ts");
    const selectedIds = new Set([assetId.image, assetId.font, ...Object.values(assetId.states)]);
    const importedAssets = useProjectStore.getState().assetManifest.filter((asset) => selectedIds.has(asset.asset_id));
    const projectSettings = useProjectStore.getState().settings;
    const project = {
      schema_version: "1.0.0",
      project_id: "renpy_gui_browser_roundtrip",
      title: "GUI 导入工程包往返",
      author: "QA",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      memory_mode: "hybrid",
      asset_manifest: importedAssets,
      nodes: [],
      edges: [],
      editor_settings: {
        runtimeUILayout: projectSettings.runtimeUILayout,
        runtimeUILayoutProfiles: projectSettings.runtimeUILayoutProfiles,
      },
    };
    const bundle = await buildProjectBundle(project);
    const reopened = await readProjectJsonFromBundle(new File([bundle], "gui-import.vnproj"));
    const reopenedAssets = reopened.asset_manifest.filter((asset) => selectedIds.has(asset.asset_id));
    const digest = async (source) => {
      if (!source) throw new Error("Asset roundtrip source URL is missing.");
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Asset roundtrip source failed: ${response.status} ${source}`);
      const bytes = await response.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const assetSource = (asset) => asset.metadata.data_url
      ?? asset.metadata.blob_url
      ?? asset.metadata.url;
    return {
      found: reopenedAssets.length === importedAssets.length,
      originalHashes: await Promise.all(importedAssets.map(asset => digest(assetSource(asset)))),
      reopenedHashes: await Promise.all(reopenedAssets.map(asset => digest(assetSource(asset)))),
      projectPaths: reopenedAssets.map(asset => asset.metadata.project_path),
      buttonImages: reopened.editor_settings?.runtimeUILayoutProfiles?.profiles?.renpy
        ?.renpy?.shared?.buttonImages,
    };
  }, {
    image: importedImage.id,
    font: importedFont.id,
    states: Object.fromEntries(Object.entries(importedButtonStates)
      .map(([state, reference]) => [state, reference.slice("asset:".length)])),
  });
  assert(projectRoundtrip.found, ".vnproj 重开后必须保留新导入素材");
  assert.deepEqual(projectRoundtrip.reopenedHashes, projectRoundtrip.originalHashes,
    ".vnproj 包内图片、按钮状态图与字体字节必须与 GUI 导入源一致");
  assert.deepEqual(projectRoundtrip.buttonImages, importedButtonStates,
    ".vnproj 重开后必须保留普通/悬停/选中/禁用状态绑定");
  report.snapshots.push({ case: "renpy-gui-vnproj-byte-roundtrip", ...projectRoundtrip });
  await page.evaluate((archiveBase64) => {
    const calls = [];
    const binary = atob(archiveBase64);
    const archiveBytes = Array.from(binary, (character) => character.charCodeAt(0));
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args = {}) => {
        calls.push(command);
        if (command === "select_renpy_gui_import_directory") return "C:\\mock-cache\\gui-import-test.zip";
        if (command === "get_renpy_gui_import_archive_size") return archiveBytes.length;
        if (command === "read_renpy_gui_import_archive_chunk") {
          return archiveBytes.slice(args.offset, args.offset + args.length);
        }
        if (command === "cleanup_renpy_gui_import_archive") return null;
        throw new Error(`Unexpected mocked native command: ${command}`);
      },
    };
    window.__renpyGuiDirectoryImportCalls = calls;
  }, archive.toString("base64"));
  await page.getByTestId("renpy-gui-import-open").click();
  await page.getByRole("button", { name: "选择资源目录" }).click();
  await page.locator(".renpy-gui-import-summary").waitFor();
  assert(await page.locator(".renpy-gui-import-summary").innerText().then((text) => text.includes("所选 GUI 目录")),
    "目录扫描结果应进入与 ZIP 相同的映射审阅流程");
  const directoryImportCalls = await page.evaluate(() => window.__renpyGuiDirectoryImportCalls);
  assert.deepEqual(directoryImportCalls, [
    "select_renpy_gui_import_directory",
    "get_renpy_gui_import_archive_size",
    "read_renpy_gui_import_archive_chunk",
    "cleanup_renpy_gui_import_archive",
  ], "原生目录暂存包必须在扫描后读取并清理");
  await page.getByRole("button", { name: "取消，不修改工程" }).click();
  report.snapshots.push({ case: "renpy-gui-native-directory-scan", calls: directoryImportCalls, status: "PASS" });
  await page.getByTestId("renpy-gui-import-dialog").waitFor({ state: "detached" });
  assert.equal(await page.locator(".renpy-gui-import-dialog").count(), 0);
  const directoryFailureBaseline = await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const state = useProjectStore.getState();
    return {
      assetCount: state.assetManifest.length,
      activeLayout: structuredClone(state.settings.runtimeUILayoutProfiles?.profiles.renpy),
    };
  });
  await page.evaluate(() => {
    const calls = [];
    window.__TAURI_INTERNALS__.invoke = async (command) => {
      calls.push(command);
      if (command === "select_renpy_gui_import_directory") return "C:\\mock-cache\\gui-import-failure.zip";
      if (command === "get_renpy_gui_import_archive_size") return 8;
      if (command === "read_renpy_gui_import_archive_chunk") {
        throw new Error("CONTROLLED_DIRECTORY_READ_FAILURE");
      }
      if (command === "cleanup_renpy_gui_import_archive") return null;
      throw new Error(`Unexpected mocked native command: ${command}`);
    };
    window.__renpyGuiDirectoryFailureCalls = calls;
  });
  await page.getByTestId("renpy-gui-import-open").click();
  await page.getByRole("button", { name: "选择资源目录" }).click();
  await page.locator(".renpy-gui-import-error").getByText("CONTROLLED_DIRECTORY_READ_FAILURE").waitFor();
  const directoryFailure = await page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const state = useProjectStore.getState();
    return {
      calls: window.__renpyGuiDirectoryFailureCalls,
      assetCount: state.assetManifest.length,
      activeLayout: state.settings.runtimeUILayoutProfiles?.profiles.renpy,
      summaryVisible: Boolean(document.querySelector(".renpy-gui-import-summary")),
    };
  });
  assert.deepEqual(directoryFailure.calls, [
    "select_renpy_gui_import_directory",
    "get_renpy_gui_import_archive_size",
    "read_renpy_gui_import_archive_chunk",
    "cleanup_renpy_gui_import_archive",
  ], "暂存包分块读取失败仍必须在 finally 清理本轮归档");
  assert.equal(directoryFailure.assetCount, directoryFailureBaseline.assetCount,
    "目录暂存包读取失败不得写入任何素材");
  assert.deepEqual(directoryFailure.activeLayout, directoryFailureBaseline.activeLayout,
    "目录暂存包读取失败不得修改 Ren’Py 布局");
  assert.equal(directoryFailure.summaryVisible, false,
    "读取失败后不得保留看似可应用的部分扫描结果");
  await page.getByRole("button", { name: "取消，不修改工程" }).click();
  await page.getByTestId("renpy-gui-import-dialog").waitFor({ state: "detached" });
  report.snapshots.push({ case: "renpy-gui-native-directory-read-failure-cleanup",
    ...directoryFailure, status: "PASS" });
  await page.screenshot({ path: path.join(output, "gui-import-applied-draft.png") });
  report.cases.push({ case: "renpy-gui-import-review-cancel-confirm", geometry,
    imported, originalAssetCount, status: "PASS" });
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const input = path.join(output, "双布局验收.vnproj");
  let env, editor, browser, page, playerServer;
  try {
    // Use a fresh owned service and explicit isolated source fixture. This
    // specialized derived fixture adds both profiles but never edits the input.
    env = await startEditorAcceptance(output);
    saveProjectContainerSync(input, fixture(), { silent: true });
    editor = env.server;
    origin = env.url;
    backendUrl = env.backendUrl;
    report.isolation.derivedFixture = input;
    report.server = { url: editor.url, pid: editor.pid, runId: editor.runId };
    await editor.run(async () => {
    browser = await chromium.launch({ headless });
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor,
      reducedMotion: motionPreference });
    page.setDefaultTimeout(30000);
    report.assetProxyRequests = [];
    await page.route("http://127.0.0.1:8278/api/project/assets/**", async (route) => {
      const requestUrl = new URL(route.request().url());
      const isolatedUrl = `${backendUrl}${requestUrl.pathname}${requestUrl.search}`;
      const response = await route.fetch({ url: isolatedUrl });
      report.assetProxyRequests.push({
        path: requestUrl.pathname,
        isolatedUrl,
        status: response.status(),
        contentType: response.headers()["content-type"] ?? null,
      });
      await route.fulfill({ response });
    });
    const errors = report.browserErrors;
    const diagnosticTasks = [];
    page.on("pageerror", (error) => errors.push({ type: "pageerror", message: String(error), stack: error.stack }));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push({
        type: "console", message: message.text(), location: message.location(),
      });
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const record = {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        method: response.request().method(),
        resourceType: response.request().resourceType(),
      };
      report.failedResponses.push(record);
      diagnosticTasks.push(response.text().then((body) => {
        record.body = body.slice(0, 4000);
      }).catch((error) => {
        record.bodyReadError = String(error);
      }));
    });
    page.on("requestfailed", (request) => {
      const record = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        error: request.failure()?.errorText ?? null,
        at: new Date().toISOString(),
        frameUrl: request.frame().url(),
        frameDetached: request.frame().isDetached(),
        mainFrame: request.frame() === page.mainFrame(),
        pageUrl: page.url(),
      };
      diagnosticTasks.push((async () => {
        try {
          const evidence = await verifyDetachedPreviewCancellation(request, page, new URL(origin).origin);
          if (evidence) report.expectedCanceledRequests.push({ ...record, ...evidence });
          else report.failedRequests.push(record);
        } catch (error) {
          report.failedRequests.push({ ...record, validationError: String(error) });
        }
      })());
    });
    page.on("request", (request) => {
      if (!request.url().endsWith("/api/project/state") || request.method() !== "POST") return;
      const settings = request.postDataJSON()?.project_metadata?.settings;
      if (!settings) return;
      const x = (layout) => layout?.screens?.find((s) => s.screen_id === "player")?.components?.find((c) => c.component_id === "speaker_label")?.rect?.x;
      report.saveRequests.push({ at: Date.now(), active: settings.runtimeUILayoutProfiles?.activeType,
        mirror: x(settings.runtimeUILayout), agentvn: x(settings.runtimeUILayoutProfiles?.profiles?.agentvn),
        renpy: x(settings.runtimeUILayoutProfiles?.profiles?.renpy) });
    });
    await page.goto(origin);
    await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some((node) => !node.disabled));
    await page.locator(".project-import-button input").first().setInputFiles(input);
    if (process.argv.includes("--gui-import") || process.argv.includes("--case=resource-user-flow")) {
      await page.locator(".editor-toolbar").waitFor();
      await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
      await runGuiImportCase(page);
      if (process.argv.includes("--case=resource-user-flow")) {
        await require("./lib/renpy-resource-user-flow.cjs").runResourceUserFlow({
          page, browser, output, report, root, title, deviceScaleFactor,
        });
        await Promise.all(diagnosticTasks);
        assert.deepEqual(report.failedResponses, [], "GUI/组件真实发布链不得产生失败响应");
        assert.deepEqual(report.failedRequests, [], "GUI/组件真实发布链不得产生未归属请求失败");
      }
      assert.deepEqual(errors, [], "GUI 导入流程不得产生前端运行时错误");
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=menu-page-export")) {
      await openLayout(page);
      await require("./lib/renpy-menu-page-export.cjs").runMenuPageExport({
        page, browser, backendUrl, output, report, root, title,
        original, deviceScaleFactor, motionPreference, verifyGeometry,
      });
      await Promise.all(diagnosticTasks);
      assert.deepEqual(errors, [], "菜单页作者、工程往返及发布流程不得产生浏览器错误");
      assert.deepEqual(report.failedResponses, [], "菜单页流程不得产生失败响应");
      assert.deepEqual(report.failedRequests, [], "菜单页流程不得产生未归属的请求失败");
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=agentvn-page-availability")) {
      await openLayout(page);
      const expectedPages = [
        ["title", "标题主页"], ["player", "播放页"], ["save_load", "存档/读档"],
        ["preferences", "选项"], ["history", "历史"], ["gallery", "画廊"], ["about", "关于"],
      ];
      const screens = page.locator(".runtime-layout-screen-list");
      assert.equal(await screens.getByRole("button", { name: "游戏菜单", exact: true }).count(), 0,
        "默认布局不得再提供没有 Runtime 导航消费的游戏菜单示意入口");
      const readSettings = async () => (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
        .data.project_metadata.settings;
      const baseline = structuredClone(await readSettings());
      const legacyMenu = baseline.runtimeUILayout.screens.find(screen => screen.screen_id === "game_menu");
      assert(legacyMenu?.components.some(component => component.component_type === "game_menu_nav"),
        "夹具必须含真实旧导航配置，不能用空数据证明兼容");
      for (const [width, height] of currentAcceptanceViewports()) {
        await page.setViewportSize({ width, height });
        await waitForStableLayoutGeometry(page, width, height);
        assert.deepEqual(await screens.locator("button").allTextContents(), expectedPages.map(([, label]) => label));
        for (const [id, label] of expectedPages) {
          const button = screens.getByRole("button", { name: label, exact: true });
          await button.click();
          await page.waitForFunction(id => document.querySelector(".runtime-layout-designer")
            ?.getAttribute("data-active-screen") === id, id);
          assert.equal(await page.locator('.runtime-layout-component-list [data-component-id="game_menu_nav"]').count(), 0);
          const hit = await button.evaluate(node => {
            const r = node.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
            return { rect: r.toJSON(), hit: node.contains(document.elementFromPoint(x, y)),
              unavailable: Boolean(node.closest("[inert],[hidden],[aria-hidden=true]")),
              selected: node.getAttribute("data-glass-selected") };
          });
          assert(hit.hit && !hit.unavailable && hit.selected === "true", JSON.stringify(hit));
          report.cases.push({ case: "agentvn-rendered-page-entry", id, width, height,
            hit, geometry: await verifyGeometry(page), status: "PASS" });
        }
        const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
        report.snapshots.push(await captureSourceBrowser(page,
          path.join(output, `agentvn-pages-${width}x${height}.png`),
          { width, height, dpr: deviceScaleFactor, reduced: motionPreference === "reduce" }));
      }
      await screens.getByRole("button", { name: "播放页", exact: true }).click();
      await page.locator('.runtime-layout-component-list button[data-component-id="speaker_label"]').click();
      const x = page.locator('.runtime-layout-inspector input[type="number"][data-help-key="layout.rect"]').first();
      await x.fill("11");
      await page.locator('[data-help-key="layout.save"]').click();
      await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
      const saved = await readSettings();
      assert.equal(saved.runtimeUILayout.screens.find(s => s.screen_id === "player").components
        .find(c => c.component_id === "speaker_label").rect.x, 11);
      assert.deepEqual(saved.runtimeUILayout.screens.find(s => s.screen_id === "game_menu"), legacyMenu,
        "收口入口与普通保存不能删除或改写旧菜单数据");
      assert.deepEqual(saved.runtimeUILayoutProfiles.profiles.renpy, baseline.runtimeUILayoutProfiles.profiles.renpy);
      const renpyButton = page.locator('[data-layout-type-option="renpy"]');
      await renpyButton.click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.locator(".renpy-title-editor .runtime-layout-sidebar")
        .getByRole("button", { name: "关于", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
      await page.locator('[data-layout-type-option="agentvn"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="agentvn"][data-active-screen="player"]').waitFor();
      await renpyButton.click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"][data-active-screen="about"]').waitFor();
      await page.locator('[data-layout-type-option="agentvn"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="agentvn"][data-active-screen="player"]').waitFor();
      const switched = await readSettings();
      assert.deepEqual(switched.runtimeUILayoutProfiles.profiles.agentvn, saved.runtimeUILayoutProfiles.profiles.agentvn);
      assert.deepEqual(switched.runtimeUILayoutProfiles.profiles.renpy, expectedActivatedRenpy,
        "旧Ren’Py配置首次激活只允许既有的帮助/按钮/能力版本归一化");
      await reloadAfterRequests(page);
      await page.waitForFunction(() => document.querySelector(".editor-toolbar")
        || document.querySelector(".recent-project-open:not(:disabled)"));
      if (!await page.locator(".editor-toolbar").isVisible())
        await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: title }).first().click();
      await openLayout(page);
      assert.equal(await page.locator('.runtime-layout-inspector input[type="number"][data-help-key="layout.rect"]')
        .first().inputValue(), "11");
      assert.deepEqual((await readSettings()).runtimeUILayoutProfiles, switched.runtimeUILayoutProfiles,
        "重启读取保留双配置与旧菜单原数据");
      assert.equal(await screens.getByRole("button", { name: "游戏菜单", exact: true }).count(), 0);
      report.cases.push({ case: "agentvn-save-switch-reopen-legacy-data-and-independent-views",
        legacyMenu, status: "PASS" });
      await Promise.all(diagnosticTasks);
      assert.deepEqual(errors, []);
      assert.deepEqual(report.failedResponses, []);
      assert.deepEqual(report.failedRequests, []);
      assert.equal(report.cases.length, 22, "三显示各七页面和完整持久化链必须实际执行");
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=confirmation-layout-export")) {
      await openLayout(page);
      await page.getByRole("group", { name: "布局类型", exact: true })
        .locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      assert.equal(await page.getByTestId("renpy-confirmation-layout-entry").count(), 1,
        "确认提示必须有独立作者入口；修改弹窗按钮角色不能代替编辑确认页面");
      await page.getByTestId("renpy-confirmation-layout-entry").click();
      await page.getByTestId("confirmation-layout-editor").waitFor();
      await page.getByRole("spinbutton", { name: "确认区域x", exact: true }).fill("22");
      await page.getByRole("spinbutton", { name: "确认区域y", exact: true }).fill("26");
      await page.getByRole("spinbutton", { name: "确认区域width", exact: true }).fill("56");
      await page.getByRole("spinbutton", { name: "确认区域height", exact: true }).fill("48");
      await page.getByLabel("确认背景色", { exact: true }).fill("#30485d");
      await page.getByLabel("确认边框色", { exact: true }).fill("#bcd4e8");
      await page.getByRole("combobox", { name: "确认提示区域", exact: true }).click();
      await page.getByRole("option", { name: "标题", exact: true }).click();
      await page.getByLabel("确认文字色", { exact: true }).fill("#ffe3a1");
      await page.getByRole("spinbutton", { name: "确认字号", exact: true }).fill("28");
      await page.getByRole("combobox", { name: "确认提示区域", exact: true }).click();
      await page.getByRole("option", { name: "正文", exact: true }).click();
      await page.getByLabel("确认文字色", { exact: true }).fill("#e5edf5");
      await page.getByRole("spinbutton", { name: "确认字号", exact: true }).fill("19");
      await page.locator('button[data-help-key="layout.save"]').click();
      await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
      const savedConfirmation = await page.evaluate(async () => {
        const { useProjectStore } = await import("/src/store/projectStore.ts");
        return structuredClone(useProjectStore.getState().settings.runtimeUILayoutProfiles.profiles.renpy.confirmationLayout);
      });
      assert.deepEqual(savedConfirmation, {
        rect: { x: 22, y: 26, width: 56, height: 48, anchor: "top_left" },
        panelStyle: { backgroundColor: "#30485d", borderColor: "#bcd4e8" },
        titleStyle: { color: "#ffe3a1", fontSize: 28 },
        textStyle: { color: "#e5edf5", fontSize: 19 },
      }, "确认提示作者输入必须保存为独立布局，不得混入页面或普通弹窗角色");
      await page.getByTestId("confirmation-layout-editor").locator(".renpy-editor-runtime-viewport[data-preview-phase='ready']").waitFor({
        timeout: 30000,
      });
      const preview = page.frameLocator(".renpy-editor-runtime-viewport iframe");
      // The real confirmation-preview message opens the shared modal as soon
      // as the Runtime acknowledges the live preview. Older bundles did not
      // handle that message, so the previous test clicked the title action
      // unconditionally and accidentally masked the protocol behavior.
      const confirmation = preview.getByRole("dialog", { name: "退出游戏？" });
      const openedByPreview = await confirmation.waitFor({ state: "visible", timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!openedByPreview) {
        await preview.getByTestId("open-exit-confirmation").click();
      }
      const modal = confirmation;
      await modal.waitFor();
      const previewStyle = await modal.evaluate((element) => {
        const style = getComputedStyle(element);
        const parent = element.parentElement?.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const title = element.querySelector("header strong");
        const content = element.querySelector(".modal-content");
        return {
          source: element.getAttribute("data-confirmation-layout-source"),
          inlineStyle: element.getAttribute("style"),
          background: style.backgroundColor,
          left: style.left, top: style.top, width: style.width, height: style.height,
          relative: parent ? {
            left: (rect.left - parent.left) / parent.width * 100,
            top: (rect.top - parent.top) / parent.height * 100,
            width: rect.width / parent.width * 100,
            height: rect.height / parent.height * 100,
          } : null,
          titleColor: title ? getComputedStyle(title).color : "",
          titleSize: title ? getComputedStyle(title).fontSize : "",
          textColor: content ? getComputedStyle(content).color : "",
          textSize: content ? getComputedStyle(content).fontSize : "",
        };
      });
      report.confirmationPreview = previewStyle;
      assert.equal(previewStyle.source, "override",
        "Runtime Modal 必须确认消费当前布局的确认提示覆盖");
      assert.equal(previewStyle.background, "rgba(48, 72, 93, 0.78)");
      assert(previewStyle.relative, "Runtime Modal 必须报告相对于确认遮罩的几何");
      for (const [field, expected] of [["left", 22], ["top", 26], ["width", 56], ["height", 48]]) {
        assert(Math.abs(previewStyle.relative[field] - expected) < 0.5,
          `Runtime Modal ${field} 未消费作者百分比几何：${JSON.stringify(previewStyle)}`);
      }
      assert.equal(previewStyle.titleColor, "rgb(255, 227, 161)");
      assert.equal(previewStyle.titleSize, "28px");
      assert.equal(previewStyle.textColor, "rgb(229, 237, 245)");
      assert.equal(previewStyle.textSize, "19px");
      await modal.getByRole("button", { name: "关闭退出游戏？", exact: true }).click();
      report.cases.push({ case: "confirmation-author-save-and-real-runtime-preview", savedConfirmation, previewStyle, status: "PASS" });
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=player-layout-export")) {
      await page.locator(".editor-toolbar").waitFor();
      await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
      await openLayout(page);
      const layoutTypeSwitch = page.getByRole("group", { name: "布局类型", exact: true });
      await layoutTypeSwitch.locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.getByTestId("renpy-player-layout-entry").click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"][data-active-screen="player"]').waitFor();
      if (process.argv.includes("--dialogue-modes")) {
        await page.locator('.runtime-layout-component-list button[data-component-id="dialog_text"]').click();
        const sharedAppearance = page.locator(".runtime-layout-inspector details")
          .filter({ has: page.locator("summary", { hasText: "外观" }) });
        if (!await sharedAppearance.evaluate(element => element.open)) await sharedAppearance.locator("summary").click();
        await sharedAppearance.locator("label").filter({ hasText: /^\s*color\s*$/ })
          .locator('input:not([type="color"])').fill("#f0d080");
        const modePicker = page.getByRole("combobox", { name: "对白布局模式", exact: true });
        assert.equal(await modePicker.count(), 1, "剧情布局必须有真实可达的普通/NVL/气泡作者入口");
        const modeMatrix = [];
        for (const mode of [
          { value: "nvl", option: "NVL 累积阅读", label: "NVL", color: "#224466", text: "#eeddaa", width: 84, font: 27 },
          { value: "bubble", option: "气泡对白", label: "气泡", color: "#553366", text: "#aaddbb", width: 43, font: 26 },
        ]) {
          await modePicker.click();
          await page.getByRole("option", { name: mode.option, exact: true }).click();
          await page.getByTestId("dialogue-mode-layout-editor").waitFor();
          await page.getByRole("spinbutton", { name: `${mode.label}区域width`, exact: true }).fill(String(mode.width));
          if (mode.value === "nvl") {
            await page.getByRole("spinbutton", { name: "NVL区域x", exact: true }).fill("8");
            await page.getByRole("spinbutton", { name: "NVL区域y", exact: true }).fill("15");
            await page.getByRole("spinbutton", { name: "NVL区域height", exact: true }).fill("62");
          }
          await page.getByRole("textbox", { name: `${mode.label}背景色`, exact: true }).fill(mode.color);
          await page.getByRole("spinbutton", { name: `${mode.label}不透明度`, exact: true }).fill("1");
          await page.getByRole("button", { name: "正文", exact: true }).click();
          await page.getByRole("spinbutton", { name: `${mode.label}字号`, exact: true }).fill(String(mode.font));
          await page.getByRole("textbox", { name: `${mode.label}文字色`, exact: true }).fill(mode.text);
          await page.getByRole("button", { name: `恢复继承${mode.label}文字色`, exact: true }).click();
          assert.equal(await page.getByRole("textbox", { name: `${mode.label}文字色`, exact: true }).inputValue(), "#f0d080",
            "模式属性恢复继承必须显示普通对白共享外观");
          await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
          const inheritedPanel = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]')
            .locator(`.dialog-box[data-dialogue-layout-mode="${mode.value}"]`);
          await inheritedPanel.waitFor({ state: "visible" });
          await page.waitForFunction(() => document.querySelector(".renpy-editor-runtime-viewport")?.dataset.previewPhase === "ready");
          assert.equal(await inheritedPanel.locator(".nvl-page-text,.dialog-text").first()
            .evaluate(element => getComputedStyle(element).color), "rgb(240, 208, 128)",
          "实际模式预览必须消费恢复继承的共享文字色，不能只有属性面板显示继承");
          await page.getByRole("textbox", { name: `${mode.label}文字色`, exact: true }).fill(mode.text);
          await page.getByRole("button", { name: "姓名", exact: true }).click();
          await page.getByRole("textbox", { name: `${mode.label}文字色`, exact: true }).fill("#99aacc");
          await page.getByRole("spinbutton", { name: `${mode.label}字号`, exact: true }).fill("21");
          await page.getByRole("button", { name: "正文", exact: true }).click();
          for (const reducedMotion of ["no-preference", "reduce"]) {
            await page.emulateMedia({ reducedMotion });
            for (const [width, height] of currentAcceptanceViewports()) {
              await page.setViewportSize({ width, height });
              await waitForStableLayoutGeometry(page, width, height);
              await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
              const frame = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
              const panel = frame.locator(`.dialog-box[data-dialogue-layout-mode="${mode.value}"]`);
              await panel.waitFor({ state: "visible" });
              const previewStyle = await panel.evaluate(element => ({
                background: getComputedStyle(element).backgroundColor,
                source: element.dataset.dialogueLayoutSource,
                rect: element.getBoundingClientRect().toJSON(),
                frame: { width: innerWidth, height: innerHeight },
                text: element.innerText,
                textColor: getComputedStyle(element.querySelector(".nvl-page-text,.dialog-text")).color,
                speakerColor: getComputedStyle(element.querySelector(".nvl-page-speaker,.speaker")).color,
              }));
              assert.equal(previewStyle.background, mode.value === "nvl" ? "rgb(34, 68, 102)" : "rgb(85, 51, 102)");
              assert.equal(previewStyle.source, "override");
              assert.equal(previewStyle.textColor, mode.value === "nvl" ? "rgb(238, 221, 170)" : "rgb(170, 221, 187)");
              assert.equal(previewStyle.speakerColor, "rgb(153, 170, 204)", "姓名区域修改必须有实际Runtime可见结果");
              assert(previewStyle.rect.left >= -1 && previewStyle.rect.right <= previewStyle.frame.width + 1
                && previewStyle.rect.top >= -1 && previewStyle.rect.bottom <= previewStyle.frame.height + 1,
              `${mode.label}实际预览不得越界：${JSON.stringify(previewStyle)}`);
              modeMatrix.push({ mode: mode.value, viewport: { width, height, reducedMotion, dpr: deviceScaleFactor },
                geometry: await verifyGeometry(page), previewStyle });
              if (process.env.PROFILE_MODE_SCREENSHOTS === "1" && width === 1920 && reducedMotion === "no-preference")
                await page.screenshot({ path: path.join(output, `author-${mode.value}-${width}x${height}.png`) });
            }
          }
          if (mode.value === "nvl") {
            await page.getByRole("button", { name: "区域外框", exact: true }).click();
            const handle = page.getByRole("button", { name: "拖动NVL区域", exact: true });
            await handle.focus();
            await page.keyboard.press("Shift+ArrowRight");
            await page.keyboard.press("Shift+ArrowRight");
            assert.equal(await page.getByRole("spinbutton", { name: "NVL区域x", exact: true }).inputValue(), "16",
              "键盘移动必须按整个区域宽度约束边界，不得把NVL外框移出实际画面");
            const position = page.getByRole("spinbutton", { name: "NVL区域x", exact: true });
            await position.fill("8");
            let hit = await handle.boundingBox();
            assert(hit?.width > 0 && hit.height > 0, "实际预览拖动把手必须可见");
            await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
            await page.mouse.down();
            await page.mouse.move(hit.x + hit.width / 2 + 4, hit.y + hit.height / 2);
            await page.mouse.up();
            assert.equal(await position.inputValue(), "8", "未超过6px的指针位移不得改写模式坐标");
            hit = await handle.boundingBox();
            await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
            await page.mouse.down();
            await page.mouse.move(hit.x + hit.width / 2 + 48, hit.y + hit.height / 2, { steps: 5 });
            await page.mouse.up();
            const movedX = Number(await position.inputValue());
            assert(movedX > 8 && movedX <= 16, `拖拽必须提交工程相对坐标并保持外框边界：${movedX}`);
            await position.fill("8");
            hit = await handle.boundingBox();
            await handle.focus();
            await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
            await page.mouse.down();
            await page.mouse.move(hit.x + hit.width / 2 + 48, hit.y + hit.height / 2, { steps: 5 });
            await page.keyboard.press("Escape");
            await page.mouse.up();
            assert.equal(await position.inputValue(), "8", "取消拖拽必须保留原坐标，松开指针不能再次提交");
            report.snapshots.push({ case: "dialogue-mode-drag-threshold-bounds-cancel", movedX, status: "PASS" });
          } else {
            await page.getByRole("button", { name: "恢复继承气泡文字色", exact: true }).click();
            assert.equal(await page.getByRole("button", { name: "恢复继承气泡文字色", exact: true }).count(), 0,
              "逐属性恢复继承必须删除局部覆盖");
            await page.getByRole("textbox", { name: "气泡文字色", exact: true }).fill(mode.text);
            await page.getByRole("button", { name: "姓名", exact: true }).click();
            await page.getByRole("textbox", { name: "气泡文字色", exact: true }).fill("#99aacc");
            await page.getByRole("spinbutton", { name: "气泡字号", exact: true }).fill("21");
            await page.getByRole("button", { name: "正文", exact: true }).click();
            await page.getByRole("button", { name: "恢复当前模式默认", exact: true }).click();
            await page.getByRole("group", { name: "确认恢复气泡布局", exact: true })
              .getByRole("button", { name: "取消", exact: true }).click();
            assert.equal(await page.getByRole("textbox", { name: "气泡文字色", exact: true }).inputValue(), mode.text);
            await page.getByRole("button", { name: "恢复当前模式默认", exact: true }).click();
            await page.getByRole("group", { name: "确认恢复气泡布局", exact: true })
              .getByRole("button", { name: "确认恢复", exact: true }).click();
            assert.match(await page.getByTestId("dialogue-mode-layout-source").innerText(), /继承/);
            await modePicker.click();
            await page.getByRole("option", { name: "NVL 累积阅读", exact: true }).click();
            await page.getByRole("button", { name: "区域外框", exact: true }).click();
            assert.equal(await page.getByRole("textbox", { name: "NVL背景色", exact: true }).inputValue(), "#224466",
              "重置气泡不得污染NVL覆盖");
            assert.equal(await page.getByRole("spinbutton", { name: "NVL区域width", exact: true }).inputValue(), "84");
            await modePicker.click();
            await page.getByRole("option", { name: "气泡对白", exact: true }).click();
            await page.getByRole("spinbutton", { name: "气泡区域width", exact: true }).fill(String(mode.width));
            await page.getByRole("textbox", { name: "气泡背景色", exact: true }).fill(mode.color);
            await page.getByRole("spinbutton", { name: "气泡不透明度", exact: true }).fill("1");
            await page.getByRole("button", { name: "正文", exact: true }).click();
            await page.getByRole("spinbutton", { name: "气泡字号", exact: true }).fill(String(mode.font));
            await page.getByRole("textbox", { name: "气泡文字色", exact: true }).fill(mode.text);
            await page.getByRole("button", { name: "姓名", exact: true }).click();
            await page.getByRole("textbox", { name: "气泡文字色", exact: true }).fill("#99aacc");
            await page.getByRole("spinbutton", { name: "气泡字号", exact: true }).fill("21");
            await page.getByRole("button", { name: "正文", exact: true }).click();
            report.snapshots.push({ case: "dialogue-mode-inheritance-reset-isolation", status: "PASS" });
          }
        }
        report.snapshots.push({ case: "dialogue-mode-author-live-preview", modeMatrix });
        await modePicker.click();
        await page.getByRole("option", { name: "普通对白", exact: true }).click();
      }

      const authoringMatrix = [];
      for (const reducedMotion of ["no-preference", "reduce"]) {
        await page.emulateMedia({ reducedMotion });
        for (const [width, height] of currentAcceptanceViewports()) {
          await page.setViewportSize({ width, height });
          await waitForStableLayoutGeometry(page, width, height);
          authoringMatrix.push({
            viewport: { width, height, dpr: deviceScaleFactor, reducedMotion },
            geometry: await verifyGeometry(page),
          });
        }
      }
      await page.emulateMedia({ reducedMotion: motionPreference });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForFunction(() => window.innerWidth === 1920 && window.innerHeight === 1080);

      const selectComponent = async (componentId) => {
        await page.locator(`.runtime-layout-component-list button[data-component-id="${componentId}"]`).click();
      };
      const editRectField = async (componentId, fieldIndex, value) => {
        await selectComponent(componentId);
        const field = await componentGeometryInput(page, fieldIndex);
        await field.fill(String(value));
        assert.equal(await field.inputValue(), String(value), `${componentId} 的第${fieldIndex + 1}项几何值必须立即显示`);
      };
      const inspectorFieldset = (summary) => page.locator(".runtime-layout-inspector details")
        .filter({ has: page.locator("summary", { hasText: summary }) });
      const openInspectorFieldset = async (summary) => {
        const fieldset = inspectorFieldset(summary);
        if (!await fieldset.evaluate((element) => element.open))
          await fieldset.locator("summary").click();
        return fieldset;
      };
      const editComponentStyle = async (componentId, fieldName, value) => {
        await selectComponent(componentId);
        const appearance = await openInspectorFieldset("外观");
        const field = appearance.locator("label")
          .filter({ hasText: new RegExp(`^\\s*${fieldName}\\s*$`) })
          .locator(["backgroundColor", "color", "borderColor"].includes(fieldName)
            ? 'input:not([type="color"])'
            : 'input[type="number"]');
        await field.fill(value);
        assert.equal(await field.inputValue(), value,
          `${componentId} 的 ${fieldName} 样式必须能从剧情页 Inspector 编辑`);
      };
      const readPlayerComponentStyle = async (componentId) => page.evaluate(async (id) => {
        const { useProjectStore } = await import("/src/store/projectStore.ts");
        const settings = useProjectStore.getState().settings;
        return structuredClone(settings.runtimeUILayoutProfiles.profiles.renpy.screens
          .find((screen) => screen.screen_id === "player").components
          .find((component) => component.component_id === id).style ?? {});
      }, componentId);
      await selectComponent("dialog_panel");
      const styleAppearance = await openInspectorFieldset("外观");
      const styleSource = styleAppearance.getByTestId("runtime-layout-component-style-source");
      assert.equal(await styleSource.textContent(), "继承 Ren'Py 默认样式",
        "未编辑的剧情区域必须明确显示继承的 Ren'Py 默认样式");
      const restoreComponentStyle = styleAppearance.getByRole("button", { name: "恢复内置默认样式", exact: true });
      assert.equal(await restoreComponentStyle.count(), 1,
        "剧情区域必须提供只作用于当前区域的默认样式恢复操作");
      const defaultDialogPanelStyle = await readPlayerComponentStyle("dialog_panel");
      await editRectField("dialog_panel", 0, 12);
      await editRectField("dialog_panel", 2, 76);
      await editComponentStyle("dialog_text", "color", "#f0d080");
      await editComponentStyle("dialog_panel", "backgroundColor", "#284c72");
      assert.equal(await styleSource.textContent(), "自定义覆盖",
        "修改剧情区域外观后必须显示局部覆盖来源");
      await restoreComponentStyle.click();
      assert.equal(await styleSource.textContent(), "继承 Ren'Py 默认样式",
        "恢复区域默认外观后必须回到继承状态");
      await page.getByRole("button", { name: "保存布局", exact: true }).click();
      await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
      assert.deepEqual(await readPlayerComponentStyle("dialog_panel"), defaultDialogPanelStyle,
        "恢复默认外观只应还原当前区域样式，不得改变其结构或其他区域");
      assert.equal(await (await componentGeometryInput(page, 0)).inputValue(), "12",
      "恢复区域外观不得重置已编辑的位置");
      assert.equal(await (await componentGeometryInput(page, 2)).inputValue(), "76",
      "恢复区域外观不得重置已编辑的宽度");
      assert.equal((await readPlayerComponentStyle("dialog_text")).color, "#f0d080",
        "恢复对白框样式不得改动另一文字区域覆盖");
      await editComponentStyle("dialog_panel", "backgroundColor", "#284c72");
      await editComponentStyle("dialog_panel", "borderRadius", "17");
      const styleOriginMatrix = [];
      for (const reducedMotion of ["no-preference", "reduce"]) {
        await page.emulateMedia({ reducedMotion });
        for (const [width, height] of currentAcceptanceViewports()) {
          await page.setViewportSize({ width, height });
          await waitForStableLayoutGeometry(page, width, height);
          await restoreComponentStyle.scrollIntoViewIfNeeded();
          const presentation = await restoreComponentStyle.evaluate((button) => {
            const row = button.closest(".runtime-layout-style-origin");
            const inspector = button.closest(".runtime-layout-inspector");
            const rect = button.getBoundingClientRect(), container = inspector.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return { rect: rect.toJSON(), container: container.toJSON(),
              hit: button === hit || button.contains(hit),
              rowOverflow: row.scrollWidth - row.clientWidth,
              source: row.querySelector("[data-testid]").textContent };
          });
          assert(presentation.hit, "恢复默认样式按钮中心必须真实可命中");
          assert(presentation.rect.left >= presentation.container.left - 1
            && presentation.rect.right <= presentation.container.right + 1
            && presentation.rect.top >= presentation.container.top - 1
            && presentation.rect.bottom <= presentation.container.bottom + 1,
          "样式恢复操作不得超出或裁切在属性栏之外");
          assert(presentation.rowOverflow <= 1, "样式来源行不得横向溢出");
          assert.equal(presentation.source, "自定义覆盖");
          styleOriginMatrix.push({ viewport: { width, height, dpr: deviceScaleFactor, reducedMotion },
            presentation });
          if (process.env.PROFILE_SCREENSHOTS === "1")
            await page.screenshot({ path: path.join(output,
              `player-style-source-${width}x${height}-${reducedMotion}.png`) });
        }
      }
      report.snapshots.push({ case: "player-style-source-and-restore", matrix: styleOriginMatrix });
      await page.emulateMedia({ reducedMotion: motionPreference });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await editComponentStyle("dialog_text", "fontSize", "31");
      await selectComponent("continue_indicator");
      const playerComponentVisibility = page.getByTestId("runtime-layout-component-visible");
      assert.equal(await playerComponentVisibility.count(), 1,
        "可选剧情区域必须提供玩家端可见性结构控件");
      await playerComponentVisibility.uncheck();
      await selectComponent("choice_list");
      assert.equal(await page.getByTestId("runtime-layout-component-visible").count(), 0,
        "必需分支区域不能提供隐藏开关");
      await editRectField("choice_list", 0, 42);

      const roleEditor = page.getByTestId("renpy-button-role-editor");
      await roleEditor.getByRole("combobox", { name: "按钮角色", exact: true }).click();
      await page.getByRole("option", { name: "剧情选项", exact: true }).click();
      await roleEditor.getByRole("combobox", { name: "按钮样式范围", exact: true }).click();
      await page.getByRole("option", { name: "共享样式", exact: true }).click();
      await roleEditor.getByLabel("按钮文字色", { exact: true }).fill("#42c6a1");
      await roleEditor.getByRole("combobox", { name: "按钮样式范围", exact: true }).click();
      await page.getByRole("option", { name: "剧情页面覆盖", exact: true }).click();
      assert.equal(await roleEditor.getByTestId("renpy-title-button-role-source").innerText(), "继承共享",
        "剧情选项页面覆盖首次应继承共享状态样式");
      await roleEditor.getByLabel("按钮文字色", { exact: true }).fill("#dfc95b");
      assert.equal(await roleEditor.getByTestId("renpy-title-button-role-source").innerText(), "覆盖",
        "剧情选项页面局部样式来源必须显示为覆盖");
      await roleEditor.getByRole("combobox", { name: "按钮角色", exact: true }).click();
      await page.getByRole("option", { name: "快捷栏", exact: true }).click();
      await roleEditor.getByLabel("按钮宽度", { exact: true }).fill("74");
      await page.getByRole("button", { name: "保存布局", exact: true }).click();
      await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();

      const readSavedPlayerProfile = async () => page.evaluate(async () => {
        const { useProjectStore } = await import("/src/store/projectStore.ts");
        const settings = useProjectStore.getState().settings;
        return structuredClone(settings.runtimeUILayoutProfiles);
      });
      const savedProfiles = await readSavedPlayerProfile();
      assert.equal(savedProfiles.activeType, "renpy");
      const authored = savedProfiles.profiles.renpy;
      assert.equal(authored.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "dialog_panel").rect.x, 12);
      assert.equal(authored.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "dialog_panel").rect.width, 76);
      assert.equal(authored.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "choice_list").rect.x, 42);
      assert.equal(authored.renpy.player.buttonRoles.quick_bar.geometry.width, 74);
      assert.equal(authored.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "dialog_panel").style.backgroundColor, "#284c72");
      assert.equal(authored.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "dialog_panel").style.borderRadius, 17);
      assert.equal(authored.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "dialog_text").style.color, "#f0d080");
      assert.equal(authored.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "dialog_text").style.fontSize, 31);
      assert.equal(authored.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "continue_indicator").visible, false,
      "保存后的剧情布局必须保留可选区域隐藏状态");
      assert.equal(authored.renpy.shared.buttonRoles.story_choice.states.normal.textColor, "#42c6a1");
      assert.equal(authored.renpy.player.buttonRoles.story_choice.states.normal.textColor, "#dfc95b");
      assert.deepEqual(savedProfiles.profiles.agentvn, original,
        "编辑剧情布局不得修改 AgentVN 配置");
      const persistedProfilesBeforeReload = structuredClone(
        (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
          .data.project_metadata.settings.runtimeUILayoutProfiles,
      );

      await page.locator('[data-workspace-surface="edit"]:visible').click();
      const projectDownloadPromise = page.waitForEvent("download", { timeout: 60000 });
      await page.getByRole("button", { name: "保存工程", exact: true }).click();
      const projectDownload = await projectDownloadPromise;
      assert.match(projectDownload.suggestedFilename(), /\.vnproj$/i,
        "真实保存工程入口必须导出便携工程文件");
      const portableProjectPath = path.join(output, projectDownload.suggestedFilename());
      await projectDownload.saveAs(portableProjectPath);
      assert.equal(await projectDownload.failure(), null, "便携工程必须完整落盘");
      report.artifacts = [{ path: portableProjectPath, bytes: fs.statSync(portableProjectPath).size,
        source: "Editor save project UI download" }];
      await page.getByTestId("project-save-confirmation")
        .getByRole("button", { name: "OK", exact: true }).click();
      await page.getByRole("button", { name: "返回首页", exact: true }).click();
      await page.locator(".project-home").waitFor({ state: "visible" });
      await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
        .some((node) => !node.disabled));
      await page.locator(".project-import-button input").first().setInputFiles(portableProjectPath);
      await page.locator(".editor-toolbar").waitFor();
      await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
      assert.deepEqual(await readSavedPlayerProfile(), savedProfiles,
        "从真实保存按钮导出并重新导入的工程必须完整保留两种布局及剧情区域样式");
      await reloadAfterRequests(page, { waitForCreationPoll: false });
      await page.waitForFunction(() => document.querySelector(".editor-toolbar")
        || document.querySelector(".recent-project-open:not(:disabled)"));
      if (!await page.locator(".editor-toolbar").isVisible())
        await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: title }).first().click();
      await page.locator(".editor-toolbar").waitFor();
      await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.locator('.advanced-tab-content.is-active[data-tab="layout"][aria-hidden="false"]').waitFor();
      await page.getByTestId("renpy-player-layout-entry").click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"][data-active-screen="player"]').waitFor();
      await selectComponent("dialog_panel");
      assert.equal(await (await componentGeometryInput(page, 0)).inputValue(), "12", "重开后对白框几何必须保留");
      assert.equal(await (await componentGeometryInput(page, 2)).inputValue(), "76", "重开后对白框宽度必须保留");
      const reopenedPanelAppearance = await openInspectorFieldset("外观");
      assert.equal(await reopenedPanelAppearance.getByTestId("runtime-layout-component-style-source").textContent(),
        "自定义覆盖", "工程重开后仍应明确显示保存的区域覆盖状态");
      assert.equal(await reopenedPanelAppearance.locator("label")
        .filter({ hasText: "backgroundColor" }).locator('input:not([type="color"])').inputValue(),
      "#284c72", "重开后对白框背景覆盖必须保留");
      assert.equal(await reopenedPanelAppearance.locator("label")
        .filter({ hasText: "borderRadius" }).locator('input[type="number"]').inputValue(),
      "17", "重开后对白框圆角覆盖必须保留");
      await selectComponent("dialog_text");
      const reopenedTextAppearance = await openInspectorFieldset("外观");
      assert.equal(await reopenedTextAppearance.locator("label")
        .filter({ hasText: /^\s*color\s*$/ }).locator('input:not([type="color"])').inputValue(),
      "#f0d080", "重开后对白文字色覆盖必须保留");
      assert.equal(await reopenedTextAppearance.locator("label")
        .filter({ hasText: "fontSize" }).locator('input[type="number"]').inputValue(),
      "31", "重开后对白字号覆盖必须保留");
      await selectComponent("continue_indicator");
      assert.equal(await page.getByTestId("runtime-layout-component-visible").isChecked(), false,
        "重开后可选剧情区域的隐藏状态必须保留");
      await selectComponent("choice_list");
      assert.equal(await (await componentGeometryInput(page, 0)).inputValue(), "42", "重开后分支区域几何必须保留");
      const persistedState = await page.evaluate(async () => {
        const { useProjectStore } = await import("/src/store/projectStore.ts");
        return structuredClone(useProjectStore.getState().settings.runtimeUILayoutProfiles);
      });
      const persistedProfilesAfterReload = structuredClone(
        (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
          .data.project_metadata.settings.runtimeUILayoutProfiles,
      );
      assert.deepEqual(persistedProfilesAfterReload, persistedProfilesBeforeReload,
        "工程重开不得修改已持久化的两套布局配置");
      assert.equal(persistedState.activeType, "renpy");
      assert.equal(persistedState.profiles.renpy.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "dialog_panel").rect.x, 12,
      "重开后的活动运行配置必须保留对白框几何");
      assert.equal(persistedState.profiles.renpy.screens.find(screen => screen.screen_id === "player")
        .components.find(component => component.component_id === "choice_list").rect.x, 42,
      "重开后的活动运行配置必须保留分支区域几何");
      assert.equal(persistedState.profiles.renpy.renpy.player.buttonRoles.quick_bar.geometry.width, 74,
        "重开后的活动运行配置必须保留快捷栏宽度");
      assert.equal(persistedState.profiles.renpy.renpy.shared.buttonRoles.story_choice.states.normal.textColor,
        "#42c6a1", "重开后剧情选项共享样式必须保留");
      assert.equal(persistedState.profiles.renpy.renpy.player.buttonRoles.story_choice.states.normal.textColor,
        "#dfc95b", "重开后剧情选项页面覆盖必须保留");

      await page.locator('[data-workspace-surface="publish"]:visible').click();
      const exportPanel = page.locator(".cartridge-export-panel");
      await exportPanel.waitFor({ state: "visible" });
      await exportPanel.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
      await exportPanel.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
      const warningConfirmation = exportPanel.getByRole("checkbox", { name: /我已检查全部警告/ });
      if (await warningConfirmation.count()) await warningConfirmation.check();
      const exportButton = exportPanel.locator(".package-primary-action");
      await exportButton.waitFor({ state: "visible" });
      assert.equal(await exportButton.isDisabled(), false,
        "隔离工程通过发布前检查后，真实卡带导出入口必须可用");
      const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
      await exportButton.click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /\.vncart$/i,
        "发布界面必须生成可导入的 .vncart 文件");
      const cartridgePath = path.join(output, download.suggestedFilename());
      await download.saveAs(cartridgePath);
      assert.equal(await download.failure(), null, "真实发布界面下载的卡带必须完整落盘");
      report.artifacts.push({ path: cartridgePath, bytes: fs.statSync(cartridgePath).size,
        source: "Editor publish UI download after portable project import" });
      await exportPanel.getByRole("button", { name: "关闭发布与打包", exact: true }).click();

      playerServer = await startOwnedViteServer({
        root: path.join(root, "GameCli_framework"),
        logFile: path.join(output, "gamecli-vite.log"),
      });
      const playerPage = await browser.newPage({ viewport: { width: 1920, height: 1080 },
        deviceScaleFactor, reducedMotion: motionPreference });
      playerPage.setDefaultTimeout(30000);
      await playerPage.goto(`${playerServer.url}?mode=library`);
      await playerPage.getByTestId("game-state-library").waitFor();
      await playerPage.getByTestId("web-cartridge-file").setInputFiles(cartridgePath);
      await playerPage.locator(".cartridge-spine").filter({ hasText: title }).waitFor();
      await playerPage.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
      await playerPage.getByTestId("game-state-title").waitFor();
      await playerPage.locator(".boot-overlay").waitFor({ state: "detached" });
      await playerPage.getByTestId("start-new-game").click();
      const runtimeDialog = playerPage.locator(".dialog-box");
      await runtimeDialog.waitFor({ state: "visible" });
      await playerPage.waitForFunction(() => {
        const player = document.querySelector(".story-player");
        const dialog = document.querySelector(".dialog-box");
        return player?.getAttribute("data-is-typing") === "false"
          && dialog?.innerText.includes("导出布局验收对白");
      });
      assert.equal(await playerPage.locator(".continue-indicator").evaluate(element =>
        getComputedStyle(element).display),
      "none", "玩家 Runtime 必须消费导出卡带中的可选剧情区域隐藏状态");
      const initialRuntimeStyle = await runtimeDialog.evaluate((element) => {
        const dialogText = element.querySelector(".dialog-text");
        const panel = getComputedStyle(element);
        const text = dialogText && getComputedStyle(dialogText);
        return {
          backgroundColor: panel.backgroundColor,
          borderRadius: panel.borderRadius,
          textColor: text?.color,
          fontSize: text?.fontSize,
          textScale: Number(element.dataset.uiTextScale),
        };
      });
      assert.equal(initialRuntimeStyle.backgroundColor, "rgba(40, 76, 114, 0.78)",
        "玩家 Runtime 必须消费导出卡带中的对白框背景样式");
      assert.equal(initialRuntimeStyle.borderRadius, "17px",
        "玩家 Runtime 必须消费导出卡带中的对白框圆角样式");
      assert.equal(initialRuntimeStyle.textColor, "rgb(240, 208, 128)",
        "玩家 Runtime 必须消费导出卡带中的对白文字色");
      assert(Math.abs(parseFloat(initialRuntimeStyle.fontSize) - 31 * initialRuntimeStyle.textScale) < 0.02,
        `玩家 Runtime 必须消费作者字号并应用当前视口缩放：${JSON.stringify(initialRuntimeStyle)}`);
      const runtimeMatrix = [];
      for (const reducedMotion of ["no-preference", "reduce"]) {
        await playerPage.emulateMedia({ reducedMotion });
        for (const [width, height] of currentAcceptanceViewports()) {
          await playerPage.setViewportSize({ width, height });
          report.snapshots.push({ case: "runtime-dialog-resize-settled",
            viewport: { width, height, dpr: deviceScaleFactor, reducedMotion },
            settlement: await waitForStablePlayerGeometry(playerPage, width, height) });
          await playerPage.waitForFunction(({ width, height }) => {
            if (window.innerWidth !== width || window.innerHeight !== height) return false;
            const scope = document.querySelector(".ui-skin-scope");
            const dialog = document.querySelector(".dialog-box");
            if (!scope || !dialog) return false;
            const scopeRect = scope.getBoundingClientRect();
            const dialogRect = dialog.getBoundingClientRect();
            return Math.abs(scopeRect.width - width) <= 1
              && dialogRect.left >= scopeRect.left - 1
              && dialogRect.right <= scopeRect.right + 1;
          },
          { width, height });
          const dialogPresentation = await runtimeDialog.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return {
              left: element.style.left,
              width: element.style.width,
              layoutType: element.getAttribute("data-runtime-layout-type"),
              text: element.innerText,
              rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
              documentWidth: document.documentElement.scrollWidth,
            };
          });
          report.snapshots.push({ case: "runtime-dialog-viewport", viewport: { width, height, dpr: deviceScaleFactor, reducedMotion },
            dialogPresentation });
          assert.equal(dialogPresentation.layoutType, "renpy", "GameCLI 必须识别导出的活动 Ren'Py 布局");
          assert.equal(dialogPresentation.left, "12%", "玩家对白框必须消费导出的对白框 X 坐标");
          assert.equal(dialogPresentation.width, "76%", "玩家对白框必须消费导出的对白框宽度");
          assert.match(dialogPresentation.text, /导出布局验收对白/);
          assert(dialogPresentation.rect.left >= -1 && dialogPresentation.rect.right <= width + 1,
            "玩家对白框在目标视口内不得越界");
          assert(dialogPresentation.documentWidth <= width + 1, "玩家 Runtime 不得产生横向溢出");
          runtimeMatrix.push({ viewport: { width, height, dpr: deviceScaleFactor, reducedMotion },
            dialogPresentation });
        }
      }
      await playerPage.emulateMedia({ reducedMotion: motionPreference });
      await playerPage.setViewportSize({ width: 1920, height: 1080 });
      await playerPage.waitForFunction(() => window.innerWidth === 1920 && window.innerHeight === 1080);

      if (process.argv.includes("--dialogue-modes")) {
        const modeRuntimeMatrix = [];
        for (const mode of ["nvl", "bubble"]) {
          await runtimeDialog.click();
          await playerPage.locator(`.dialog-box[data-dialogue-layout-mode="${mode}"]`).waitFor({ state: "visible" });
          await playerPage.waitForFunction(() => document.querySelector(".story-player")?.dataset.isTyping === "false");
          for (const reducedMotion of ["no-preference", "reduce"]) {
            await playerPage.emulateMedia({ reducedMotion });
            for (const [width, height] of currentAcceptanceViewports()) {
              await playerPage.setViewportSize({ width, height });
              await waitForStablePlayerGeometry(playerPage, width, height);
              const appearance = await runtimeDialog.evaluate(element => ({
                background: getComputedStyle(element).backgroundColor,
                rect: element.getBoundingClientRect().toJSON(),
                mode: element.dataset.dialogueLayoutMode,
                textColor: getComputedStyle(element.querySelector(".nvl-page-text,.dialog-text")).color,
              }));
              assert.equal(appearance.mode, mode);
              assert.equal(appearance.background, mode === "nvl" ? "rgb(34, 68, 102)" : "rgb(85, 51, 102)");
              assert.equal(appearance.textColor, mode === "nvl" ? "rgb(238, 221, 170)" : "rgb(170, 221, 187)");
              assert(appearance.rect.left >= -1 && appearance.rect.right <= width + 1
                && appearance.rect.top >= -1 && appearance.rect.bottom <= height + 1);
              if (mode === "nvl") {
                assert(Math.abs(appearance.rect.left - width * .08) < 2);
                assert(Math.abs(appearance.rect.width - width * .84) < 2);
              }
              if (process.env.PROFILE_MODE_SCREENSHOTS === "1" && width === 1920 && reducedMotion === "no-preference")
                await playerPage.screenshot({ path: path.join(output, `player-${mode}-${width}x${height}.png`) });
              modeRuntimeMatrix.push({ mode, viewport: { width, height, reducedMotion, dpr: deviceScaleFactor }, appearance });
            }
          }
        }
        report.snapshots.push({ case: "dialogue-mode-exported-player", modeRuntimeMatrix });
      }
      await runtimeDialog.click();
      const runtimeChoices = playerPage.locator(".choice-panel");
      await runtimeChoices.waitFor({ state: "visible" });
      const authoredChoice = runtimeChoices.getByRole("button", { name: /选择：继续/ }).first();
      await authoredChoice.waitFor({ state: "visible" });
      await playerPage.waitForFunction(() => Array.from(document.querySelectorAll(".choice-option"))
        .some((button) => button.getAttribute("data-renpy-role-state") === "normal"),
      undefined, { timeout: 10000 });
      assert.equal(await authoredChoice.evaluate((button) =>
        getComputedStyle(button).getPropertyValue("--renpy-role-normal-text").trim()),
      "#dfc95b", "玩家 Runtime 必须优先消费导出的剧情页面样式覆盖");
      assert.equal(await authoredChoice.evaluate((button) => getComputedStyle(button).color),
        "rgb(223, 201, 91)", "剧情选项页面样式必须实际渲染到玩家按钮");
      const quickBar = playerPage.getByTestId("renpy-quick-bar");
      await quickBar.waitFor({ state: "visible" });
      const runtimeQuickBarMatrix = [];
      for (const reducedMotion of ["no-preference", "reduce"]) {
        await playerPage.emulateMedia({ reducedMotion });
        for (const [width, height] of currentAcceptanceViewports()) {
          await playerPage.setViewportSize({ width, height });
          report.snapshots.push({ case: "runtime-choice-resize-settled",
            viewport: { width, height, dpr: deviceScaleFactor, reducedMotion },
            settlement: await waitForStablePlayerGeometry(playerPage, width, height) });
          await playerPage.waitForFunction(({ width, height }) => {
            if (window.innerWidth !== width || window.innerHeight !== height) return false;
            const scope = document.querySelector(".ui-skin-scope");
            const choices = document.querySelector(".choice-panel");
            if (!scope || !choices) return false;
            const scopeRect = scope.getBoundingClientRect();
            const choiceRect = choices.getBoundingClientRect();
            return Math.abs(scopeRect.width - width) <= 1
              && choiceRect.left >= scopeRect.left - 1
              && choiceRect.right <= scopeRect.right + 1;
          },
          { width, height });
          const choicePresentation = await runtimeChoices.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return {
              left: element.style.left,
              labels: [...element.querySelectorAll(".choice-option")].map(button => button.innerText.trim()),
              rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
              documentWidth: document.documentElement.scrollWidth,
            };
          });
          report.snapshots.push({ case: "runtime-choice-viewport",
            viewport: { width, height, dpr: deviceScaleFactor, reducedMotion }, choicePresentation });
          assert.equal(choicePresentation.left, "42%", "玩家分支区域必须消费导出的分支布局 X 坐标");
          assert.deepEqual(choicePresentation.labels, ["继续", "稍后"]);
          assert(choicePresentation.rect.left >= -1 && choicePresentation.rect.right <= width + 1,
            "玩家分支区域在目标视口内不得越界");
          assert(choicePresentation.documentWidth <= width + 1, "分支页面不得产生横向溢出");

          const quickBarPresentation = await quickBar.evaluate(element => {
            const computed = getComputedStyle(element);
            return {
              scale: Number(element.getAttribute("data-uniform-scale")),
              width: element.getBoundingClientRect().width,
              buttonWidths: [...element.querySelectorAll("button")]
                .map(button => button.getBoundingClientRect().width),
              inlineWidth: element.style.width,
              computedWidth: computed.width,
              maxWidth: computed.maxWidth,
              gap: computed.gap,
              transform: computed.transform,
              parentRect: element.parentElement.getBoundingClientRect().toJSON(),
              snapshot: Boolean(element.closest("[data-runtime-transition-snapshot]")),
              animations: element.getAnimations().map(animation => ({
                playState: animation.playState, timing: animation.effect?.getComputedTiming(),
              })),
            };
          });
          report.snapshots.push({ case: "runtime-quickbar-geometry",
            viewport: { width, height, dpr: deviceScaleFactor, reducedMotion }, quickBarPresentation });
          assert.equal(quickBarPresentation.buttonWidths.length, 9, "导出玩家应保留完整九项快捷栏");
          assert(quickBarPresentation.scale > 0, "快捷栏应公开有效的统一尺寸比例");
          for (const buttonWidth of quickBarPresentation.buttonWidths) {
            assert(Math.abs(buttonWidth - 74 * quickBarPresentation.scale) < 1,
              "每个快捷栏按钮必须消费导出的74px基础宽度并统一缩放");
          }
          assert(Math.abs(quickBarPresentation.width
            - (9 * 74 + 8 * 6) * quickBarPresentation.scale) < 2,
          `快捷栏总宽度必须与九项按钮及八个间距的缩放结果一致：${JSON.stringify(quickBarPresentation)}`);
          runtimeQuickBarMatrix.push({ viewport: { width, height, dpr: deviceScaleFactor, reducedMotion },
            choicePresentation, quickBarPresentation });
          if (process.env.PROFILE_SCREENSHOTS === "1")
            await playerPage.screenshot({ path: path.join(output,
              `player-exported-choice-${width}x${height}-${reducedMotion}.png`) });
        }
      }
      report.cases.push({ case: "renpy-player-layout-save-export-import-runtime",
        authored: { dialogX: 12, choiceX: 42, quickBarButtonWidth: 74 },
        authoringMatrix, runtimeMatrix, runtimeQuickBarMatrix,
        viewportSet: currentAcceptanceViewports(),
        dpr: deviceScaleFactor,
        status: "PASS" });
      assert.deepEqual(errors, [], "布局导出与玩家消费流程不得产生 Editor 前端错误");
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=home-short")) {
      await page.locator(".editor-toolbar").waitFor();
      await reloadAfterRequests(page);
      await page.locator(".project-home").waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-home-hydrating"));
      const sizes = currentAcceptanceViewports();
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        await page.mouse.move(0, 0);
        const open = page.locator(".recent-project-open:visible:not(:disabled)").filter({ hasText: title }).first();
        await open.waitFor({ state: "visible" });
        await page.locator(".project-home").evaluate(async (home) => {
          await Promise.all(home.getAnimations({ subtree: true })
            .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {})));
        });
        const before = await page.locator(".project-home").evaluate((home) => {
          const style = getComputedStyle(home);
          const panels = [...home.querySelectorAll(".project-command-panel,.recent-projects-panel")];
          const bounds = panels.map(panel => ({ className: panel.className,
            rect: panel.getBoundingClientRect().toJSON(), overflowX: panel.scrollWidth - panel.clientWidth }));
          return {
            rect: home.getBoundingClientRect().toJSON(),
            clientHeight: home.clientHeight,
            scrollHeight: home.scrollHeight,
            scrollTop: home.scrollTop,
            overflowY: style.overflowY,
            overflowX: home.scrollWidth - home.clientWidth,
            pageOverflowX: document.documentElement.scrollWidth - innerWidth,
            panels: bounds,
          };
        });
        report.snapshots.push({ case: "home-before-scroll", width, height, before });
        assert(before.overflowX <= 1 && before.pageOverflowX <= 1, "首页不得横向溢出");
        for (const panel of before.panels) {
          assert(panel.rect.width > 0 && panel.rect.left >= 0 && panel.rect.right <= width + 1
          , `首页面板横向越界：${JSON.stringify(panel)}`);
        }
        const [left, right] = before.panels.map(panel => panel.rect);
        assert(Math.min(left.right, right.right) - Math.max(left.left, right.left) <= 1
          || Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) <= 1,
        "首页操作区与最近工程面板不得重叠");
        let wheelScroll;
        if (before.scrollHeight > before.clientHeight + 1) {
          // Aim at page padding, not the independently scrollable recent list.
          await page.mouse.move(8, Math.max(2, height - 24));
          await page.mouse.wheel(0, Math.max(300, height));
          await page.waitForFunction(previous => document.querySelector(".project-home")?.scrollTop > previous,
            before.scrollTop, { timeout: 1500 });
          wheelScroll = await page.locator(".project-home").evaluate(home => home.scrollTop);
        }
        const controlGeometry = [];
        const actionCount = await page.locator(".project-action-stack .home-action").count();
        assert(actionCount >= 4, "有草稿的首页不能丢失继续/新建/导入/QQ群操作");
        for (const action of await page.locator(".project-action-stack .home-action").all()) {
          await action.scrollIntoViewIfNeeded();
          const geometry = await action.evaluate(button => {
            const rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            const clips = [];
            for (let parent = button.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              if (["hidden", "clip", "auto", "scroll"].includes(style.overflowX)
                || ["hidden", "clip", "auto", "scroll"].includes(style.overflowY))
                clips.push({ className: parent.className, rect: parent.getBoundingClientRect().toJSON() });
            }
            return { text: button.textContent?.trim(), rect: rect.toJSON(),
              clips, hit: hit === button || button.contains(hit) };
          });
          assert(geometry.rect.left >= 0 && geometry.rect.right <= width + 1
            && geometry.rect.top >= -1 && geometry.rect.bottom <= height + 1 && geometry.hit,
          `首页操作不可到达或被遮挡：${JSON.stringify(geometry)}`);
          for (const clip of geometry.clips) {
            assert(geometry.rect.left >= clip.rect.left - 1 && geometry.rect.right <= clip.rect.right + 1
              && geometry.rect.top >= clip.rect.top - 1 && geometry.rect.bottom <= clip.rect.bottom + 1,
            `首页按钮被祖先容器裁切：${JSON.stringify({ button: geometry, clip })}`);
          }
          controlGeometry.push(geometry);
        }
        await page.locator('[data-help-key="home.qqGroup"]').click();
        await page.locator('[role="dialog"]').waitFor();
        await page.keyboard.press("Escape");
        await page.locator('[role="dialog"]').waitFor({ state: "hidden" });
        await open.scrollIntoViewIfNeeded();
        const target = await open.evaluate((button) => {
          const rect = button.getBoundingClientRect();
          const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
          const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
          const hit = document.elementFromPoint(x, y);
          return {
            rect: rect.toJSON(),
            hit: hit?.className?.baseVal ?? hit?.className ?? hit?.tagName,
            target: button.className,
            inViewport: rect.left >= 0 && rect.right <= innerWidth
              && rect.top >= 0 && rect.bottom <= innerHeight,
          };
        });
        assert(target.inViewport, `最近工程按钮必须可滚动到真实视口内: ${JSON.stringify(target)}`);
        assert(await open.evaluate((button) => {
          const rect = button.getBoundingClientRect();
          return [[.5, .5], [.1, .1], [.9, .1], [.1, .9], [.9, .9]].every(([x, y]) => {
            const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
            return hit === button || button.contains(hit);
          });
        }), `最近工程按钮中心必须实际命中按钮: ${JSON.stringify(target)}`);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: path.join(output, `home-${width}x${height}.png`) });
        await open.click({ timeout: 3000 });
        await page.locator(".editor-toolbar").waitFor({ timeout: 30000 });
        await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
        report.cases.push({ case: "short-height-home-recent-project-is-scrollable-and-clickable",
          width, height, before, wheelScroll, controlGeometry, target, status: "PASS" });
        await page.goto(origin);
        await page.locator(".project-home").waitFor({ state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-home-hydrating"));
      }
      assert.equal(report.cases.length, sizes.length, "首页视口验收拒绝空矩阵");
      assert.equal(errors.length, 0, `首页流程出现浏览器错误：${JSON.stringify(errors)}`);
      report.status = "PASS";
      return;
    }
    await openLayout(page);
    if (process.argv.includes("--case=renpy-page-style-editor")) {
      await page.getByRole("group", { name: "布局类型", exact: true })
        .locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      const sidebar = page.locator(".renpy-title-editor .runtime-layout-sidebar");
      const authoredPages = [
        { id: "title", label: "标题主页" },
        { id: "preferences", label: "选项" },
        { id: "save_load", label: "存档/读档" },
        { id: "history", label: "历史" },
        { id: "about", label: "关于" },
        { id: "help", label: "帮助" },
        { id: "gallery", label: "画廊" },
      ];
      for (const authoredPage of authoredPages) {
        await sidebar.getByRole("button", { name: authoredPage.label, exact: true }).click();
        await page.locator(`.renpy-title-editor[data-editor-page="${authoredPage.id}"]`).waitFor();
        if (authoredPage.id !== "title")
          await page.locator(`.renpy-editor-runtime-viewport[data-preview-page="${authoredPage.id}"][data-preview-phase="ready"]`).waitFor();
        assert.equal(await page.getByTestId("renpy-page-style-editor").count(), 1,
          `${authoredPage.label}必须能编辑当前页面区域样式`);
        assert.equal(await page.getByTestId("renpy-page-style-editor")
          .getByLabel("页面背景色", { exact: true }).isEnabled(), true,
        `${authoredPage.label}页面样式必须可操作`);
      }
      await sidebar.getByRole("button", { name: "标题主页", exact: true }).click();
      const regionEditor = page.getByTestId("renpy-page-region-editor");
      const titleActionRegion = regionEditor.locator('[data-component-id="title_continue_button"]');
      await titleActionRegion.click();
      assert.equal(await regionEditor.getByLabel("区域 X", { exact: true }).isEnabled(), true,
        "标题按钮仍须允许独立调整页面区域位置");
      assert.equal(await page.getByTestId("renpy-page-style-editor").count(), 0,
        "标题按钮样式必须由按钮角色编辑器统一管理，不能同时暴露通用区域样式");
      assert.equal(await page.getByTestId("renpy-region-style-managed-by-role").isVisible(), true,
        "选择按钮区域时应明确提示其样式编辑入口");
      assert.equal(await page.getByTestId("renpy-button-role-editor").isVisible(), true,
        "按钮角色样式编辑器必须保持可见");
      await sidebar.getByRole("button", { name: "关于", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="about"][data-preview-phase="ready"]').waitFor();
      const styleEditor = page.getByTestId("renpy-page-style-editor");
      const preview = page.frameLocator(".renpy-editor-runtime-viewport iframe");
      const baseline = await preview.locator(".about-card").evaluate((panel) => {
        const style = getComputedStyle(panel);
        return { backgroundColor: style.backgroundColor, color: style.color,
          borderRadius: style.borderRadius };
      });
      assert.equal(await styleEditor.getByTestId("renpy-page-style-backgroundColor-source").innerText(),
        "主题继承");
      await styleEditor.getByLabel("页面背景色", { exact: true }).fill("#345678");
      await styleEditor.getByLabel("页面文字色", { exact: true }).fill("#f0d090");
      await styleEditor.getByLabel("页面圆角", { exact: true }).fill("18");
      await page.waitForFunction(() => {
        const panel = document.querySelector(".renpy-editor-runtime-viewport iframe")
          ?.contentDocument?.querySelector(".about-card");
        if (!panel) return false;
        const style = getComputedStyle(panel);
        return style.backgroundColor === "rgba(52, 86, 120, 0.78)"
          && style.color === "rgb(240, 208, 144)"
          && style.borderRadius === "18px";
      }, undefined, { timeout: 30000 });
      assert.equal(await styleEditor.getByTestId("renpy-page-style-backgroundColor-source").innerText(),
        "覆盖");
      const styleGeometryMatrix = [];
      for (const [width, height] of currentAcceptanceViewports()) {
        await page.setViewportSize({ width, height });
        const workbench = await verifyGeometry(page);
        const runtime = await preview.locator(".about-card").evaluate((panel) => {
          const rect = panel.getBoundingClientRect();
          const style = getComputedStyle(panel);
          const viewport = panel.ownerDocument.documentElement;
          return {
            rect: rect.toJSON(),
            viewport: { width: viewport.clientWidth, height: viewport.clientHeight },
            styles: { backgroundColor: style.backgroundColor, color: style.color,
              borderRadius: style.borderRadius },
          };
        });
        assert(runtime.rect.left >= 0 && runtime.rect.top >= 0
          && runtime.rect.right <= runtime.viewport.width + 1
          && runtime.rect.bottom <= runtime.viewport.height + 1,
        `页面样式覆盖不得让Runtime区域越界：${JSON.stringify({ width, height, runtime })}`);
        assert.deepEqual(runtime.styles, {
          backgroundColor: "rgba(52, 86, 120, 0.78)",
          color: "rgb(240, 208, 144)",
          borderRadius: "18px",
        }, `Runtime必须在${width}×${height}消费页面样式覆盖`);
        styleGeometryMatrix.push({ width, height, workbench, runtime });
      }
      const beforeSave = (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
        .data.project_metadata.settings;
      const agentvnBefore = structuredClone(beforeSave.runtimeUILayoutProfiles.profiles.agentvn);
      await page.getByRole("button", { name: "保存布局", exact: true }).click();
      await page.getByText("布局已保存", { exact: true }).waitFor();
      const saved = (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
        .data.project_metadata.settings;
      const aboutPanel = saved.runtimeUILayoutProfiles.profiles.renpy.screens
        .find((screen) => screen.screen_id === "about").components
        .find((component) => component.component_type === "about_panel");
      assert.equal(aboutPanel.style.backgroundColor, "#345678");
      assert.equal(aboutPanel.style.color, "#f0d090");
      assert.equal(aboutPanel.style.borderRadius, 18);
      assert.deepEqual(saved.runtimeUILayoutProfiles.profiles.agentvn, agentvnBefore,
        "页面样式覆盖不能污染AgentVN布局");
      await reloadAfterRequests(page);
      await page.waitForFunction(() => document.querySelector(".editor-toolbar")
        || document.querySelector(".recent-project-open:not(:disabled)"));
      if (!await page.locator(".editor-toolbar").isVisible())
        await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: title }).first().click();
      await page.locator(".editor-toolbar").waitFor();
      await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.locator('.advanced-tab-content.is-active[data-tab="layout"][aria-hidden="false"]').waitFor();
      await page.waitForFunction(() => !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving"));
      const activeLayout = page.locator('.advanced-tab-content.is-active[data-tab="layout"][aria-hidden="false"]');
      await activeLayout.locator(".runtime-layout-designer[data-layout-type='renpy']").waitFor();
      const reopenedSidebar = activeLayout.locator(".renpy-title-editor .runtime-layout-sidebar");
      await reopenedSidebar.getByRole("button", { name: "关于", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="about"][data-preview-phase="ready"]').waitFor();
      const reopenedStyles = page.getByTestId("renpy-page-style-editor");
      assert.equal(await reopenedStyles.getByTestId("renpy-page-style-backgroundColor-source").innerText(), "覆盖");
      assert.equal(await reopenedStyles.getByLabel("页面背景色", { exact: true }).inputValue(), "#345678");
      for (const key of ["backgroundColor", "color", "borderRadius"])
        await reopenedStyles.getByTestId(`renpy-page-style-property-${key}`)
          .getByRole("button", { name: "恢复主题继承", exact: true }).click();
      await page.waitForFunction((expected) => {
        const panel = document.querySelector(".renpy-editor-runtime-viewport iframe")
          ?.contentDocument?.querySelector(".about-card");
        if (!panel) return false;
        const style = getComputedStyle(panel);
        return style.backgroundColor === expected.backgroundColor
          && style.color === expected.color
          && style.borderRadius === expected.borderRadius;
      }, baseline, { timeout: 30000 });
      await page.getByRole("button", { name: "保存布局", exact: true }).click();
      await page.getByText("布局已保存", { exact: true }).waitFor();
      const afterRestore = (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
        .data.project_metadata.settings;
      const restoredAboutPanel = afterRestore.runtimeUILayoutProfiles.profiles.renpy.screens
        .find((screen) => screen.screen_id === "about").components
        .find((component) => component.component_type === "about_panel");
      assert.equal(restoredAboutPanel.style?.backgroundColor, undefined);
      assert.equal(restoredAboutPanel.style?.color, undefined);
      assert.equal(restoredAboutPanel.style?.borderRadius, undefined);
      assert.deepEqual(afterRestore.runtimeUILayoutProfiles.profiles.agentvn, agentvnBefore);
      assert.deepEqual(errors, [], "页面区域样式创作流程不得产生浏览器错误");
      report.cases.push({ case: "renpy-page-style-editor-runtime-persistence-inheritance",
        authoredPages: authoredPages.map(({ id }) => id), baseline, styleGeometryMatrix,
        applied: { backgroundColor: "#345678", color: "#f0d090", borderRadius: 18 },
        reset: "theme-inheritance", motionPreference, status: "PASS" });
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=renpy-page-region-editor")) {
      await page.getByRole("group", { name: "布局类型", exact: true })
        .locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      const sidebar = page.locator(".renpy-title-editor .runtime-layout-sidebar");
      const authoredPages = [
        { id: "title", label: "标题主页", region: "标题信息" },
        { id: "preferences", label: "选项", region: "设置区域" },
        { id: "save_load", label: "存档/读档", region: "存档网格" },
        { id: "history", label: "历史", region: "历史列表" },
        { id: "about", label: "关于", region: "关于面板" },
        { id: "help", label: "帮助", region: "帮助面板" },
        { id: "gallery", label: "画廊", region: "画廊网格" },
      ];
      for (const authoredPage of authoredPages) {
        await sidebar.getByRole("button", { name: authoredPage.label, exact: true }).click();
        await page.locator(`.renpy-title-editor[data-editor-page="${authoredPage.id}"]`).waitFor();
        if (authoredPage.id !== "title")
          await page.locator(`.renpy-editor-runtime-viewport[data-preview-page="${authoredPage.id}"][data-preview-phase="ready"]`).waitFor();
        const pageRegions = page.getByTestId("renpy-page-region-editor");
        assert.equal(await pageRegions.getByRole("button", { name: authoredPage.region, exact: true }).count(), 1,
          `${authoredPage.label}必须有可达、可识别的内建区域编辑入口`);
        assert.equal(await pageRegions.getByRole("spinbutton", { name: "区域 X", exact: true }).isEnabled(), true,
          `${authoredPage.label}区域必须能以结构化字段编辑`);
      }
      await sidebar.getByRole("button", { name: "关于", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="about"][data-preview-phase="ready"]').waitFor();
      assert.equal(await page.getByTestId("renpy-page-region-editor").count(), 1,
        "专用页面编辑器必须提供当前页面内建区域的结构化编辑，不应要求离开页面进入通用拖拽画布");
      const regions = page.getByTestId("renpy-page-region-editor");
      await regions.getByRole("button", { name: "关于面板", exact: true }).click();
      await regions.getByRole("spinbutton", { name: "区域 X", exact: true }).fill("12");
      await regions.getByRole("spinbutton", { name: "区域宽度", exact: true }).fill("68");
      const preview = page.frameLocator(".renpy-editor-runtime-viewport iframe");
      await page.waitForFunction(() => {
        const viewport = document.querySelector(".renpy-editor-runtime-viewport");
        const panel = viewport?.querySelector("iframe")?.contentDocument?.querySelector(".about-card");
        return viewport?.dataset.previewPhase === "ready"
          && panel?.style.left === "12%"
          && panel?.style.width === "68%";
      }, undefined, { timeout: 30000 });
      const result = await preview.locator(".about-card").evaluate((panel) => ({
        left: panel.style.left,
        top: panel.style.top,
        width: panel.style.width,
        height: panel.style.height,
      }));
      assert.deepEqual(result, { left: "12%", top: "18%", width: "68%", height: "48%" },
        "专用编辑器修改必须直接反映到同一页面的真实 Runtime 预览");
      await page.getByRole("button", { name: "保存布局", exact: true }).click();
      await page.getByText("布局已保存", { exact: true }).waitFor();
      const saved = (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
        .data.project_metadata.settings;
      const savedPanel = saved.runtimeUILayoutProfiles.profiles.renpy.screens
        .find((screen) => screen.screen_id === "about").components
        .find((component) => component.component_type === "about_panel");
      assert.equal(savedPanel.rect.x, 12);
      assert.equal(savedPanel.rect.width, 68);
      const agentvnBeforeReset = structuredClone(saved.runtimeUILayoutProfiles.profiles.agentvn);
      await reloadAfterRequests(page);
      await page.waitForFunction(() => document.querySelector(".editor-toolbar")
        || document.querySelector(".recent-project-open:not(:disabled)"));
      if (!await page.locator(".editor-toolbar").isVisible())
        await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: title }).first().click();
      await page.locator(".editor-toolbar").waitFor();
      await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.locator('.advanced-tab-content.is-active[data-tab="layout"][aria-hidden="false"]').waitFor();
      await page.waitForFunction(() => !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving"));
      const activeLayout = page.locator('.advanced-tab-content.is-active[data-tab="layout"][aria-hidden="false"]');
      await activeLayout.locator(".runtime-layout-designer[data-layout-type='renpy']").waitFor();
      const reopenedSidebar = activeLayout.locator(".renpy-title-editor .runtime-layout-sidebar");
      await reopenedSidebar.getByRole("button", { name: "关于", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="about"][data-preview-phase="ready"]').waitFor();
      assert.equal(await regions.getByRole("spinbutton", { name: "区域 X", exact: true }).inputValue(), "12",
        "页面区域几何必须在工程重开后恢复");
      assert.equal(await regions.getByRole("spinbutton", { name: "区域宽度", exact: true }).inputValue(), "68");
      const geometryMatrix = [];
      for (const [width, height] of currentAcceptanceViewports()) {
        await page.setViewportSize({ width, height });
        const workbench = await verifyGeometry(page);
        const runtimeRect = await preview.locator(".about-card").evaluate((panel) => {
          const rect = panel.getBoundingClientRect();
          return { rect: rect.toJSON(), style: { left: panel.style.left, width: panel.style.width },
            viewport: { width: panel.ownerDocument.documentElement.clientWidth,
              height: panel.ownerDocument.documentElement.clientHeight } };
        });
        assert(runtimeRect.rect.left >= 0 && runtimeRect.rect.right <= runtimeRect.viewport.width + 1
          && runtimeRect.rect.top >= 0 && runtimeRect.rect.bottom <= runtimeRect.viewport.height + 1,
        `页面区域在 ${width}×${height} 实际预览中必须完整可见: ${JSON.stringify(runtimeRect)}`);
        assert.deepEqual(runtimeRect.style, { left: "12%", width: "68%" });
        geometryMatrix.push({ width, height, workbench, runtimeRect });
      }
      await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
      const reset = page.getByRole("group", { name: "确认重置关于", exact: true });
      await reset.getByRole("button", { name: "取消", exact: true }).click();
      await page.waitForFunction(() => {
        const viewport = document.querySelector(".renpy-editor-runtime-viewport");
        const panel = viewport?.querySelector("iframe")?.contentDocument?.querySelector(".about-card");
        return viewport?.dataset.previewPhase === "ready"
          && panel?.style.left === "12%"
          && panel?.style.width === "68%";
      }, undefined, { timeout: 30000 });
      await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
      await reset.getByRole("button", { name: "确认重置", exact: true }).click();
      await page.waitForFunction(() => {
        const viewport = document.querySelector(".renpy-editor-runtime-viewport");
        const panel = viewport?.querySelector("iframe")?.contentDocument?.querySelector(".about-card");
        return viewport?.dataset.previewPhase === "ready"
          && panel?.style.left === "5%"
          && panel?.style.width === "58%";
      }, undefined, { timeout: 30000 });
      await page.getByRole("button", { name: "保存布局", exact: true }).click();
      await page.getByText("布局已保存", { exact: true }).waitFor();
      const afterReset = (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
        .data.project_metadata.settings;
      assert.equal(afterReset.runtimeUILayoutProfiles.profiles.renpy.screens
        .find((screen) => screen.screen_id === "about").components
        .find((component) => component.component_type === "about_panel").rect.x, 5,
      "确认重置只恢复本页面的内建几何");
      assert.deepEqual(afterReset.runtimeUILayoutProfiles.profiles.agentvn, agentvnBeforeReset,
        "Ren’Py页面编辑与重置不得污染AgentVN布局");
      assert.equal(await page.getByRole("button", { name: "其他页面（继续完善中）", exact: true }).count(), 0,
        "已完成页面编辑入口不得继续标记为未完成");
      assert.deepEqual(errors, [], "页面区域编辑流程不得产生前端错误");
      report.cases.push({ case: "renpy-page-region-editor-runtime-and-persistence",
        authoredPages: authoredPages.map(({ id, region }) => ({ id, region })),
        region: "about_panel", result, geometryMatrix, reset: "page-scoped", status: "PASS" });
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=preview-page-sync")) {
      await page.addInitScript(() => {
        window.__layoutPreviewInits = [];
        window.addEventListener("message", event => {
          if (event.data?.type === "agentvn.live-preview.init")
            window.__layoutPreviewInits.push({
              revision: event.data.revision, sessionId: event.data.sessionId,
              runId: event.data.runId, screen: event.data.screen,
            });
        });
      });
      await page.getByRole("group", { name: "布局类型", exact: true })
        .locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      const sidebar = page.locator(".renpy-title-editor .runtime-layout-sidebar");
      await sidebar.getByRole("button", { name: "选项", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="preferences"][data-preview-phase="ready"]').waitFor();
      const runtime = page.frameLocator(".renpy-editor-runtime-viewport iframe");
      const waitIdle = async screen => page.waitForFunction(expected => {
        const doc = document.querySelector(".renpy-editor-runtime-viewport iframe")?.contentDocument;
        const owner = doc?.querySelector("[data-runtime-transition-phase]");
        return owner?.getAttribute("data-runtime-transition-phase") === "idle"
          && owner.getAttribute("data-runtime-presented-screen") === expected
          && owner.getAttribute("data-runtime-committed-screen") === expected
          && !doc.querySelector("[data-runtime-transition-snapshot]");
      }, screen);
      await waitIdle("settings");
      const duration = motionPreference === "reduce" ? 816 : 1632;
      for (const [width, height] of currentAcceptanceViewports()) {
        await page.setViewportSize({ width, height });
        const workbench = await verifyGeometry(page);
        const captureNavigation = async (name, screen, action) => {
          await runtime.locator("[data-runtime-transition-phase]").evaluate(owner => {
            const rail = document.querySelector("[data-testid='renpy-menu-navigation']");
            const trace = window.__previewPageSyncTrace = {
              initBefore: window.__layoutPreviewInits.length, frames: [],
              railRect: rail.getBoundingClientRect().toJSON(), done: false, rail,
            };
            const started = performance.now();
            const sample = () => {
              const owner = document.querySelector("[data-runtime-transition-phase]");
              const surface = owner?.querySelector("[data-runtime-motion-surface]");
              const snapshot = owner?.querySelector("[data-runtime-transition-snapshot]");
              const preview = window.frameElement?.closest(".renpy-editor-runtime-viewport");
              trace.frames.push({
                at: performance.now(), phase: owner?.dataset.runtimeTransitionPhase,
                presented: owner?.dataset.runtimePresentedScreen,
                committed: owner?.dataset.runtimeCommittedScreen,
                style: owner?.dataset.runtimeTransitionStyle,
                duration: Number(owner?.dataset.runtimeTransitionDuration),
                opacity: surface ? Number(getComputedStyle(surface).opacity) : null,
                oldOpacity: snapshot ? Number(getComputedStyle(snapshot).opacity) : null,
                black: owner ? Number(getComputedStyle(owner, "::before").opacity) : 0,
                hasLaunchBlackout: !!document.querySelector(".game-launch-blackout"),
                oldInert: snapshot?.inert,
                oldFocused: !!snapshot?.contains(document.activeElement),
                functionalLayers: owner?.querySelectorAll(".runtime-screen-transition-current").length,
                railSame: document.querySelector("[data-testid='renpy-menu-navigation']") === rail,
                railRect: rail.getBoundingClientRect().toJSON(),
                initCount: window.__layoutPreviewInits.length,
                previewPhase: preview?.dataset.previewPhase,
                overflow: document.documentElement.scrollWidth - innerWidth,
              });
              if (trace.done || performance.now() - started > 15000) return;
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          await action();
          await waitIdle(screen);
          await runtime.locator("[data-runtime-transition-phase]").evaluate(() => {
            window.__previewPageSyncTrace.done = true;
          });
          const trace = await runtime.locator("[data-runtime-transition-phase]").evaluate(() => {
            const { rail, ...trace } = window.__previewPageSyncTrace;
            return { ...trace, initAfter: window.__layoutPreviewInits.length };
          });
          const row = { case: name, width, height, duration, trace, workbench, status: "CHECKING" };
          report.cases.push(row);
          assert.equal(trace.initAfter, trace.initBefore,
            "仅切换预览页面不能再次初始化游戏并截断原有淡入淡出");
          const fading = trace.frames.filter(frame => frame.phase === "crossfading");
          assert(fading.length > 2, "实际 Runtime 预览须保留淡入淡出中间帧");
          assert(fading.some(frame => frame.opacity > .1 && frame.opacity < .9
            && frame.oldOpacity > .1), "预览内旧页与新页须连续交叠");
          assert(fading.every(frame => frame.style === "crossfade" && frame.duration === duration
            && frame.oldInert && !frame.oldFocused && frame.functionalLayers === 1),
          "预览内转场须使用完整统一时长，离场不可交互且仅有一个功能页");
          for (const frame of trace.frames) {
            assert(frame.previewPhase === "ready", "页面同步不能重新加载或禁用已就绪预览");
            assert(frame.black < .01 && !frame.hasLaunchBlackout && frame.overflow <= 1,
              "菜单互切不得黑场或溢出");
            assert(frame.railSame, "页签同步不能重挂共享导航");
            for (const key of ["x", "y", "width", "height"])
              assert(Math.abs(frame.railRect[key] - trace.railRect[key]) <= 1, `预览导航${key}不稳定`);
          }
          assert.equal(await runtime.locator("[data-runtime-transition-snapshot]").count(), 0);
          await page.locator(`.renpy-title-editor[data-editor-page="${screen === "settings" ? "preferences" : screen}"]`).waitFor();
          row.status = "PASS";
        };
        await captureNavigation("runtime-menu-click-preserves-session", "about",
          () => runtime.getByTestId("renpy-menu-about").click());
        await captureNavigation("author-page-click-preserves-session", "settings",
          () => sidebar.getByRole("button", { name: "选项", exact: true }).click());
        await captureNavigation("runtime-redirect-preserves-session", "help", async () => {
          await runtime.getByTestId("renpy-menu-about").click();
          await runtime.locator("[data-runtime-transition-phase]").evaluate(async () => {
            while (document.querySelector("[data-runtime-transition-phase]")?.dataset.runtimeTransitionPhase !== "crossfading")
              await new Promise(resolve => requestAnimationFrame(resolve));
          });
          await runtime.getByTestId("renpy-menu-help").click();
        });
        await captureNavigation("runtime-return-to-settings-preserves-session", "settings",
          () => runtime.getByTestId("renpy-menu-settings").click());
        await page.screenshot({ path: path.join(output, `preview-page-sync-${width}x${height}.png`) });
      }
      assert.equal(report.cases.length, 12, "预览同步验收不得使用空或缺失矩阵");
      assert.deepEqual(errors, []);
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=layout-naming")) {
      const switcher = page.getByRole("group", { name: "布局类型", exact: true });
      assert.equal(await switcher.getByRole("button", { name: "AgentVN", exact: true }).count(), 1,
        "布局类型应保留 AgentVN 选项");
      assert.equal(await switcher.locator('[data-layout-type-option="renpy"]').count(), 1,
        "布局类型应以最新确认的产品名称呈现第二种布局");
      await switcher.locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.locator(".renpy-title-editor").waitFor();
      const advancedToggle = page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true });
      const layoutDescription = page.locator("#runtime-layout-type-description");
      assert.equal(await advancedToggle.isChecked(), false,
        "切换到 Ren’Py 布局时，独立进阶代码覆盖默认保持关闭");
      assert.equal((await layoutDescription.textContent()).trim(), "Ren’Py · 图形化布局编辑");
      await advancedToggle.check();
      assert.equal((await layoutDescription.textContent()).trim(), "Ren’Py · 进阶代码编辑",
        "进阶勾选只改变当前布局的编辑模式说明");
      assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-layout-type"), "renpy",
        "进阶编辑模式不得创建或切换第三种布局类型");
      await advancedToggle.uncheck();
      const visibleLayoutText = await page.locator(".runtime-layout-designer").evaluate((root) => [
        root.innerText,
        ...[...root.querySelectorAll("[aria-label], [title]")].flatMap((element) => [
          element.getAttribute("aria-label") ?? "",
          element.getAttribute("title") ?? "",
        ]),
      ].join("\n"));
      assert(visibleLayoutText.includes("Ren’Py · 图形化布局编辑"),
        "取消代码覆盖后应明确说明当前为图形化布局编辑");
      const geometry = [];
      for (const [width, height] of currentAcceptanceViewports()) {
        await page.setViewportSize({ width, height });
        geometry.push({ width, height, ...(await verifyGeometry(page)) });
      }
      await page.getByTestId("renpy-gui-import-open").click();
      const importDialog = page.getByTestId("renpy-gui-import-dialog");
      await importDialog.waitFor();
      const importText = await importDialog.evaluate((dialog) => [
        dialog.innerText,
        ...[...dialog.querySelectorAll("[aria-label], [title]")].flatMap((element) => [
          element.getAttribute("aria-label") ?? "",
          element.getAttribute("title") ?? "",
        ]),
      ].join("\n"));
      assert(importText.includes("导入"), "导入说明仍应可读");
      assert.equal(await importDialog.getAttribute("aria-modal"), "true");
      await page.getByRole("button", { name: "取消，不修改工程" }).click();
      report.cases.push({ case: "advanced-layout-user-facing-name", geometry, status: "PASS" });
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=button-role-editor")) {
      await page.getByRole("group", { name: "布局类型", exact: true })
        .locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.getByTestId("renpy-button-role-editor").waitFor({ timeout: 5_000 });
      await page.getByRole("combobox", { name: "按钮角色", exact: true }).click();
      const roleLabels = await page.getByRole("option").allTextContents();
      assert.deepEqual(roleLabels, [
        "标题操作", "页面导航", "分类 / 分页", "剧情选项", "快捷栏", "弹窗操作",
      ], "进阶专用编辑器必须提供六类可独立编辑的按钮角色");
      await page.getByRole("option", { name: "标题操作", exact: true }).click();
      async function selectRoleControl(name, label) {
        await page.getByRole("combobox", { name, exact: true }).click();
        await page.getByRole("option", { name: label, exact: true }).click();
      }
      await selectRoleControl("按钮样式范围", "共享样式");
      await selectRoleControl("按钮状态", "普通");
      await page.getByLabel("按钮宽度").fill("280");
      await page.getByLabel("按钮高度").fill("56");
      await page.getByLabel("按钮背景色").fill("#203040");
      await page.getByLabel("按钮不透明度").fill("0.37");
      assert.equal(await page.getByTestId("renpy-title-button-role-source").innerText(), "自定义");
      const rolePreviewButton = page.getByTestId("renpy-preview-0");
      const getRolePreviewState = () => rolePreviewButton.evaluate((button) => {
        const view = button.ownerDocument.defaultView;
        const matchingRules = [];
        for (const sheet of [...button.ownerDocument.styleSheets]) {
          let rules;
          try { rules = sheet.cssRules; } catch { continue; }
          for (const rule of [...rules]) {
            if (!("selectorText" in rule) || !rule.selectorText.includes("renpy-title-action")) continue;
            try {
              if (button.matches(rule.selectorText) && rule.style.backgroundColor)
                matchingRules.push({ selector: rule.selectorText, value: rule.style.backgroundColor });
            } catch {}
          }
        }
        const style = view.getComputedStyle(button);
        return { background: style.backgroundColor, opacity: Number(style.opacity), width: style.width, height: style.height,
          variables: ["--renpy-role-normal-background", "--renpy-role-width", "--renpy-role-height"]
            .map(key => [key, style.getPropertyValue(key)]), matchingRules };
      });
      await rolePreviewButton.waitFor();
      let normalState;
      const normalDeadline = Date.now() + 5000;
      while (Date.now() < normalDeadline) {
        normalState = await getRolePreviewState();
        if (normalState.background === "rgb(32, 48, 64)" && Math.abs(normalState.opacity - .37) < .01) break;
        await page.waitForTimeout(50);
      }
      assert.equal(normalState.background, "rgb(32, 48, 64)",
        `实际标题 Runtime 预览必须消费角色普通态：${JSON.stringify(normalState)}`);
      assert(Math.abs(normalState.opacity - .37) < .01,
        `实际标题Runtime预览必须消费作者设定的不透明度：${JSON.stringify(normalState)}`);
      const before = await page.getByTestId("renpy-preview-0").evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        const title = button.closest(".renpy-title-view");
        return { width: rect.width, height: rect.height, background: style.backgroundColor,
          cssWidth: parseFloat(style.width),
          canvasScale: title.getBoundingClientRect().width / title.offsetWidth,
          customBackground: style.getPropertyValue("--renpy-role-normal-background"),
          role: button.getAttribute("data-button-role"),
          custom: button.getAttribute("data-button-role-custom"),
          styled: button.getAttribute("data-button-role-styled"),
          inlineStyle: button.getAttribute("style") };
      });
      assert.equal(before.background, "rgb(32, 48, 64)",
        `实际标题 Runtime 预览必须消费角色普通态：${JSON.stringify(before)}`);
      await selectRoleControl("按钮状态", "悬停");
      await page.getByLabel("按钮背景色").fill("#304050");
      await page.getByLabel("按钮不透明度").fill("0.74");
      await rolePreviewButton.hover();
      let hover;
      const hoverDeadline = Date.now() + 5000;
      while (Date.now() < hoverDeadline) {
        hover = await rolePreviewButton.evaluate((button) => {
          const rect = button.getBoundingClientRect();
          return { width: rect.width, height: rect.height, background: getComputedStyle(button).backgroundColor,
            opacity: Number(getComputedStyle(button).opacity) };
        });
        if (hover.background === "rgb(48, 64, 80)" && Math.abs(hover.opacity - .74) < .01) break;
        await page.waitForTimeout(50);
      }
      assert.equal(hover.background, "rgb(48, 64, 80)",
        "悬停态编辑必须实时反映到实际标题预览");
      assert(Math.abs(hover.opacity - .74) < .01, "悬停不透明度必须实时反映到实际标题预览");
      const stableHover = await rolePreviewButton.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height, background: getComputedStyle(button).backgroundColor };
      });
      assert.equal(stableHover.width, before.width, "状态切换不能改变按钮包络宽度");
      assert.equal(stableHover.height, before.height, "状态切换不能改变按钮包络高度");
      assert.equal(await page.locator(".renpy-title-editor").evaluate((node) =>
        node.scrollWidth - node.clientWidth <= 1), true, "按钮编辑器不得造成工作台横向溢出");
      await selectRoleControl("按钮样式范围", "当前页面覆盖");
      assert.equal(await page.getByTestId("renpy-title-button-role-source").innerText(), "继承共享");
      await page.getByLabel("按钮宽度").fill("320");
      const pageOverrideWidth = await rolePreviewButton.evaluate((button) => button.getBoundingClientRect().width);
      const pageGeometryTrace = await rolePreviewButton.evaluate(async button => {
        const frames = [];
        for (let index = 0; index < 8; index++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const title = button.closest(".renpy-title-view");
          const style = getComputedStyle(button);
          frames.push({ at: performance.now(), renderedWidth: button.getBoundingClientRect().width,
            cssWidth: parseFloat(style.width),
            canvasScale: title.getBoundingClientRect().width / title.offsetWidth,
            roleWidth: style.getPropertyValue("--renpy-role-width") });
        }
        return frames;
      });
      report.snapshots.push({ case: "role-page-logical-and-rendered-geometry", before, stableHover, pageOverrideWidth, pageGeometryTrace });
      assert.equal(before.cssWidth, 280, "共享角色必须使用设定的逻辑宽度");
      for (const frame of pageGeometryTrace) {
        assert.equal(frame.cssWidth, 320, "局部覆盖必须恰好反映设定的逻辑宽度");
        assert(Math.abs(frame.canvasScale - before.canvasScale) < .001,
          "按钮角色修改不能改变预览画布比例");
        assert(Math.abs(frame.renderedWidth - 320 * before.canvasScale) <= 1,
          "实际预览按钮必须只应用一次画布缩放");
      }
      assert(Math.abs(pageOverrideWidth - 320 * before.canvasScale) <= 1,
        "页面几何覆盖必须在实际预览正确显示，不能以逻辑像素阈值判断缩略画布");
      await page.getByRole("button", { name: "恢复此角色共享继承" }).click();
      const restoredWidth = await rolePreviewButton.evaluate((button) => button.getBoundingClientRect().width);
      assert(Math.abs(restoredWidth - stableHover.width) <= 1, "恢复继承必须恢复共享按钮包络");
      await page.getByRole("button", { name: "保存布局" }).click();
      await page.getByText("布局已保存").waitFor({ timeout: 15_000 });
      const savedSettings = (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
        .data.project_metadata.settings;
      const savedRole = savedSettings.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.buttonRoles.title_action;
      assert.equal(savedRole.geometry.width, 280, "显式保存应持久化共享按钮角色几何");
      assert.equal(savedRole.states.normal.backgroundColor, "#203040",
        "显式保存应持久化按钮状态样式");
      assert.equal(savedRole.states.normal.opacity, .37, "普通态透明度必须随工程保存");
      assert.equal(savedRole.states.hover.opacity, .74, "悬停态透明度必须随工程保存");
      const roleGeometry = [];
      for (const [width, height] of currentAcceptanceViewports()) {
        await page.setViewportSize({ width, height });
        roleGeometry.push({ width, height, ...(await verifyGeometry(page)) });
        assert.equal(await page.locator(".renpy-title-editor").evaluate((node) =>
          node.scrollWidth - node.clientWidth <= 1), true,
        `按钮角色编辑器在 ${width}×${height} 不得造成横向溢出`);
      }
      // Content-flow dimensions are minimums only until that particular axis
      // is authored. Changing it must not silently pin the other axis.
      await selectRoleControl("按钮角色", "页面导航");
      const sizingSource = page.getByTestId("renpy-role-sizing-source");
      await sizingSource.waitFor();
      assert((await sizingSource.innerText()).includes("宽度：内置最小值，随文字扩展。"));
      assert((await sizingSource.innerText()).includes("高度：内置最小值，随文字扩展。"));
      await page.getByLabel("按钮宽度").fill("190");
      assert((await sizingSource.innerText()).includes("宽度：显式固定值。"));
      assert((await sizingSource.innerText()).includes("高度：内置最小值，随文字扩展。"));
      await page.getByRole("button", { name: "恢复此角色共享继承", exact: true }).click();
      assert((await sizingSource.innerText()).includes("宽度：内置最小值，随文字扩展。"));
      await selectRoleControl("按钮角色", "标题操作");
      await sizingSource.waitFor({ state: "hidden" });
      report.cases.push({ case: "advanced-button-role-editor-live-runtime-preview",
        contentFlowSizingSourceAndSingleAxisReset: true,
        roleLabels, before, hover: stableHover, pageOverrideWidth, restoredWidth, roleGeometry, status: "PASS" });
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=menu-frame-editor")) {
      await page.getByRole("group", { name: "布局类型", exact: true })
        .locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      const sidebar = page.locator(".renpy-title-editor .runtime-layout-sidebar");
      await sidebar.getByRole("button", { name: "关于", exact: true }).click();
      assert.equal(await page.getByTestId("renpy-menu-frame-shared").count(), 1,
        "共享菜单框架必须提供结构化编辑入口，不能只有页面导航字号");
      const shared = page.getByTestId("renpy-menu-frame-shared");
      const local = page.getByTestId("renpy-menu-frame-page");
      await shared.locator("summary").click();
      await local.locator("summary").click();
      const getSaved = async () => (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
        .data.project_metadata.settings;
      const agentvnBefore = structuredClone((await getSaved()).runtimeUILayoutProfiles.profiles.agentvn);
      const fields = [
        ["menuNavigationWidth", "导航区宽度", 310], ["menuTopPadding", "标题区高度", 140],
        ["menuBottomPadding", "底部留白", 40], ["menuContentLeft", "内容左边距", 32],
        ["menuContentRight", "内容右边距", 24], ["menuContentTop", "内容顶部间距", 12],
        ["menuTitleX", "标题左边距", 56], ["menuTitleFontSize", "标题字号", 44],
      ];
      for (const [, label, value] of fields)
        await shared.getByRole("spinbutton", { name: `共享菜单${label}`, exact: true }).fill(String(value));
      await local.getByRole("button", { name: "覆盖关于内容左边距", exact: true }).click();
      await local.getByRole("spinbutton", { name: "关于菜单内容左边距", exact: true }).fill("48");
      assert.equal(await page.getByTestId("renpy-frame-menuContentLeft-source").innerText(), "覆盖");
      const runtime = page.frameLocator(".renpy-editor-runtime-viewport iframe");
      const waitFrame = async (scope, left, font) => page.waitForFunction(({ scope, left, font }) => {
        const doc = document.querySelector(".renpy-editor-runtime-viewport iframe")?.contentDocument;
        const frame = doc?.querySelector("[data-renpy-menu-frame]");
        const title = doc?.querySelector("[data-testid='renpy-menu-title']");
        const owner = doc?.querySelector("[data-runtime-transition-phase]");
        if (!frame || !title || owner?.getAttribute("data-runtime-transition-phase") !== "idle"
          || !doc.querySelector(`[data-ui-screen="${scope}"]`)) return false;
        const scale = Number(frame.dataset.renpyMenuScale);
        return Math.abs(parseFloat(doc.defaultView.getComputedStyle(frame).getPropertyValue("--renpy-content-left")) / scale - left) < .1
          && Math.abs(parseFloat(doc.defaultView.getComputedStyle(title).fontSize) / scale - font) < .1;
      }, { scope, left, font }, { timeout: 30000 });
      await waitFrame("about", 48, 44);
      await local.getByRole("button", { name: "恢复内容左边距继承", exact: true }).click();
      await waitFrame("about", 32, 44);
      assert.equal(await page.getByTestId("renpy-frame-menuContentLeft-source").innerText(), "继承");
      await local.getByRole("button", { name: "覆盖关于内容左边距", exact: true }).click();
      await local.getByRole("spinbutton", { name: "关于菜单内容左边距", exact: true }).fill("48");
      await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
      const reset = page.getByRole("group", { name: "确认重置关于", exact: true });
      await reset.getByRole("button", { name: "取消", exact: true }).click();
      await waitFrame("about", 48, 44);
      await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
      await reset.getByRole("button", { name: "确认重置", exact: true }).click();
      await waitFrame("about", 32, 44);
      await local.getByRole("button", { name: "覆盖关于内容左边距", exact: true }).click();
      await local.getByRole("spinbutton", { name: "关于菜单内容左边距", exact: true }).fill("48");
      await local.getByRole("button", { name: "覆盖关于标题字号", exact: true }).click();
      await local.getByRole("spinbutton", { name: "关于菜单标题字号", exact: true }).fill("46");
      await waitFrame("about", 48, 46);
      await sidebar.getByRole("button", { name: "选项", exact: true }).click();
      await waitFrame("preferences", 32, 44);
      assert.equal(await page.getByTestId("renpy-frame-menuContentLeft-source").innerText(), "继承");
      await runtime.getByTestId("renpy-menu-about").click();
      await waitFrame("about", 48, 46);
      await page.locator(".renpy-title-editor[data-editor-page='about']").waitFor();
      report.cases.push({ case: "menu-frame-shared-local-reset-and-preview-navigation", status: "PASS" });
      for (const [width, height] of currentAcceptanceViewports()) {
        await page.setViewportSize({ width, height });
        await waitFrame("about", 48, 46);
        const workbench = await verifyGeometry(page);
        const actual = await runtime.getByTestId("renpy-menu-title").evaluate(title => {
          const frame = title.closest("[data-renpy-menu-frame]");
          const rect = frame.getBoundingClientRect(), returning = frame.querySelector("[data-testid='renpy-menu-return']");
          const r = returning.getBoundingClientRect(), css = getComputedStyle(frame);
          const outlet = frame.querySelector("[data-testid='renpy-menu-content']").getBoundingClientRect();
          return { frame: rect.toJSON(), title: title.getBoundingClientRect().toJSON(),
            return: r.toJSON(), returnInNav: !!returning.closest("[data-testid='renpy-menu-navigation']"),
            hit: returning.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
            scale: Number(frame.dataset.renpyMenuScale), safeLeft:parseFloat(css.paddingLeft),
            safeTop:parseFloat(css.paddingTop), outlet:outlet.toJSON(),
            overflow: document.documentElement.scrollWidth-innerWidth };
        });
        assert(!actual.returnInNav && actual.hit && actual.overflow <= 1);
        assert(Math.abs(actual.outlet.x-actual.frame.x-actual.safeLeft-358*actual.scale) <= 1,
          `实际Runtime必须消费关于页面内容左边距覆盖：${JSON.stringify(actual)}`);
        assert(Math.abs(actual.outlet.y-actual.frame.y-actual.safeTop-152*actual.scale) <= 1);
        assert(actual.title.bottom <= actual.outlet.y+1);
        await page.screenshot({ path:path.join(output,`menu-frame-editor-${width}x${height}.png`) });
        report.cases.push({ case:"menu-frame-editor-runtime-geometry",width,height,actual,workbench,status:"PASS" });
      }
      await page.getByRole("button", { name:"保存布局",exact:true }).click();
      await page.getByText("布局已保存",{exact:true}).waitFor();
      const saved = await getSaved(), gui = saved.runtimeUILayoutProfiles.profiles.renpy.renpy;
      for (const [key,,value] of fields) assert.equal(gui.shared[key],value);
      assert.equal(gui.about.menuContentLeft,48); assert.equal(gui.about.menuTitleFontSize,46);
      assert.equal(gui.preferences?.menuContentLeft,undefined);
      assert.deepEqual(saved.runtimeUILayoutProfiles.profiles.agentvn,agentvnBefore);
      await reloadAfterRequests(page);
      await page.waitForFunction(()=>document.querySelector(".editor-toolbar") || document.querySelector(".recent-project-open:not(:disabled)"));
      if (!await page.locator(".editor-toolbar").isVisible())
        await page.locator(".recent-project-open:not(:disabled)").filter({hasText:title}).first().click();
      await page.waitForFunction(()=>!document.querySelector(".project-entry-loading-overlay"));
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await sidebar.getByRole("button",{name:"关于",exact:true}).click();
      await waitFrame("about",48,46);
      await local.locator("summary").click();
      assert.equal(await page.getByTestId("renpy-frame-menuContentLeft-source").innerText(),"覆盖");
      assert.equal(await page.getByTestId("renpy-frame-menuTitleFontSize-source").innerText(),"覆盖");
      assert.deepEqual((await getSaved()).runtimeUILayoutProfiles.profiles.agentvn,agentvnBefore);
      assert.deepEqual(errors,[]);
      report.cases.push({case:"menu-frame-save-reopen-and-profile-isolation",status:"PASS"});
      report.status="PASS";
      return;
    }
    if (process.argv.includes("--case=player-modal-role-editor")) {
      await page.getByRole("group", { name: "布局类型", exact: true })
        .locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.getByTestId("renpy-player-layout-entry").click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"][data-active-screen="player"]').waitFor();
      await page.getByTestId("renpy-button-role-editor").waitFor({ timeout: 5000 });
      assert.equal(await page.getByTestId("renpy-button-role-editor").getAttribute("data-role-page"), "player",
        "剧情页角色编辑必须把局部覆盖写入 player，而不是任一菜单页面");
      assert.equal(await page.getByTestId("renpy-player-runtime-preview-toggle").count(), 1,
        "剧情页角色编辑必须能切到独立实际 Runtime 预览");
      await page.getByTestId("renpy-player-runtime-preview-toggle").click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="player"][data-preview-phase="ready"]').waitFor({
        timeout: 30000,
      });
      const previewGeometry = [];
      for (const [width, height] of currentAcceptanceViewports()) {
        await page.setViewportSize({ width, height });
        const frame = await page.locator(".renpy-editor-runtime-viewport").evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const iframe = node.querySelector("iframe");
          return { rect: rect.toJSON(), iframeInert: iframe?.inert,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        const workbench = await verifyGeometry(page);
        assert(frame.rect.width > 0 && frame.rect.height > 0
          && frame.overflow <= 1 && !frame.iframeInert,
        `剧情页 Runtime 预览在 ${width}×${height} 必须可见、可交互且不溢出：${JSON.stringify(frame)}`);
        previewGeometry.push({ width, height, frame, workbench });
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.getByRole("combobox", { name: "按钮角色", exact: true }).click();
      await page.getByRole("option", { name: "弹窗操作", exact: true }).click();
      await page.getByTestId("renpy-title-button-role-source").waitFor();
      assert.equal(await page.getByTestId("renpy-title-button-role-source").innerText(), "继承共享");
      await page.getByRole("combobox", { name: "按钮样式范围", exact: true }).click();
      await page.getByRole("option", { name: "共享样式", exact: true }).click();
      await page.getByLabel("按钮背景色").fill("#203040");
      await page.getByRole("combobox", { name: "按钮样式范围", exact: true }).click();
      await page.getByRole("option", { name: "剧情页面覆盖", exact: true }).click();
      assert.equal(await page.getByTestId("renpy-title-button-role-source").innerText(), "继承共享",
        "剧情页弹窗角色在无局部值时显示共享继承");
      await page.getByLabel("按钮背景色").fill("#425262");
      assert.equal(await page.getByTestId("renpy-title-button-role-source").innerText(), "覆盖");
      await page.getByRole("button", { name: "恢复此角色共享继承", exact: true }).click();
      assert.equal(await page.getByTestId("renpy-title-button-role-source").innerText(), "继承共享",
        "恢复继承必须移除 player 局部角色，不得更改共享配置");
      await page.getByLabel("按钮背景色").fill("#425262");
      await page.getByRole("button", { name: "保存布局" }).click();
      await page.getByText("布局已保存").waitFor({ timeout: 15000 });
      const savedSettings = (await (await page.request.get(`${backendUrl}/api/project/state`)).json())
        .data.project_metadata.settings;
      const gui = savedSettings.runtimeUILayoutProfiles.profiles.renpy.renpy;
      assert.equal(gui?.player?.buttonRoles?.modal_action?.states?.normal?.backgroundColor, "#425262",
        "剧情页弹窗操作覆盖应保存至 player 且优先于共享角色");
      assert.equal(gui?.shared?.buttonRoles?.modal_action?.states?.normal?.backgroundColor, "#203040",
        "剧情页覆盖不得污染共享角色");
      await page.getByTestId("renpy-player-runtime-preview-toggle").click();
      await page.getByTestId("renpy-player-runtime-preview-toggle").click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="player"][data-preview-phase="ready"]').waitFor({
        timeout: 30000,
      });
      const preview = page.frameLocator(".renpy-editor-runtime-viewport iframe");
      await preview.getByTestId("renpy-quick-save").click();
      await preview.getByRole("status").filter({ hasText: "快存已保存" }).waitFor({ timeout: 15000 });
      await preview.getByTestId("renpy-quick-load").click();
      const modalAction = preview.getByRole("dialog", { name: "读取最新快存？" })
        .getByTestId("confirm-quick-load");
      await modalAction.waitFor();
      const runtimeModal = await modalAction.evaluate((button) => ({
        background: getComputedStyle(button).backgroundColor,
        roleCustom: button.closest("[data-runtime-modal]")?.getAttribute("data-renpy-role-custom"),
        roleStyled: button.closest("[data-runtime-modal]")?.getAttribute("data-renpy-role-styled"),
        page: button.closest("[data-runtime-modal]")?.getAttribute("data-runtime-screen"),
      }));
      assert.equal(runtimeModal.background, "rgb(66, 82, 98)",
        `实际剧情 Runtime 弹窗必须消费 player 页面覆盖：${JSON.stringify(runtimeModal)}`);
      assert.equal(runtimeModal.roleCustom, "true");
      assert.equal(runtimeModal.page, "playing");
      report.cases.push({ case: "player-modal-role-editor-runtime-preview-inheritance",
        previewGeometry, savedShared: gui.shared.buttonRoles.modal_action.states.normal.backgroundColor,
        savedPlayer: gui.player.buttonRoles.modal_action.states.normal.backgroundColor, runtimeModal, status: "PASS" });
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=title-runtime-modal-preview")) {
      await page.getByRole("group", { name: "布局类型", exact: true })
        .locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.locator('.renpy-title-editor[data-editor-page="title"]').waitFor();
      await page.getByRole("combobox", { name: "按钮角色", exact: true }).click();
      await page.getByRole("option", { name: "弹窗操作", exact: true }).click();
      await page.getByRole("combobox", { name: "按钮样式范围", exact: true }).click();
      await page.getByRole("option", { name: "当前页面覆盖", exact: true }).click();
      await page.getByLabel("按钮背景色").fill("#273849");
      assert.equal(await page.getByTestId("renpy-title-button-role-source").innerText(), "覆盖",
        "标题页弹窗角色应显示为页面覆盖");
      assert.equal(await page.getByTestId("renpy-title-static-preview-toggle").getAttribute("aria-pressed"), "true",
        "标题页默认应保留可编辑的静态布局画布");
      assert.equal(await page.locator(".renpy-editor-runtime-viewport iframe").count(), 0,
        "进入标题页时不应预先挂载第二个 Runtime iframe");
      await page.getByTestId("renpy-title-runtime-preview-toggle").click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="title"][data-preview-phase="ready"]').waitFor({
        timeout: 30000,
      });
      const previewGeometry = [];
      for (const [width, height] of currentAcceptanceViewports()) {
        await page.setViewportSize({ width, height });
        const viewport = await page.locator(".renpy-editor-runtime-viewport").evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const iframe = node.querySelector("iframe");
          return { rect: rect.toJSON(), iframeInert: iframe?.inert,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        const workbench = await verifyGeometry(page);
        assert(viewport.rect.width > 0 && viewport.rect.height > 0
          && !viewport.iframeInert && viewport.overflow <= 1,
        `标题页Runtime预览在${width}×${height}须可交互且不溢出：${JSON.stringify(viewport)}`);
        previewGeometry.push({ width, height, viewport, workbench });
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.getByTestId("renpy-title-static-preview-toggle").click();
      await page.locator(".renpy-editor-runtime-viewport iframe").waitFor({ state: "detached" });
      await page.locator(".renpy-title-editor .renpy-editor-preview-stage").waitFor({ state: "visible" });
      await page.getByTestId("renpy-title-runtime-preview-toggle").click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="title"][data-preview-phase="ready"]').waitFor({
        timeout: 30000,
      });
      const preview = page.frameLocator(".renpy-editor-runtime-viewport iframe");
      await preview.getByTestId("open-exit-confirmation").click();
      const modal = preview.getByRole("dialog", { name: "退出游戏？" });
      await modal.waitFor();
      const action = modal.getByTestId("confirm-exit-game");
      const runtimeModal = await action.evaluate((button) => ({
        background: getComputedStyle(button).backgroundColor,
        roleCustom: button.closest("[data-runtime-modal]")?.getAttribute("data-renpy-role-custom"),
        rolePage: button.closest("[data-runtime-modal]")?.getAttribute("data-runtime-screen"),
      }));
      assert.equal(runtimeModal.background, "rgb(39, 56, 73)",
        `真实标题页退出弹窗应消费标题页角色覆盖：${JSON.stringify(runtimeModal)}`);
      assert.equal(runtimeModal.roleCustom, "true");
      assert.equal(runtimeModal.rolePage, "title_menu");
      report.cases.push({ case: "title-modal-role-real-runtime-preview",
        previewGeometry, previewToggleRoundTrip: "PASS", runtimeModal, status: "PASS" });
      report.status = "PASS";
      return;
    }
    if (process.argv.includes("--case=reload")) {
      await page.getByRole("group", { name: "布局类型", exact: true })
        .locator('[data-layout-type-option="renpy"]').click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      const reloadViewports = currentAcceptanceViewports();
      for (let attempt = 0; attempt < reloadViewports.length; attempt++) {
        const [width, height] = reloadViewports[attempt];
        // Reopen the isolated project on the desktop home surface, then
        // exercise the *cold layout task* at the acceptance viewport.
        await page.setViewportSize({ width: 1920, height: 1080 });
        await reloadAfterRequests(page);
        await page.waitForFunction(() => document.querySelector(".editor-toolbar")
          || document.querySelector(".recent-project-open:not(:disabled)"));
        if (!await page.locator(".editor-toolbar").isVisible())
          await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: title }).first().click();
        await page.locator(".editor-toolbar").waitFor();
        await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
        await page.setViewportSize({ width, height });
        await page.locator('[data-workspace-surface="options"]:visible').click();
        const profiler = await page.context().newCDPSession(page);
        await profiler.send("Performance.enable");
        const beforeMetrics = await profiler.send("Performance.getMetrics");
        if (process.env.PROFILE_CPU === "1") {
          await profiler.send("Profiler.enable");
          await profiler.send("Profiler.start");
        }
        await page.evaluate(() => {
          window.__layoutReloadFrames = [];
          const sample = () => {
            const root = document.querySelector(".runtime-layout-designer");
            const layer = document.querySelector('.advanced-tab-content[data-tab="layout"]');
            window.__layoutReloadFrames.push({ at: performance.now(),
              rootReady: root?.getAttribute("data-advanced-tab-ready"),
              type: root?.getAttribute("data-layout-type"), layer: layer?.className,
              inert: layer?.inert, hidden: layer?.getAttribute("aria-hidden"),
              phase: document.querySelector(".advanced-tools-panel")?.className });
            if (window.__layoutReloadFrames.length < 100)
              window.__layoutReloadTimer = setTimeout(sample, 100);
          };
          sample();
        });
        const started = Date.now();
        let elapsedMs, layoutDurationMs;
        try {
          await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
          await page.waitForFunction(() => {
            const layer = document.querySelector('.advanced-tab-content[data-tab="layout"]');
            return layer?.classList.contains("is-active") && !layer.inert;
          });
          await page.locator(".renpy-title-editor .runtime-layout-sidebar")
            .getByRole("button", { name: "关于", exact: true }).click();
          elapsedMs = Date.now() - started;
          assert(elapsedMs < 5000, `冷启动真实导航超出 5s 上限：${elapsedMs}ms`);
        } finally {
          await page.evaluate(() => clearTimeout(window.__layoutReloadTimer)).catch(() => {});
          const afterMetrics = await profiler.send("Performance.getMetrics");
          report.reloadMetrics ??= [];
          report.reloadMetrics.push({ attempt, before: beforeMetrics.metrics,
            after: afterMetrics.metrics });
          const metric = (metrics, name) => metrics.find(value => value.name === name)?.value ?? 0;
          layoutDurationMs = 1000 * (metric(afterMetrics.metrics, "LayoutDuration")
            - metric(beforeMetrics.metrics, "LayoutDuration"));
          if (process.env.PROFILE_CPU === "1") {
            const { profile } = await profiler.send("Profiler.stop");
            fs.writeFileSync(path.join(output, `reload-${attempt}.cpuprofile`), JSON.stringify(profile));
          }
          await profiler.detach();
        }
        assert(layoutDurationMs < 2000, `冷启动布局计算异常膨胀：${layoutDurationMs}ms`);
        assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-renpy-editor"), "about");
        await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
        const geometry = await verifyGeometry(page);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: path.join(output, `reload-${width}x${height}.png`) });
        report.cases.push({ case: "renpy-layout-reload-real-navigation", attempt, width, height,
          elapsedMs, layoutDurationMs, geometry,
          timeline: await page.evaluate(() => window.__layoutReloadFrames), status: "PASS" });
      }
      assert.equal(report.cases.length, reloadViewports.length, "冷启动验收不能使用空矩阵");
      report.status = "PASS";
      return;
    }
    const viewports = currentAcceptanceViewports(process.env.PROFILE_VIEWPORTS
      ? JSON.parse(process.env.PROFILE_VIEWPORTS) : process.env.PROFILE_FAST ? [[1920, 1080]] : undefined);
    assert(Array.isArray(viewports) && viewports.length > 0
      && viewports.every((viewport) => Array.isArray(viewport) && viewport.length === 2
        && viewport.every((value) => Number.isFinite(value) && value > 0)),
    "布局配置验收拒绝空矩阵或无效尺寸");
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      const xInput = await componentGeometryInput(page);
      await xInput.fill("11");
      const response = page.waitForResponse((res) => {
        if (!res.url().endsWith("/api/project/state") || res.request().method() !== "POST") return false;
        const layout = res.request().postDataJSON()?.project_metadata?.settings?.runtimeUILayout;
        return layout?.screens.find((s) => s.screen_id === "player")?.components.find((c) => c.component_id === "speaker_label")?.rect.x === 11;
      });
      await page.locator('[data-help-key="layout.save"]').click();
      const body = await (await response).json();
      assert(body.ok, "真实布局保存请求失败");
      const settings = body.data.project_metadata.settings;
      assert.deepEqual(settings.runtimeUILayoutProfiles.profiles.agentvn, settings.runtimeUILayout,
        "后端活动配置必须与刚保存的布局一致");
      assert.deepEqual(settings.runtimeUILayoutProfiles.profiles.renpy, inactive, "保存不得覆盖另一套布局");
      await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
      const geometry = await verifyGeometry(page);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, `${width}x${height}.png`) });
      report.cases.push({ width, height, geometry, status: "PASS" });
      await xInput.fill("12");
    }
    await reloadAfterRequests(page);
    await page.waitForFunction(() => document.querySelector(".editor-toolbar") || document.querySelector(".recent-project-open:not(:disabled)"));
    if (!await page.locator(".editor-toolbar").isVisible()) {
      await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: title }).first().click();
    }
    await openLayout(page);
    assert.equal(await (await componentGeometryInput(page)).inputValue(), "11",
      "刷新后的布局必须是保存值，而不是未保存草稿或旧配置");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await (await componentGeometryInput(page)).fill("13");
    await page.locator('[data-help-key="advanced.tab.theme"]:visible').click();
    await page.waitForFunction(() => {
      const active = document.querySelector(".advanced-tab-content.is-active[data-tab='theme']");
      const inactive = document.querySelector(".advanced-tab-content[data-tab='layout']");
      return active && !active.inert
        && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving")
        && (!inactive || (inactive.inert && inactive.getAttribute("aria-hidden") === "true"
          && getComputedStyle(inactive).pointerEvents === "none"
          && Number(getComputedStyle(inactive).opacity) <= .001));
    });
    const retainedDraftLayer = await page.evaluate(() => {
      const inactive = document.querySelector(".advanced-tab-content[data-tab='layout']");
      const control = inactive?.querySelector(".runtime-layout-inspector input");
      const rect = control?.getBoundingClientRect();
      return { mounted: Boolean(inactive), inert: inactive?.inert ?? true,
        ariaHidden: inactive?.getAttribute("aria-hidden") ?? null,
        ownsFocus: Boolean(inactive?.contains(document.activeElement)),
        hit: rect ? Boolean(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest(
          ".advanced-tab-content[data-tab='layout']")) : false };
    });
    assert(retainedDraftLayer.inert && !retainedDraftLayer.ownsFocus && !retainedDraftLayer.hit,
      `Inactive layout draft must surrender focus and real pointer input: ${JSON.stringify(retainedDraftLayer)}`);
    report.snapshots.push({ case: "retained-layout-draft-has-no-input-ownership", ...retainedDraftLayer, status: "PASS" });
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    await page.locator('.runtime-layout-component-list button[data-component-id="speaker_label"]').click();
    assert.equal(await (await componentGeometryInput(page)).inputValue(), "13",
      "离开布局页再返回应保留草稿");
    const layoutTypeSwitch = page.getByRole("group", { name: "布局类型", exact: true });
    await layoutTypeSwitch.locator('[data-layout-type-option="renpy"]').click();
    const confirmation = page.getByRole("dialog", { name: "切换布局类型？" });
    await confirmation.waitFor();
    assert.equal(await layoutTypeSwitch.getByRole("button", { name: "AgentVN", exact: true }).getAttribute("aria-pressed"), "true",
      "存在未保存草稿时，视觉和无障碍活动状态必须保持原布局直至用户确认");
    assert.equal(await layoutTypeSwitch.locator('[data-layout-type-option="renpy"]').getAttribute("aria-pressed"), "false");
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await (await componentGeometryInput(page)).inputValue(), "13",
      "取消切换必须保留草稿");
    assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-layout-type"), "agentvn");
    const chooseType = async (label) => layoutTypeSwitch.getByRole("button", { name: label, exact: true }).click();
    const waitType = (type) => page.locator(`.runtime-layout-designer[data-layout-type="${type}"]`).waitFor();
    const state = async () => (await (await page.request.get(`${backendUrl}/api/project/state`)).json()).data.project_metadata.settings;
    const speakerX = (layout) => layout.screens.find((s) => s.screen_id === "player").components.find((c) => c.component_id === "speaker_label").rect.x;
    const stableHeaderGeometry = () => page.evaluate(() => Object.fromEntries(
      ["header", ".runtime-layout-type-switch", '[data-help-key="layout.save"]']
        .map((selector, index) => {
          const element = index === 0 ? document.querySelector(".runtime-layout-header")
            : document.querySelector(selector);
          const rect = element.getBoundingClientRect();
          return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
        })));
    const typeSwitchPresentation = () => page.evaluate(() => {
      const group = document.querySelector(".runtime-layout-type-switch");
      const buttons = [...group.querySelectorAll("button")];
      const active = buttons.find((button) => button.getAttribute("aria-pressed") === "true");
      const inactive = buttons.find((button) => button.getAttribute("aria-pressed") !== "true");
      const rects = buttons.map((button) => {
        return {
          x: button.offsetLeft,
          y: button.offsetTop,
          width: button.offsetWidth,
          height: button.offsetHeight,
        };
      });
      const indicator = getComputedStyle(group, "::before");
      return {
        activeLabel: active?.textContent?.trim(),
        activeColor: getComputedStyle(active).color,
        inactiveColor: getComputedStyle(inactive).color,
        indicatorIndex: getComputedStyle(group).getPropertyValue("--layout-switch-index").trim(),
        transitionProperty: indicator.transitionProperty,
        transitionDuration: indicator.transitionDuration,
        rects,
      };
    });
    const renpySidebar = page.locator(".renpy-title-editor .runtime-layout-sidebar");
    const failureRoute = async (route) => {
      if (route.request().method() === "POST"
        && route.request().postDataJSON()?.project_metadata?.settings?.runtimeUILayoutProfiles?.activeType === "renpy") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "模拟布局保存失败" }) });
      } else await route.continue();
    };
    await page.route("**/api/project/state", failureRoute);
    await chooseType("Ren’Py");
    await confirmation.getByRole("button", { name: "保存并切换", exact: true }).click();
    await page.locator('.operation-result-dialog.is-error').waitFor();
    assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-layout-type"), "agentvn");
    assert.equal((await state()).runtimeUILayoutProfiles.activeType, "agentvn", "保存失败不能切换后端配置");
    await page.unroute("**/api/project/state", failureRoute);
    await confirmation.getByRole("button", { name: "保存并切换", exact: true }).click();
    await waitType("renpy");
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-renpy-editor"), "title",
      "Ren’Py 首次激活必须进入专用标题主页，而不是复用 AgentVN 播放页");
    await page.waitForTimeout(500);
    assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-layout-type"), "renpy",
      "布局保存确认后，AgentVN 的迟到写入不得把当前布局切回旧类型");
    const afterSaveSwitch = await state();
    report.snapshots.push({ step: "after-save-switch", backend: afterSaveSwitch,
      local: await page.evaluate(async () => (await import("/src/store/projectStore.ts")).useProjectStore.getState().settings) });
    assert.equal(speakerX(afterSaveSwitch.runtimeUILayoutProfiles.profiles.agentvn), 13, "保存并切换必须写入离开的草稿");
    assert.deepEqual(afterSaveSwitch.runtimeUILayoutProfiles.profiles.renpy, expectedActivatedRenpy,
      "激活目标布局须保存同一规范化结果，保留原参数并补齐类型、帮助页和最低Runtime版本");
    await renpySidebar.getByRole("button", { name: "选项", exact: true }).click();
    assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-renpy-editor"), "preferences");
    await page.getByRole("button", { name: "移动预览", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "移动预览", exact: true }).getAttribute("aria-pressed"), "true");
    for (const [width, height] of currentAcceptanceViewports()) {
      await page.setViewportSize({ width, height });
      const beforeSwitch = await stableHeaderGeometry();
      await chooseType("AgentVN");
      await waitType("agentvn");
      assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-active-screen"), "player",
        "AgentVN 必须恢复自己的页面选择状态");
      const agentPresentation = await typeSwitchPresentation();
      assert.equal(agentPresentation.activeLabel, "AgentVN");
      assert.notEqual(agentPresentation.activeColor, agentPresentation.inactiveColor,
        "活动与非活动布局类型必须有明确的文字对比");
      assert.equal(agentPresentation.indicatorIndex, "0", "活动高亮必须停留在 AgentVN 项");
      const agentZoom = page.locator(".runtime-layout-zoom-switch");
      await agentZoom.getByRole("button", { name: "75%", exact: true }).click();
      const agentGeometry = await stableHeaderGeometry();
      const agentPanes = await verifyGeometry(page);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, `type-agentvn-${width}x${height}.png`) });
      await chooseType("Ren’Py");
      await waitType("renpy");
      assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-renpy-editor"), "preferences",
        "Ren’Py 必须恢复自己的页面选择状态");
      assert.equal(await page.getByRole("button", { name: "移动预览", exact: true }).getAttribute("aria-pressed"), "true",
        "Ren’Py 必须恢复自己的预览设备模式");
      const renpyPresentation = await typeSwitchPresentation();
      assert.equal(renpyPresentation.activeLabel, "Ren’Py");
      assert.notEqual(renpyPresentation.activeColor, renpyPresentation.inactiveColor,
        "Ren’Py 活动态必须与 AgentVN 和非活动态明显区分");
      assert.equal(renpyPresentation.indicatorIndex, "1", "活动高亮必须切换到 Ren’Py 项");
      assert.deepEqual(renpyPresentation.rects, agentPresentation.rects,
        "活动态切换不得改变两个类型按钮的几何尺寸");
      const reduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
      report.snapshots.push({ case: "layout-switch-pointer-motion", width, height,
        preference: motionPreference, reduced, presentation: renpyPresentation });
      assert.equal(reduced, motionPreference === "reduce", "整轮矩阵必须保持请求的动效模式");
      const hasMovement = renpyPresentation.transitionProperty.split(",").map(value => value.trim()).includes("transform");
      const durations = renpyPresentation.transitionDuration.split(",").map(value => parseFloat(value));
      assert(hasMovement, "普通与减少动效模式均需连续高亮交接，而非瞬间闪现");
      assert(durations.some(value => value >= .18), "类型切换需要保留短时空间连续反馈");
      const renpyGeometry = await stableHeaderGeometry();
      const renpyPanes = await verifyGeometry(page);
      await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
      await page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]').getByTestId("settings-screen").waitFor();
      for (const selector of Object.keys(agentGeometry)) {
        for (const key of ["x", "y", "width", "height"]) {
          assert(Math.abs(agentGeometry[selector][key] - renpyGeometry[selector][key]) <= 1,
            `布局切换不能移动或改变工具栏 ${selector} ${key}: ${JSON.stringify({ agentGeometry, renpyGeometry })}`);
        }
      }
      if (width === 1920) {
        assert(Math.abs(beforeSwitch[".runtime-layout-type-switch"].width
          - renpyGeometry[".runtime-layout-type-switch"].width) <= 1,
        "类型切换栏必须常驻且固定几何");
      }
      report.cases.push({ case: "layout-switch-stable-workbench-and-independent-view-state",
        width, height, agentGeometry, renpyGeometry, agentPanes, renpyPanes,
        agentPresentation, renpyPresentation, status: "PASS" });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(output, `type-renpy-${width}x${height}.png`) });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedMotionPresentation = await typeSwitchPresentation();
    const agentTypeButton = layoutTypeSwitch.getByRole("button", { name: "AgentVN", exact: true });
    const renpyTypeButton = layoutTypeSwitch.locator('[data-layout-type-option="renpy"]');
    const reducedToAgent = await verifyTypeSwitchMotion(page, "agentvn", () => agentTypeButton.click());
    const reducedToRenpy = await verifyTypeSwitchMotion(page, "renpy", () => renpyTypeButton.click());
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const keyboardToAgent = await verifyTypeSwitchMotion(page, "agentvn", async () => {
      await agentTypeButton.focus();
      await agentTypeButton.press("Enter");
    });
    const keyboardPresentation = await typeSwitchPresentation();
    report.cases.push({ case: "layout-switch-reduced-motion-and-keyboard", reducedMotionPresentation,
      keyboardPresentation, reducedToAgent, reducedToRenpy, keyboardToAgent, status: "PASS" });
    await page.emulateMedia({ reducedMotion: motionPreference });
    await chooseType("Ren’Py");
    await waitType("renpy");
    assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-layout-type"), "renpy");
    await chooseType("AgentVN");
    await waitType("agentvn");
    assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-active-screen"), "player");
    assert.equal(await page.locator(".runtime-layout-zoom-switch [data-glass-selected='true']").textContent(), "75%",
      "AgentVN 必须恢复自己的画布缩放状态");
    await chooseType("Ren’Py");
    await waitType("renpy");
    assert.equal(await page.locator(".runtime-layout-designer").getAttribute("data-renpy-editor"), "preferences");
    await renpySidebar.getByRole("button", { name: "标题主页", exact: true }).click();
    if (process.env.RENPY_TITLE_ACCEPTANCE === "1") {
      await page.getByRole("button", { name: "标题主页", exact: true }).click();
      await page.getByTestId("renpy-title-editor").waitFor({ timeout: 5000 });
      await page.locator(".renpy-title-editor .runtime-layout-sidebar").getByRole("button", { name: "选项", exact: true }).click({ timeout: 5000 });
      await page.getByTestId("renpy-menu-editor").waitFor({ timeout: 5000 });
      await page.locator(".renpy-title-editor .runtime-layout-sidebar").getByRole("button", { name: "标题主页", exact: true }).click();
      for (const [width, height] of viewports) {
        await page.setViewportSize({ width, height });
        await page.getByRole("spinbutton", { name: "共享导航字号", exact: true }).fill("28");
        await page.getByRole("button", { name: "覆盖标题页字号", exact: true }).click();
        await page.getByRole("spinbutton", { name: "标题页导航字号", exact: true }).fill("32");
        assert.equal(await page.getByTestId("renpy-font-source").textContent(), "覆盖");
        await page.getByRole("button", { name: "恢复继承", exact: true }).click();
        assert.equal(await page.getByTestId("renpy-font-source").textContent(), "继承");
        const geometry = await verifyGeometry(page);
        const preview = page.getByTestId("renpy-title-view");
        const titleGeometry = await page.evaluate(() => {
          const container = document.querySelector(".runtime-layout-designer").getBoundingClientRect();
          const save = document.querySelector('[data-help-key="layout.save"]').getBoundingClientRect();
          const view = document.querySelector('[data-testid="renpy-title-view"]').getBoundingClientRect();
          const buttons = [...document.querySelectorAll('[data-testid="renpy-title-view"] button')]
            .map((el) => {
              const style = getComputedStyle(el);
              return { rect: el.getBoundingClientRect().toJSON(), clipped: el.scrollWidth > el.clientWidth + 1,
                borderWidth: style.borderTopWidth, background: style.backgroundColor, shadow: style.boxShadow };
            });
          return { container: container.toJSON(), save: save.toJSON(), view: view.toJSON(), buttons };
        });
        assert(titleGeometry.save.right <= titleGeometry.container.right + 1, "保存布局按钮被外层容器裁切");
        for (const button of titleGeometry.buttons) {
          assert.equal(button.borderWidth, "0px", "Editor真实标题预览应继承模板文字按钮，而非默认加框");
          assert.equal(button.background, "rgba(0, 0, 0, 0)", "Editor真实标题预览不得叠加默认底色");
          assert.equal(button.shadow, "none", "Editor真实标题预览不得叠加玻璃光晕");
          assert(!button.clipped && button.rect.left >= titleGeometry.view.left - 1
            && button.rect.right <= titleGeometry.view.right + 1 && button.rect.top >= titleGeometry.view.top - 1
            && button.rect.bottom <= titleGeometry.view.bottom + 1, "标题预览按钮越界或裁切");
        }
        await preview.getByRole("button", { name: "选项", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "预览：选项" }).waitFor();
        await page.screenshot({ path: path.join(output, `renpy-editor-${width}x${height}.png`) });
        report.cases.push({ case: "renpy-title-editor", width, height, geometry, titleGeometry, status: "PASS" });
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
      const sidebar = page.locator(".renpy-title-editor .runtime-layout-sidebar");
      const runtime = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
      const menuViewports = currentAcceptanceViewports(process.env.PROFILE_MENU_VIEWPORTS
        ? JSON.parse(process.env.PROFILE_MENU_VIEWPORTS) : viewports);
      for (const [width, height] of menuViewports) {
        await page.setViewportSize({ width, height });
        const workbench = await page.locator(".workspace-task-panel.advanced.is-layout-mode").evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            bounds: node.getBoundingClientRect().toJSON(),
            position: style.position,
            top: style.top,
            bottom: style.bottom,
            height: style.height,
            overflowY: style.overflowY,
          };
        });
        const workbenchBounds = workbench.bounds;
        const toolbarBounds = await page.locator(".editor-toolbar").boundingBox();
        assert(workbenchBounds.top >= toolbarBounds.y + toolbarBounds.height - 1
          && workbenchBounds.bottom <= height + 1 && workbenchBounds.height > 0,
          `工作台须保留顶部入口与节点栏，内容通过真实滚动到达，不能再回到旧全屏覆盖策略: ${JSON.stringify(workbench)}`);
        await page.waitForFunction(() => document.querySelector(".renpy-title-editor .renpy-editor-device-frame")
          ?.getAttribute("data-frame-phase") === "idle");
        const editorSurface = await page.locator(".renpy-title-editor").evaluate((editor) => {
          const rect = (selector, node = editor.querySelector(selector)) => {
            if (!node) return null;
            const box = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              selector,
              rect: box.toJSON(),
              display: style.display,
              flexDirection: style.flexDirection,
              position: style.position,
              overflow: style.overflow,
            };
          };
          const siblings = [".runtime-layout-sidebar", ".runtime-layout-center", ".runtime-layout-inspector"]
            .map((selector) => rect(selector));
          const previewToolbar = rect(".renpy-editor-preview-toolbar");
          const stageNode = editor.querySelector(".renpy-editor-preview-stage");
          const canvasNode = editor.querySelector(".renpy-editor-device-canvas");
          const previewStage = rect(".renpy-editor-preview-stage");
          const previewFrame = rect(".renpy-editor-device-frame");
          const previewCanvas = rect(".renpy-editor-device-canvas");
          const gridStyle = getComputedStyle(editor);
          const fit = stageNode && canvasNode ? {
            availableWidth: parseFloat(getComputedStyle(stageNode).width),
            availableHeight: parseFloat(getComputedStyle(stageNode).height),
            logicalWidth: parseFloat(getComputedStyle(canvasNode).width),
            logicalHeight: parseFloat(getComputedStyle(canvasNode).height),
            columnGap: parseFloat(gridStyle.columnGap) || 0,
          } : null;
          const ranges = siblings.flatMap((item) => item ? [item.rect] : []);
          const overlaps = [];
          for (let i = 0; i < ranges.length; i += 1) {
            for (let j = i + 1; j < ranges.length; j += 1) {
              const left = Math.max(ranges[i].left, ranges[j].left);
              const right = Math.min(ranges[i].right, ranges[j].right);
              const top = Math.max(ranges[i].top, ranges[j].top);
              const bottom = Math.min(ranges[i].bottom, ranges[j].bottom);
              if (right > left + 1 && bottom > top + 1) overlaps.push([i, j]);
            }
          }
          return {
            editor: rect(".renpy-title-editor", editor),
            grid: rect(".renpy-title-editor", editor),
            siblings,
            previewToolbar,
            previewStage, previewFrame, previewCanvas, fit,
            overlaps,
            documentOverflow: document.documentElement.scrollWidth - innerWidth,
          };
        });
        if (width <= 640) {
          assert.equal(editorSurface.editor.display, "flex",
            `窄屏 Ren’Py 编辑页必须改为单列流式布局，不能继续使用三列网格: ${JSON.stringify(editorSurface)}`);
          assert.equal(editorSurface.editor.flexDirection, "column",
            `窄屏 Ren’Py 编辑页必须按侧栏、画布、属性顺序纵向排列: ${JSON.stringify(editorSurface)}`);
          assert.equal(editorSurface.overlaps.length, 0,
            `窄屏 Ren’Py 编辑页的侧栏、画布和属性不得互相覆盖: ${JSON.stringify(editorSurface)}`);
          assert(editorSurface.documentOverflow <= 1,
            `窄屏 Ren’Py 编辑页不得产生页面横向溢出: ${JSON.stringify(editorSurface)}`);
        } else if (width >= 1920 && height >= 1080) {
          const [left, center, right] = editorSurface.siblings.map((item) => item.rect);
          assert.equal(editorSurface.editor.display, "grid",
            `1080p 及以上必须保留三栏工作台: ${JSON.stringify(editorSurface)}`);
          assert(left.right + 4 <= center.left && center.right + 4 <= right.left,
            `1080p 及以上侧栏、画布、属性必须并排且不重叠: ${JSON.stringify(editorSurface)}`);
          const { fit, previewStage, previewFrame, previewCanvas } = editorSurface;
          assert(fit && previewStage && previewFrame && previewCanvas, "缺少实际逻辑画布/等比预览层");
          const availableCenter = editorSurface.editor.rect.width - left.width - right.width - 2 * fit.columnGap;
          assert(center.width >= 480 && Math.abs(center.width - availableCenter) <= 1
            && center.height >= height * .6,
          `预览须完整使用保留节点栏/Inspector后的真实工作台剩余轨道，不沿用旧全屏1100px下限: ${JSON.stringify(editorSurface)}`);
          const expectedScale = Math.min(fit.availableWidth / fit.logicalWidth, fit.availableHeight / fit.logicalHeight);
          const expectedWidth = fit.logicalWidth * expectedScale;
          const expectedHeight = fit.logicalHeight * expectedScale;
          assert(Math.abs(previewFrame.rect.width - expectedWidth) <= 1
            && Math.abs(previewFrame.rect.height - expectedHeight) <= 1,
          `Runtime预览必须按实际可用区最大等比适配，不能使用固定小窗: ${JSON.stringify(editorSurface)}`);
          assert(Math.abs(previewCanvas.rect.width - previewFrame.rect.width) <= 1
            && Math.abs(previewCanvas.rect.height - previewFrame.rect.height) <= 1,
          "逻辑画布必须与实际游戏帧一致，不得重复缩放或裁切");
          assert(previewFrame.rect.left >= previewStage.rect.left - 1
            && previewFrame.rect.right <= previewStage.rect.right + 1
            && previewFrame.rect.top >= previewStage.rect.top - 1
            && previewFrame.rect.bottom <= previewStage.rect.bottom + 1, "预览越过可用舞台边界");
        }
        await sidebar.getByRole("button", { name: "选项", exact: true }).click();
        await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
        await runtime.getByTestId("settings-screen").waitFor();
        await page.getByRole("button", { name: "覆盖选项字号", exact: true }).click();
        await page.getByRole("spinbutton", { name: "选项导航字号", exact: true }).fill("32");
        await runtime.getByTestId("renpy-menu-navigation").getByTestId("renpy-menu-settings").waitFor();
        await page.waitForFunction(() => {
          const doc = document.querySelector('iframe[title="Ren\'Py（进阶）实际页面预览"]')?.contentDocument;
          const nav = doc?.querySelector('[data-testid="renpy-menu-navigation"] button');
          const frame = doc?.querySelector("[data-renpy-menu-frame]");
          return nav && frame && Math.abs(parseFloat(doc.defaultView.getComputedStyle(nav).fontSize)
            / Number(frame.dataset.renpyMenuScale) - 32) < .1;
        });
        await page.getByRole("button", { name: "恢复继承", exact: true }).click();
        await page.waitForFunction(() => {
          const doc = document.querySelector('iframe[title="Ren\'Py（进阶）实际页面预览"]')?.contentDocument;
          const nav = doc?.querySelector('[data-testid="renpy-menu-navigation"] button');
          const frame = doc?.querySelector("[data-renpy-menu-frame]");
          return nav && frame && Math.abs(parseFloat(doc.defaultView.getComputedStyle(nav).fontSize)
            / Number(frame.dataset.renpyMenuScale) - 28) < .1;
        });
        const geometry = await verifyGeometry(page);
        // The iframe is the actual Runtime at the chosen logical viewport;
        // its canvas transform is applied exactly once by the editor.
        const canvas = await page.locator(".renpy-editor-runtime-viewport").evaluate((viewport) => {
          const bounds = viewport.getBoundingClientRect();
          const frame = viewport.querySelector("iframe").getBoundingClientRect();
          return { bounds: bounds.toJSON(), frame: frame.toJSON() };
        });
        assert(canvas.frame.left >= canvas.bounds.left - 1 && canvas.frame.right <= canvas.bounds.right + 1
          && canvas.frame.top >= canvas.bounds.top - 1 && canvas.frame.bottom <= canvas.bounds.bottom + 1,
          "编辑器缩略 Runtime 必须同时按可用宽高缩放，不能裁掉下半画面");
        const previewGeometry = await runtime.getByTestId("renpy-menu-navigation").evaluate((nav) => {
          const root = nav.closest("[data-renpy-menu-frame]");
          const content = root.querySelector('[data-testid="renpy-menu-content"]').getBoundingClientRect();
          return { nav: nav.getBoundingClientRect().toJSON(), content: content.toJSON(),
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(previewGeometry.nav.right <= previewGeometry.content.left + 1 && previewGeometry.overflow <= 1,
          "真实编辑预览导航不得遮挡内容或横向溢出");
        await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
        await runtime.locator('[data-runtime-screen-transition="idle"]').waitFor();
        const input = runtime.getByLabel("High contrast text");
        const before = await input.isChecked();
        // The inspector follows the canvas in narrow/short layouts. Centering
        // the canvas keeps the actual Runtime clear of the sticky task toolbar.
        if (width <= 640 || height <= 480) {
          await page.locator(".renpy-editor-runtime-viewport")
            .evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
        }
        const canvasHit = await page.evaluate(() => {
          const frame = document.querySelector('.renpy-editor-runtime-viewport iframe');
          const input = frame?.contentDocument?.querySelector('input[aria-label="High contrast text"]');
          const outer = frame?.getBoundingClientRect();
          const inner = input?.getBoundingClientRect();
          if (!outer || !inner) return null;
          const x = outer.left + (inner.left + inner.width / 2) * outer.width / frame.clientWidth;
          const y = outer.top + (inner.top + inner.height / 2) * outer.height / frame.clientHeight;
          return { x, y, tag: document.elementFromPoint(x, y)?.tagName };
        });
        assert.equal(canvasHit?.tag, "IFRAME",
          `实际 Runtime 控件不能被宿主导航遮挡: ${JSON.stringify(canvasHit)}`);
        await input.click();
        assert.equal(await input.isChecked(), !before, "画布应能操作真实设置控件");
        await runtime.getByTestId("renpy-menu-history").click();
        await runtime.locator('[data-ui-screen="history"]').waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll(".renpy-title-editor .runtime-layout-sidebar button")]
          .some((node) => node.textContent.trim() === "历史" && node.getAttribute("aria-current") === "page"));
        await page.locator(".renpy-title-editor .runtime-layout-inspector")
          .getByRole("heading", { name: "历史 · 导航", exact: true }).waitFor();
        assert.equal(await page.locator(".renpy-title-editor").getAttribute("data-editor-page"), "history",
          "在实际 Runtime 预览中点击页面导航后，左侧选择、画布与右侧属性必须同步");
        await page.getByRole("button", { name: "移动预览", exact: true }).click();
        for (const [label, screen] of [["存档/读档", "save_load"], ["历史", "history"], ["关于", "about"], ["帮助", "help"], ["画廊", "gallery"]]) {
          await sidebar.getByRole("button", { name: label, exact: true }).click();
          await page.locator(`.renpy-editor-runtime-viewport[data-preview-page="${screen}"][data-preview-phase="ready"]`).waitFor();
          await runtime.locator(`[data-ui-screen="${screen}"]`).waitFor();
          if (screen === "help") {
            await page.getByLabel("帮助文字颜色", { exact: true }).fill("#12abcd");
            await page.waitForFunction(() => {
              const frame = document.querySelector(".renpy-editor-runtime-viewport iframe");
              return frame?.contentDocument?.querySelector(".help-card")?.style.color === "rgb(18, 171, 205)";
            });
            assert.equal(await page.getByTestId("renpy-help-color-source").textContent(), "覆盖");
          }
        }
        await page.getByRole("button", { name: "桌面预览", exact: true }).click();
        await page.mouse.move(0, 0);
        await page.screenshot({ path: path.join(output, `renpy-menu-editor-${width}x${height}.png`) });
        report.cases.push({ case: "renpy-menu-editor-runtime-inheritance", width, height, geometry, previewGeometry, status: "PASS" });
      }
      for (const [width, height] of menuViewports) {
        await page.setViewportSize({ width, height });
        await sidebar.getByRole("button", { name: "帮助", exact: true }).click();
        await page.getByLabel("帮助文字颜色", { exact: true }).fill("#12abcd");
        await page.getByRole("button", { name: "覆盖帮助字号", exact: true }).click();
        await page.getByRole("spinbutton", { name: "帮助导航字号", exact: true }).fill("24");
        await page.getByLabel("帮助面板颜色", { exact: true }).fill("#233445");
        await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
        const helpReset = page.getByRole("group", { name: "确认重置帮助", exact: true });
        await helpReset.getByRole("button", { name: "取消", exact: true }).click();
        assert.equal(await page.getByTestId("renpy-font-source").textContent(), "覆盖",
          "取消帮助页重置必须保留导航覆盖");
        assert.equal(await page.getByTestId("renpy-help-color-source").textContent(), "覆盖",
          "取消帮助页重置必须保留内容颜色覆盖");
        await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
        await helpReset.getByRole("button", { name: "确认重置", exact: true }).click();
        assert.equal(await page.getByTestId("renpy-font-source").textContent(), "继承",
          "重置帮助页必须恢复导航继承");
        assert.equal(await page.getByTestId("renpy-help-color-source").textContent(), "主题继承",
          "重置帮助页必须同时恢复内容文字颜色继承，不仅清除导航覆盖");
        assert.equal(await page.getByTestId("renpy-help-backgroundColor-source").textContent(), "主题继承",
          "重置帮助页必须同时恢复面板颜色继承");
        const helpResetGeometry = await verifyGeometry(page);
        report.cases.push({ case: "help-color-and-navigation-reset-cancel-confirm", width, height,
          geometry: helpResetGeometry, status: "PASS" });
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
      await sidebar.getByRole("button", { name: "存档/读档", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="save_load"][data-preview-phase="ready"]').waitFor();
      await page.getByTestId("renpy-save-grid-columns-source").waitFor();
      await page.getByTestId("renpy-save-grid-gap-source").waitFor();
      const saveLoadRuntime = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
      const saveGrid = saveLoadRuntime.getByTestId("save-slot-grid");
      assert.equal(await page.getByRole("spinbutton", { name: "共享存档网格列数", exact: true }).inputValue(), "2",
        "旧工程未启用新结构字段时，编辑控件必须显示旧组件基准而非模板三列");
      assert.equal(await page.getByRole("spinbutton", { name: "共享存档网格间距", exact: true }).inputValue(), "30");
      assert.equal(await page.getByLabel("存档列数继承值", { exact: true }).textContent(), "2");
      assert.equal(await page.getByLabel("存档间距继承值", { exact: true }).textContent(), "30");
      await waitSaveGrid(page, 2, 30);
      await page.getByRole("button", { name: "覆盖存档列数", exact: true }).click();
      assert.equal(await page.getByRole("spinbutton", { name: "存档网格列数", exact: true }).inputValue(), "2",
        "创建覆盖必须从真实继承值起步");
      await page.getByRole("spinbutton", { name: "存档网格列数", exact: true }).fill("4");
      await waitSaveGrid(page, 4, 30);
      await page.getByRole("button", { name: "恢复存档列数继承", exact: true }).click();
      await waitSaveGrid(page, 2, 30);
      report.cases.push({ case: "legacy-save-grid-editor-inherited-values-and-partial-override", status: "PASS" });
      await page.getByRole("spinbutton", { name: "共享存档网格列数", exact: true }).fill("5");
      await page.getByRole("spinbutton", { name: "共享存档网格间距", exact: true }).fill("18");
      await waitSaveGrid(page, 5, 18);
      const sharedGridPresentation = await saveGrid.evaluate((grid) => {
        const style = getComputedStyle(grid);
        return {
          columns: style.gridTemplateColumns.split(" ").length,
          gap: parseFloat(style.gap),
          columnsAttribute: grid.getAttribute("data-renpy-save-columns"),
          gapAttribute: grid.getAttribute("data-renpy-save-gap"),
          inlineStyle: grid.getAttribute("style"),
        };
      });
      assert(sharedGridPresentation.columns === 5 && Math.abs(sharedGridPresentation.gap - 18) < 0.1,
        `共享存档网格设置必须同步到真实 Runtime: ${JSON.stringify(sharedGridPresentation)}`);
      await page.getByRole("button", { name: "覆盖存档列数", exact: true }).click();
      await page.getByRole("button", { name: "覆盖存档间距", exact: true }).click();
      await page.getByRole("spinbutton", { name: "存档网格列数", exact: true }).waitFor();
      await page.getByRole("spinbutton", { name: "存档网格间距", exact: true }).waitFor();
      await page.getByRole("spinbutton", { name: "存档网格列数", exact: true }).fill("4");
      await page.getByRole("spinbutton", { name: "存档网格间距", exact: true }).fill("20");
      await waitSaveGrid(page, 4, 20);
      const gridViewports = currentAcceptanceViewports(process.env.PROFILE_GRID_VIEWPORTS
        ? JSON.parse(process.env.PROFILE_GRID_VIEWPORTS) : menuViewports);
      assert(Array.isArray(gridViewports) && gridViewports.length > 0
        && gridViewports.every(size => Array.isArray(size) && size.length === 2
          && size.every(value => Number.isFinite(value) && value > 0)), "存档网格验收拒绝空矩阵");
      for (const [width, height] of gridViewports) {
        await page.setViewportSize({ width, height });
        for (const device of ["桌面预览", "移动预览"]) {
          await page.getByRole("button", { name: device, exact: true }).click();
          await waitSaveGrid(page, 4, 20);
          await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
          const geometry = await assertSaveGridGeometry(page);
          const inspectorGeometry = await verifyGeometry(page);
          if (width <= 640 || height <= 480) {
            await page.locator('iframe[title="Ren\'Py（进阶）实际页面预览"]')
              .evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
            await page.evaluate(() => new Promise(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))));
          }
          const automatic = saveLoadRuntime.getByRole("tab", { name: "自动", exact: true });
          const innerButton = await automatic.evaluate(node => {
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return { ...rect.toJSON(), hit: hit === node || node.contains(hit) };
          });
          const locatorBox = await automatic.boundingBox();
          const pointerGeometry = await page.locator('iframe[title="Ren\'Py（进阶）实际页面预览"]').evaluate((frame, { inner, box }) => {
            const outer = frame.getBoundingClientRect();
            const mapped = { x: outer.left + (inner.left + inner.width / 2) * outer.width / frame.clientWidth,
              y: outer.top + (inner.top + inner.height / 2) * outer.height / frame.clientHeight };
            const describe = point => {
              const hit = document.elementFromPoint(point.x, point.y);
              return { ...point, tag: hit?.tagName, text: hit?.textContent?.slice(0, 80),
                helpKey: hit?.closest("[data-help-key]")?.getAttribute("data-help-key") };
            };
            const mappedTarget = describe(mapped);
            const ancestors = [];
            if (mappedTarget.tag !== "IFRAME") {
              for (let node = frame.parentElement; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                ancestors.push({ tag: node.tagName, className: typeof node.className === "string" ? node.className : "",
                  rect: node.getBoundingClientRect().toJSON(), scrollTop: node.scrollTop,
                  scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
                  overflowY: style.overflowY, position: style.position });
              }
            }
            return { frame: outer.toJSON(), inner, locatorBox: box, mapped: mappedTarget,
              ancestors,
              locatorCenter: box ? describe({ x: box.x + box.width / 2, y: box.y + box.height / 2 }) : null };
          }, { inner: innerButton, box: locatorBox });
          report.snapshots.push({ case: "save-tab-pointer-geometry", width, height, device, pointerGeometry });
          assert(innerButton.hit, "iframe 内部必须命中目标分类控件");
          assert.equal(pointerGeometry.mapped.tag, "IFRAME",
            `真实控件必须在宿主中可命中，不能被导航/留白区域遮挡: ${JSON.stringify(pointerGeometry)}`);
          assert.equal(pointerGeometry.locatorCenter?.tag, "IFRAME", "浏览器自动化实际落点必须命中 iframe");
          await automatic.click();
          await saveLoadRuntime.getByRole("tab", { name: "自动", exact: true, selected: true }).waitFor();
          assert.equal(await automatic.getAttribute("aria-selected"), "true", "预览内真实存档分类按钮必须可点");
          assert.equal(await saveGrid.locator(".save-slot").count(), 6,
            "自动存档网格必须按每页六槽呈现");
          await saveLoadRuntime.getByTestId("save-page-next").click();
          await saveLoadRuntime.getByTestId("save-slot-auto-7").waitFor();
          assert.deepEqual(await saveGrid.locator("[data-testid^='save-slot-auto-']").evaluateAll(nodes =>
            nodes.map(node => node.getAttribute("data-testid"))),
          ["save-slot-auto-7", "save-slot-auto-8"], "自动档第二页必须保留稳定的 7/8 槽位");
          assert.equal(await saveGrid.locator(".save-slot").count(), 2);
          await saveLoadRuntime.getByTestId("save-page-previous").click();
          await saveLoadRuntime.getByTestId("save-slot-auto-1").waitFor();
          await saveLoadRuntime.getByRole("tab", { name: "手动", exact: true }).click();
          await saveLoadRuntime.getByRole("tab", { name: "手动", exact: true, selected: true }).waitFor();
          assert.equal(await saveGrid.locator(".save-slot").count(), 6);
          await saveLoadRuntime.getByTestId("save-page-next").click();
          await saveLoadRuntime.getByTestId("save-slot-manual-7").waitFor();
          assert.equal(await saveGrid.locator(".save-slot").count(), 6);
          await saveLoadRuntime.getByTestId("save-page-previous").click();
          await saveLoadRuntime.getByTestId("save-slot-manual-1").waitFor();
          await page.screenshot({ path: path.join(output, `save-grid-${width}x${height}-${device}.png`) });
          report.cases.push({ case: "save-grid-page-structure-runtime-parity", width, height, device,
            geometry, inspectorGeometry, status: "PASS" });
        }
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.getByRole("button", { name: "桌面预览", exact: true }).click();
      assert.equal(await page.getByTestId("renpy-save-grid-columns-source").textContent(), "覆盖");
      assert.equal(await page.getByTestId("renpy-save-grid-gap-source").textContent(), "覆盖");
      await page.getByRole("button", { name: "恢复存档列数继承", exact: true }).click();
      await page.getByRole("button", { name: "恢复存档间距继承", exact: true }).click();
      await waitSaveGrid(page, 5, 18);
      assert.equal(await page.getByTestId("renpy-save-grid-columns-source").textContent(), "继承");
      assert.equal(await page.getByTestId("renpy-save-grid-gap-source").textContent(), "继承");
      await page.getByRole("button", { name: "覆盖存档列数", exact: true }).click();
      await page.getByRole("button", { name: "覆盖存档间距", exact: true }).click();
      await page.getByRole("spinbutton", { name: "存档网格列数", exact: true }).fill("4");
      await page.getByRole("spinbutton", { name: "存档网格间距", exact: true }).fill("20");
      await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
      const saveReset = page.getByRole("group", { name: "确认重置存档/读档", exact: true });
      assert.match(await saveReset.innerText(), /网格结构/, "确认文字必须说明结构参数会被重置");
      await saveReset.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(await page.getByTestId("renpy-save-grid-columns-source").textContent(), "覆盖");
      await waitSaveGrid(page, 4, 20);
      await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
      await saveReset.getByRole("button", { name: "确认重置", exact: true }).click();
      assert.equal(await page.getByTestId("renpy-save-grid-columns-source").textContent(), "继承");
      assert.equal(await page.getByTestId("renpy-save-grid-gap-source").textContent(), "继承");
      await waitSaveGrid(page, 5, 18);
      report.cases.push({ case: "save-grid-live-inheritance-and-reset-cancel-confirm", status: "PASS" });
      await sidebar.getByRole("button", { name: "帮助", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="help"][data-preview-phase="ready"]').waitFor();
      await page.getByLabel("帮助文字颜色", { exact: true }).fill("#12abcd");
      await sidebar.getByRole("button", { name: "关于", exact: true }).click();
      await page.getByRole("button", { name: "覆盖关于字号", exact: true }).click();
      await page.getByRole("spinbutton", { name: "关于导航字号", exact: true }).fill("31");
      await page.getByRole("button", { name: "覆盖关于左边距", exact: true }).click();
      await page.getByRole("spinbutton", { name: "关于导航左边距", exact: true }).fill("76");
      await sidebar.getByRole("button", { name: "选项", exact: true }).click();
      await page.getByRole("button", { name: "覆盖选项间距", exact: true }).click();
      await page.getByRole("spinbutton", { name: "选项导航间距", exact: true }).fill("12");
      await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
      await page.getByRole("group", { name: "确认重置选项", exact: true }).getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(await page.getByRole("spinbutton", { name: "选项导航间距", exact: true }).inputValue(), "12");
      await page.getByRole("button", { name: "重置当前页布局", exact: true }).click();
      await page.getByRole("group", { name: "确认重置选项", exact: true }).getByRole("button", { name: "确认重置", exact: true }).click();
      assert.equal(await page.getByTestId("renpy-spacing-source").textContent(), "继承");
      await page.locator('[data-help-key="layout.save"]').click();
      await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
      const savedRenpy = (await state()).runtimeUILayoutProfiles.profiles.renpy;
      assert.equal(savedRenpy.renpy.shared.fontSize, 28);
      assert.equal(savedRenpy.renpy.title?.fontSize, undefined);
      assert.equal(savedRenpy.renpy.about.fontSize, 31);
      assert.equal(savedRenpy.renpy.about.x, 76, "重置选项页不能清除关于页覆盖");
      assert.equal(savedRenpy.renpy.help?.fontSize, undefined, "帮助导航覆盖不能借用关于页值");
      assert.equal(savedRenpy.renpy.shared.saveColumns, 5, "共享存档网格列数必须随活动布局保存");
      assert.equal(savedRenpy.renpy.shared.saveGap, 18, "共享存档网格间距必须随活动布局保存");
      assert.equal(savedRenpy.renpy.save_load?.saveColumns, undefined, "恢复继承后不得留下页面列数覆盖");
      assert.equal(savedRenpy.renpy.save_load?.saveGap, undefined, "恢复继承后不得留下页面间距覆盖");
      assert.equal(savedRenpy.screens.find((screen) => screen.screen_id === "help").components[0].style.color, "#12abcd",
        "帮助面板覆盖必须单独保存");
      assert.equal(savedRenpy.renpy.preferences?.fontSize, undefined);
      assert.deepEqual((await state()).runtimeUILayoutProfiles.profiles.agentvn,
        afterSaveSwitch.runtimeUILayoutProfiles.profiles.agentvn, "专用编辑页不得污染另一布局");
      await reloadAfterRequests(page);
      await page.waitForFunction(() => document.querySelector(".editor-toolbar") || document.querySelector(".recent-project-open:not(:disabled)"));
      if (!await page.locator(".editor-toolbar").isVisible())
        await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: title }).first().click();
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.locator('.advanced-tab-content.is-active[data-tab="layout"][aria-hidden="false"]').waitFor();
      await page.locator(".renpy-title-editor .runtime-layout-sidebar")
        .getByRole("button", { name: "关于", exact: true }).click();
      assert.equal(await page.getByRole("spinbutton", { name: "关于导航字号", exact: true }).inputValue(), "31",
        "菜单页面覆盖保存重启后必须保留");
      await page.locator(".renpy-title-editor .runtime-layout-sidebar")
        .getByRole("button", { name: "帮助", exact: true }).click();
      assert.equal(await page.getByTestId("renpy-help-color-source").textContent(), "覆盖",
        "帮助样式覆盖保存重启后仍须保留");
      await page.locator(".renpy-title-editor .runtime-layout-sidebar")
        .getByRole("button", { name: "存档/读档", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-page="save_load"][data-preview-phase="ready"]').waitFor();
      assert.equal(await page.getByRole("spinbutton", { name: "共享存档网格列数", exact: true }).inputValue(), "5");
      assert.equal(await page.getByRole("spinbutton", { name: "共享存档网格间距", exact: true }).inputValue(), "18");
      await waitSaveGrid(page, 5, 18);
      report.cases.push({ case: "save-grid-persisted-backend-and-real-preview-after-restart", status: "PASS" });
      await page.getByRole("button", { name: "标题主页", exact: true }).click();
      assert.equal(await page.getByRole("spinbutton", { name: "共享导航字号", exact: true }).inputValue(), "28",
        "专用编辑页保存值必须在重启后保留");
      // Keep the generic Stage 1 dirty/discard assertions relative to this saved baseline.
      expectedActivatedRenpy = structuredClone(savedRenpy);
      await page.getByTestId("renpy-player-layout-entry").click();
    }
    await chooseType("AgentVN");
    await waitType("agentvn");
    await page.locator('.runtime-layout-component-list button[data-component-id="speaker_label"]').click();
    await (await componentGeometryInput(page)).fill("21");
    await chooseType("Ren’Py");
    await confirmation.getByRole("button", { name: "放弃并切换", exact: true }).click();
    await waitType("renpy");
    const afterDiscard = await state();
    report.snapshots.push({ step: "after-discard", backend: afterDiscard,
      local: await page.evaluate(async () => (await import("/src/store/projectStore.ts")).useProjectStore.getState().settings) });
    assert.deepEqual(afterDiscard.runtimeUILayoutProfiles.profiles.renpy, expectedActivatedRenpy,
      "放弃只能丢弃当前草稿，不得覆盖目标布局已保存的规范化配置");
    assert.equal(speakerX(afterDiscard.runtimeUILayout), speakerX(expectedActivatedRenpy),
      "放弃切换必须恢复目标布局的已保存快照");
    assert.equal(speakerX(afterDiscard.runtimeUILayoutProfiles.profiles.agentvn), 13,
      "放弃切换不能污染已保存的 AgentVN 布局");
    await chooseType("AgentVN");
    await waitType("agentvn");
    assert.equal(speakerX((await state()).runtimeUILayout), 13,
      "切回 AgentVN 后必须恢复已保存布局，而不是被放弃的草稿");
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await chooseType("Ren’Py"); await waitType("renpy");
      await chooseType("AgentVN"); await waitType("agentvn");
      report.cases.push({ case: "type-switch-real-click", width, height, status: "PASS" });
    }
    report.cases.push({ case: "dirty-cancel-save-failure-retry-discard", status: "PASS" });
    await page.addScriptTag({ content: cartridgeIO });
    const portable = await page.evaluate(async (projectFixture) => {
      const { buildProjectBundle, readProjectJsonFromBundle } = await import("/src/utils/projectBundle.ts");
      const { exportEditorCartridge } = await import("/src/cartridge/exportCartridge.ts");
      const { exportScript } = await import("/src/utils/exportScript.ts");
      const { manifestAssetsFromProjectAssets } = await import("/src/utils/projectAssets.ts");
      const { loadCartridgeFromFile, disposeAssetBlobUrls } = window.ProfileCartridgeIO;
      const project = structuredClone(projectFixture);
      const assets = ["active-art", "inactive-art"].map((id, index) => {
        const text = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${index ? "#ff0000" : "#00ff00"}"/></svg>`;
        return { asset_id: id, asset_type: "ui", metadata: {
          filename: `${id}.svg`, mime_type: "image/svg+xml", source: "imported",
          data_url: `data:image/svg+xml;base64,${btoa(text)}`, width: 4, height: 4,
        } };
      });
      project.asset_manifest = assets;
      const profiles = project.editor_settings.runtimeUILayoutProfiles;
      for (const [type, id] of [["agentvn", "active-art"], ["renpy", "inactive-art"]]) {
        profiles.profiles[type].screens.find((s) => s.screen_id === "player")
          .components.find((c) => c.component_id === "dialog_panel").style.backgroundImage = `asset:${id}`;
      }
      project.editor_settings.runtimeUILayout = structuredClone(profiles.profiles.agentvn);
      const blob = await buildProjectBundle(project);
      const reopened = await readProjectJsonFromBundle(new File([blob], "双布局工程.vnproj"));
      const input = {
        script: exportScript(reopened.nodes, reopened.edges), gameId: "layout-profiles-export",
        title: "布局导出回归", author: "QA", version: "1.0.0", language: "zh-CN", description: "",
        includeGallery: false, includeMetadata: false, projectAssetRefs: reopened.asset_manifest,
        projectAssets: manifestAssetsFromProjectAssets(reopened.asset_manifest),
        // Deliberately stale: the active profile must remain the authority.
        uiSkin: reopened.editor_settings.runtimeUILayoutProfiles.profiles.renpy,
        uiLayoutProfiles: reopened.editor_settings.runtimeUILayoutProfiles,
      };
      const packed = await exportEditorCartridge(input);
      const cartridge = await loadCartridgeFromFile(new File([packed.blob], "活动布局.vncart"), { runtimeVersion: "0.7.0" });
      const activeBytes = cartridge.assetBlobUrls["active-art"]
        ? await (await fetch(cartridge.assetBlobUrls["active-art"])).text() : null;
      const result = {
        reopenedSettings: reopened.editor_settings,
        originalSettings: project.editor_settings,
        reopenedAssetIds: reopened.asset_manifest.map((a) => a.asset_id),
        cartridgeLayout: cartridge.uiSkin,
        cartridgeAssetIds: cartridge.manifest.assets.map((a) => a.asset_id),
        activeBytes, errors: packed.errors,
        projectBytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        cartridgeBytes: Array.from(new Uint8Array(await packed.blob.arrayBuffer())),
      };
      disposeAssetBlobUrls(cartridge.assetBlobUrls);
      disposeAssetBlobUrls(cartridge.uiAssetBlobUrls ?? {});
      return result;
    }, { ...fixture(), editor_settings: await state() });
    fs.writeFileSync(path.join(output, "roundtrip.vnproj"), Buffer.from(portable.projectBytes));
    fs.writeFileSync(path.join(output, "active-layout.vncart"), Buffer.from(portable.cartridgeBytes));
    assert.deepEqual(portable.reopenedSettings, portable.originalSettings, "便携工程必须完整保留两套配置");
    if (process.env.RENPY_TITLE_ACCEPTANCE === "1") {
      const gridGUI = portable.reopenedSettings.runtimeUILayoutProfiles.profiles.renpy.renpy;
      assert.equal(gridGUI.shared.saveColumns, 5, ".vnproj 重开必须保留新共享网格列数");
      assert.equal(gridGUI.shared.saveGap, 18, ".vnproj 重开必须保留新共享网格间距");
      assert.equal(gridGUI.save_load?.saveColumns, undefined, ".vnproj 不得自动补回已经恢复继承的覆盖");
    }
    assert.deepEqual(portable.reopenedAssetIds.sort(), ["active-art", "inactive-art"], "便携工程必须保存两套素材");
    assert.deepEqual(portable.errors, [], "卡带导出不能有校验错误");
    assert.equal(portable.cartridgeLayout.name, original.name, "卡带必须使用活动配置，而非过时兼容字段");
    assert.deepEqual(portable.cartridgeAssetIds, ["active-art"], "卡带不能包含另一套布局独占素材");
    assert(portable.activeBytes.includes("#00ff00"), "卡带必须实际包含活动素材字节");
    report.cases.push({ case: "portable-project-roundtrip-active-cartridge-bytes", status: "PASS" });
    await Promise.all(diagnosticTasks);
    const expectedSaveFailureUrl = `${backendUrl}/api/project/state`;
    assert.deepEqual(report.failedResponses, [{
      url: expectedSaveFailureUrl,
      status: 500,
      statusText: "Internal Server Error",
      method: "POST",
      resourceType: "fetch",
      body: JSON.stringify({ detail: "模拟布局保存失败" }),
    }], "只能出现本用例有意注入且由 UI 正确处理的布局保存失败响应");
    assert.deepEqual(report.failedRequests, [], "不得有网络请求意外失败");
    const expectedSaveFailureConsole = errors.filter((error) =>
      error.type === "console"
      && error.message === "Failed to load resource: the server responded with a status of 500 (Internal Server Error)"
      && error.location?.url === expectedSaveFailureUrl);
    assert.equal(expectedSaveFailureConsole.length, 1,
      "浏览器仅可记录与已断言保存失败响应对应的一条资源错误");
    assert.deepEqual(errors.filter((error) => !expectedSaveFailureConsole.includes(error)), [],
      "不得有未处理的控制台或页面异常");
    report.cases.push({ case: "only-declared-save-failure-is-allowed", status: "PASS" });
    report.status = "PASS";
    });
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    report.failureState = await page?.evaluate(async () => {
      const store = await import("/src/store/projectStore.ts");
      const root = document.querySelector(".runtime-layout-designer");
      return {
        errorBoundary: (() => {
          const boundary = document.querySelector(".app-error-boundary");
          const details = boundary?.querySelector("details");
          if (details) details.open = true;
          return boundary?.innerText ?? null;
        })(),
        root: root ? {
          className: root.className, layoutType: root.getAttribute("data-layout-type"),
          screen: root.getAttribute("data-active-screen"), renpyScreen: root.getAttribute("data-renpy-editor"),
          inert: root.inert, busy: root.getAttribute("aria-busy"),
          ancestors: (() => {
            const items = [];
            for (let element = root; element; element = element.parentElement)
              items.push({ tag: element.tagName, className: element.className,
                tab: element.getAttribute("data-tab"), phase: element.getAttribute("data-advanced-tab-ready"),
                inert: element.inert, hidden: element.getAttribute("aria-hidden"),
                opacity: getComputedStyle(element).opacity, display: getComputedStyle(element).display });
            return items;
          })(),
        } : null,
        settings: store.useProjectStore.getState().settings.runtimeUILayoutProfiles,
        controls: [...document.querySelectorAll(".runtime-layout-type-switch button")].map(button => ({
          text: button.textContent, pressed: button.getAttribute("aria-pressed"), disabled: button.disabled,
        })),
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map(dialog => ({
          text: dialog.textContent?.slice(0, 400), className: dialog.className,
        })),
        reloadTimeline: window.__layoutReloadFrames,
      };
    }).catch(diagnosticError => ({ error: String(diagnosticError) }));
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    await playerServer?.stop();
    await env?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
