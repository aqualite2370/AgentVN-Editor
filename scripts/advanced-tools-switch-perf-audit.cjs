const fs = require("fs");
const path = require("path");
const { chromium } = require("../editor/node_modules/playwright");
const {
  resolveAcceptancePaths,
  startEditorAcceptance,
} = require("./lib/editor-ui-acceptance.cjs");

const ROOT = path.resolve(__dirname, "..");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const defaultOutput = path.join(ROOT, "output", "playwright", "advanced-tools-switch-perf", RUN_ID);
const { output: OUT_DIR } = resolveAcceptancePaths({ output: defaultOutput });
const REPORT_PATH = path.join(OUT_DIR, "advanced-tools-switch-perf-audit.json");

const allViewports = [
  { label: "desktop-1440", width: 1440, height: 1000, frameGapMs: 80 },
  { label: "laptop-1280", width: 1280, height: 720, frameGapMs: 120 },
];

const allVariants = [
  { id: "baseline", label: "baseline", css: "" },
  {
    id: "no-popover-morph",
    label: "disable popover morph",
    css: `
      .toolbar-popover.is-morphing {
        animation: none !important;
        transition: none !important;
        transform: none !important;
        opacity: 1 !important;
      }
    `,
  },
  {
    id: "no-tab-animation",
    label: "disable advanced tab animation",
    css: `
      .advanced-tools-panel.is-tab-leaving .advanced-tab-content,
      .advanced-tools-panel.is-tab-entering .advanced-tab-content,
      .advanced-tab-viewport {
        animation: none !important;
        transition: none !important;
        transform: none !important;
        opacity: 1 !important;
      }
    `,
  },
  {
    id: "no-global-transition",
    label: "disable global transition",
    css: `
      body *,
      body *::before,
      body *::after {
        transition: none !important;
      }
    `,
  },
];
const thresholdToleranceMs = 5;
const longTaskToleranceMs = 15;

function selectedItems(items, envName, key) {
  const raw = process.env[envName]?.trim();
  if (!raw) return items;
  const selected = new Set(raw.split(",").map((item) => item.trim()).filter(Boolean));
  return items.filter((item) => selected.has(item[key]));
}

const viewports = selectedItems(allViewports, "AGENTVN_PERF_VIEWPORTS", "label");
const variants = selectedItems(allVariants, "AGENTVN_PERF_VARIANTS", "id");

const tabs = {
  settings: { selector: ".advanced-tab-content.is-active .project-settings-panel", wide: false },
  providers: { selector: ".advanced-tab-content.is-active .provider-settings-panel", wide: false },
  library: { selector: ".advanced-tab-content.is-active .asset-library-panel", wide: false },
  assets: { selector: ".advanced-tab-content.is-active .asset-generation-panel", wide: true },
  layout: { selector: ".advanced-tab-content.is-active .runtime-layout-designer", wide: true },
  theme: { selector: ".advanced-tab-content.is-active .runtime-theme-designer", wide: true },
  animation: { selector: ".advanced-tab-content.is-active .animation-editor-shell", wide: true },
};

const tabSequence = ["providers", "library", "assets", "layout", "theme", "animation", "settings"];
const rounds = 3;

fs.mkdirSync(OUT_DIR, { recursive: true });

function basenameFromUrl(value) {
  try {
    const url = new URL(value);
    return path.basename(url.pathname);
  } catch {
    return path.basename(String(value).split("?")[0]);
  }
}

async function waitForCenterHit(page, selector, timeout = 15_000) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout });
  await page.waitForFunction((targetSelector) => {
    const el = document.querySelector(targetSelector);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity || "1") <= 0.01) return false;
    const x = Math.min(innerWidth - 1, Math.max(1, rect.left + rect.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));
  }, selector, { timeout });
}

async function openAdvancedSettings(page) {
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60_000 });
  const optionsButton = page.locator('[data-workspace-surface="options"]:visible').first();
  await optionsButton.waitFor({ state: "visible", timeout: 30_000 });
  await optionsButton.click();
  await page.locator(".toolbar-popover.advanced.is-open").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".advanced-tools-panel.is-tab-idle").waitFor({ state: "visible", timeout: 30_000 });
  await switchToTab(page, "settings", { measure: false });
}

async function installRuntimeVariant(page, variant) {
  if (!variant.css.trim()) return;
  await page.addStyleTag({ content: variant.css });
}

async function installPerformanceProbe(page) {
  await page.evaluate(() => {
    const state = {
      running: false,
      start: 0,
      lastFrame: 0,
      frameGaps: [],
      longTasks: [],
      longAnimationFrames: [],
      mutationCount: 0,
      mutationRecords: [],
      transitionSamples: [],
      transitionSampleRunId: 0,
      observer: null,
      longAnimationFrameObserver: null,
      mutationObserver: null,
    };
    window.__advancedToolsSwitchAudit = state;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= state.start) {
            state.longTasks.push({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      state.observer = observer;
    } catch {
      state.observer = null;
    }
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!state.running || entry.startTime + entry.duration < state.start) continue;
          state.longAnimationFrames.push({
            startTime: entry.startTime,
            duration: entry.duration,
            blockingDuration: entry.blockingDuration,
            scripts: (entry.scripts ?? []).map((script) => ({
              sourceURL: script.sourceURL,
              functionName: script.sourceFunctionName,
              invoker: script.invoker,
              startTime: script.startTime,
              duration: script.duration,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
            })),
          });
        }
      });
      observer.observe({ type: "long-animation-frame", buffered: false });
      state.longAnimationFrameObserver = observer;
    }
    try {
      const mutationObserver = new MutationObserver((records) => {
        if (!state.running) return;
        const now = performance.now();
        for (const record of records) {
          state.mutationCount += 1;
          if (state.mutationRecords.length >= 40) continue;
          const target = record.target instanceof Element ? record.target : undefined;
          state.mutationRecords.push({
            time: now,
            type: record.type,
            attributeName: record.attributeName,
            added: record.addedNodes?.length ?? 0,
            removed: record.removedNodes?.length ?? 0,
            target: target
              ? {
                  tag: target.tagName.toLowerCase(),
                  id: target.id || undefined,
                  className: String(target.className || "").slice(0, 160) || undefined,
                  tab: target.getAttribute("data-tab") || undefined,
                }
              : undefined,
          });
        }
      });
      mutationObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden"],
      });
      state.mutationObserver = mutationObserver;
    } catch {
      state.mutationObserver = null;
    }
  });
}

async function startPerformanceProbe(page) {
  return page.evaluate(() => {
    const state = window.__advancedToolsSwitchAudit;
    state.running = true;
    state.start = performance.now();
    state.lastFrame = state.start;
    state.frameGaps = [];
    state.longTasks = [];
    state.longAnimationFrames = [];
    state.mutationCount = 0;
    state.mutationRecords = [];
    state.transitionSamples = [];
    state.transitionSampleRunId += 1;
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

async function startTransitionSampler(page, targetTab) {
  await page.evaluate(({ tab, durationMs, intervalMs }) => {
    const state = window.__advancedToolsSwitchAudit;
    state.transitionSamples = [];
    const runId = (state.transitionSampleRunId += 1);
    const popover = document.querySelector(".toolbar-popover.advanced");
    const preExistingPopoverAnimations = new Map(
      (popover?.getAnimations() ?? []).map((animation) => [animation, {
        currentTime: animation.currentTime,
        startTime: animation.startTime,
      }]),
    );
    const contentMeta = (node) => {
      if (!node) return undefined;
      const style = getComputedStyle(node);
      return {
        tab: node.getAttribute("data-tab") || undefined,
        className: String(node.className || ""),
        opacity: Number.parseFloat(style.opacity || "1"),
        transform: style.transform,
      };
    };
    const startedAt = performance.now();
    const sample = () => {
      if (state.transitionSampleRunId !== runId) return;
      const time = performance.now();
      const panel = document.querySelector(".advanced-tools-panel");
      const viewport = document.querySelector(".advanced-tab-viewport");
      const active = document.querySelector(".advanced-tab-content.is-active");
      const popover = document.querySelector(".toolbar-popover.advanced");
      const entering = [...document.querySelectorAll(".advanced-tab-content.is-entering")].map(contentMeta);
      const leaving = [...document.querySelectorAll(".advanced-tab-content.is-leaving")].map(contentMeta);
      const viewportStyle = viewport ? getComputedStyle(viewport) : undefined;
      const popoverStyle = popover ? getComputedStyle(popover) : undefined;
      state.transitionSamples.push({
        time,
        elapsedMs: time - startedAt,
        targetTab: tab,
        panelClassName: panel ? String(panel.className || "") : "",
        viewportClassName: viewport ? String(viewport.className || "") : "",
        viewportHeight: viewportStyle?.height,
        viewportMinHeight: viewportStyle?.minHeight,
        popoverClassName: popover ? String(popover.className || "") : "",
         popoverTransform: popoverStyle?.transform ?? "none",
         popoverAnimations: popover?.getAnimations().map((animation) => ({
           playState: animation.playState,
           currentTime: animation.currentTime,
           startTime: animation.startTime,
           preExisting: preExistingPopoverAnimations.has(animation),
           preExistingCurrentTime: preExistingPopoverAnimations.get(animation)?.currentTime ?? null,
           startedAfterClick: !preExistingPopoverAnimations.has(animation),
         })) ?? [],
         preExistingPopoverAnimationCount: preExistingPopoverAnimations.size,
         active: contentMeta(active),
         entering,
         leaving,
       });
      if (time - startedAt < durationMs) window.setTimeout(sample, intervalMs);
    };
    sample();
  }, { tab: targetTab, durationMs: 360, intervalMs: 48 });
}

async function stopPerformanceProbe(page, startedAt) {
  return page.evaluate((start) => {
    const state = window.__advancedToolsSwitchAudit;
    state.running = false;
    const longTasks = state.longTasks.filter((item) => item.startTime >= start);
    const resourceEntries = performance.getEntriesByType("resource")
      .filter((entry) => entry.startTime >= start)
      .filter((entry) => ["script", "fetch", "xmlhttprequest"].includes(entry.initiatorType))
      .map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        transferSize: entry.transferSize,
      }));
    return {
      maxLongTaskMs: longTasks.reduce((max, item) => Math.max(max, item.duration), 0),
      maxFrameGapMs: state.frameGaps.reduce((max, item) => Math.max(max, item), 0),
      longTasks,
      longAnimationFrames: state.longAnimationFrames.filter((item) => item.startTime + item.duration >= start),
      frameGaps: state.frameGaps,
      resourceEntries,
      mutationCount: state.mutationCount,
      mutationRecords: state.mutationRecords,
      transitionSamples: state.transitionSamples,
    };
  }, startedAt);
}

async function collectPanelSnapshot(page, targetTab) {
  const selector = tabs[targetTab]?.selector ?? "";
  return page.evaluate(({ tab, selector }) => {
    const rectOf = (node) => {
      if (!node) return undefined;
      const rect = node.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
      };
    };
    const panel = document.querySelector(".advanced-tools-panel");
    const viewport = document.querySelector(".advanced-tab-viewport");
    const target = selector ? document.querySelector(selector) : null;
    const activeContents = [...document.querySelectorAll(".advanced-tab-content.is-active")];
    const warmContents = [...document.querySelectorAll(".advanced-tab-content.is-warm")];
    const inactiveContents = [...document.querySelectorAll(".advanced-tab-content.is-inactive")];
    const enteringContents = [...document.querySelectorAll(".advanced-tab-content.is-entering")];
    const leavingContents = [...document.querySelectorAll(".advanced-tab-content.is-leaving")];
    const mountedTabs = [...document.querySelectorAll(".advanced-tab-content")]
      .map((node) => node.getAttribute("data-tab"))
      .filter(Boolean);
    const transitionedElementCount = panel
      ? [...panel.querySelectorAll("*")].reduce((count, node) => {
          const style = getComputedStyle(node);
          const durations = style.transitionDuration.split(",").map((item) => Number.parseFloat(item) || 0);
          return durations.some((item) => item > 0) ? count + 1 : count;
        }, 0)
      : 0;
    return {
      targetTab: tab,
      panelRect: rectOf(panel),
      viewportRect: rectOf(viewport),
      targetRect: rectOf(target),
      panelClassName: panel ? String(panel.className) : "",
      viewportMinHeight: viewport ? getComputedStyle(viewport).minHeight : "",
      viewportScrollHeight: viewport ? viewport.scrollHeight : 0,
      activeTabCount: activeContents.length,
      activeTabs: activeContents.map((node) => node.getAttribute("data-tab")).filter(Boolean),
      warmTabCount: warmContents.length,
      inactiveTabCount: inactiveContents.length,
      enteringTabCount: enteringContents.length,
      enteringTabs: enteringContents.map((node) => node.getAttribute("data-tab")).filter(Boolean),
      leavingTabCount: leavingContents.length,
      leavingTabs: leavingContents.map((node) => node.getAttribute("data-tab")).filter(Boolean),
      mountedTabs,
      transitionedElementCount,
    };
  }, { tab: targetTab, selector });
}

function numericOpacity(value) {
  return Number.isFinite(value) ? value : 1;
}

function distinctRounded(values) {
  return [...new Set(values.filter((value) => Number.isFinite(value)).map((value) => Math.round(value)))];
}

function buildAnimationAudit({
  fromSnapshot,
  visibleSnapshot,
  idleSnapshot,
  samples,
  fromTab,
  targetTab,
  expectContainerMorph = false,
}) {
  const fromWide = tabs[fromTab]?.wide ?? false;
  const targetWide = tabs[targetTab]?.wide ?? false;
  const regularTransition = Boolean(fromTab && !fromWide && !targetWide && fromTab !== targetTab);
  const crossesContainerMode = Boolean(fromTab && fromTab !== targetTab && fromWide !== targetWide);
  const viewportHeights = samples
    .map((sample) => Number.parseFloat(sample.viewportHeight || ""))
    .filter((value) => Number.isFinite(value));
  const roundedHeights = distinctRounded(viewportHeights);
  const enteringSamples = samples.flatMap((sample) => sample.entering ?? []);
  const leavingSamples = samples.flatMap((sample) => sample.leaving ?? []);
  const targetEntering = enteringSamples.filter((item) => item?.tab === targetTab);
  const sourceLeaving = fromTab ? leavingSamples.filter((item) => item?.tab === fromTab) : [];
  const targetEnteringOpacity = targetEntering.map((item) => numericOpacity(item?.opacity));
  const sourceLeavingOpacity = sourceLeaving.map((item) => numericOpacity(item?.opacity));
  const viewportDelta = Math.abs((idleSnapshot?.viewportRect?.height ?? 0) - (fromSnapshot?.viewportRect?.height ?? 0));
  const expectsHeightMotion = regularTransition && viewportDelta >= 2;
  const failures = [];
  if (regularTransition && targetEntering.length === 0) failures.push(`missing entering samples for ${targetTab}`);
  const containerMorphFrames = samples.filter((sample) =>
    String(sample.popoverClassName || "").includes("is-morphing")
      && sample.popoverAnimations?.some((animation) => animation.playState === "running")
      && sample.popoverTransform !== "none"
      && sample.popoverTransform !== "matrix(1, 0, 0, 1, 0, 0)"
      && sample.popoverAnimations?.some((animation) =>
        animation.playState === "running" && animation.startedAfterClick,
      ));
  if (!crossesContainerMode && containerMorphFrames.length > 0) {
    failures.push(`outer container morphed during same-mode tab switch ${fromTab}->${targetTab}`);
  }
  if (expectContainerMorph && crossesContainerMode && containerMorphFrames.length === 0) {
    failures.push(`missing outer container FLIP during compact/wide mode switch ${fromTab}->${targetTab}`);
  }
  if (expectsHeightMotion && roundedHeights.length < 2) {
    failures.push(`missing block-size transition for ${fromTab}->${targetTab}`);
  }
  if (regularTransition && targetEnteringOpacity.length > 0 && Math.min(...targetEnteringOpacity) > 0.98) failures.push(`enter opacity did not dip for ${targetTab}`);
  return {
    ok: failures.length === 0,
    failures,
    regularTransition,
    crossesContainerMode,
    expectContainerMorph,
    containerMorphFrameCount: containerMorphFrames.length,
    preExistingPopoverAnimationCount: samples[0]?.preExistingPopoverAnimationCount ?? 0,
    expectsHeightMotion,
    fromTab,
    targetTab,
    visiblePanelClassName: visibleSnapshot?.panelClassName,
    idlePanelClassName: idleSnapshot?.panelClassName,
    sampleCount: samples.length,
    viewportHeightRange: viewportHeights.length > 0 ? {
      min: Math.min(...viewportHeights),
      max: Math.max(...viewportHeights),
      distinctRounded: roundedHeights.length,
    } : undefined,
    entering: {
      sampleCount: targetEntering.length,
      minOpacity: targetEnteringOpacity.length > 0 ? Math.min(...targetEnteringOpacity) : undefined,
      maxOpacity: targetEnteringOpacity.length > 0 ? Math.max(...targetEnteringOpacity) : undefined,
    },
    leaving: {
      sampleCount: sourceLeaving.length,
      minOpacity: sourceLeavingOpacity.length > 0 ? Math.min(...sourceLeavingOpacity) : undefined,
      maxOpacity: sourceLeavingOpacity.length > 0 ? Math.max(...sourceLeavingOpacity) : undefined,
    },
  };
}

async function waitForIdle(page, targetTab) {
  await page.waitForFunction((tab) => {
    const panel = document.querySelector(".advanced-tools-panel");
    const target = {
      settings: ".advanced-tab-content.is-active .project-settings-panel",
      providers: ".advanced-tab-content.is-active .provider-settings-panel",
      library: ".advanced-tab-content.is-active .asset-library-panel",
      assets: ".advanced-tab-content.is-active .asset-generation-panel",
      layout: ".advanced-tab-content.is-active .runtime-layout-designer",
      theme: ".advanced-tab-content.is-active .runtime-theme-designer",
      animation: ".advanced-tab-content.is-active .animation-editor-shell",
    }[tab];
    const el = target ? document.querySelector(target) : null;
    return Boolean(
      panel &&
      panel.classList.contains("is-tab-idle") &&
      el &&
      Boolean(el.closest(".advanced-tab-content.is-active"))
    );
  }, targetTab, { timeout: 30_000 });
}

async function switchToTab(page, targetTab, options = { measure: true }) {
  const tab = tabs[targetTab];
  if (!tab) throw new Error(`Unknown tab: ${targetTab}`);
  const buttonSelector = `[data-help-key="advanced.tab.${targetTab}"]`;
  if (options.measure === false && await page.locator(tab.selector).first().isVisible({ timeout: 500 }).catch(() => false)) {
    return {
      targetVisibleMs: 0,
      idleMs: 0,
      maxLongTaskMs: 0,
      maxFrameGapMs: 0,
      longTaskCount: 0,
      longTasks: [],
      resourceCount: 0,
      resourceEntries: [],
      lazyChunkNames: [],
      mutationCount: 0,
      mutationRecords: [],
      transitionSamples: [],
      animationAudit: undefined,
    };
  }
  if (options.measure === false) {
    await page.locator(buttonSelector).first().waitFor({ state: "attached", timeout: 30_000 });
    await page.locator(buttonSelector).first().click();
    await page.locator(tab.selector).first().waitFor({ state: "visible", timeout: 30_000 });
    await waitForIdle(page, targetTab).catch(() => {});
    return {
      targetVisibleMs: 0,
      idleMs: 0,
      maxLongTaskMs: 0,
      maxFrameGapMs: 0,
      longTaskCount: 0,
      longTasks: [],
      resourceCount: 0,
      resourceEntries: [],
      lazyChunkNames: [],
      mutationCount: 0,
      mutationRecords: [],
      transitionSamples: [],
      animationAudit: undefined,
    };
  }
  await waitForCenterHit(page, buttonSelector, 30_000);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const targetBox = await page.locator(buttonSelector).first().boundingBox();
    if (!targetBox) throw new Error(`Advanced tab action has no hit target: ${buttonSelector}`);
    const beforeSnapshot = options.measure ? await collectPanelSnapshot(page, targetTab) : undefined;
    const startedAt = options.measure ? await startPerformanceProbe(page) : 0;
    const shouldSampleTransition = Boolean(options.measure && options.fromTab && options.fromTab !== targetTab);
    if (shouldSampleTransition) await startTransitionSampler(page, targetTab);
    const clickStart = await page.evaluate(() => performance.now());
    await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
    try {
      await page.locator(tab.selector).first().waitFor({ state: "visible", timeout: attempt === 3 ? 30_000 : 2_500 });
      const targetVisibleMs = await page.evaluate((start) => performance.now() - start, clickStart);
      const visibleSnapshot = options.measure ? await collectPanelSnapshot(page, targetTab) : undefined;
      await waitForIdle(page, targetTab);
      const idleMs = await page.evaluate((start) => performance.now() - start, clickStart);
      const idleSnapshot = options.measure ? await collectPanelSnapshot(page, targetTab) : undefined;
      if (shouldSampleTransition) await page.waitForTimeout(90);
      const perf = options.measure ? await stopPerformanceProbe(page, startedAt) : {
        maxLongTaskMs: 0,
        maxFrameGapMs: 0,
        longTasks: [],
        frameGaps: [],
        resourceEntries: [],
        mutationCount: 0,
        mutationRecords: [],
        transitionSamples: [],
      };
      await page.waitForTimeout(60);
      const lazyChunkNames = perf.resourceEntries
        .filter((entry) => entry.initiatorType === "script")
        .map((entry) => basenameFromUrl(entry.name));
      return {
        targetVisibleMs,
        idleMs,
        maxLongTaskMs: perf.maxLongTaskMs,
        maxFrameGapMs: perf.maxFrameGapMs,
        longTaskCount: perf.longTasks.length,
        longTasks: perf.longTasks.slice(0, 8),
        longAnimationFrames: perf.longAnimationFrames ?? [],
        resourceCount: perf.resourceEntries.length,
        resourceEntries: perf.resourceEntries.slice(0, 12),
        lazyChunkNames,
        mutationCount: perf.mutationCount,
        mutationRecords: perf.mutationRecords.slice(0, 12),
        transitionSamples: perf.transitionSamples ?? [],
        animationAudit: options.measure ? buildAnimationAudit({
          fromSnapshot: beforeSnapshot,
          visibleSnapshot,
          idleSnapshot,
          samples: shouldSampleTransition ? perf.transitionSamples ?? [] : [],
          fromTab: options.fromTab ?? beforeSnapshot?.activeTabs?.[0],
          targetTab,
          expectContainerMorph: options.expectContainerMorph,
        }) : undefined,
        beforeSnapshot,
        visibleSnapshot,
        idleSnapshot,
      };
    } catch (error) {
      if (options.measure) await stopPerformanceProbe(page, startedAt).catch(() => {});
      lastError = error;
      await page.waitForTimeout(80);
    }
  }
  if (lastError) throw lastError;
  throw new Error(`Unable to switch to ${targetTab}`);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function dropLargestOutlier(values) {
  if (values.length < 8) return values;
  return [...values].sort((a, b) => a - b).slice(0, -1);
}

function summarizeSwitches(switches) {
  const regular = switches.filter((item) => !tabs[item.from]?.wide && !tabs[item.to]?.wide);
  const repeated = switches.filter((item) => item.round > 1);
  const repeatedRegular = repeated.filter((item) => !tabs[item.from]?.wide && !tabs[item.to]?.wide);
  const pathStats = new Map();
  for (const item of switches) {
    const key = `${item.from}->${item.to}`;
    const current = pathStats.get(key) ?? {
      path: key,
      from: item.from,
      to: item.to,
      count: 0,
      visibleValues: [],
      idleValues: [],
      frameGapValues: [],
      longTaskValues: [],
    };
    current.count += 1;
    current.visibleValues.push(item.targetVisibleMs);
    current.idleValues.push(item.idleMs);
    current.frameGapValues.push(item.maxFrameGapMs);
    current.longTaskValues.push(item.maxLongTaskMs);
    pathStats.set(key, current);
  }
  const slowestPaths = [...pathStats.values()]
    .map((item) => ({
      path: item.path,
      from: item.from,
      to: item.to,
      count: item.count,
      avgVisibleMs: Math.round(item.visibleValues.reduce((sum, value) => sum + value, 0) / Math.max(1, item.visibleValues.length)),
      p95VisibleMs: Math.round(percentile(item.visibleValues, 95)),
      maxVisibleMs: Math.round(Math.max(0, ...item.visibleValues)),
      maxFrameGapMs: Math.round(Math.max(0, ...item.frameGapValues)),
      maxLongTaskMs: Math.round(Math.max(0, ...item.longTaskValues)),
    }))
    .sort((a, b) => b.p95VisibleMs - a.p95VisibleMs)
    .slice(0, 8);
  return {
    p95RegularVisibleMs: percentile(regular.map((item) => item.targetVisibleMs), 95),
    p95RepeatedRegularVisibleMs: percentile(repeatedRegular.map((item) => item.targetVisibleMs), 95),
    p95RepeatedRegularIdleMs: percentile(repeatedRegular.map((item) => item.idleMs), 95),
    maxFirstLongTaskMs: switches.filter((item) => item.round === 1).reduce((max, item) => Math.max(max, item.maxLongTaskMs), 0),
    maxRepeatedLongTaskMs: repeated.reduce((max, item) => Math.max(max, item.maxLongTaskMs), 0),
    maxRepeatedRegularLongTaskMs: repeatedRegular.reduce((max, item) => Math.max(max, item.maxLongTaskMs), 0),
    maxFrameGapMs: switches.reduce((max, item) => Math.max(max, item.maxFrameGapMs), 0),
    maxRegularFrameGapMs: regular.reduce((max, item) => Math.max(max, item.maxFrameGapMs), 0),
    maxRepeatedFrameGapMs: repeated.reduce((max, item) => Math.max(max, item.maxFrameGapMs), 0),
    maxRepeatedRegularFrameGapMs: repeatedRegular.reduce((max, item) => Math.max(max, item.maxFrameGapMs), 0),
    totalMutationCount: switches.reduce((sum, item) => sum + (item.mutationCount ?? 0), 0),
    slowestPaths,
    slowest: [...switches]
      .sort((a, b) => b.targetVisibleMs - a.targetVisibleMs)
      .slice(0, 5)
      .map((item) => ({
        viewport: item.viewport,
        variant: item.variant,
        round: item.round,
        from: item.from,
        to: item.to,
        targetVisibleMs: Math.round(item.targetVisibleMs),
        idleMs: Math.round(item.idleMs),
        maxLongTaskMs: Math.round(item.maxLongTaskMs),
        maxFrameGapMs: Math.round(item.maxFrameGapMs),
        resourceCount: item.resourceCount,
        mutationCount: item.mutationCount ?? 0,
        lazyChunkNames: item.lazyChunkNames ?? [],
      })),
  };
}

function baselineFailures(viewport, switches) {
  const summary = summarizeSwitches(switches);
  const failures = [];
  if (summary.p95RepeatedRegularVisibleMs > 120 + thresholdToleranceMs) failures.push(`repeated regular tab visible p95 ${Math.round(summary.p95RepeatedRegularVisibleMs)}ms > 120ms`);
  if (summary.maxFirstLongTaskMs > 100 + longTaskToleranceMs) failures.push(`first-round long task ${Math.round(summary.maxFirstLongTaskMs)}ms > 100ms`);
  if (summary.maxRepeatedRegularLongTaskMs > 50 + longTaskToleranceMs) failures.push(`repeated regular long task ${Math.round(summary.maxRepeatedRegularLongTaskMs)}ms > 50ms`);
  if (summary.maxRegularFrameGapMs > viewport.frameGapMs + thresholdToleranceMs) failures.push(`regular frame gap ${Math.round(summary.maxRegularFrameGapMs)}ms > ${viewport.frameGapMs}ms`);
  const animationFailures = switches
    .filter((item) => item.round > 1
      && (item.animationAudit?.regularTransition || item.animationAudit?.expectContainerMorph))
    .flatMap((item) => (item.animationAudit?.failures ?? []).map((failure) => `${item.from}->${item.to}: ${failure}`));
  failures.push(...animationFailures.slice(0, 8));
  return failures;
}

function buildVariantComparisons(results) {
  const comparisons = [];
  for (const baseline of results.filter((item) => item.variant.id === "baseline")) {
    for (const candidate of results.filter((item) => item.viewport.label === baseline.viewport.label && item.variant.id !== "baseline")) {
      const improve = (before, after) => before > 0 ? Math.round(((before - after) / before) * 100) : 0;
      comparisons.push({
        viewport: baseline.viewport.label,
        variant: candidate.variant.id,
        p95RegularVisibleImprovementPct: improve(baseline.summary.p95RegularVisibleMs, candidate.summary.p95RegularVisibleMs),
        p95RepeatedRegularVisibleImprovementPct: improve(baseline.summary.p95RepeatedRegularVisibleMs, candidate.summary.p95RepeatedRegularVisibleMs),
        maxFrameGapImprovementPct: improve(baseline.summary.maxFrameGapMs, candidate.summary.maxFrameGapMs),
        maxRepeatedLongTaskImprovementPct: improve(baseline.summary.maxRepeatedLongTaskMs, candidate.summary.maxRepeatedLongTaskMs),
        materiallyImproved: (
          improve(baseline.summary.p95RegularVisibleMs, candidate.summary.p95RegularVisibleMs) >= 25 ||
          improve(baseline.summary.p95RepeatedRegularVisibleMs, candidate.summary.p95RepeatedRegularVisibleMs) >= 25 ||
          improve(baseline.summary.maxFrameGapMs, candidate.summary.maxFrameGapMs) >= 25 ||
          improve(baseline.summary.maxRepeatedLongTaskMs, candidate.summary.maxRepeatedLongTaskMs) >= 25
        ),
      });
    }
  }
  return comparisons;
}

async function runVariantViewport(browser, viewport, variant, acceptance) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await acceptance.open(page);
  await installRuntimeVariant(page, variant);
  await openAdvancedSettings(page);
  await installPerformanceProbe(page);

  const switches = [];
  let currentTab = "settings";
  for (let round = 1; round <= rounds; round += 1) {
    for (const targetTab of tabSequence) {
      const metrics = await switchToTab(page, targetTab, {
        measure: true,
        fromTab: currentTab,
        expectContainerMorph: variant.id === "baseline",
      });
      switches.push({
        viewport: viewport.label,
        variant: variant.id,
        round,
        from: currentTab,
        to: targetTab,
        wideSwitch: tabs[currentTab].wide !== tabs[targetTab].wide,
        ...metrics,
      });
      currentTab = targetTab;
    }
  }

  const screenshot = path.join(OUT_DIR, `${viewport.label}-${variant.id}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await context.close();

  const summary = summarizeSwitches(switches);
  const failures = variant.id === "baseline" ? baselineFailures(viewport, switches) : [];
  return {
    viewport,
    variant,
    ok: failures.length === 0,
    failures,
    summary,
    switches,
    screenshot,
  };
}

function printSummary(report) {
  const rows = report.results.map((result) => ({
    viewport: result.viewport.label,
    variant: result.variant.id,
    ok: result.ok,
    p95RegularVisibleMs: Math.round(result.summary.p95RegularVisibleMs),
    p95RepeatedRegularVisibleMs: Math.round(result.summary.p95RepeatedRegularVisibleMs),
    maxFirstLongTaskMs: Math.round(result.summary.maxFirstLongTaskMs),
    maxRepeatedRegularLongTaskMs: Math.round(result.summary.maxRepeatedRegularLongTaskMs),
    maxRegularFrameGapMs: Math.round(result.summary.maxRegularFrameGapMs),
    failures: result.failures.join("; "),
  }));
  console.table(rows);
  const slowest = report.results.flatMap((result) => result.summary.slowest)
    .sort((a, b) => b.targetVisibleMs - a.targetVisibleMs)
    .slice(0, 5);
  console.log("Slowest switches:");
  console.table(slowest);
  if (report.variantComparisons.length > 0) {
    console.log("Variant comparisons:");
    console.table(report.variantComparisons);
  }
}

(async () => {
  const report = {
    ok: true,
    at: new Date().toISOString(),
    editorUrl: null,
    rounds,
    tabSequence,
    env: {
      AGENTVN_PERF_VARIANTS: process.env.AGENTVN_PERF_VARIANTS ?? "",
      AGENTVN_PERF_VIEWPORTS: process.env.AGENTVN_PERF_VIEWPORTS ?? "",
      resolvedVariants: variants.map((item) => item.id),
      resolvedViewports: viewports.map((item) => item.label),
    },
    logs: [],
    results: [],
    variantComparisons: [],
  };
  let browser;
  let acceptance;
  try {
    acceptance = await startEditorAcceptance(OUT_DIR);
    report.editorUrl = acceptance.url;
    report.owner = {
      editorPid: acceptance.server.pid,
      serverRunId: acceptance.server.runId,
      editorUrl: acceptance.url,
      backendUrl: acceptance.backendUrl,
    };
    browser = await chromium.launch({ headless: true });
    for (const viewport of viewports) {
      for (const variant of variants) {
        let result;
        try {
          result = await acceptance.server.run(() => runVariantViewport(browser, viewport, variant, acceptance));
        } catch (error) {
          result = {
            viewport,
            variant,
            ok: false,
            failures: [error instanceof Error ? error.message : String(error)],
            summary: summarizeSwitches([]),
            switches: [],
            screenshot: "",
            error: error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) },
          };
        }
        report.results.push(result);
        if (variant.id === "baseline" && !result.ok) report.ok = false;
      }
    }
    report.variantComparisons = buildVariantComparisons(report.results);
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await acceptance?.stop().catch(() => {});
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
    printSummary(report);
    console.log(JSON.stringify({
      ok: report.ok,
      reportPath: REPORT_PATH,
      screenshots: report.results.map((item) => item.screenshot),
      error: report.error,
    }, null, 2));
  }
  if (!report.ok) process.exit(1);
})();
