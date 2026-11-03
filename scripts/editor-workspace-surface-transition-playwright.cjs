#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, viewports, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
// Importing read-only native frame samplers must not require a new/empty
// source-server output directory or prepare a second acceptance environment.
const acceptancePaths = require.main === module ? resolveAcceptancePaths() : null;
const output = acceptancePaths?.output;
const requested = (process.env.EDITOR_SURFACE_VIEWPORTS || "").split(",").map(value => value.trim()).filter(Boolean);
const reducedMotion = process.env.EDITOR_SURFACE_REDUCED === "1";
const deviceScaleFactor = Number(process.env.EDITOR_SURFACE_DPR || 1);
const headful = process.env.EDITOR_SURFACE_HEADFUL === "1";
// 2026-10-19: user requests 1.5x workbench playback. Keep the original frame,
// focus, hit/geometry and interruption assertions; rebase only its old clocks.
const workspaceMs = milliseconds => milliseconds / 1.5;
const matrix = requested.length
  ? viewports.filter(viewport => requested.includes(viewport.name))
  : ["1080p", "4k", "narrow"].map(name => viewports.find(viewport => viewport.name === name)).filter(Boolean);
const report = {
  runId,
  scope: "editor-top-level-workspace-surface-handoff",
  deviceScaleFactor,
  reducedMotion,
  headful,
  isolation: acceptancePaths,
  motionBaselines: {
    workspacePanelEntryMs: 360,
    workspacePanelExitMs: 240,
    source: "Git HEAD editor/src/styles/layout.css toolbar-popover-enter/exit before the current workbench implementation",
    advancedTabCrossfadeMs: 200,
    advancedTabSource: "plans/ACTIVE_TASKS.md E1 historical effective timing; current strict browser regression asserts 400ms",
    topLevelIncomingContentMs: 200,
    topLevelOutgoingContentMs: 200,
    topLevelContentSource: "plans/ACTIVE_TASKS.md E1 RED capture recorded 200ms incoming content and no retained outgoing layer",
    containerTransitions: "GitHub contract retained by editor-page-transition-regression-playwright.cjs (1120ms enter, 1700ms home return, 960ms editor unload); this slice does not change these established paths",
  },
  status: "RUNNING",
  results: [],
};

function ensure(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
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

function inspectCloseBackgroundContinuity(close) {
  const samples = close.frames.map(frame => ({
    at: frame.at,
    blurPx: Number(/blur\(([\d.e+-]+)px\)/.exec(frame.workspaceFilter)?.[1] ?? 0),
    panelPresent: frame.panelPresent,
    ghostCount: frame.ghostCount,
  }));
  let minimum = Number.POSITIVE_INFINITY;
  const rebounds = [];
  for (const sample of samples) {
    minimum = Math.min(minimum, sample.blurPx);
    if (sample.blurPx > minimum + 0.02) rebounds.push({ ...sample, previousMinimumBlurPx: minimum });
  }
  return { samples, rebounds, maximumReboundPx: Math.max(0,
    ...rebounds.map(sample => sample.blurPx - sample.previousMinimumBlurPx)) };
}

async function waitForSurface(page, surface) {
  await page.waitForFunction(target => (
    document.querySelector(`[data-workspace-surface="${target}"]`)?.getAttribute("aria-current") === "page"
    && document.querySelector(`[data-workspace-task="${target}"]`)
  ), surface, { timeout: 30_000 });
}

async function waitForSurfaceTransitionSettled(page, surface) {
  await page.waitForFunction(target => {
    const popover = document.querySelector(".toolbar-popover.workspace-task-panel");
    const nav = document.querySelector(`[data-workspace-surface="${target}"]`);
    const presentation = popover?.querySelector(".toolbar-panel-presentation-layer")?.firstElementChild
      ?? popover?.firstElementChild;
    const ownedTransitionAnimations = [
      ...(popover?.getAnimations() ?? []),
      ...(presentation?.getAnimations() ?? []),
    ];
    const runningAnimations = ownedTransitionAnimations
      .some(animation => animation.playState === "running");
    return nav?.getAttribute("aria-current") === "page"
      && popover?.getAttribute("data-workspace-task") === target
      && !popover.inert
      && !popover.classList.contains("is-morphing")
      && !runningAnimations
      && !document.querySelector(".toolbar-popover-morph-ghost");
  }, surface, { timeout: 10_000 });
}

async function inspectPersistentWorkspace(page) {
  return page.evaluate(() => {
    const body = document.querySelector(".editor-workspace-body");
    const palette = document.querySelector(".node-palette");
    const flow = document.querySelector(".flow-surface");
    const paletteFilterAncestors = [];
    for (let node = palette; node; node = node.parentElement) {
      const filter = getComputedStyle(node).filter;
      if (filter !== "none") paletteFilterAncestors.push({ className: node.className, filter });
    }
    const panel = document.querySelector(".toolbar-popover.workspace-task-panel.is-open");
    const inspector = document.querySelector(".scene-editor-pane");
    const rect = node => {
      const box = node?.getBoundingClientRect();
      return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
    };
    const intersects = (a, b) => Boolean(a && b
      && a.left < b.left + b.width
      && a.left + a.width > b.left
      && a.top < b.top + b.height
      && a.top + a.height > b.top);
    const paletteRect = rect(palette);
    const panelRect = rect(panel);
    const inspectorRect = rect(inspector);
      const flowRect = rect(flow);
    const paletteHitSamples = Array.from(palette?.querySelectorAll("button") ?? [])
      .filter(button => {
        const box = button.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .slice(0, 3)
      .map(button => {
        const box = button.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const topmost = document.elementFromPoint(x, y);
        return {
          label: button.innerText.trim(),
          center: { x, y },
          topmostTag: topmost?.tagName ?? null,
          topmostClass: typeof topmost?.className === "string" ? topmost.className : null,
          topmostBelongsToPalette: Boolean(topmost && palette?.contains(topmost)),
        };
      });
    return {
      bodyVisible: Boolean(body && getComputedStyle(body).visibility !== "hidden"
        && Number(getComputedStyle(body).opacity) > 0.01),
      bodyFilter: body ? getComputedStyle(body).filter : "none",
      flowFilter: flow ? getComputedStyle(flow).filter : "none",
      flowFilterDuration: flow ? getComputedStyle(flow).transitionDuration : "0s",
      paletteFilterAncestors,
      bodyInert: Boolean(body?.inert),
      paletteVisible: Boolean(palette && getComputedStyle(palette).display !== "none"
        && getComputedStyle(palette).visibility !== "hidden"
        && rect(palette)?.width > 0 && rect(palette)?.height > 0),
      paletteRect,
      panelRect,
      paletteCoveredByPanel: intersects(paletteRect, panelRect),
      inspectorRect,
      inspectorVisible: Boolean(inspector && getComputedStyle(inspector).display !== "none"
        && getComputedStyle(inspector).visibility !== "hidden"
        && Number(getComputedStyle(inspector).opacity) > 0.01
        && inspectorRect?.width > 0 && inspectorRect?.height > 0),
      inspectorCoveredByPanel: intersects(inspectorRect, panelRect),
      panelRightWithinCanvasTrack: Boolean(panelRect && flowRect
        && panelRect.left + panelRect.width <= flowRect.left + flowRect.width + 1.5),
      panelRightInsetPx: Number.parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue("--workspace-task-right")) || null,
      paletteHitSamples,
      paletteClipped: Boolean(palette && (
        palette.getBoundingClientRect().left < 0
        || palette.getBoundingClientRect().right > innerWidth
        || palette.getBoundingClientRect().top < 0
        || palette.getBoundingClientRect().bottom > innerHeight
      )),
      flowRect,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

async function captureHandoff(page, from, to, { settleContentSelector } = {}) {
  await page.evaluate(({ fromSurface, toSurface }) => {
    const rectSnapshot = node => {
      const rect = node?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    };
    const viewportSnapshot = () => {
      const viewport = window.visualViewport;
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
        visualViewport: viewport ? {
          width: viewport.width,
          height: viewport.height,
          scale: viewport.scale,
          offsetLeft: viewport.offsetLeft,
          offsetTop: viewport.offsetTop,
        } : null,
      };
    };
    const capture = {
      frames: [],
      done: false,
      toSurface,
      settledFrameCount: 0,
      settledAt: null,
      viewportBaseline: viewportSnapshot(),
      baseline: rectSnapshot(document.querySelector(".toolbar-popover.workspace-task-panel")),
      workspaceBaseline: {
        palette: rectSnapshot(document.querySelector(".node-palette")),
        flow: rectSnapshot(document.querySelector(".flow-surface")),
        inspector: rectSnapshot(document.querySelector(".scene-editor-pane")),
      },
      animationCalls: [],
    };
    window.__editorSurfaceTransitionCapture = capture;
    const nativeAnimate = Element.prototype.animate;
    capture.restoreAnimate = nativeAnimate;
    Element.prototype.animate = function (...args) {
      if (this.closest?.(".toolbar-popover.workspace-task-panel")) {
        capture.animationCalls.push({
          at: performance.now(),
          target: this.className || this.tagName,
          timing: args[1] ?? null,
          keyframes: args[0] ?? null,
        });
      }
      return nativeAnimate.apply(this, args);
    };
    document.querySelector(`[data-workspace-surface="${toSurface}"]`)?.addEventListener("click", event => {
      capture.clickDetail = event.detail;
    }, { once: true });
    const sample = () => {
      const popover = document.querySelector(".toolbar-popover.workspace-task-panel");
      const style = popover ? getComputedStyle(popover) : null;
      const rect = popover?.getBoundingClientRect();
      const ghost = document.querySelector(".toolbar-popover-morph-ghost");
      const content = popover?.querySelector(".toolbar-panel-presentation-layer")?.firstElementChild
        ?? popover?.firstElementChild;
      const contentStyle = content ? getComputedStyle(content) : null;
      const palette = document.querySelector(".node-palette");
      const flow = document.querySelector(".flow-surface");
      const inspector = document.querySelector(".scene-editor-pane");
      const rectSnapshot = node => {
        const box = node?.getBoundingClientRect();
        return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
      };
      const paletteFilteredAncestors = [];
      for (let node = palette; node; node = node.parentElement) {
        const filter = getComputedStyle(node).filter;
        if (filter !== "none") paletteFilteredAncestors.push({ className: node.className, filter });
      }
      const paletteStyle = palette ? getComputedStyle(palette) : null;
      const paletteRect = palette?.getBoundingClientRect();
      const inspectorRect = inspector?.getBoundingClientRect();
      const panelRect = popover?.getBoundingClientRect();
      const palettePanelOverlap = Boolean(paletteRect && panelRect
        && paletteRect.left < panelRect.right
        && paletteRect.right > panelRect.left
        && paletteRect.top < panelRect.bottom
        && paletteRect.bottom > panelRect.top);
      const inspectorPanelOverlap = Boolean(inspectorRect && panelRect
        && inspectorRect.left < panelRect.right
        && inspectorRect.right > panelRect.left
        && inspectorRect.top < panelRect.bottom
        && inspectorRect.bottom > panelRect.top);
      const panelCenterHit = panelRect
        ? document.elementFromPoint(panelRect.left + panelRect.width / 2, panelRect.top + panelRect.height / 2)
        : null;
      capture.frames.push({
        at: performance.now(),
        viewport: viewportSnapshot(),
        selectedSurface: document.querySelector('[data-workspace-surface][aria-current="page"]')
          ?.getAttribute("data-workspace-surface") ?? null,
        task: popover?.getAttribute("data-workspace-task") ?? null,
        className: popover?.className ?? null,
        rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        opacity: style ? Number(style.opacity) : null,
        transform: style?.transform ?? "none",
        morphing: Boolean(popover?.classList.contains("is-morphing")),
        popoverAnimations: popover?.getAnimations().map(animation => ({
          playState: animation.playState,
          currentTime: animation.currentTime,
          duration: animation.effect?.getTiming().duration ?? null,
        })) ?? [],
        ghostPresent: Boolean(ghost),
        ghostOpacity: ghost ? Number(getComputedStyle(ghost).opacity) : null,
        workspaceFilter: (() => {
          const canvas = document.querySelector(".flow-surface");
          return canvas ? getComputedStyle(canvas).filter : null;
        })(),
        workspaceFilterDuration: (() => {
          const canvas = document.querySelector(".flow-surface");
          return canvas ? getComputedStyle(canvas).transitionDuration : null;
        })(),
        ghostAnimations: ghost?.getAnimations().map(animation => ({
          playState: animation.playState,
          currentTime: animation.currentTime,
          duration: animation.effect?.getTiming().duration ?? null,
          delay: animation.effect?.getTiming().delay ?? 0,
        })) ?? [],
        contentClass: content?.className ?? content?.tagName ?? null,
        contentOpacity: contentStyle ? Number(contentStyle.opacity) : null,
        contentAnimations: content?.getAnimations().map(animation => ({
          playState: animation.playState,
          currentTime: animation.currentTime,
          duration: animation.effect?.getTiming().duration ?? null,
        })) ?? [],
        workspacePresentation: {
          bodyVisibility: getComputedStyle(document.querySelector(".editor-workspace-body")).visibility,
          bodyFilter: getComputedStyle(document.querySelector(".editor-workspace-body")).filter,
          paletteRect: rectSnapshot(palette),
          paletteDisplay: paletteStyle?.display ?? "missing",
          paletteVisibility: paletteStyle?.visibility ?? "missing",
          paletteOpacity: Number(paletteStyle?.opacity ?? 0),
          paletteInert: Boolean(palette?.closest(".editor-workspace-body")?.inert),
          paletteFilteredAncestors,
          flowRect: rectSnapshot(flow),
          flowFilter: flow ? getComputedStyle(flow).filter : "none",
          inspectorRect: rectSnapshot(inspector),
          inspectorVisible: Boolean(inspector && getComputedStyle(inspector).display !== "none"
            && getComputedStyle(inspector).visibility !== "hidden"
            && Number(getComputedStyle(inspector).opacity) > 0.01
            && inspectorRect?.width > 0 && inspectorRect?.height > 0),
          inspectorPanelOverlap,
          palettePanelOverlap,
          panelCenterHit: panelCenterHit instanceof HTMLElement
            ? `${panelCenterHit.tagName.toLowerCase()}.${String(panelCenterHit.className).replaceAll(" ", ".")}`
            : panelCenterHit?.tagName ?? null,
        },
        fromSurface,
        toSurface,
      });
      const selectedSurface = document.querySelector('[data-workspace-surface][aria-current="page"]')
        ?.getAttribute("data-workspace-surface") ?? null;
      const transitionAnimations = [
        ...(popover?.getAnimations() ?? []),
        ...(content?.getAnimations() ?? []),
      ];
      const isSettled = Boolean(popover
        && selectedSurface === capture.toSurface
        && popover.getAttribute("data-workspace-task") === capture.toSurface
        && !popover.inert
        && !popover.classList.contains("is-morphing")
        && !ghost
        && style?.opacity === "1"
        && ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(style.transform)
        && (!contentStyle || (
          Number(contentStyle.opacity) >= 0.999
          && ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(contentStyle.transform)
        ))
        && transitionAnimations.every(animation => animation.playState !== "running"));
      capture.settledFrameCount = isSettled ? capture.settledFrameCount + 1 : 0;
      if (capture.settledFrameCount === 2) {
        capture.settledAt = performance.now();
        capture.done = true;
        capture.stopReason = "two-consecutive-settled-frames";
      }
      if (!capture.done && capture.frames.length < 4096) requestAnimationFrame(sample);
      else if (!capture.done) {
        capture.done = true;
        capture.stopReason = "safety-frame-limit";
      }
    };
    requestAnimationFrame(sample);
  }, { fromSurface: from, toSurface: to });

  await page.locator(`[data-workspace-surface="${to}"]:visible`).click();
  await waitForSurface(page, to);
  if (settleContentSelector) {
    await page.locator(settleContentSelector).waitFor({ state: "visible" });
    await page.waitForFunction(({ selector, target }) => {
      const popover = document.querySelector(".toolbar-popover.workspace-task-panel");
      const content = popover?.querySelector(selector);
      return popover
        && popover.getAttribute("data-workspace-task") === target
        && content
        && !popover.getAnimations({ subtree: true }).some(animation => animation.playState === "running")
        && !popover.classList.contains("is-morphing")
        && !document.querySelector(".toolbar-popover-morph-ghost");
    }, { selector: settleContentSelector, target: to }, { timeout: 15_000 });
  } else {
    await waitForSurfaceTransitionSettled(page, to);
  }
  try {
    await page.waitForFunction(() => (
      window.__editorSurfaceTransitionCapture?.settledFrameCount >= 2
    ), undefined, { timeout: 15_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const capture = window.__editorSurfaceTransitionCapture;
      const popover = document.querySelector(".toolbar-popover.workspace-task-panel");
      const content = popover?.querySelector(".toolbar-panel-presentation-layer")?.firstElementChild
        ?? popover?.firstElementChild;
      const summarizeAnimation = animation => ({
        playState: animation.playState,
        currentTime: animation.currentTime,
        duration: animation.effect?.getTiming().duration ?? null,
        targetClass: animation.effect?.target instanceof Element
          ? animation.effect.target.className : null,
        targetTestId: animation.effect?.target instanceof Element
          ? animation.effect.target.getAttribute("data-testid") : null,
      });
      return {
        toSurface: capture?.toSurface ?? null,
        settledFrameCount: capture?.settledFrameCount ?? null,
        lastFrames: capture?.frames.slice(-12) ?? [],
        live: {
          selectedSurface: document.querySelector('[data-workspace-surface][aria-current="page"]')
            ?.getAttribute("data-workspace-surface") ?? null,
          task: popover?.getAttribute("data-workspace-task") ?? null,
          panelClass: popover?.className ?? null,
          panelInert: Boolean(popover?.inert),
          panelOpacity: popover ? getComputedStyle(popover).opacity : null,
          panelTransform: popover ? getComputedStyle(popover).transform : null,
          contentClass: content?.className ?? content?.tagName ?? null,
          contentOpacity: content ? getComputedStyle(content).opacity : null,
          contentTransform: content ? getComputedStyle(content).transform : null,
          panelAnimations: popover?.getAnimations().map(summarizeAnimation) ?? [],
          contentAnimations: content?.getAnimations().map(summarizeAnimation) ?? [],
          ghostCount: document.querySelectorAll(".toolbar-popover-morph-ghost").length,
          flowFilter: document.querySelector(".flow-surface")
            ? getComputedStyle(document.querySelector(".flow-surface")).filter : null,
        },
      };
    });
    throw new Error(`Handoff did not produce two consecutive settled frames: ${JSON.stringify(diagnostic)}\n${error}`);
  }
  return page.evaluate(() => {
    const capture = window.__editorSurfaceTransitionCapture;
    capture.done = true;
    if (capture.restoreAnimate) Element.prototype.animate = capture.restoreAnimate;
    const popover = document.querySelector(".toolbar-popover.workspace-task-panel");
    const content = popover?.querySelector(".toolbar-panel-presentation-layer")?.firstElementChild
      ?? popover?.firstElementChild;
    const ownedTransitionAnimations = [
      ...(popover?.getAnimations() ?? []),
      ...(content?.getAnimations() ?? []),
    ];
    return {
      viewportBaseline: capture.viewportBaseline,
      baseline: capture.baseline,
      workspaceBaseline: capture.workspaceBaseline,
      frames: capture.frames,
      animationCalls: capture.animationCalls,
      clickDetail: capture.clickDetail,
      captureStopReason: capture.stopReason ?? "external-stop",
      final: {
        at: performance.now(),
        settledAt: capture.settledAt,
        settledFrameCount: capture.settledFrameCount,
        selectedSurface: document.querySelector('[data-workspace-surface][aria-current="page"]')
          ?.getAttribute("data-workspace-surface") ?? null,
        task: popover?.getAttribute("data-workspace-task") ?? null,
        className: popover?.className ?? null,
        inert: Boolean(popover?.inert),
        ghostCount: document.querySelectorAll(".toolbar-popover-morph-ghost").length,
      runningAnimationCount: ownedTransitionAnimations
        .filter(animation => animation.playState === "running").length,
      runningAnimations: ownedTransitionAnimations
        .filter(animation => animation.playState === "running")
        .map(animation => ({
          name: animation.animationName ?? null,
          currentTime: animation.currentTime,
          duration: animation.effect?.getTiming().duration ?? null,
          target: (() => {
            const target = animation.effect?.target;
            if (!(target instanceof Element)) return null;
            return {
              tag: target.tagName,
              className: typeof target.className === "string" ? target.className : null,
              testId: target.getAttribute("data-testid"),
            };
          })(),
        })),
        rect: (() => {
          const rect = popover?.getBoundingClientRect();
          return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
        })(),
      },
    };
  });
}

async function captureWorkspacePanelClose(page) {
  await page.evaluate(() => {
    const panel = document.querySelector(".toolbar-popover.workspace-task-panel");
    if (!(panel instanceof HTMLElement)) throw new Error("Options workbench is missing before close.");
    const capture = {
      frames: [],
      animationStart: null,
      animationEnd: null,
      panelUnmountAt: null,
      settledFrameCount: 0,
      settledAt: null,
      done: false,
      trackedPanel: panel,
    };
    window.__editorWorkspaceCloseCapture = capture;
    panel.addEventListener("animationstart", event => {
      if (event.target !== panel || event.animationName !== "workspace-task-exit") return;
      capture.animationStart = {
        at: performance.now(),
        elapsedTime: event.elapsedTime,
        animationName: event.animationName,
      };
    }, true);
    panel.addEventListener("animationend", event => {
      if (event.target !== panel || event.animationName !== "workspace-task-exit") return;
      capture.animationEnd = {
        at: performance.now(),
        elapsedTime: event.elapsedTime,
        animationName: event.animationName,
      };
    }, true);
    const sample = () => {
      const currentPanel = capture.trackedPanel?.isConnected ? capture.trackedPanel : null;
      if (!currentPanel && capture.panelUnmountAt === null)
        capture.panelUnmountAt = performance.now();
      const selectedSurface = document.querySelector('[data-workspace-surface][aria-current="page"]')
        ?.getAttribute("data-workspace-surface") ?? null;
      const ghostCount = document.querySelectorAll(".toolbar-popover-morph-ghost").length;
      const workspaceFilter = document.querySelector(".flow-surface")
        ? getComputedStyle(document.querySelector(".flow-surface")).filter : null;
      const body = document.querySelector(".editor-workspace-body");
      const focused = document.activeElement;
      const ghost = document.querySelector(".toolbar-popover-morph-ghost");
      const inputOwnership = {
        bodyInert: Boolean(body?.inert),
        focusedInWorkspace: Boolean(body?.contains(focused)),
        focusedInClosingPanel: Boolean(currentPanel?.contains(focused)),
        focusedSurface: focused?.getAttribute("data-workspace-surface") ?? null,
        ghostOpacity: ghost ? Number(getComputedStyle(ghost).opacity) : null,
      };
      if (currentPanel) {
        const style = getComputedStyle(currentPanel);
        const animation = currentPanel.getAnimations()
          .find(candidate => candidate.animationName === "workspace-task-exit");
        capture.frames.push({
          at: performance.now(),
          panelPresent: true,
          selectedSurface,
          className: currentPanel.className,
          opacity: Number(style.opacity),
          transform: style.transform,
          animationDuration: animation?.effect?.getTiming().duration ?? null,
          animationCurrentTime: animation?.currentTime ?? null,
          animationPlayState: animation?.playState ?? null,
          inert: currentPanel.inert,
          ghostCount,
          workspaceFilter,
          ...inputOwnership,
        });
      } else {
        capture.frames.push({
          at: performance.now(),
          panelPresent: false,
          selectedSurface,
          className: null,
          opacity: null,
          transform: "none",
          animationDuration: null,
          animationCurrentTime: null,
          animationPlayState: null,
          inert: null,
          ghostCount,
          workspaceFilter,
          ...inputOwnership,
        });
      }
      const isSettled = !currentPanel
        && selectedSurface === "edit"
        && ghostCount === 0
        && workspaceFilter === "none";
      capture.settledFrameCount = isSettled ? capture.settledFrameCount + 1 : 0;
      if (capture.settledFrameCount === 2) capture.settledAt = performance.now();
      if (!capture.done) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator('[data-workspace-surface="edit"]:visible').click();
  await page.waitForFunction(() => (
    document.querySelector('[data-workspace-surface="edit"]')?.getAttribute("aria-current") === "page"
    && !document.querySelector(".toolbar-popover.workspace-task-panel")
  ), undefined, { timeout: 15_000 });
  await page.waitForFunction(() => (
    getComputedStyle(document.querySelector(".flow-surface")).filter === "none"
  ), undefined, { timeout: 5_000 });
  await page.waitForFunction(() => (
    window.__editorWorkspaceCloseCapture?.settledFrameCount >= 2
  ), undefined, { timeout: 15_000 });
  return page.evaluate(() => {
    const capture = window.__editorWorkspaceCloseCapture;
    capture.done = true;
    return {
      capturedAt: performance.now(),
      settledAt: capture.settledAt,
      settledFrameCount: capture.settledFrameCount,
      frames: capture.frames,
      animationStart: capture.animationStart,
      animationEnd: capture.animationEnd,
      panelUnmountAt: capture.panelUnmountAt,
      finalSurface: document.querySelector('[data-workspace-surface][aria-current="page"]')
        ?.getAttribute("data-workspace-surface") ?? null,
      finalPanelCount: document.querySelectorAll(".toolbar-popover.workspace-task-panel").length,
      finalWorkspaceFilter: getComputedStyle(document.querySelector(".flow-surface")).filter,
      focusedSurface: document.activeElement?.getAttribute("data-workspace-surface") ?? null,
    };
  });
}

async function captureClosingWorkspaceInput(page) {
  // Actual user clicks modify only the supplied isolated test project.
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await waitForSurfaceTransitionSettled(page, "options");
  const originalCount = await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/store/editorStore.ts");
    return useEditorStore.getState().nodes.length;
  });
  await page.evaluate(() => {
    const capture = { frames: [], done: false, pointer: null, reopen: null };
    window.__closingWorkspaceInput = capture;
    const panel = () => document.querySelector(
      ".toolbar-popover.workspace-task-panel:not(.toolbar-popover-morph-ghost)");
    const inspect = () => {
      const node = panel();
      const body = document.querySelector(".editor-workspace-body");
      return {
        at: performance.now(), panelPresent: Boolean(node),
        stage: node?.classList.contains("is-closing") ? "closing"
          : node?.classList.contains("is-open") ? "open" : "absent",
        opacity: node ? Number(getComputedStyle(node).opacity) : null,
        transform: node ? getComputedStyle(node).transform : null,
        bodyInert: Boolean(body?.inert),
        focusedInClosingPanel: Boolean(node?.classList.contains("is-closing")
          && node.contains(document.activeElement)),
      };
    };
    const palette = document.querySelector('.node-palette [data-help-key="palette.scene"]');
    const onPointer = event => {
      capture.pointer = { ...inspect(), trusted: event.isTrusted };
    };
    palette.addEventListener("pointerdown", onPointer, { once: true });
    const options = document.querySelector('[data-workspace-surface="options"]');
    const onReopen = event => {
      capture.reopen = { ...inspect(), trusted: event.isTrusted };
    };
    options.addEventListener("click", onReopen, { once: true });
    const onWorkspaceFocus = () => {
      if (inspect().stage !== "closing") return;
      // The deliberate reopen click focuses Options before its click handler.
      // That is not the preceding Tab's workspace focus observation.
      if (options.contains(document.activeElement)) return;
      capture.focus = {
        inPalette: Boolean(document.activeElement?.closest(".node-palette")),
        inClosingPanel: Boolean(document.activeElement?.closest(".workspace-task-panel.is-closing")),
      };
    };
    document.addEventListener("focusin", onWorkspaceFocus);
    capture.cleanup = () => {
      palette.removeEventListener("pointerdown", onPointer);
      options.removeEventListener("click", onReopen);
      document.removeEventListener("focusin", onWorkspaceFocus);
    };
    const sample = () => {
      capture.frames.push(inspect());
      if (!capture.done) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  try {
    const paletteBox = await page.locator('.node-palette [data-help-key="palette.scene"]').boundingBox();
    const optionsBox = await page.locator('[data-workspace-surface="options"]:visible').boundingBox();
    assert(paletteBox && optionsBox, "Real exit-input targets must have visible geometry");
    await page.locator('[data-workspace-surface="edit"]:visible').click();
    await page.waitForFunction(() => {
      const panel = document.querySelector(
        ".toolbar-popover.workspace-task-panel:not(.toolbar-popover-morph-ghost).is-closing");
      const animation = panel?.getAnimations().find(a => a.animationName === "workspace-task-exit");
      return animation?.playState === "running" && Number(animation.currentTime) >= 100 / 1.5;
    }, undefined, { timeout: 10000 });
    // Stable foreground targets were measured before exit. Submit real input
    // first, inspect the store afterwards: diagnostics/import round trips must
    // not consume the now-shorter interruption window.
    await page.mouse.click(paletteBox.x + paletteBox.width / 2, paletteBox.y + paletteBox.height / 2);
    await page.keyboard.press("Tab");
    await page.mouse.click(optionsBox.x + optionsBox.width / 2, optionsBox.y + optionsBox.height / 2);
    await waitForSurfaceTransitionSettled(page, "options");
    const created = await page.evaluate(async () => {
      const { useEditorStore } = await import("/src/store/editorStore.ts");
      const state = useEditorStore.getState();
      return { count: state.nodes.length, selectedNodeId: state.selectedNodeId,
        selectedKind: state.nodes.find(node => node.id === state.selectedNodeId)?.data.nodeKind };
    });
    const result = await page.evaluate(() => {
      const capture = window.__closingWorkspaceInput;
      return { frames: capture.frames, pointer: capture.pointer, reopen: capture.reopen, focus: capture.focus };
    });
    const focus = result.focus ?? { inPalette: false, inClosingPanel: false };
    const firstReopenedFrame = result.frames.find(frame =>
      result.reopen && frame.at >= result.reopen.at && frame.stage === "open");
    const closingFrames = result.frames.filter(frame => frame.stage === "closing");
    const checks = {
      inputDuringActualExit: result.pointer?.trusted && result.pointer.stage === "closing"
        && !result.pointer.bodyInert,
      exactlyOneNodeCreated: created.count === originalCount + 1 && created.selectedKind === "scene",
      focusReturnedToWorkspace: focus.inPalette && !focus.inClosingPanel,
      noFocusInInertExit: closingFrames.every(frame => !frame.focusedInClosingPanel),
      reopenedBeforeUnmount: result.reopen?.trusted && result.reopen.stage === "closing",
      continuousReopen: Boolean(firstReopenedFrame && result.reopen
        && Math.abs(firstReopenedFrame.opacity - result.reopen.opacity) <= 0.12),
    };
    return { ...result, originalCount, created, focus, firstReopenedFrame, checks };
  } finally {
    await page.evaluate(() => {
      const capture = window.__closingWorkspaceInput;
      if (capture) { capture.done = true; capture.cleanup(); }
    }).catch(() => {});
  }
}

async function captureInterruptedWorkspacePanelEntry(page) {
  const editBox = await page.locator('[data-workspace-surface="edit"]:visible').boundingBox();
  assert(editBox, "Real reverse-entry target must have visible geometry");
  await page.evaluate(() => {
    const capture = { frames: [], done: false, trackedPanel: null };
    window.__editorWorkspaceInterruptedEntry = capture;
    document.querySelector('[data-workspace-surface="edit"]')?.addEventListener("click", () => {
      const panel = document.querySelector(".toolbar-popover.workspace-task-panel");
      capture.opacityAtReverse = panel ? Number(getComputedStyle(panel).opacity) : null;
      capture.transformAtReverse = panel ? getComputedStyle(panel).transform : null;
      capture.reverseAt = performance.now();
    }, { once: true });
    const sample = () => {
      if (!capture.trackedPanel) {
        capture.trackedPanel = document.querySelector(
          ".toolbar-popover.workspace-task-panel:not(.toolbar-popover-morph-ghost)",
        );
      }
      const panel = capture.trackedPanel?.isConnected ? capture.trackedPanel : null;
      const animation = panel?.getAnimations()
        .find(candidate => candidate.animationName === "workspace-task-enter");
      capture.frames.push({
        at: performance.now(),
        className: panel?.className ?? null,
        opacity: panel ? Number(getComputedStyle(panel).opacity) : null,
        transform: panel ? getComputedStyle(panel).transform : "none",
        animationName: animation?.animationName ?? null,
        animationTime: animation?.currentTime ?? null,
        animationDuration: animation?.effect?.getTiming().duration ?? null,
        activeAnimations: panel?.getAnimations().map(candidate => ({
          name: candidate.animationName ?? null,
          currentTime: candidate.currentTime,
          duration: candidate.effect?.getTiming().duration ?? null,
          playState: candidate.playState,
        })) ?? [],
      });
      if (!capture.done && capture.frames.length < 180) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await waitForSurface(page, "options");
  await page.waitForFunction(() => {
    const panel = document.querySelector(".toolbar-popover.workspace-task-panel");
    const animation = panel?.getAnimations().find(candidate =>
      candidate.animationName === "workspace-task-enter");
    return panel && Number(animation?.currentTime) >= 160 / 1.5;
  }, undefined, { timeout: 10_000 });
  await page.mouse.click(editBox.x + editBox.width / 2, editBox.y + editBox.height / 2);
  await page.waitForFunction(() => (
    document.querySelector('[data-workspace-surface="edit"]')?.getAttribute("aria-current") === "page"
    && !document.querySelector(".toolbar-popover.workspace-task-panel")
  ), undefined, { timeout: 15_000 });
  return page.evaluate(() => {
    const capture = window.__editorWorkspaceInterruptedEntry;
    capture.done = true;
    const frames = capture.frames.filter(frame => frame.className !== null
      && Number.isFinite(frame.opacity));
    const reversalIndex = frames.findIndex(frame => frame.className.includes("is-closing"));
    const reversalFrames = reversalIndex >= 0 ? frames.slice(reversalIndex) : [];
    const opacitySteps = reversalFrames.slice(1).map((frame, index) =>
      Math.abs(frame.opacity - reversalFrames[index].opacity));
    const opacityRates = reversalFrames.slice(1).map((frame, index) =>
      Math.abs(frame.opacity - reversalFrames[index].opacity)
        / Math.max(1, frame.at - reversalFrames[index].at));
    const monotonicExit = reversalFrames.every((frame, index) =>
      index === 0 || frame.opacity <= reversalFrames[index - 1].opacity + 0.02);
    const monotonicExitViolations = reversalFrames.slice(1).flatMap((frame, index) => {
      const previous = reversalFrames[index];
      return frame.opacity <= previous.opacity + 0.02 ? [] : [{
        at: frame.at,
        previousAt: previous.at,
        opacity: frame.opacity,
        previousOpacity: previous.opacity,
        animationTime: frame.activeAnimations?.find(animation =>
          animation.name === "workspace-task-exit")?.currentTime ?? null,
      }];
    });
    return {
      frames,
      opacityAtReverse: capture.opacityAtReverse,
      transformAtReverse: capture.transformAtReverse,
      reverseAt: capture.reverseAt,
      firstClosingFrame: reversalFrames[0] ?? null,
      largestOpacityStep: opacitySteps.length ? Math.max(...opacitySteps) : null,
      largestOpacityRatePerMs: opacityRates.length ? Math.max(...opacityRates) : null,
      maxFrameGapMs: reversalFrames.slice(1).reduce((max, frame, index) =>
        Math.max(max, frame.at - reversalFrames[index].at), 0),
      monotonicExit,
      monotonicExitViolations,
      finalSurface: document.querySelector('[data-workspace-surface][aria-current="page"]')
        ?.getAttribute("data-workspace-surface") ?? null,
      finalPanelCount: document.querySelectorAll(".toolbar-popover.workspace-task-panel").length,
    };
  });
}

async function captureInterruptedWorkspacePanelExit(page) {
  const optionsBox = await page.locator('[data-workspace-surface="options"]:visible').boundingBox();
  assert(optionsBox, "Real reverse-exit target must have visible geometry");
  await page.evaluate(() => {
    const capture = {
      frames: [],
      done: false,
      trackedPanel: document.querySelector(
        ".toolbar-popover.workspace-task-panel:not(.toolbar-popover-morph-ghost)",
      ),
    };
    window.__editorWorkspaceInterruptedExit = capture;
    document.querySelector('[data-workspace-surface="options"]')?.addEventListener("click", () => {
      const panel = document.querySelector(".toolbar-popover.workspace-task-panel");
      capture.opacityAtReverse = panel ? Number(getComputedStyle(panel).opacity) : null;
      capture.transformAtReverse = panel ? getComputedStyle(panel).transform : null;
      capture.reverseAt = performance.now();
    }, { once: true });
    const sample = () => {
      const panel = capture.trackedPanel?.isConnected ? capture.trackedPanel : null;
      const animation = panel?.getAnimations()
        .find(candidate => candidate.animationName === "workspace-task-exit");
      capture.frames.push({
        at: performance.now(),
        className: panel?.className ?? null,
        opacity: panel ? Number(getComputedStyle(panel).opacity) : null,
        transform: panel ? getComputedStyle(panel).transform : "none",
        animationName: animation?.animationName ?? null,
        animationTime: animation?.currentTime ?? null,
        animationDuration: animation?.effect?.getTiming().duration ?? null,
      });
      if (!capture.done && capture.frames.length < 180) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator('[data-workspace-surface="edit"]:visible').click();
  await page.waitForFunction(() => {
    const panel = document.querySelector(".toolbar-popover.workspace-task-panel");
    const animation = panel?.getAnimations().find(candidate =>
      candidate.animationName === "workspace-task-exit");
    return panel && Number(animation?.currentTime) >= 160 / 1.5;
  }, undefined, { timeout: 10_000 });
  await page.mouse.click(optionsBox.x + optionsBox.width / 2, optionsBox.y + optionsBox.height / 2);
  await waitForSurfaceTransitionSettled(page, "options");
  return page.evaluate(() => {
    const capture = window.__editorWorkspaceInterruptedExit;
    capture.done = true;
    const frames = capture.frames.filter(frame => frame.className !== null
      && Number.isFinite(frame.opacity));
    const reversalIndex = frames.findIndex(frame => frame.at >= capture.reverseAt
      && frame.className.includes("is-open"));
    const reversalFrames = reversalIndex >= 0 ? frames.slice(reversalIndex) : [];
    const opacitySteps = reversalFrames.slice(1).map((frame, index) =>
      Math.abs(frame.opacity - reversalFrames[index].opacity));
    const opacityRates = reversalFrames.slice(1).map((frame, index) =>
      Math.abs(frame.opacity - reversalFrames[index].opacity)
        / Math.max(1, frame.at - reversalFrames[index].at));
    const monotonicEntry = reversalFrames.every((frame, index) =>
      index === 0 || frame.opacity >= reversalFrames[index - 1].opacity - 0.02);
    const panel = document.querySelector(".toolbar-popover.workspace-task-panel");
    return {
      frames,
      opacityAtReverse: capture.opacityAtReverse,
      transformAtReverse: capture.transformAtReverse,
      reverseAt: capture.reverseAt,
      firstOpeningFrame: reversalFrames[0] ?? null,
      largestOpacityStep: opacitySteps.length ? Math.max(...opacitySteps) : null,
      largestOpacityRatePerMs: opacityRates.length ? Math.max(...opacityRates) : null,
      maxFrameGapMs: reversalFrames.slice(1).reduce((max, frame, index) =>
        Math.max(max, frame.at - reversalFrames[index].at), 0),
      monotonicEntry,
      finalSurface: document.querySelector('[data-workspace-surface][aria-current="page"]')
        ?.getAttribute("data-workspace-surface") ?? null,
      finalTask: panel?.getAttribute("data-workspace-task") ?? null,
      finalPanelInert: Boolean(panel?.inert),
      morphGhostCount: document.querySelectorAll(".toolbar-popover-morph-ghost").length,
    };
  });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  assert(matrix.length > 0, `No matching transition viewports: ${requested.join(",")}`);
  const env = await startEditorAcceptance(output);
  report.isolation = {
    input: env.input,
    output: env.output,
    fixtureProjectId: env.fixtureProjectId,
    isolated: env.isolated,
  };
  report.owner = { editorPid: env.server.pid, runId: env.server.runId, url: env.url, backendUrl: env.backendUrl };
  let browser;
  try {
    browser = await chromium.launch({ headless: !headful });
    for (const viewport of matrix) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor,
        reducedMotion: reducedMotion ? "reduce" : "no-preference",
      });
      page.setDefaultTimeout(30_000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.stack || error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await env.server.run(async () => {
        const viewportResult = {
          viewport,
          optionsOpenTransition: null,
          optionsCloseTransition: null,
          optionsWorkspace: null,
          transitions: [],
          rapidHandoff: null,
          errors,
        };
        report.results.push(viewportResult);
        await env.open(page);
        const optionsOpenTransition = await captureHandoff(page, "edit", "options", {
          settleContentSelector: ".advanced-tools-panel",
        });
        viewportResult.optionsOpenTransition = optionsOpenTransition;
        await page.locator(".advanced-tools-panel").waitFor({ state: "visible" });
        await page.waitForFunction(() => {
          const canvas = document.querySelector(".flow-surface");
          return canvas && getComputedStyle(canvas).filter.includes("blur(");
        }, undefined, { timeout: 10_000 });
        const optionsWorkspace = await inspectPersistentWorkspace(page);
        viewportResult.optionsWorkspace = optionsWorkspace;
        const optionsPresentationDurations = optionsOpenTransition.animationCalls
          .filter(call => String(call.target).includes("advanced-tools-panel"))
          .map(call => call.timing?.duration)
          .filter(duration => Number.isFinite(duration));
        ensure(optionsPresentationDurations.some(duration => duration >= workspaceMs(reducedMotion ? 480 : 800) - 1),
          `${viewport.name}: Options entry must retain its category-specific accelerated presentation`,
          { optionsPresentationDurations, animationCalls: optionsOpenTransition.animationCalls });
        const optionsShellFrames = optionsOpenTransition.frames.filter(frame =>
          frame.task === "options" && frame.className?.includes("is-open"));
        const optionsShellAnimationDurations = optionsShellFrames.flatMap(frame =>
          frame.popoverAnimations
            .filter(animation => animation.duration > 0)
            .map(animation => animation.duration));
        const firstOptionsShellFrame = optionsShellFrames.find(frame =>
          frame.opacity < 0.999
          || (frame.transform !== "none" && frame.transform !== "matrix(1, 0, 0, 1, 0, 0)"));
        const settledOptionsShellFrame = firstOptionsShellFrame
          ? optionsShellFrames.find(frame => frame.at > firstOptionsShellFrame.at
            && frame.opacity >= 0.999
            && ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(frame.transform))
          : undefined;
        const optionsShellVisibleMs = firstOptionsShellFrame && settledOptionsShellFrame
          ? settledOptionsShellFrame.at - firstOptionsShellFrame.at
          : 0;
        const openingBlurFrames = optionsShellFrames.filter(frame =>
          frame.workspaceFilter && frame.workspaceFilter !== "none");
        const openingIntermediateBlurFrames = openingBlurFrames.filter(frame =>
          !/blur\(2\.5px\)/.test(frame.workspaceFilter));
        const openingBlurDurations = optionsShellFrames
          .map(frame => frame.workspaceFilterDuration)
          .filter(Boolean);
        const optionsFrameIntervals = optionsShellFrames.slice(1).map((frame, index) =>
          frame.at - optionsShellFrames[index].at);
        ensure(optionsShellFrames.length >= 3
          && optionsShellAnimationDurations.some(duration => duration >= workspaceMs(720))
          && optionsShellVisibleMs >= workspaceMs(report.motionBaselines.workspacePanelEntryMs * 2)
          && openingBlurFrames.length >= 3
          && openingIntermediateBlurFrames.length >= 2
          && openingBlurDurations.some(duration => Math.abs(parseFloat(duration) * 1000 - workspaceMs(800)) < 1),
        `${viewport.name}: Options container and background must retain continuous coordinated accelerated clocks`,
        {
          optionsShellFrames: optionsShellFrames.slice(0, 12),
          optionsShellAnimationDurations,
          optionsShellVisibleMs,
          openingBlurFrames: openingBlurFrames.slice(0, 12),
          openingIntermediateBlurFrames: openingIntermediateBlurFrames.length,
          openingBlurDurations,
        });
        viewportResult.optionsOpenTransition.containerMotion = {
          animationDurations: [...new Set(optionsShellAnimationDurations)],
          observedVisibleMs: optionsShellVisibleMs,
          historicalBaselineMs: report.motionBaselines.workspacePanelEntryMs,
          requiredVisibleMs: report.motionBaselines.workspacePanelEntryMs * 2,
          blurTransitionDurations: [...new Set(openingBlurDurations)],
          intermediateBlurFrameCount: openingIntermediateBlurFrames.length,
          maximumFrameIntervalMs: optionsFrameIntervals.length
            ? Math.max(...optionsFrameIntervals) : null,
          medianFrameIntervalMs: optionsFrameIntervals.length
            ? [...optionsFrameIntervals].sort((left, right) => left - right)[
              Math.floor(optionsFrameIntervals.length / 2)
            ] : null,
        };
        await page.screenshot({ path: path.join(output, `${viewport.name}-options.png`) });
        ensure(optionsWorkspace.bodyVisible && optionsWorkspace.paletteVisible
          && !optionsWorkspace.paletteCoveredByPanel
          && !optionsWorkspace.paletteClipped && !optionsWorkspace.horizontalOverflow
          && optionsWorkspace.inspectorVisible && !optionsWorkspace.inspectorCoveredByPanel
          && optionsWorkspace.panelRightWithinCanvasTrack,
        `${viewport.name}: opening Options must preserve node controls and Inspector, with the panel docked to the canvas track`,
        optionsWorkspace);
        ensure(optionsWorkspace.bodyFilter === "none"
          && optionsWorkspace.flowFilter.includes("blur(")
          && optionsWorkspace.paletteFilterAncestors.length === 0,
          `${viewport.name}: Options should soften its preserved workspace with a background blur`,
          optionsWorkspace);

        const transitions = viewportResult.transitions;
        for (const [from, to] of [
          ["options", "assistant"],
          ["assistant", "options"],
          ["options", "preview"],
          ["preview", "publish"],
        ]) {
          const handoff = await captureHandoff(page, from, to);
          ensure(handoff.captureStopReason === "two-consecutive-settled-frames",
            `${viewport.name} ${from}->${to}: frame capture stopped before the semantic handoff was settled`,
            { captureStopReason: handoff.captureStopReason, frameCount: handoff.frames.length });
          const workspace = ["options", "assistant"].includes(to)
            ? await inspectPersistentWorkspace(page)
            : undefined;
          if (workspace) {
            const assistantTransition = transitions.find(transition => transition.to === "assistant");
            if (assistantTransition) assistantTransition.workspace = workspace;
            ensure(workspace.bodyVisible && workspace.paletteVisible
              && !workspace.paletteCoveredByPanel
              && !workspace.paletteClipped && !workspace.horizontalOverflow
              && workspace.bodyFilter === "none"
              && workspace.flowFilter.includes("blur(")
              && workspace.paletteFilterAncestors.length === 0,
            `${viewport.name}: AI and Options must share persistent, softly blurred workspace behavior`,
            workspace);
            const ownerFrames = handoff.frames.filter(frame =>
              frame.task === to && frame.workspacePresentation?.inspectorRect);
            ensure(ownerFrames.length >= 3 && ownerFrames.every(frame =>
              frame.workspacePresentation.inspectorVisible
              && !frame.workspacePresentation.inspectorPanelOverlap),
            `${viewport.name} ${from}->${to}: Inspector must remain visible and unobscured through every sampled handoff frame`,
            ownerFrames.map(frame => ({
              at: frame.at,
              panelRect: frame.rect,
              inspectorRect: frame.workspacePresentation.inspectorRect,
              overlap: frame.workspacePresentation.inspectorPanelOverlap,
            })));
            ensure(workspace.inspectorVisible && !workspace.inspectorCoveredByPanel
              && workspace.panelRightWithinCanvasTrack,
            `${viewport.name}: ${to} workbench must stay within the canvas track and leave Inspector unobscured`,
            workspace);
            ensure(Math.max(
            Math.abs(workspace.paletteRect.left - optionsWorkspace.paletteRect.left),
            Math.abs(workspace.paletteRect.width - optionsWorkspace.paletteRect.width),
            Math.abs(workspace.flowRect.left - optionsWorkspace.flowRect.left),
            Math.abs(workspace.flowRect.width - optionsWorkspace.flowRect.width),
            rectDelta(workspace.inspectorRect, optionsWorkspace.inspectorRect),
          ) <= 1.5,
          `${viewport.name}: node rail, canvas, or Inspector shifted between Options and AI`,
          { optionsWorkspace, workspace });
          }
          const frames = handoff.frames.filter(frame =>
            frame.selectedSurface === to && frame.task === to);
          const firstVisibleChangeFrame = handoff.frames.find(frame =>
            frame.selectedSurface === to && frame.task === to
            && (frame.ghostPresent
              || frame.morphing
              || frame.opacity < 0.999
              || frame.contentOpacity < 0.999
              || rectDelta(frame.rect, handoff.baseline) > 1.5));
          const settledFrames = handoff.frames.filter(frame =>
            frame.selectedSurface === to
            && frame.task === to
            && !frame.ghostPresent
            && frame.opacity >= 0.999
            && ["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(frame.transform)
            && frame.popoverAnimations.every(animation => animation.playState !== "running")
            && frame.contentAnimations.every(animation => animation.playState !== "running"));
          const settledPair = settledFrames.find((frame, index) => {
            const next = settledFrames[index + 1];
            return next
              && handoff.frames.indexOf(next) === handoff.frames.indexOf(frame) + 1;
          });
          const settledPairEnd = settledPair
            ? handoff.frames[handoff.frames.indexOf(settledPair) + 1]
            : undefined;
          const effectiveVisibleHandoffMs = firstVisibleChangeFrame && settledPairEnd
            ? settledPairEnd.at - firstVisibleChangeFrame.at
            : 0;
          const frameIntervals = handoff.frames.slice(1).map((frame, index) =>
            frame.at - handoff.frames[index].at);
          const sortedFrameIntervals = [...frameIntervals].sort((left, right) => left - right);
          const workspaceFrames = frames.map(frame => frame.workspacePresentation);
          const workspaceGeometryDelta = sample => Math.max(
            rectDelta(sample?.paletteRect, handoff.workspaceBaseline?.palette),
            rectDelta(sample?.flowRect, handoff.workspaceBaseline?.flow),
            rectDelta(sample?.inspectorRect, handoff.workspaceBaseline?.inspector),
          );
          if (["options", "assistant"].includes(to)) ensure(workspaceFrames.length >= 2
            && workspaceFrames.every(sample => sample
              && sample.bodyVisibility === "visible"
              && sample.bodyFilter === "none"
              && sample.paletteDisplay !== "none"
              && sample.paletteVisibility === "visible"
              && sample.paletteOpacity >= 0.98
              && sample.paletteFilteredAncestors.length === 0
              && !sample.palettePanelOverlap
              && workspaceGeometryDelta(sample) <= 1.5
              && sample.paletteRect?.left >= -1
              && sample.paletteRect?.top >= -1
              && sample.paletteRect?.left + sample.paletteRect?.width <= viewport.width + 1
              && sample.paletteRect?.top + sample.paletteRect?.height <= viewport.height + 1
              && sample.flowFilter.includes("blur(")),
          `${viewport.name} ${from}->${to}: node controls must remain clear and stable while only the canvas background is softened`,
          { baseline: handoff.workspaceBaseline, workspaceFrames });
          const ghostFrames = frames.filter(frame => frame.ghostPresent);
          const expectedMorphDuration = workspaceMs(reducedMotion ? 640 : 960) - 1;
          const morphFrames = frames.filter(frame => (
            frame.popoverAnimations.some(animation => animation.playState === "running"
              && animation.duration >= expectedMorphDuration
              && animation.duration <= expectedMorphDuration + 120)
            && frame.transform !== "none"
            && frame.transform !== "matrix(1, 0, 0, 1, 0, 0)"
          ));
          const targetContentFrames = frames.filter(frame => typeof frame.contentClass === "string"
            && !frame.contentClass.includes("toolbar-panel-loading"));
          const contentMotionDurations = frames.flatMap(frame =>
            frame.contentAnimations.filter(animation => animation.duration > 0)
              .map(animation => animation.duration));
          const ghostMotionTimings = frames.flatMap(frame =>
            frame.ghostAnimations.filter(animation => animation.duration > 0)
              .map(animation => ({ duration: animation.duration, delay: animation.delay })));
          const geometryChanged = handoff.baseline && handoff.final.rect
            && Math.max(
              Math.abs(handoff.baseline.left - handoff.final.rect.left),
              Math.abs(handoff.baseline.top - handoff.final.rect.top),
              Math.abs(handoff.baseline.width - handoff.final.rect.width),
              Math.abs(handoff.baseline.height - handoff.final.rect.height),
            ) > 1;
          ensure(frames.length >= 3, `${viewport.name} ${from}->${to}: handoff was not sampled across real frames`);
          ensure(targetContentFrames.length >= 2,
            `${viewport.name} ${from}->${to}: incoming surface was not observable`, { frames: frames.slice(0, 24) });
          if (reducedMotion) {
            ensure(ghostFrames.length >= 2,
              `${viewport.name} ${from}->${to}: reduced motion must retain a visible outgoing handoff layer`,
              { frames: frames.slice(0, 24), animationCalls: handoff.animationCalls, clickDetail: handoff.clickDetail });
            ensure(ghostMotionTimings.some(timing => (
              timing.duration >= workspaceMs(480) - 1 && timing.duration + timing.delay >= workspaceMs(480) - 1
            )),
            `${viewport.name} ${from}->${to}: reduced-motion outgoing handoff lost its coordinated accelerated clock`,
            { ghostMotionTimings, animationCalls: handoff.animationCalls });
            if (geometryChanged) {
              ensure(morphFrames.length >= 2,
                `${viewport.name} ${from}->${to}: reduced motion must smoothly morph changed container geometry`,
                { baseline: handoff.baseline, final: handoff.final, frames: frames.slice(0, 24) });
            } else {
              ensure(frames.every(frame => frame.rect
                && Math.max(
                  Math.abs(frame.rect.left - handoff.baseline.left),
                  Math.abs(frame.rect.top - handoff.baseline.top),
                  Math.abs(frame.rect.width - handoff.baseline.width),
                  Math.abs(frame.rect.height - handoff.baseline.height),
                ) <= 1.5),
              `${viewport.name} ${from}->${to}: stable-size reduced-motion handoff unexpectedly jumped the container`,
              { baseline: handoff.baseline, frames: frames.slice(0, 24) });
            }
          } else {
            ensure(ghostFrames.length >= 2,
              `${viewport.name} ${from}->${to}: outgoing surface disappeared without a retained transition layer`,
              { frames: frames.slice(0, 24) });
            ensure(ghostMotionTimings.some(timing => (
              timing.duration >= workspaceMs(576) - 1 && timing.duration + timing.delay >= workspaceMs(960) - 1
            )),
            `${viewport.name} ${from}->${to}: outgoing handoff lost its coordinated accelerated clock`,
            { ghostMotionTimings, animationCalls: handoff.animationCalls });
            if (geometryChanged) {
              ensure(morphFrames.length >= 2,
                `${viewport.name} ${from}->${to}: changed Editor container geometry did not morph`,
                { baseline: handoff.baseline, final: handoff.final, frames: frames.slice(0, 24) });
            } else {
              ensure(frames.every(frame => frame.rect
                && Math.max(
                  Math.abs(frame.rect.left - handoff.baseline.left),
                  Math.abs(frame.rect.top - handoff.baseline.top),
                  Math.abs(frame.rect.width - handoff.baseline.width),
                  Math.abs(frame.rect.height - handoff.baseline.height),
                ) <= 1.5),
              `${viewport.name} ${from}->${to}: stable-size handoff unexpectedly jumped the container`,
              { baseline: handoff.baseline, frames: frames.slice(0, 24) });
            }
          }
          ensure(contentMotionDurations.some(duration => duration >= workspaceMs(reducedMotion ? 480 : 800) - 1),
          `${viewport.name} ${from}->${to}: incoming content lost its category-specific accelerated clock`,
          { contentMotionDurations, animationCalls: handoff.animationCalls, clickDetail: handoff.clickDetail,
            frames: frames.slice(0, 24) });
          ensure(handoff.final.selectedSurface === to
            && handoff.final.task === to
            && !handoff.final.inert
            && handoff.final.ghostCount === 0
            && handoff.final.runningAnimationCount === 0,
          `${viewport.name} ${from}->${to}: transition did not settle on the requested interactive surface`,
          handoff.final);
          ensure(settledPairEnd
            && effectiveVisibleHandoffMs >= workspaceMs(report.motionBaselines.topLevelIncomingContentMs * 2),
          `${viewport.name} ${from}->${to}: visible handoff ended before its accelerated budget or lacked a settled sole-owner frame`,
          {
            firstVisibleChangeAt: firstVisibleChangeFrame?.at ?? null,
            settledPairEndAt: settledPairEnd?.at ?? null,
            effectiveVisibleHandoffMs,
            requiredVisibleHandoffMs: workspaceMs(report.motionBaselines.topLevelIncomingContentMs * 2),
            settledPair: settledPair ? [settledPair, settledPairEnd] : [],
            final: handoff.final,
          });
          await page.screenshot({ path: path.join(output, `${viewport.name}-${to}.png`) });
          transitions.push({
            from,
            to,
            captureStopReason: handoff.captureStopReason,
            effectiveVisibleHandoffMs,
            historicalBaselineMs: report.motionBaselines.topLevelIncomingContentMs,
            requiredVisibleHandoffMs: report.motionBaselines.topLevelIncomingContentMs * 2,
            settledPair: settledPair ? [settledPair, settledPairEnd] : [],
            frameCount: frames.length,
            maximumFrameIntervalMs: frameIntervals.length ? Math.max(...frameIntervals) : null,
            medianFrameIntervalMs: sortedFrameIntervals.length
              ? sortedFrameIntervals[Math.floor(sortedFrameIntervals.length / 2)] : null,
            ghostFrameCount: ghostFrames.length,
            morphFrameCount: morphFrames.length,
            geometryChanged,
            targetContentFrameCount: targetContentFrames.length,
            contentMotionDurations,
            workspaceFrameCount: workspaceFrames.length,
            workspaceGeometryMaxDelta: Math.max(...workspaceFrames.map(workspaceGeometryDelta)),
            workspacePresentationFrames: workspaceFrames.slice(0, 24),
            firstFrames: frames.slice(0, 20),
            final: handoff.final,
            workspace,
          });
        }

        await page.locator(".package-panel-close").click();
        await page.waitForFunction(() => (
          document.querySelector('[data-workspace-surface="edit"]')?.getAttribute("aria-current") === "page"
          && !document.querySelector(".toolbar-popover.workspace-task-panel")
        ), undefined, { timeout: 10_000 });
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await waitForSurface(page, "options");
        await page.locator(".advanced-tools-panel").waitFor({ state: "visible" });
        await waitForSurfaceTransitionSettled(page, "options");
        const optionsCloseTransition = await captureWorkspacePanelClose(page);
        viewportResult.optionsCloseTransition = optionsCloseTransition;
        optionsCloseTransition.backgroundContinuity = inspectCloseBackgroundContinuity(optionsCloseTransition);
        ensure(optionsCloseTransition.backgroundContinuity.rebounds.length === 0,
          `${viewport.name}: closing workspace must not reblur after the real panel disappears`,
          optionsCloseTransition.backgroundContinuity);
        optionsCloseTransition.inputOwnership = {
          noInertEditorFrames: optionsCloseTransition.frames
            .filter(frame => frame.selectedSurface === "edit").every(frame => !frame.bodyInert),
          noFocusInsideExit: optionsCloseTransition.frames.every(frame => !frame.focusedInClosingPanel),
        };
        ensure(Object.values(optionsCloseTransition.inputOwnership).every(Boolean),
          `${viewport.name}: invisible cleanup must not retain editor input or focus`,
          optionsCloseTransition.inputOwnership);
        const closingFrames = optionsCloseTransition.frames.filter(frame =>
          frame.className?.includes("is-closing"));
        const firstVisibleExitFrame = closingFrames.find(frame =>
          frame.opacity < 0.999
            || (frame.transform !== "none" && frame.transform !== "matrix(1, 0, 0, 1, 0, 0)"));
        const settledExitFrames = optionsCloseTransition.frames.filter(frame =>
          !frame.panelPresent
            && frame.selectedSurface === "edit"
            && frame.ghostCount === 0
            && frame.workspaceFilter === "none");
        const settledExitPair = settledExitFrames.find((frame, index) => {
          const next = settledExitFrames[index + 1];
          return next
            && optionsCloseTransition.frames.indexOf(next)
              === optionsCloseTransition.frames.indexOf(frame) + 1;
        });
        const effectiveVisibleExitMs = firstVisibleExitFrame && settledExitPair
          ? settledExitPair.at - firstVisibleExitFrame.at
          : 0;
        const closingMotionFrames = closingFrames.filter(frame =>
          Number.isFinite(frame.opacity)
          && (frame.opacity < 0.999
            || (frame.transform !== "none" && frame.transform !== "matrix(1, 0, 0, 1, 0, 0)")));
        const closingDuration = optionsCloseTransition.animationEnd?.elapsedTime * 1000 ?? 0;
        const closingOpacities = closingFrames.map(frame => frame.opacity).filter(Number.isFinite);
        const closingBlurFrames = closingFrames.filter(frame =>
          frame.workspaceFilter && frame.workspaceFilter !== "none");
        const closingIntermediateBlurFrames = closingBlurFrames.filter(frame =>
          !/blur\(2\.5px\)/.test(frame.workspaceFilter));
        ensure(optionsCloseTransition.animationStart?.animationName === "workspace-task-exit"
          && optionsCloseTransition.animationEnd?.animationName === "workspace-task-exit"
          && closingDuration >= workspaceMs(report.motionBaselines.workspacePanelExitMs * 2)
          && effectiveVisibleExitMs >= workspaceMs(report.motionBaselines.workspacePanelExitMs * 2)
          && closingMotionFrames.length >= 4
          && closingFrames.some(frame => frame.animationDuration >= workspaceMs(480))
          && closingBlurFrames.length >= 4
          && closingIntermediateBlurFrames.length >= 2
          && closingOpacities.length >= 4
          && closingOpacities[0] > closingOpacities[closingOpacities.length - 1],
        `${viewport.name}: Options workbench must close continuously with its accelerated clock`,
        {
          animationStart: optionsCloseTransition.animationStart,
          animationEnd: optionsCloseTransition.animationEnd,
          panelUnmountAt: optionsCloseTransition.panelUnmountAt,
          capturedAt: optionsCloseTransition.capturedAt,
          firstVisibleExitAt: firstVisibleExitFrame?.at ?? null,
          settledExitPair: settledExitPair ? [settledExitPair, settledExitFrames[
            settledExitFrames.indexOf(settledExitPair) + 1
          ]] : [],
          effectiveVisibleExitMs,
          requiredVisibleExitMs: workspaceMs(report.motionBaselines.workspacePanelExitMs * 2),
          closingDuration,
          closingFrames: closingFrames.slice(0, 16),
          closingIntermediateBlurFrames: closingIntermediateBlurFrames.length,
        });
        optionsCloseTransition.effectiveVisibleExitMs = effectiveVisibleExitMs;
        optionsCloseTransition.requiredVisibleExitMs = report.motionBaselines.workspacePanelExitMs * 2;
        ensure(optionsCloseTransition.finalSurface === "edit"
          && optionsCloseTransition.finalPanelCount === 0
          && optionsCloseTransition.finalWorkspaceFilter === "none"
          && optionsCloseTransition.focusedSurface === "edit",
        `${viewport.name}: closing Options must return focus ownership to the editor and restore the sharp workspace`,
        optionsCloseTransition);
        viewportResult.closingWorkspaceInput = await captureClosingWorkspaceInput(page);
        ensure(Object.values(viewportResult.closingWorkspaceInput.checks).every(Boolean),
          `${viewport.name}: editor input/focus must resume during exit and reopening must stay continuous`,
          viewportResult.closingWorkspaceInput);
        await captureWorkspacePanelClose(page);
        const interruptedEntry = await captureInterruptedWorkspacePanelEntry(page);
        viewportResult.interruptedEntry = interruptedEntry;
        ensure(Number.isFinite(interruptedEntry.opacityAtReverse)
          && Number.isFinite(interruptedEntry.firstClosingFrame?.opacity)
          && Math.abs(interruptedEntry.firstClosingFrame.opacity - interruptedEntry.opacityAtReverse) <= 0.12
          && interruptedEntry.monotonicExit
          && interruptedEntry.finalSurface === "edit"
          && interruptedEntry.finalPanelCount === 0,
        `${viewport.name}: reversing the workbench entry into close must continue from its current presentation without a visual jump`,
        interruptedEntry);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await waitForSurface(page, "options");
        await page.locator(".advanced-tools-panel").waitFor({ state: "visible" });
        await waitForSurfaceTransitionSettled(page, "options");
        const interruptedExit = await captureInterruptedWorkspacePanelExit(page);
        viewportResult.interruptedExit = interruptedExit;
        ensure(Number.isFinite(interruptedExit.opacityAtReverse)
          && Number.isFinite(interruptedExit.firstOpeningFrame?.opacity)
          && Math.abs(interruptedExit.firstOpeningFrame.opacity - interruptedExit.opacityAtReverse) <= 0.12
          && interruptedExit.monotonicEntry
          && interruptedExit.finalSurface === "options"
          && interruptedExit.finalTask === "options"
          && !interruptedExit.finalPanelInert
          && interruptedExit.morphGhostCount === 0,
        `${viewport.name}: reversing workbench exit into entry must continue from its current presentation and restore the requested interactive panel`,
        interruptedExit);
        await waitForSurfaceTransitionSettled(page, "options");

        const rapidCapture = await page.evaluate(() => {
          const capture = { frames: [], done: false };
          window.__editorRapidSurfaceCapture = capture;
          const sample = () => {
            const popover = document.querySelector(".toolbar-popover.workspace-task-panel");
            const ghost = document.querySelector(".toolbar-popover-morph-ghost");
            const rect = popover?.getBoundingClientRect();
            capture.frames.push({
              at: performance.now(),
              selectedSurface: document.querySelector('[data-workspace-surface][aria-current="page"]')
                ?.getAttribute("data-workspace-surface") ?? null,
              task: popover?.getAttribute("data-workspace-task") ?? null,
              popoverPresent: Boolean(popover),
              ghostPresent: Boolean(ghost),
              ghostCount: document.querySelectorAll(".toolbar-popover-morph-ghost").length,
              rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
            });
            if (!capture.done && capture.frames.length < 180) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        for (const surface of ["assistant", "preview", "publish"]) {
          const target = page.locator(`[data-workspace-surface="${surface}"]:visible`);
          const box = await target.boundingBox();
          ensure(box, `${viewport.name}: ${surface} navigation target is not hittable`);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        await waitForSurface(page, "publish");
        await waitForSurfaceTransitionSettled(page, "publish");
        const rapidHandoff = await page.evaluate(() => {
          const capture = window.__editorRapidSurfaceCapture;
          capture.done = true;
          const popover = document.querySelector(".toolbar-popover.workspace-task-panel");
          return {
            frames: capture.frames,
            final: {
              selectedSurface: document.querySelector('[data-workspace-surface][aria-current="page"]')
                ?.getAttribute("data-workspace-surface") ?? null,
              task: popover?.getAttribute("data-workspace-task") ?? null,
              inert: Boolean(popover?.inert),
              ghostCount: document.querySelectorAll(".toolbar-popover-morph-ghost").length,
            },
          };
        });
        viewportResult.rapidHandoff = rapidHandoff;
        const rapidLiveFrames = rapidHandoff.frames.filter(frame => (
          frame.selectedSurface !== "edit" && frame.task !== null
        ));
        ensure(rapidLiveFrames.length >= 3,
          `${viewport.name}: rapid A→B→C clicks did not produce a sampled handoff`, rapidHandoff.frames);
        ensure(rapidLiveFrames.every(frame => frame.popoverPresent || frame.ghostPresent),
          `${viewport.name}: rapid A→B→C handoff exposed a blank frame`, rapidLiveFrames);
        ensure(rapidLiveFrames.every(frame => frame.ghostCount <= 1),
          `${viewport.name}: rapid A→B→C handoff stacked stale outgoing snapshots`, rapidLiveFrames);
        ensure(rapidHandoff.final.selectedSurface === "publish"
          && rapidHandoff.final.task === "publish"
          && !rapidHandoff.final.inert
          && rapidHandoff.final.ghostCount === 0,
        `${viewport.name}: stale transition completion overrode the final requested surface`,
        rapidHandoff.final);
        await page.screenshot({ path: path.join(output, `${viewport.name}-rapid-publish.png`) });
        await page.locator(".package-panel-close").click();
        await page.waitForFunction(() => (
          document.querySelector('[data-workspace-surface="edit"]')?.getAttribute("aria-current") === "page"
          && !document.querySelector(".toolbar-popover.workspace-task-panel")
        ), undefined, { timeout: 10_000 });
        const initialWorkspace = await inspectPersistentWorkspace(page);
        const resizerBox = await page.locator(".panel-resizer").boundingBox();
        ensure(resizerBox && initialWorkspace.flowRect && initialWorkspace.inspectorRect,
          `${viewport.name}: Inspector resizer and workspace tracks must be measurable`);
        const resizerX = resizerBox.x + resizerBox.width / 2;
        const resizerY = resizerBox.y + Math.min(resizerBox.height / 2, 60);
        await page.mouse.move(resizerX, resizerY);
        await page.mouse.down();
        await page.mouse.move(resizerX - 72, resizerY, { steps: 8 });
        await page.mouse.up();
        await page.waitForFunction(previous => {
          const flow = document.querySelector(".flow-surface")?.getBoundingClientRect();
          const inspector = document.querySelector(".scene-editor-pane")?.getBoundingClientRect();
          const right = Number.parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue("--workspace-task-right"));
          return Boolean(flow && inspector
            && flow.width < previous.flow.width - 40
            && inspector.width > previous.inspector.width + 40
            && Number.isFinite(right)
            && Math.abs(right - (document.documentElement.clientWidth - flow.right)) <= 1.5);
        }, {
          flow: initialWorkspace.flowRect,
          inspector: initialWorkspace.inspectorRect,
        }, { timeout: 5000 });
        viewportResult.inspectorResize = await inspectPersistentWorkspace(page);
        ensure(viewportResult.inspectorResize.flowRect.width < initialWorkspace.flowRect.width - 40
          && viewportResult.inspectorResize.inspectorRect.width > initialWorkspace.inspectorRect.width + 40
          && viewportResult.inspectorResize.panelRightInsetPx !== null,
        `${viewport.name}: resizing Inspector must update the workbench's canvas-relative dock bounds`,
        { initialWorkspace, resizedWorkspace: viewportResult.inspectorResize });
        ensure(errors.length === 0, `${viewport.name}: browser errors`, errors);
      });
      await page.close();
    }
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await env.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`${report.status}: ${path.join(output, "report.json")}`);
  }
}

// Native WebView acceptance uses the same frame sampler as the source-browser
// suite. Importing this module must not start another browser/backend run.
module.exports = {
  captureHandoff,
  captureWorkspacePanelClose,
  captureClosingWorkspaceInput,
  captureInterruptedWorkspacePanelEntry,
  captureInterruptedWorkspacePanelExit,
  inspectPersistentWorkspace,
  waitForSurfaceTransitionSettled,
  inspectCloseBackgroundContinuity,
};
if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}
