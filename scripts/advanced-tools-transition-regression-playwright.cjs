#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const net = require("node:net");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { verifyDetachedPreviewCancellation } = require("./lib/preview-cancellation-evidence.cjs");
const { resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { comparePngBuffers, freezeSettledVisualAnimations, resumeSettledVisualAnimations } =
  require("./advanced-layout-warm-opacity-equivalence-playwright.cjs");
const { summarizeSettledAdvancedLayers } = require("./lib/advanced-layer-visibility.cjs");

const root = path.resolve(__dirname, "..");
const acceptancePaths = resolveAcceptancePaths();
const fixture = acceptancePaths.input;
const outputDir = acceptancePaths.output;
let editorPort;
let backendPort;
let editorUrl;
let backendUrl;
let owner = null;
const repeatTransitions = Number(process.argv.find(arg => arg.startsWith("--repeat-transitions="))?.split("=")[1] ?? 1);
const delayedCaptureInput = process.env.ADVANCED_TOOLS_CAPTURE_DELAY_INPUT === "1";
let captureInputDelayApplied = false;
if (!Number.isInteger(repeatTransitions) || repeatTransitions < 1 || repeatTransitions > 30)
  throw Error("Transition repetitions must be an integer from 1 to 30");

function isolatedAssetUrl(requestUrl) {
  const url = new URL(requestUrl);
  return url.origin === "http://127.0.0.1:8278" && url.pathname.startsWith("/api/project/assets/")
    ? `${backendUrl}${url.pathname}${url.search}` : requestUrl;
}

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function isMonotonic(values, direction, epsilon = 0.025) {
  return values.every((value, index) => {
    if (index === 0) return true;
    return direction === "down"
      ? value <= values[index - 1] + epsilon
      : value >= values[index - 1] - epsilon;
  });
}

function rectDelta(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.max(
    Math.abs(left.left - right.left),
    Math.abs(left.top - right.top),
    Math.abs(left.width - right.width),
    Math.abs(left.height - right.height),
  );
}

function isWideTab(tab) {
  return ["layout", "theme", "assets", "animation"].includes(tab);
}

function isIdentityTransform(value) {
  return value === "none"
    || value === "matrix(1, 0, 0, 1, 0, 0)"
    || value === "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)";
}

function readTransformMetrics(value) {
  if (isIdentityTransform(value)) return { scaleX: 1, scaleY: 1, x: 0, y: 0 };
  const match = /^matrix\(([^)]+)\)$/.exec(value);
  if (!match) return null;
  const [a, b, c, d, x, y] = match[1].split(",").map(Number);
  return {
    scaleX: Math.hypot(a, b),
    scaleY: Math.hypot(c, d),
    x,
    y,
  };
}

function isNearIdentityTransform(value) {
  const metrics = readTransformMetrics(value);
  return Boolean(metrics
    && Math.abs(metrics.scaleX - 1) < 0.0001
    && Math.abs(metrics.scaleY - 1) < 0.0001
    && Math.abs(metrics.x) < 0.01
    && Math.abs(metrics.y) < 0.01);
}

function assertMorphAnchor(frames, label) {
  const morphFrames = frames.filter((sample) => sample.popoverClass.includes("is-morphing")
    && !isIdentityTransform(sample.popoverTransform));
  assert(morphFrames.every((sample) => {
    const origin = sample.popoverTransformOrigin?.split(/\s+/).map(parseFloat);
    return origin?.length >= 2 && origin.slice(0, 2).every((value) => Number.isFinite(value) && Math.abs(value) <= 0.01);
  }), `${label}: Editor FLIP morph must use its measured top-left anchor, including wide layout mode`,
  morphFrames.map(({ at, popoverClass, popoverTransformOrigin, popoverTransform, popoverRect }) => (
    { at, popoverClass, popoverTransformOrigin, popoverTransform, popoverRect }
  )));
}

function assertGeometryBridgeOwnership(viewportName, fromTab, toTab, frames) {
  const label = `${viewportName} ${fromTab}->${toTab}`;
  const crossfadeFrames = frames.filter(sample =>
    sample.activeTab === toTab && sample.leavingTab === fromTab);
  const requiresWideBridge = frames[0]?.viewportWidth >= 1280
    && frames[0]?.viewportHeight >= 720;
  // A real geometry bridge owns outgoing pixels. The original inert page
  // must not also reflow at the new wide width while that bridge is alive.
  // Same-size/narrow transitions have no bridge and keep their real fade.
  const bridgedFrames = crossfadeFrames.filter(sample =>
    sample.viewportWidth >= 1280 && sample.viewportHeight >= 720
    && isWideTab(toTab) && sample.geometryBridge?.tab === fromTab);
  if (!isWideTab(fromTab) && isWideTab(toTab) && requiresWideBridge) {
    assert(bridgedFrames.length >= 2,
      `${label}: wide entry must retain an observable outgoing geometry bridge`, frames);
  }
  assert(bridgedFrames.every(sample => sample.leavingDisplay === "none"
    && sample.leavingLayoutWidth === 0 && sample.leavingLayoutHeight === 0
    && sample.leavingBridgeOwner === "true"
    && sample.geometryBridge.inert && sample.geometryBridge.ariaHidden === "true"
    && sample.geometryBridge.pointerEvents === "none"
    && sample.geometryBridge.rect.width > 0 && sample.geometryBridge.rect.height > 0),
  `${label}: outgoing page was laid out twice or its geometry bridge became interactive`,
  bridgedFrames);
  assert(crossfadeFrames.every(sample => sample.leavingDisplay !== "none"
    || sample.geometryBridge?.tab === fromTab),
  `${label}: outgoing content was removed without its own visual bridge`, crossfadeFrames);
}

function assertStrictTransition(viewportName, fromTab, toTab, frames, baseline, reducedMotion) {
  const crossfadeFrames = frames.filter((sample) => (
    sample.activeTab === toTab
    && sample.leavingTab === fromTab
    && Number.isFinite(sample.activeOpacity)
    && Number.isFinite(sample.leavingOpacity)
  ));
  const duration = crossfadeFrames.length > 1
    ? crossfadeFrames[crossfadeFrames.length - 1].at - crossfadeFrames[0].at
    : 0;
  const outgoing = crossfadeFrames.map((sample) => sample.leavingOpacity);
  const incoming = crossfadeFrames.map((sample) => sample.activeOpacity);
  const crossfadeContainerBaseline = crossfadeFrames[0]?.popoverRect ?? baseline.popover;
  const crossfadeNavBaseline = crossfadeFrames[0]
    ? {
        nav: crossfadeFrames[0].navRect,
        navButtonRects: crossfadeFrames[0].navButtonRects,
        navLayout: crossfadeFrames[0].navLayout,
      }
    : {
        nav: baseline.nav,
        navButtonRects: baseline.navButtonRects,
        navLayout: baseline.navLayout,
      };
  const label = `${viewportName} ${fromTab}->${toTab}`;
  assertMorphAnchor(frames, label);
  assertGeometryBridgeOwnership(viewportName, fromTab, toTab, frames);
  assert(
    crossfadeFrames.length >= (reducedMotion ? 2 : 4) && duration >= (reducedMotion ? 16 : 48),
    `${label}: no observable presentation across real RAF frames`,
    { duration, crossfadeFrames, animationEvents: frames.animationEvents ?? [],
      inputEvents: frames.inputEvents ?? [],
      finalFrames: frames.slice(-8), longAnimationFrames: frames.longAnimationFrames ?? [] },
  );
  assert(
    Math.max(...outgoing) >= 0.5
      && Math.min(...outgoing) <= 0.3
      && isMonotonic(outgoing, "down"),
    `${label}: outgoing opacity was not a continuous monotonic fade`,
    { outgoing, crossfadeFrames },
  );
  assert(
    incoming[0] <= 0.5
      && Math.max(...incoming) >= 0.8
      && isMonotonic(incoming, "up"),
    `${label}: incoming opacity was not a continuous monotonic fade`,
    { incoming, crossfadeFrames },
  );
  assert(crossfadeFrames.every((sample) => !sample.preparing), `${label}: placeholder content entered the crossfade`, crossfadeFrames);
  assert(
    crossfadeFrames.every((sample) => sample.activePointerEvents !== "none" && !sample.activeInert
      && sample.leavingPointerEvents === "none" && sample.leavingInert),
    `${label}: ready input owner was blocked or outgoing content remained interactive`,
    crossfadeFrames,
  );
  assert(
    crossfadeFrames.every((sample) => (
      ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(sample.activeTransform)
      && ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(sample.leavingTransform)
      && sample.activeFilter === "none"
      && sample.leavingFilter === "none"
    )),
    `${label}: transform/filter motion leaked into the tab crossfade`,
    crossfadeFrames,
  );
  assert(
    crossfadeFrames.some((sample) => sample.activeAnimations.some(a => a.playState === "running"))
      && crossfadeFrames.every(sample => [...sample.activeAnimations, ...sample.leavingAnimations]
        .every(animation => {
          const sibling = isWideTab(fromTab) === isWideTab(toTab);
          const tokens = sample.motionTokens;
          const nominal = sibling ? reducedMotion ? tokens.siblingReducedMs : tokens.siblingMs
            : 400;
          const expected = nominal * (reducedMotion ? 1 : Math.max(.25,tokens.scale)) / tokens.rate;
          return Math.abs(animation.duration - expected) < 1
            && animation.easing === (sibling ? sample.siblingMotionCurve : sample.motionCurve);
        })),
    `${label}: crossfade must preserve its Editor category budget, playback rate and curve`,
    crossfadeFrames,
  );
  assert(crossfadeFrames.every(sample => sample.animatedChildren.length === 0
    && sample.activeOpacity + sample.leavingOpacity >= 0.9),
    `${label}: nested transition or blank presentation frame`, crossfadeFrames);
  const crossesContainerMode = isWideTab(fromTab) !== isWideTab(toTab);
  const morphBaseline = crossfadeFrames[0]?.popoverRect ?? baseline.popover;
  const maxContainerGeometryDelta = crossfadeFrames.reduce((maximum, sample) => {
    if (!sample.popoverRect || !morphBaseline) return maximum;
    return Math.max(maximum, rectDelta(sample.popoverRect, morphBaseline));
  }, 0);
  const morphFrames = crossfadeFrames.filter((sample) => sample.popoverClass.includes("is-morphing")
    && sample.popoverAnimations.some((animation) => animation.playState === "running")
    && !isIdentityTransform(sample.popoverTransform));
  // Cross-width transitions may morph the outer presentation frame while the
  // content crossfades. getBoundingClientRect() includes that transform, so
  // visual rect movement is expected during those frames. Layout geometry is
  // still locked by the offset measurements above, and the settled check in
  // captureStrictTransition verifies the transform is removed at the end.
  const hasOuterMorph = crossesContainerMode && morphFrames.length >= 2;
  assert(
    crossfadeFrames.every((sample) => sample.navLayout.height === crossfadeNavBaseline.navLayout.height
      && sample.navLayout.buttons.length === crossfadeNavBaseline.navLayout.buttons.length
      && sample.navLayout.buttons.every((button, index) => (
        button.width === crossfadeNavBaseline.navLayout.buttons[index].width
        && button.height === crossfadeNavBaseline.navLayout.buttons[index].height))),
    `${label}: outer container transition reflowed navigation controls`,
    { baseline, crossfadeNavBaseline, crossfadeFrames },
  );
  if (hasOuterMorph) {
    if (reducedMotion) {
      const metrics = morphFrames.map((sample) => readTransformMetrics(sample.popoverTransform));
      assert(metrics.every((value) => value
        && value.scaleX >= 0.92 && value.scaleX <= 1.08
        && value.scaleY >= 0.92 && value.scaleY <= 1.08
        && Math.abs(value.x) <= 24 && Math.abs(value.y) <= 24),
      `${label}: reduced-motion morph must stay spatially restrained while remaining animated`,
      { metrics, morphFrames });
    } else {
      assert(crossfadeFrames.every((sample) => sample.popoverRect
        && sample.popoverRect.left >= -1
        && sample.popoverRect.top >= -1
        && sample.popoverRect.left + sample.popoverRect.width <= sample.viewportWidth + 1
        && sample.popoverRect.top + sample.popoverRect.height <= sample.viewportHeight + 1),
      `${label}: outer container morph escaped the viewport`, crossfadeFrames);
    }
  } else if (!crossesContainerMode || !hasOuterMorph) {
    assert(crossfadeFrames.every((sample) => (
      isIdentityTransform(sample.popoverTransform)
      && rectDelta(sample.popoverRect, crossfadeContainerBaseline) <= 1.5
      && rectDelta(sample.navRect, crossfadeNavBaseline.nav) <= 1.5
      && sample.navButtonRects.length === crossfadeNavBaseline.navButtonRects.length
      && sample.navButtonRects.every((rect, index) => (
        Math.abs(rect.width - crossfadeNavBaseline.navButtonRects[index].width) <= 1.5
        && Math.abs(rect.height - crossfadeNavBaseline.navButtonRects[index].height) <= 1.5
        && Math.abs(rect.top - crossfadeNavBaseline.navButtonRects[index].top) <= 1.5))
    )),
    `${label}: navigation or workspace frame changed geometry`,
    { baseline, crossfadeNavBaseline, crossfadeFrames, maxContainerGeometryDelta });
  }
}

async function readNativeTransitionWindow(page, phase) {
  if (process.env.ADVANCED_TOOLS_HEADFUL !== "1") return null;
  const session = await page.context().newCDPSession(page);
  try {
    const state = await session.send("Browser.getWindowForTarget");
    return { phase, windowId: state.windowId, bounds: state.bounds };
  } finally {
    await session.detach();
  }
}

async function captureStrictTransition(page, viewportName, fromTab, toTab, reducedMotion) {
  await page.bringToFront();
  const windowStates = [await readNativeTransitionWindow(page, "start")].filter(Boolean);
  await page.waitForFunction((tab) => (
    document.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") === tab
    && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving")
  ), fromTab, { timeout: 15_000 });
  const targetTab = page.locator(`[data-help-key="advanced.tab.${toTab}"]:visible`).first();
  await targetTab.evaluate((node) => {
    const viewport = node.closest(".glass-selection-group")?.querySelector(".glass-selection-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("advanced tab scroll viewport not found");
    const viewportRect = viewport.getBoundingClientRect();
    const targetRect = node.getBoundingClientRect();
    const safeInset = 8;
    let nextScrollLeft = viewport.scrollLeft;
    if (targetRect.left < viewportRect.left + safeInset) {
      nextScrollLeft -= (viewportRect.left + safeInset) - targetRect.left;
    }
    if (targetRect.right > viewportRect.right - safeInset) {
      nextScrollLeft += targetRect.right - (viewportRect.right - safeInset);
    }
    viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, nextScrollLeft));
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const baseline = await page.evaluate(() => {
    const rect = (node) => {
      const value = node?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, width: value.width, height: value.height } : null;
    };
    const navLayout = (nav) => ({
      height: nav?.offsetHeight ?? 0,
      buttons: [...(nav?.querySelectorAll("button") ?? [])].map((button) => ({
        width: button.offsetWidth,
        height: button.offsetHeight,
      })),
    });
    const navStyle = (nav) => {
      if (!(nav instanceof HTMLElement)) return null;
      const style = getComputedStyle(nav);
      return {
        display: style.display,
        height: style.height,
        minHeight: style.minHeight,
        padding: style.padding,
        boxSizing: style.boxSizing,
        alignItems: style.alignItems,
        overflow: style.overflow,
        viewportHeight: nav.querySelector(".glass-selection-viewport")?.getBoundingClientRect().height ?? 0,
        trackHeight: nav.querySelector(".glass-selection-track")?.getBoundingClientRect().height ?? 0,
      };
    };
    const popover = document.querySelector(".toolbar-popover.advanced");
    const viewport = document.querySelector(".advanced-tab-viewport");
    const nav = document.querySelector(".advanced-tools-panel > nav.glass-selection-group");
    return {
      popover: rect(popover),
      popoverTransformOrigin: popover ? getComputedStyle(popover).transformOrigin : null,
      viewport: rect(viewport),
      nav: rect(nav),
      navButtonRects: [...(nav?.querySelectorAll("button") ?? [])].map(rect),
      navLayout: navLayout(nav),
      navStyle: navStyle(nav),
    };
  });
  await page.evaluate(() => {
    const history = [];
    const longAnimationFrames = [];
    const animationEvents = [];
    const inputEvents = [];
    const captureStartedAt = performance.now();
    let captureExpired = false;
    const recordInput = (event) => {
      const button = event.composedPath().find(node => node instanceof HTMLElement
        && node.matches("button[data-help-key^='advanced.tab.']"));
      if (!button) return;
      const viewport = button.closest(".glass-selection-viewport");
      const panel = button.closest(".advanced-tools-panel");
      const rect = button.getBoundingClientRect();
      inputEvents.push({
        type: event.type, trusted: event.isTrusted, at: performance.now(),
        key: button.dataset.helpKey, x: event.clientX, y: event.clientY,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        scrollLeft: viewport?.scrollLeft,
        ghost: !!button.closest(".toolbar-popover-morph-ghost"),
        selected: panel?.querySelector("[data-glass-selected='true']")?.dataset.helpKey,
        active: panel?.querySelector(".advanced-tab-content.is-active")?.dataset.tab,
        hitKey: document.elementFromPoint(event.clientX, event.clientY)
          ?.closest("button")?.getAttribute("data-help-key"),
      });
    };
    for (const type of ["pointerdown", "pointerup", "click"]) {
      document.addEventListener(type, recordInput, true);
    }
    const observedAnimations = new WeakSet();
    let running = true;
    let frames = 0;
    let longFrameObserver = null;
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
      longFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longAnimationFrames.push({
            startTime: entry.startTime,
            duration: entry.duration,
            blockingDuration: entry.blockingDuration,
            scripts: (entry.scripts ?? []).map((script) => ({
              sourceURL: script.sourceURL,
              functionName: script.sourceFunctionName,
              invoker: script.invoker,
              duration: script.duration,
              forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
            })),
          });
        }
      });
      longFrameObserver.observe({ type: "long-animation-frame", buffered: false });
    }
    const rect = (node) => {
      const value = node?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, width: value.width, height: value.height } : null;
    };
    const navLayout = (nav) => ({
      height: nav?.offsetHeight ?? 0,
      buttons: [...(nav?.querySelectorAll("button") ?? [])].map((button) => ({
        width: button.offsetWidth,
        height: button.offsetHeight,
      })),
    });
    const navStyle = (nav) => {
      if (!(nav instanceof HTMLElement)) return null;
      const style = getComputedStyle(nav);
      return {
        display: style.display,
        height: style.height,
        minHeight: style.minHeight,
        padding: style.padding,
        boxSizing: style.boxSizing,
        alignItems: style.alignItems,
        overflow: style.overflow,
        viewportHeight: nav.querySelector(".glass-selection-viewport")?.getBoundingClientRect().height ?? 0,
        trackHeight: nav.querySelector(".glass-selection-track")?.getBoundingClientRect().height ?? 0,
      };
    };
    let lastGeometry = {
      popoverRect: null,
      viewportRect: null,
      navRect: null,
      navButtonRects: [],
        navLayout: { height: 0, buttons: [] },
        navStyle: null,
    };
    const sample = () => {
      const viewport = document.querySelector(".advanced-tab-viewport");
      const active = viewport?.querySelector(".advanced-tab-content.is-active");
      const leaving = viewport?.querySelector(".advanced-tab-content.is-leaving");
      const popover = document.querySelector(".toolbar-popover.advanced");
      const nav = document.querySelector(".advanced-tools-panel > nav.glass-selection-group");
      const activeStyle = active ? getComputedStyle(active) : null;
      const leavingStyle = leaving ? getComputedStyle(leaving) : null;
      const popoverStyle = popover ? getComputedStyle(popover) : null;
      const bridge = document.querySelector(".toolbar-popover-morph-ghost");
      const bridgeStyle = bridge ? getComputedStyle(bridge) : null;
      const bridgeTab = bridge?.querySelector(".advanced-tab-content.is-active")?.dataset.tab;
      const motionStyle = getComputedStyle(document.documentElement);
      for (const node of [active, leaving].filter(Boolean)) {
        for (const animation of node.getAnimations()) {
          if (observedAnimations.has(animation)) continue;
          observedAnimations.add(animation);
          const record = (event) => animationEvents.push({
            event, at: performance.now(), tab: node.dataset.tab,
            connected: node.isConnected, currentTime: animation.currentTime,
            startTime: animation.startTime, pending: animation.pending,
            timelineTime: animation.timeline?.currentTime, playState: animation.playState,
          });
          record("observed");
          animation.ready.then(() => record("ready"), () => record("ready-rejected"));
          animation.finished.then(() => record("finished"), () => record("cancelled"));
        }
      }
      // Do not attach stale pre-switch geometry to a crossfade frame.
      // Short viewports use the same real DOM measurements as desktop.
      lastGeometry = {
        popoverRect: rect(popover),
        viewportRect: rect(viewport),
        navRect: rect(nav),
        navButtonRects: [...(nav?.querySelectorAll("button") ?? [])].map(rect),
        navLayout: navLayout(nav),
      };
      history.push({
        at: performance.now(),
        pageVisibility: document.visibilityState,
        pageHidden: document.hidden,
        pageHasFocus: document.hasFocus(),
        activeTab: active?.getAttribute("data-tab") ?? null,
        leavingTab: leaving?.getAttribute("data-tab") ?? null,
        activeOpacity: Number(activeStyle?.opacity ?? 1),
        leavingOpacity: Number(leavingStyle?.opacity ?? 0),
        leavingDisplay: leavingStyle?.display ?? null,
        leavingBridgeOwner: leaving?.getAttribute("data-geometry-snapshot-owner") ?? null,
        leavingLayoutWidth: leaving?.offsetWidth ?? null,
        leavingLayoutHeight: leaving?.offsetHeight ?? null,
        geometryBridge: bridge ? {
          tab: bridgeTab ?? null,
          rect: rect(bridge),
          opacity: Number(bridgeStyle?.opacity ?? 0),
          inert: bridge.inert,
          ariaHidden: bridge.getAttribute("aria-hidden"),
          pointerEvents: bridgeStyle?.pointerEvents ?? null,
        } : null,
        activeAnimationName: activeStyle?.animationName ?? "none",
        leavingAnimationName: leavingStyle?.animationName ?? "none",
        activeAnimationDuration: activeStyle?.animationDuration ?? "0s",
        leavingAnimationDuration: leavingStyle?.animationDuration ?? "0s",
        activeAnimations: active?.getAnimations().map((animation) => ({
          currentTime: animation.currentTime,
          playState: animation.playState,
          duration: animation.effect?.getTiming().duration ?? null,
          easing: animation.effect?.getTiming().easing ?? null,
        })) ?? [],
        leavingAnimations: leaving?.getAnimations().map((animation) => ({
          currentTime: animation.currentTime,
          playState: animation.playState,
          duration: animation.effect?.getTiming().duration ?? null,
          easing: animation.effect?.getTiming().easing ?? null,
        })) ?? [],
        motionCurve: motionStyle.getPropertyValue("--ease-editor-crossfade").trim(),
        siblingMotionCurve: motionStyle.getPropertyValue("--ease-editor-sibling").trim(),
        motionTokens: {
          scale: Number(motionStyle.getPropertyValue("--motion-scale")),
          rate: Number(motionStyle.getPropertyValue("--editor-workspace-playback-rate")),
          siblingMs: (() => {
            const value = motionStyle.getPropertyValue("--motion-editor-sibling").trim();
            const time = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/.exec(value);
            if (!time) throw new Error(`Invalid sibling CSS time: ${value}`);
            return Number(time[1]) * (time[2] === "s" ? 1000 : 1);
          })(),
          siblingReducedMs: (() => {
            const value = motionStyle.getPropertyValue("--motion-editor-sibling-reduced").trim();
            const time = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/.exec(value);
            if (!time) throw new Error(`Invalid reduced sibling CSS time: ${value}`);
            return Number(time[1]) * (time[2] === "s" ? 1000 : 1);
          })(),
        },
        activePointerEvents: activeStyle?.pointerEvents ?? null,
        leavingPointerEvents: leavingStyle?.pointerEvents ?? null,
        activeInert: active?.inert,
        leavingInert: leaving?.inert,
        activeTransform: activeStyle?.transform ?? null,
        leavingTransform: leavingStyle?.transform ?? null,
        activeFilter: activeStyle?.filter ?? null,
        leavingFilter: leavingStyle?.filter ?? null,
        preparing: Boolean(active?.querySelector(".advanced-tab-preparing")),
        popoverRect: lastGeometry.popoverRect,
        popoverClass: popover?.className ?? "",
        popoverTransform: popoverStyle?.transform ?? "none",
        popoverTransformOrigin: popoverStyle?.transformOrigin ?? null,
        popoverOpacity: Number(popoverStyle?.opacity ?? 1),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        popoverAnimations: popover?.getAnimations().map((animation) => ({
          currentTime: animation.currentTime,
          playState: animation.playState,
        })) ?? [],
        viewportRect: lastGeometry.viewportRect,
        navRect: lastGeometry.navRect,
        navButtonRects: lastGeometry.navButtonRects,
        navLayout: lastGeometry.navLayout,
        navStyle: navStyle(nav),
        animatedChildren: frames < 4 || frames % 8 === 0 ? [
          active?.querySelector(":scope > .advanced-tab-scroll > .advanced-card > header, :scope > .advanced-tab-scroll > .advanced-card > h3, :scope > .advanced-tab-scroll > .advanced-card > .asset-library-header, :scope > .advanced-tab-scroll > .advanced-card > .provider-settings-header, :scope > .advanced-tab-scroll > .runtime-layout-designer > .runtime-layout-header, :scope > .advanced-tab-scroll > .runtime-theme-designer > .runtime-theme-header"),
          leaving?.querySelector(":scope > .advanced-tab-scroll > .advanced-card > header, :scope > .advanced-tab-scroll > .advanced-card > h3, :scope > .advanced-tab-scroll > .advanced-card > .asset-library-header, :scope > .advanced-tab-scroll > .advanced-card > .provider-settings-header, :scope > .advanced-tab-scroll > .runtime-layout-designer > .runtime-layout-header, :scope > .advanced-tab-scroll > .runtime-theme-designer > .runtime-theme-header"),
        ]
          .filter(Boolean)
          .map((node) => {
            const childStyle = getComputedStyle(node);
            return {
              animationName: childStyle.animationName,
              transform: childStyle.transform,
            };
          })
          .filter((item) => item.animationName.includes("advanced-tab-element")) : [],
      });
      frames += 1;
      // Before real input, keep a small presentation lead-in. A fixed frame
      // cap would expire in 7.5s at 240Hz, before a valid 30s actionability wait.
      if (!inputEvents.some(event => event.type === "pointerdown" && event.trusted)
        && history.length > 64) history.shift();
      if (running) {
        captureExpired = performance.now() - captureStartedAt >= 60_000;
        if (!captureExpired) requestAnimationFrame(sample);
      }
    };
    window.__strictAdvancedTransitionCapture = {
      history,
      longAnimationFrames,
      animationEvents,
      inputEvents,
      timing: () => ({ captureStartedAt, frames, captureExpired }),
        stop: () => {
          running = false;
          longFrameObserver?.disconnect();
          for (const type of ["pointerdown", "pointerup", "click"]) {
            document.removeEventListener(type, recordInput, true);
          }
        },
    };
    requestAnimationFrame(sample);
  });
  // Collector regression only: a user/actionability wait may precede the
  // trusted click. This delay is never used to await or settle product state.
  if (delayedCaptureInput && !captureInputDelayApplied
    && fromTab === "settings" && toTab === "providers") {
    captureInputDelayApplied = true;
    await new Promise(resolve => setTimeout(resolve, 9_000));
  }
  await targetTab.click();
  const trustedTargetInput = await page.evaluate(tab => (
    window.__strictAdvancedTransitionCapture?.inputEvents.filter(event =>
      event.type === "click" && event.trusted && !event.ghost
      && event.key === `advanced.tab.${tab}` && event.hitKey === event.key) ?? []
  ), toTab);
  assert(trustedTargetInput.length === 1,
    `${viewportName} ${fromTab}->${toTab}: expected one trusted click on the live target`,
    trustedTargetInput);
    // The layout designer is a large canvas. Keep the outgoing surface visible
    // until the ready target crossfades in; only one layer owns input, and the
    // outer workbench morphs independently without changing navigation geometry.
  if (fromTab === "layout" || toTab === "layout") {
    await page.waitForFunction((tab) => (
      document.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") === tab
      && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving")
    ), toTab, { timeout: 30_000 });
    if (isWideTab(fromTab) !== isWideTab(toTab)) {
      await page.waitForFunction(() => {
        const popover = document.querySelector(".toolbar-popover.advanced");
        return popover
          && !popover.classList.contains("is-morphing")
          && popover.getAnimations().every((animation) => animation.playState !== "running");
      }, undefined, { timeout: 10_000 });
    }
    const captured = await page.evaluate(() => {
      window.__strictAdvancedTransitionCapture?.stop();
      return window.__strictAdvancedTransitionCapture?.history ?? [];
    });
    const endWindow = await readNativeTransitionWindow(page, "end");
    if (endWindow) windowStates.push(endWindow);
    const captureDiagnostics = await page.evaluate(() => {
      const capture = window.__strictAdvancedTransitionCapture;
      return { timing: capture?.timing(), inputEvents: capture?.inputEvents,
        animationEvents: capture?.animationEvents, longAnimationFrames: capture?.longAnimationFrames };
    });
    assert(windowStates.every(state => state.bounds.windowState !== "minimized")
      && captured.every(sample => sample.pageHidden === false && sample.pageVisibility === "visible"),
    `${viewportName} ${fromTab}->${toTab}: transition visibility evidence unavailable`,
    { windowStates, captureDiagnostics, captured });
    assertMorphAnchor(captured, `${viewportName} ${fromTab}->${toTab}`);
    assertGeometryBridgeOwnership(viewportName, fromTab, toTab, captured);
    assert(captured.length >= 2, `${viewportName} ${fromTab}->${toTab}: direct canvas switch had no real frame samples`);
    const handoffFrames = captured.filter((sample) => sample.activeTab === toTab);
    assert(handoffFrames.length > 0, `${viewportName} ${fromTab}->${toTab}: target canvas never became active`);
    assert(captured.every((sample) => [fromTab, toTab].includes(sample.activeTab)
      && (sample.leavingTab === null || sample.leavingTab === fromTab)
      && sample.activeOpacity + sample.leavingOpacity >= 0.99
      && sample.activeOpacity + sample.leavingOpacity <= 1.01
      && (!sample.leavingTab || (sample.leavingInert && sample.leavingPointerEvents === "none"))
      && sample.navLayout.buttons.length === baseline.navLayout.buttons.length
      && sample.navLayout.height === baseline.navLayout.height
      && sample.navLayout.buttons.every((button, index) => (
        button.width === baseline.navLayout.buttons[index].width
        && button.height === baseline.navLayout.buttons[index].height))),
    `${viewportName} ${fromTab}->${toTab}: canvas handoff exposed a blank frame, dual input ownership, or navigation reflow`,
    { baseline, captured });
    const crossfadeFrames = handoffFrames.filter((sample) =>
      sample.activeOpacity > 0.05 && sample.activeOpacity < 0.95
      && sample.leavingOpacity > 0.05 && sample.leavingOpacity < 0.95);
    assert(crossfadeFrames.length >= 2,
      `${viewportName} ${fromTab}->${toTab}: ready canvas must crossfade over observable frames`,
      { baseline, windowStates, captureDiagnostics, captured });
    const settled = await page.evaluate(() => {
      const active = document.querySelector(".advanced-tab-content.is-active");
      const popover = document.querySelector(".toolbar-popover.advanced");
      const popoverRect = popover?.getBoundingClientRect();
      return {
        active: active?.getAttribute("data-tab") ?? null,
        inert: active?.inert ?? true,
        pointerEvents: active ? getComputedStyle(active).pointerEvents : "none",
        opacity: active ? Number(getComputedStyle(active).opacity) : 0,
        layoutMode: popover?.classList.contains("is-layout-mode") ?? false,
        transform: popover ? getComputedStyle(popover).transform : "none",
        geometryBridgeResidue: document.querySelectorAll(
          ".toolbar-popover-morph-ghost, [data-geometry-snapshot-owner]",
        ).length,
        popoverRect: popoverRect
          ? {
            left: popoverRect.left,
            top: popoverRect.top,
            width: popoverRect.width,
            height: popoverRect.height,
          }
          : null,
      };
    });
    const containerGeometryDelta = baseline.popover && settled.popoverRect
      ? Math.max(
        Math.abs(baseline.popover.left - settled.popoverRect.left),
        Math.abs(baseline.popover.top - settled.popoverRect.top),
        Math.abs(baseline.popover.width - settled.popoverRect.width),
        Math.abs(baseline.popover.height - settled.popoverRect.height),
      )
      : Number.POSITIVE_INFINITY;
    const expectsOuterMorph = containerGeometryDelta > 8;
    if (isWideTab(fromTab) !== isWideTab(toTab) && !reducedMotion && expectsOuterMorph) {
      const morphFrames = captured.filter((sample) => sample.popoverClass.includes("is-morphing")
        && sample.popoverAnimations.some((animation) => animation.playState === "running")
        && !isIdentityTransform(sample.popoverTransform));
      assert(morphFrames.length >= 2,
        `${viewportName} ${fromTab}->${toTab}: compact/wide mode switch did not visibly morph the outer Editor container`,
        { baseline, captured, settled, containerGeometryDelta });
    }
    assert(settled.active === toTab && !settled.inert && settled.pointerEvents !== "none"
      && settled.opacity >= 0.99 && settled.layoutMode === isWideTab(toTab)
      && isIdentityTransform(settled.transform) && settled.geometryBridgeResidue === 0,
    `${viewportName} ${fromTab}->${toTab}: direct canvas switch did not settle to one interactive target`, settled);
    return {
      fromTab,
      toTab,
      mode: "prepared-canvas-direct-commit",
      frames: captured,
      settled,
      containerGeometryDelta,
      expectsOuterMorph,
      windowStates,
      captureDiagnostics,
    };
  }
  try {
    await page.waitForFunction(([from, to]) => {
      const viewport = document.querySelector(".advanced-tab-viewport");
      return viewport?.querySelector(".advanced-tab-content.is-leaving")?.getAttribute("data-tab") === from
        && viewport?.querySelector(".advanced-tab-content.is-active.is-entering")?.getAttribute("data-tab") === to;
    }, [fromTab, toTab], { timeout: 30_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      active: document.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") ?? null,
      layers: [...document.querySelectorAll(".advanced-tab-content")].map((node) => ({
        tab: node.getAttribute("data-tab"),
        className: node.className,
        hidden: node.hasAttribute("hidden"),
      })),
    }));
    throw new Error(`${viewportName} ${fromTab}->${toTab}: transition layers did not mount\n${JSON.stringify(diagnostic, null, 2)}\n${error.message}`);
  }
  await page.waitForFunction((tab) => (
    document.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") === tab
    && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving")
  ), toTab, { timeout: 30_000 });
  if (isWideTab(fromTab) !== isWideTab(toTab)) {
    await page.waitForFunction(() => {
      const popover = document.querySelector(".toolbar-popover.advanced");
      return popover
        && !popover.classList.contains("is-morphing")
        && popover.getAnimations().every((animation) => animation.playState !== "running");
    }, undefined, { timeout: 10_000 });
  }
  const captured = await page.evaluate(() => {
    window.__strictAdvancedTransitionCapture?.stop();
    return {
      history: window.__strictAdvancedTransitionCapture?.history ?? [],
      longAnimationFrames: window.__strictAdvancedTransitionCapture?.longAnimationFrames ?? [],
      animationEvents: window.__strictAdvancedTransitionCapture?.animationEvents ?? [],
      inputEvents: window.__strictAdvancedTransitionCapture?.inputEvents ?? [],
      captureTiming: window.__strictAdvancedTransitionCapture?.timing(),
    };
  });
  const frames = captured.history;
  frames.longAnimationFrames = captured.longAnimationFrames;
  frames.animationEvents = captured.animationEvents;
  frames.inputEvents = captured.inputEvents;
  fs.writeFileSync(path.join(outputDir, `${viewportName}-${fromTab}-${toTab}-input.json`),
    JSON.stringify({ fromTab, toTab, inputEvents: captured.inputEvents,
      captureTiming: captured.captureTiming }, null, 2));
  assert(!captured.captureTiming?.captureExpired
    && frames.at(-1)?.at >= trustedTargetInput[0].at,
  `${viewportName} ${fromTab}->${toTab}: capture did not cover the actual input`,
  { captureTiming: captured.captureTiming, lastFrame: frames.at(-1)?.at,
    trustedTargetInput });
  assertStrictTransition(viewportName, fromTab, toTab, frames, baseline, reducedMotion);
  const settled = await page.evaluate(() => {
    const popover = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
    const active = popover?.querySelector(".advanced-tab-content.is-active");
    const summarizeAnimations = (node) => node?.getAnimations().map((animation) => ({
      playState: animation.playState,
      currentTime: animation.currentTime,
      duration: animation.effect?.getTiming().duration,
      easing: animation.effect?.getTiming().easing,
    })) ?? [];
    const ghosts = [...document.querySelectorAll(".toolbar-popover-morph-ghost")];
    const layers = [...(popover?.querySelectorAll(".advanced-tab-content") ?? [])].map((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        tab: node.getAttribute("data-tab"),
        className: node.className,
        hidden: node.hasAttribute("hidden"),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        inert: node.inert,
        ariaHidden: node.getAttribute("aria-hidden"),
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      };
    });
    return {
      active: active?.getAttribute("data-tab") ?? null,
      geometryBridgeOwnerResidue: document.querySelectorAll("[data-geometry-snapshot-owner]").length,
      layers,
      activeOpacity: Number(active ? getComputedStyle(active).opacity : 0),
      activePointerEvents: active ? getComputedStyle(active).pointerEvents : "none",
      layoutMode: popover?.classList.contains("is-layout-mode") ?? false,
      popoverClass: popover?.className ?? "",
      popoverInlineTransform: popover?.style.transform ?? "",
      popoverTransform: popover ? getComputedStyle(popover).transform : "none",
      popoverAnimations: summarizeAnimations(popover),
      ghosts: ghosts.map((ghost) => ({
        className: ghost.className,
        inlineTransform: ghost.style.transform,
        computedTransform: getComputedStyle(ghost).transform,
        animations: summarizeAnimations(ghost),
      })),
    };
  });
  Object.assign(settled, summarizeSettledAdvancedLayers(settled.layers,
    await page.evaluate(() => window.__advancedWarmPrepaintPixelQualified === true)));
  assert(
    settled.active === toTab
      && settled.visibleLayers === 1
      && settled.activeOpacity >= 0.99
      && settled.activePointerEvents !== "none",
    `${viewportName} ${fromTab}->${toTab}: transition residue remained`,
    settled,
  );
  assert(
    settled.ghosts.length === 0,
    `${viewportName} ${fromTab}->${toTab}: morph ghost remained after the real popover settled`,
    settled,
  );
  assert(settled.geometryBridgeOwnerResidue === 0,
    `${viewportName} ${fromTab}->${toTab}: stale geometry bridge still owned a page`, settled);
  assert(settled.layoutMode === isWideTab(toTab), `${viewportName} ${fromTab}->${toTab}: final layout mode was wrong`, settled);
  assert(isNearIdentityTransform(settled.popoverTransform),
    `${viewportName} ${fromTab}->${toTab}: popover transform residue remained`,
    {
      settled,
      finalFrames: frames.slice(-8).map((sample) => ({
        at: sample.at,
        activeTab: sample.activeTab,
        leavingTab: sample.leavingTab,
        popoverClass: sample.popoverClass,
        popoverTransform: sample.popoverTransform,
        popoverAnimations: sample.popoverAnimations,
      })),
      animationEvents: captured.animationEvents,
    });
  return { fromTab, toTab, frames, settled, animationEvents: captured.animationEvents,
    inputEvents: captured.inputEvents, captureTiming: captured.captureTiming,
    longAnimationFrames: captured.longAnimationFrames };
}

async function ready(url) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server not ready: ${url}`);
}

async function captureGeometryBridgeInterruption(page, viewportName) {
  await page.evaluate(() => {
    const frames = [];
    let running = true;
    const sample = () => {
      if (!running) return;
      const root = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
      const active = root?.querySelector(".advanced-tab-content.is-active");
      const leaving = root?.querySelector(".advanced-tab-content.is-leaving");
      const bridge = document.querySelector(".toolbar-popover-morph-ghost");
      const bridgeTab = bridge?.querySelector(".advanced-tab-content.is-active")?.dataset.tab ?? null;
      const rootStyle = root ? getComputedStyle(root) : null;
      const rootRect = root?.getBoundingClientRect();
      frames.push({
        at: performance.now(),
        phase: root?.querySelector(".advanced-tools-panel")?.className ?? null,
        active: active?.dataset.tab ?? null,
        activeDisplay: active ? getComputedStyle(active).display : null,
        leaving: leaving?.dataset.tab ?? null,
        leavingDisplay: leaving ? getComputedStyle(leaving).display : null,
        bridgeTab,
        bridgeInert: bridge?.inert ?? null,
        morphRunning: root?.getAnimations().some(animation => animation.playState === "running"
          && !("animationName" in animation)
          && animation.effect?.getKeyframes().some(frame =>
            typeof frame.transform === "string" && frame.transform.includes("scale("))) ?? false,
        transformOrigin: rootStyle?.transformOrigin ?? null,
        rect: rootRect ? { left: rootRect.left, top: rootRect.top,
          right: rootRect.right, bottom: rootRect.bottom } : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        ghostHasFocus: bridge?.contains(document.activeElement) ?? false,
        markers: [...(root?.querySelectorAll("[data-geometry-snapshot-owner]") ?? [])]
          .map(node => node.dataset.tab),
      });
      requestAnimationFrame(sample);
    };
    window.__geometryBridgeInterruption = { frames, stop: () => { running = false; } };
    requestAnimationFrame(sample);
  });
  const handoffs = [];
  // Keyboard activation avoids Playwright's pointer stability wait: these
  // are real user actions while the outer morph is still moving.
  for (const tab of ["theme", "layout", "settings"]) {
    const button = page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`).first();
    await button.focus();
    await button.press("Enter");
    await page.waitForFunction(tab => {
      const root = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
      return root?.querySelector(`.advanced-tab-content.is-active.is-entering[data-tab="${tab}"]`);
    }, tab, { timeout: 30000 });
    handoffs.push(await page.evaluate(() => {
      const root = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
      const active = root?.querySelector(".advanced-tab-content.is-active");
      return {
        tab: active?.dataset.tab,
        running: active?.getAnimations().some(animation => animation.playState === "running"
          || animation.playState === "paused") ?? false,
      };
    }));
  }
  await page.waitForFunction(() => {
    const root = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
    const panel = root?.querySelector(".advanced-tools-panel");
    return panel?.classList.contains("is-tab-idle")
      && panel.querySelector(".advanced-tab-content.is-active")?.dataset.tab === "settings"
      && !root.classList.contains("is-morphing")
      && !document.querySelector(".toolbar-popover-morph-ghost, [data-geometry-snapshot-owner]");
  }, undefined, { timeout: 15000 });
  const frames = await page.evaluate(() => {
    window.__geometryBridgeInterruption.stop();
    return window.__geometryBridgeInterruption.frames;
  });
  assert(handoffs.length === 3 && handoffs.every(handoff => handoff.running),
    `${viewportName}: geometry interruption did not reach three live handoffs`, handoffs);
  assert(frames.length >= 4 && frames.every(frame => frame.active && frame.activeDisplay !== "none"
    && frame.markers.every(tab => tab === frame.bridgeTab)
    && (frame.leavingDisplay !== "none" || frame.leaving === frame.bridgeTab)
    && (frame.bridgeTab === null || frame.bridgeInert)),
  `${viewportName}: stale geometry snapshot hid another page during interruption`, frames);
  assert(frames.every(frame => !frame.ghostHasFocus
    && (!frame.morphRunning || frame.transformOrigin?.split(/\s+/).slice(0, 2)
      .every(value => Math.abs(parseFloat(value)) <= 0.01))),
  `${viewportName}: interrupted morph changed its measured anchor or ghost captured focus`, frames);
  assert(frames.every(frame => !frame.reducedMotion || !frame.morphRunning
    || (frame.rect && frame.rect.left >= -1 && frame.rect.top >= -1
      && frame.rect.right <= frame.viewport.width + 1
      && frame.rect.bottom <= frame.viewport.height + 1)),
  `${viewportName}: interrupted reduced morph escaped its viewport`, frames);
  return { handoffs, frames };
}

function stop(child) {
  if (!child?.pid) return;
  try {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {}
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(absolute) : [absolute];
  });
}

async function verifyGameCliPreviewAssets() {
  const distRoot = path.join(root, "GameCli_framework", "dist");
  const assetRoot = path.join(distRoot, "assets");
  assert(fs.existsSync(path.join(distRoot, "index.html")), "GameCLI preview index is missing");
  assert(fs.existsSync(assetRoot), "GameCLI preview asset directory is missing");
  const files = collectFiles(assetRoot).filter((file) => /\.(?:js|css)$/i.test(file));
  assert(files.length > 0, "GameCLI preview contains no JS/CSS assets");
  for (const file of files) {
    const relative = path.relative(distRoot, file).replace(/\\/g, "/");
    const response = await fetch(`${editorUrl}/gamecli-preview/${relative}`, { cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    assert(response.ok, `GameCLI preview asset is not served: ${relative}`, {
      status: response.status,
      contentType,
    });
    if (file.endsWith(".js")) {
      assert(contentType.includes("javascript"), `GameCLI preview JS has the wrong MIME: ${relative}`, { contentType });
    } else {
      assert(contentType.includes("text/css"), `GameCLI preview CSS has the wrong MIME: ${relative}`, { contentType });
    }
  }
}

async function runViewport(browser, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: Number(process.env.ADVANCED_TOOLS_DPR || 1),
    reducedMotion: process.env.ADVANCED_TOOLS_REDUCED_MOTION === "1" ? "reduce" : "no-preference",
  });
  try {
    // The application emits canonical loopback asset URLs. Serve their real
    // bytes from this run's isolated backend, never a user's port 8278.
    await page.route("http://127.0.0.1:8278/api/project/assets/**", async (route) => {
      const response = await route.fetch({ url: isolatedAssetUrl(route.request().url()) });
      await route.fulfill({ response });
    });
    const errors = [];
    const failedRequests = [];
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("requestfailed", (request) => failedRequests.push(request));
    await page.goto(`${editorUrl}/`, { waitUntil: "domcontentloaded" });
    await page.locator(".project-import-button input").first().waitFor({ state: "attached", timeout: 30_000 });
    await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some((input) => input instanceof HTMLInputElement && !input.disabled), undefined, { timeout: 30_000 });
    await page.locator(".project-import-button input").first().setInputFiles(fixture);
    // Import enters the editor itself; clicking a cached card here races it.
    await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 90_000 });
    await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"), undefined, { timeout: 15_000 });
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator(".toolbar-popover.advanced.is-open").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => {
      const popover = document.querySelector(".toolbar-popover.advanced.is-open");
      const animations = popover?.getAnimations({ subtree: true }) ?? [];
      return popover?.classList.contains("is-entered")
        && animations.every(animation => animation.playState === "finished" || animation.playState === "idle");
    }, undefined, { timeout: 30_000 });
    const warmPrepaintEvidence = await qualifyWarmPrepaintPixels(page, viewport);
    const softenedWorkspace = await page.evaluate(() => {
      const body = document.querySelector(".editor-workspace-body");
      const palette = document.querySelector(".node-palette");
      const flow = document.querySelector(".flow-surface");
      const bodyStyle = body ? getComputedStyle(body) : null;
      const paletteStyle = palette ? getComputedStyle(palette) : null;
      const flowStyle = flow ? getComputedStyle(flow) : null;
      const paletteRect = palette?.getBoundingClientRect();
      const filteredPaletteAncestors = [];
      for (let node = palette; node; node = node.parentElement) {
        const filter = getComputedStyle(node).filter;
        if (filter !== "none") filteredPaletteAncestors.push({ className: node.className, filter });
      }
      return {
        inert: Boolean(body?.inert),
        visibility: bodyStyle?.visibility ?? "missing",
        bodyFilter: bodyStyle?.filter ?? "none",
        flowFilter: flowStyle?.filter ?? "none",
        filteredPaletteAncestors,
        paletteDisplay: paletteStyle?.display ?? "missing",
        paletteVisibility: paletteStyle?.visibility ?? "missing",
        paletteRect: paletteRect && {
          left: paletteRect.left, top: paletteRect.top, width: paletteRect.width, height: paletteRect.height,
          right: paletteRect.right, bottom: paletteRect.bottom,
        },
      };
    });
    assert(softenedWorkspace.inert
      && softenedWorkspace.visibility !== "hidden"
      && softenedWorkspace.bodyFilter === "none"
      && softenedWorkspace.flowFilter.includes("blur")
      && softenedWorkspace.filteredPaletteAncestors.length === 0
      && softenedWorkspace.paletteDisplay !== "none"
      && softenedWorkspace.paletteVisibility !== "hidden"
      && softenedWorkspace.paletteRect?.width > 0
      && softenedWorkspace.paletteRect?.height > 0
      && softenedWorkspace.paletteRect.left >= 0
      && softenedWorkspace.paletteRect.right <= viewport.width
      && softenedWorkspace.paletteRect.top >= 0
      && softenedWorkspace.paletteRect.bottom <= viewport.height,
    `${viewport.name}: Options must retain the workspace geometry, show the node controls, and soften the background without allowing edits`,
    softenedWorkspace);
    const layoutTab = page.locator('[data-help-key="advanced.tab.layout"]:visible').first();
    await layoutTab.waitFor({ state: "visible", timeout: 30_000 });
    const settingsGeometry = await page.evaluate(() => {
      const popover = document.querySelector(".toolbar-popover.advanced");
      const viewport = document.querySelector(".advanced-tab-viewport");
      const scroll = document.querySelector(".advanced-tab-content.is-active .advanced-tab-scroll");
      const rect = (node) => {
        const value = node?.getBoundingClientRect();
        return value ? { top: value.top, bottom: value.bottom, height: value.height } : null;
      };
      return {
        popoverClass: popover?.className ?? "",
        panelClass: document.querySelector(".advanced-tools-panel")?.className ?? "",
        viewport: rect(viewport),
        popover: rect(popover),
        scrollHeight: scroll?.scrollHeight ?? 0,
        clientHeight: scroll?.clientHeight ?? 0,
        viewportHeight: window.innerHeight,
        visualViewport: window.visualViewport ? { height: window.visualViewport.height, offsetTop: window.visualViewport.offsetTop } : null,
        expectedAvailable: window.innerHeight - (viewport?.getBoundingClientRect().top ?? 0) - 12,
        inlineHeight: viewport?.getAttribute("style") ?? "",
        computedHeight: viewport ? getComputedStyle(viewport).height : "",
      };
    });
    assert(
      !settingsGeometry.popoverClass.includes("is-layout-mode")
        && !settingsGeometry.panelClass.includes("layout-mode"),
      `${viewport.name}: project settings was incorrectly forced into the wide layout workspace`,
      settingsGeometry,
    );
    if (settingsGeometry.scrollHeight > 520) {
      assert(
        settingsGeometry.viewport && settingsGeometry.popover
          && settingsGeometry.popover.bottom - settingsGeometry.viewport.bottom <= 24,
        `${viewport.name}: project settings panel stopped before the popover bottom`,
        settingsGeometry,
      );
    }
    const settingsTab = page.locator('[data-help-key="advanced.tab.settings"]:visible').first();
    if (await settingsTab.getAttribute("data-glass-selected") !== "true") {
      await settingsTab.click({ force: true });
      await page.waitForFunction(() => {
        const panel = document.querySelector(".advanced-tools-panel");
        const active = panel?.querySelector(".advanced-tab-content.is-active");
        const animations = panel?.getAnimations({ subtree: true }) ?? [];
        return panel?.classList.contains("is-tab-idle")
          && active?.dataset.tab === "settings"
          && animations.every(animation => animation.playState === "finished" || animation.playState === "idle");
      }, undefined, { timeout: 10_000 });
    }
    const reducedMotion = process.env.ADVANCED_TOOLS_REDUCED_MOTION === "1";
    const primaryTransition = await captureStrictTransition(page, viewport.name, "settings", "layout", reducedMotion);
    const detachedPreviewCancellations = [];
      const navGeometry = await page.evaluate(() => {
        const popover = document.querySelector(".toolbar-popover.advanced");
        const nav = document.querySelector(".advanced-tools-panel > nav.glass-selection-group");
        const viewport = nav?.querySelector(".glass-selection-viewport");
        const track = nav?.querySelector(".glass-selection-track");
        const buttons = [...(nav?.querySelectorAll("button") ?? [])];
        const rect = (node) => {
          const value = node?.getBoundingClientRect();
          return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
        };
        return {
          popover: rect(popover),
          nav: rect(nav),
          viewport: rect(viewport),
          track: rect(track),
          buttons: buttons.map(rect),
          buttonRows: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
        };
      });
      assert(navGeometry.buttonRows <= 2, `${viewport.name}: advanced tabs wrapped into too many rows`, navGeometry);
      assert(navGeometry.buttons.every((button) => button && button.width < navGeometry.nav.width * 0.42), `${viewport.name}: advanced tab button stretched to the full nav width`, navGeometry);
      const additionalTransitions = [];
      for (const [fromTab, toTab] of [
        ["layout", "theme"],
        ["theme", "settings"],
        ["settings", "providers"],
        // Re-enter immediately after settle: queued idle/resize measurements
        // from the outgoing panel must not resize the next crossfade.
        ["providers", "settings"],
        ["settings", "providers"],
      ]) {
        additionalTransitions.push(await captureStrictTransition(page, viewport.name, fromTab, toTab, reducedMotion));
      }
      for (let repeat = 1; repeat < repeatTransitions; repeat += 1) {
        // Repeat the actual wide-to-compact defect route as well as regular
        // tabs. Repeating only providers/settings cannot stress the snapshot
        // lifecycle exercised by theme/settings on narrow screens.
        for (const [fromTab, toTab] of [
          ["providers", "theme"],
          ["theme", "settings"],
          ["settings", "providers"],
          ["providers", "settings"],
          ["settings", "providers"],
        ]) {
          additionalTransitions.push(await captureStrictTransition(page, viewport.name, fromTab, toTab, reducedMotion));
        }
      }
    const geometryBridgeInterruption = await captureGeometryBridgeInterruption(page, viewport.name);
    // Check the entire navigation sequence, not just the first crossfade.
    for (const request of failedRequests) {
      // Keep raw cancellations as evidence only after independent verification.
      // Live-frame failures, bad rechecks and unapproved URLs remain failures.
      const evidence = await verifyDetachedPreviewCancellation(request, page, editorUrl, isolatedAssetUrl(request.url()));
      if (evidence) detachedPreviewCancellations.push(evidence);
      else errors.push(`requestfailed ${request.url()} ${request.failure()?.errorText ?? ""}`);
    }
    assert(errors.length === 0, `${viewport.name}: browser errors`, errors);
    return { viewport, warmPrepaintEvidence, primaryTransition, settingsGeometry, navGeometry, additionalTransitions,
      geometryBridgeInterruption, detachedPreviewCancellations };
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `${viewport.name}-failure.png`) }).catch(() => {});
    throw new Error(`${viewport.name}: ${error.stack || error}`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function qualifyWarmPrepaintPixels(page, viewport) {
  const initial = await page.evaluate(() => {
    const warm = document.querySelector('.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .advanced-tab-content.is-warm[data-tab="layout"]');
    if (!(warm instanceof HTMLElement)) return null;
    const style = getComputedStyle(warm);
    return { opacity: style.opacity, inert: warm.inert, ariaHidden: warm.getAttribute("aria-hidden"),
      pointerEvents: style.pointerEvents };
  });
  if (!initial || initial.opacity === "0") return { kind: "no-nonzero-prepaint", initial };
  assert(initial.opacity === "0.001" && initial.inert && initial.ariaHidden === "true"
    && initial.pointerEvents === "none", `${viewport.name}: unsafe warm presentation`, initial);
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => !document.querySelector(".hover-help-card"));
  let override;
  const captureStates = [];
  const captureState = async (label, points = []) => {
    const state = await page.evaluate(points => {
      const describe = node => node instanceof Element
        ? `${node.tagName.toLowerCase()}.${String(node.className).split(/\s+/).slice(0, 3).join(".")}` : null;
      const animations = document.getAnimations().map(animation => ({
        target: describe(animation.effect?.target), name: animation.animationName ?? null,
        state: animation.playState, pending: animation.pending, time: animation.currentTime,
        timing: animation.effect?.getComputedTiming(),
      }));
      const frames = [...document.querySelectorAll("iframe")].map(frame => {
        try {
          return { src: frame.src, animations: frame.contentDocument?.getAnimations().map(animation => ({
            target: describe(animation.effect?.target), state: animation.playState,
            pending: animation.pending, time: animation.currentTime,
          })) ?? null };
        } catch { return { src: frame.src, inaccessible: true }; }
      });
      const hit = points.map(point => ({ point,
        elements: document.elementsFromPoint(point.x, point.y).slice(0, 6).map(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { target: describe(node), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          opacity: style.opacity, filter: style.filter, transform: style.transform };
      }) }));
      return { at: performance.now(), visibility: document.visibilityState, animations, frames, hit };
    }, points);
    captureStates.push({ label, ...state });
    fs.writeFileSync(path.join(outputDir, `${viewport.name}-warm-capture-states.json`),
      JSON.stringify(captureStates, null, 2));
  };
  try {
    const paused = await freezeSettledVisualAnimations(page);
    assert(paused.every(animation => !animation.pending && animation.playState === "paused"),
      `${viewport.name}: pixel capture started before animation pause applied`, paused);
    const screenshot = name => page.screenshot({
      path: path.join(outputDir, `${viewport.name}-warm-${name}.png`), scale: "css",
    });
    await captureState("before-baseline");
    const baseline = await screenshot("prepaint");
    await captureState("after-baseline");
    const control = await screenshot("control");
    await captureState("after-control");
    const controlDiff = await comparePngBuffers(page, baseline, control);
    await captureState("control-comparison", controlDiff.outlierSamples);
    assert(controlDiff.pixelsOverOneLevel === 0, `${viewport.name}: unstable prepaint pixel control`, controlDiff);
    override = await page.addStyleTag({ content:
      '.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .advanced-tab-content.is-warm[data-tab="layout"]{opacity:0!important}' });
    assert(await page.evaluate(() => getComputedStyle(document.querySelector(
      '.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .advanced-tab-content.is-warm[data-tab="layout"]')).opacity) === "0",
      `${viewport.name}: prepaint zero-opacity comparison did not apply`);
    const withoutPrepaint = await screenshot("opacity-zero");
    await captureState("after-opacity-zero");
    const diff = await comparePngBuffers(page, baseline, withoutPrepaint, control);
    assert(diff.pixelsExceedingControlEnvelope === 0,
      `${viewport.name}: hidden prepaint changes visible pixels beyond the unchanged one-level allowance`, diff);
    await page.evaluate(() => { window.__advancedWarmPrepaintPixelQualified = true; });
    return { kind: "actual-viewport-prepaint-vs-zero-opacity-pixel-proof", initial, controlDiff, diff };
  } finally {
    await override?.evaluate(node => node.remove());
    await resumeSettledVisualAnimations(page);
  }
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  const headful = process.env.ADVANCED_TOOLS_HEADFUL === "1";
  const angle = process.env.ADVANCED_TOOLS_ANGLE;
  assert(!angle || angle === "d3d11", "Unsupported explicit acceptance renderer");
  const browserDiagnosticsByViewport = [];
  const allViewports = [
    { name: "1080p", width: 1920, height: 1080 },
    { name: "1440p", width: 2560, height: 1440 },
    { name: "4k", width: 3840, height: 2160 },
    { name: "reported1040", width: 1040, height: 559 },
    { name: "reported", width: 1440, height: 900 },
    { name: "wide", width: 2560, height: 1392 },
    { name: "wide1440", width: 2560, height: 1440 },
    { name: "short", width: 757, height: 299 },
    { name: "narrow", width: 390, height: 844 },
  ];
  const requestedViewport = process.env.ADVANCED_TOOLS_VIEWPORT || "1080p,1440p,4k";
  const requestedNames = requestedViewport.split(",").map(name => name.trim());
  assert(requestedNames.every(name => allViewports.some(viewport => viewport.name === name)),
    `unknown ADVANCED_TOOLS_VIEWPORT: ${requestedViewport}`, allViewports);
  const viewports = allViewports.filter(viewport => requestedNames.includes(viewport.name));
  assert(viewports.length > 0, `empty ADVANCED_TOOLS_VIEWPORT: ${requestedViewport}`);

  backendPort = await freePort();
  editorPort = await freePort();
  if (backendPort === editorPort) editorPort = await freePort();
  backendUrl = `http://127.0.0.1:${backendPort}`;
  const dataDir = path.join(outputDir, "runs", new Date().toISOString().replace(/[:.]/g, "-"), "isolated-data");
  const backend = spawn("python", ["backend_launcher.py"], {
    cwd: path.join(root, "backend"),
    env: { ...process.env, AGENTVN_EDITOR_DATA_DIR: dataDir,
      AGENTVN_BACKEND_DATA_DIR: dataDir, DATABASE_PATH: path.join(dataDir, "vn_engine.db"),
      AGENTVN_BACKEND_PORT: String(backendPort), AGENTVN_LEGACY_DATABASE_PATHS: "" },
    windowsHide: true, stdio: "ignore",
  });
  let browser, editor;
  try {
    await ready(`${backendUrl}/api/health`);
    if (backend.exitCode !== null || backend.signalCode !== null)
      throw new Error("Owned backend exited before readiness");
    const previousBackendUrl = process.env.VITE_BACKEND_URL;
    process.env.VITE_BACKEND_URL = backendUrl;
    try {
    editor = await startOwnedViteServer({ root: path.join(root, "editor"), port: editorPort,
        logFile: path.join(outputDir, "editor.log") });
    } finally {
      if (previousBackendUrl === undefined) delete process.env.VITE_BACKEND_URL;
      else process.env.VITE_BACKEND_URL = previousBackendUrl;
    }
    editorUrl = editor.url;
    owner = {
      editor: { pid: editor.pid, runId: editor.runId, url: editor.url },
      backend: { pid: backend.pid, port: backendPort },
    };
    await ready(`${editorUrl}/`);
    await verifyGameCliPreviewAssets();
    for (const viewport of viewports) {
      console.log(`Testing Options transitions: ${viewport.name} (${viewport.width}x${viewport.height})`);
      // A fresh Chromium process per viewport prevents a prior high-resolution
      // surface from retaining compositor/GPU resources and starving later
      // frame-level transition samples. The per-viewport assertions remain
      // identical; only test-process lifetime is isolated.
      browser = await chromium.launch({ headless: !headful, args: angle ? [`--use-angle=${angle}`] : [] });
      try {
        const diagnostics = await browser.newBrowserCDPSession();
        const systemInfo = await diagnostics.send("SystemInfo.getInfo").catch(() => null);
        browserDiagnosticsByViewport.push({
          viewport: viewport.name,
          version: browser.version(),
          gpuRenderer: systemInfo?.gpu?.devices?.[0]?.deviceString ?? "unavailable",
          gpuFeatureStatus: systemInfo?.gpu?.featureStatus ?? null,
          requestedAngle: angle ?? "browser-default",
        });
        fs.writeFileSync(path.join(outputDir,"browser-diagnostics.json"),JSON.stringify(browserDiagnosticsByViewport,null,2));
        if(angle) assert(systemInfo?.gpu?.featureStatus?.gpu_compositing === "enabled"
          && systemInfo?.gpu?.featureStatus?.rasterization === "enabled",
          "Requested hardware-rendered acceptance is unavailable",systemInfo?.gpu);
        await diagnostics.detach().catch(() => {});
        results.push(await editor.run(() => runViewport(browser, viewport)));
      } finally {
        await browser.close().catch(() => {});
        browser = undefined;
      }
    }
  } finally {
    await browser?.close().catch(() => {});
    await editor?.stop();
    stop(backend);
  }
  const reducedMotion = process.env.ADVANCED_TOOLS_REDUCED_MOTION === "1";
  fs.writeFileSync(path.join(outputDir, reducedMotion ? "report-reduced-motion.json" : "report.json"), JSON.stringify({
    ok: true,
    repeatTransitions,
    at: new Date().toISOString(),
    reducedMotion,
    headful,
    collectorRegression: delayedCaptureInput
      ? { preClickDelayMs: 9_000, applied: captureInputDelayApplied,
        scope: "sampling-lifetime-only; product transition is not delayed" }
      : null,
    isolation: acceptancePaths,
    owner,
    browserDiagnosticsByViewport,
    results,
  }, null, 2));
  console.log(`advanced-tools-transition-regression-playwright: PASS (${outputDir})`);
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error));
  console.error(error.stack || error);
  process.exitCode = 1;
});
