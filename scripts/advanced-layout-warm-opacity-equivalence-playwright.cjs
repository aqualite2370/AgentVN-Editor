#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const {
  getWarmLayerVisualEquivalenceFailures,
} = require("./lib/advanced-layout-transition-performance.cjs");
const {
  resolveAcceptancePaths,
  startEditorAcceptance,
} = require("./lib/editor-ui-acceptance.cjs");

const paths = resolveAcceptancePaths();
const output = paths.output;
const viewport = { width: 3840, height: 2160 };

async function readState(page) {
  return page.evaluate(() => {
    const popover = [...document.querySelectorAll(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
    )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
      ?.getAttribute("data-glass-selected") === "true");
    const settings = popover?.querySelector('.advanced-tab-content.is-active[data-tab="settings"]');
    const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    const designer = layout?.querySelector(".runtime-layout-designer");
    const stage = layout?.querySelector(".runtime-layout-stage");
    const preview = layout?.querySelector(".runtime-layout-expected-preview");
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? {
        x: value.x, y: value.y, width: value.width, height: value.height,
      } : null;
    };
    const focusPath = (element) => {
      if (!(element instanceof Element)) return null;
      const parts = [];
      for (let node = element; node && parts.length < 5; node = node.parentElement) {
        let part = node.tagName.toLowerCase();
        if (node.id) part += `#${node.id}`;
        if (typeof node.className === "string" && node.className.trim())
          part += `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}`;
        if (node instanceof HTMLElement && node.dataset.tab) part += `[data-tab="${node.dataset.tab}"]`;
        parts.push(part);
      }
      return parts.join(" <- ");
    };
    const style = layout instanceof HTMLElement ? getComputedStyle(layout) : null;
    return {
      selectedTab: settings ? "settings" : null,
      panelWideMode: popover?.classList.contains("is-layout-mode") ?? null,
      ariaHidden: layout?.getAttribute("aria-hidden") === "true",
      inert: layout?.hasAttribute("inert") ?? false,
      pointerEvents: style?.pointerEvents ?? null,
      activeElementInside: Boolean(layout?.contains(document.activeElement)),
      activeElementPath: focusPath(document.activeElement),
      designerReady: designer?.getAttribute("data-advanced-tab-ready") === "true",
      previewMounted: Boolean(preview),
      opacity: style ? Number.parseFloat(style.opacity) : null,
      geometry: {
        popover: rect(popover),
        viewport: rect(popover?.querySelector(".advanced-tab-viewport")),
        stage: rect(stage),
      },
      viewportRect: rect(popover?.querySelector(".advanced-tab-viewport")),
    };
  });
}

async function captureClip(page, rect, filename) {
  assert(rect && rect.width > 0 && rect.height > 0, "workspace viewport must have a screenshot region");
  const clip = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.min(viewport.width - Math.max(0, Math.floor(rect.x)), Math.ceil(rect.width)),
    height: Math.min(viewport.height - Math.max(0, Math.floor(rect.y)), Math.ceil(rect.height)),
  };
  const buffer = await page.screenshot({
    path: path.join(output, filename),
    type: "png",
    scale: "css",
    clip,
  });
  return { buffer, clip };
}

async function comparePngBuffers(page, baseline, candidate, control = null) {
  return page.evaluate(async ({ baselinePng, candidatePng, controlPng }) => {
    const decode = async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const a = await decode(baselinePng);
    const b = await decode(candidatePng);
    const control = controlPng ? await decode(controlPng) : null;
    if (a.width !== b.width || a.height !== b.height
      || (control && (a.width !== control.width || a.height !== control.height))) {
      return {
        width: a.width,
        height: a.height,
        comparedWidth: b.width,
        comparedHeight: b.height,
        maxChannelDelta: Number.POSITIVE_INFINITY,
        changedPixels: Number.POSITIVE_INFINITY,
        pixelsOverOneLevel: Number.POSITIVE_INFINITY,
        pixelsOutsideControlNoise: Number.POSITIVE_INFINITY,
        pixelsExceedingControlEnvelope: Number.POSITIVE_INFINITY,
      };
    }
    let maxChannelDelta = 0;
    let changedPixels = 0;
    let pixelsOverOneLevel = 0;
    let pixelsOutsideControlNoise = 0;
    let pixelsExceedingControlEnvelope = 0;
    const outlierSamples = [];
    for (let i = 0; i < a.pixels.length; i += 4) {
      let pixelDelta = 0;
      let controlDelta = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        pixelDelta = Math.max(pixelDelta, Math.abs(a.pixels[i + channel] - b.pixels[i + channel]));
        if (control)
          controlDelta = Math.max(controlDelta, Math.abs(a.pixels[i + channel] - control.pixels[i + channel]));
      }
      if (pixelDelta > 0) changedPixels += 1;
      if (pixelDelta > 1) pixelsOverOneLevel += 1;
      if (pixelDelta > 1 && outlierSamples.length < 12) outlierSamples.push({
        x: (i / 4) % a.width, y: Math.floor(i / 4 / a.width), delta: pixelDelta,
        baseline: Array.from(a.pixels.slice(i, i + 4)),
        candidate: Array.from(b.pixels.slice(i, i + 4)),
      });
      if (control && pixelDelta > 0 && controlDelta === 0) pixelsOutsideControlNoise += 1;
      if (control && pixelDelta > controlDelta + 1) pixelsExceedingControlEnvelope += 1;
      maxChannelDelta = Math.max(maxChannelDelta, pixelDelta);
    }
    return {
      width: a.width,
      height: a.height,
      maxChannelDelta,
      changedPixels,
      pixelsOverOneLevel,
      pixelsOutsideControlNoise,
      pixelsExceedingControlEnvelope,
      outlierSamples,
    };
  }, {
    baselinePng: baseline.toString("base64"),
    candidatePng: candidate.toString("base64"),
    controlPng: control?.toString("base64") ?? null,
  });
}

async function freezeSettledVisualAnimations(page) {
  return page.evaluate(async () => {
    const animations = document.getAnimations()
      .filter(animation => animation.playState === "running" || animation.pending);
    window.__warmPixelPausedAnimations = animations;
    animations.forEach(animation => animation.pause());
    // pause() queues a compositor operation. A screenshot taken before ready
    // resolves can contain a different animation frame than its control.
    await Promise.all(animations.map(animation => animation.ready));
    return animations.map(animation => ({
      playState: animation.playState,
      pending: animation.pending,
      currentTime: Number(animation.currentTime ?? 0),
      target: animation.effect?.target instanceof Element
        ? `${animation.effect.target.tagName.toLowerCase()}.${String(animation.effect.target.className).split(/\s+/).filter(Boolean)[0] ?? ""}`
        : null,
    }));
  });
}

async function resumeSettledVisualAnimations(page) {
  return page.evaluate(() => {
    window.__warmPixelPausedAnimations?.forEach(animation => animation.play());
    delete window.__warmPixelPausedAnimations;
  });
}

async function verifyPointerOwnership(page) {
  return page.evaluate(() => {
    const popover = [...document.querySelectorAll(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
    )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
      ?.getAttribute("data-glass-selected") === "true");
    const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    const viewport = popover?.querySelector(".advanced-tab-viewport");
    if (!(layout instanceof HTMLElement) || !(viewport instanceof HTMLElement))
      return { ok: false, reason: "settings or warm layout was not mounted" };

    let target = null;
    const bounds = viewport.getBoundingClientRect();
    for (let row = 1; row <= 8 && !target; row += 1) {
      for (let column = 1; column <= 8 && !target; column += 1) {
        const x = bounds.left + (bounds.width * column) / 9;
        const y = bounds.top + (bounds.height * row) / 9;
        const candidate = document.elementFromPoint(x, y);
        if (!(candidate instanceof Element)
          || layout.contains(candidate)
          || candidate.closest("button, input, select, textarea, a, [contenteditable='true'], [role='button']")) continue;
        target = { x, y, elementPath: candidate.tagName.toLowerCase() };
      }
    }
    if (!target) return { ok: false, reason: "no non-interactive safe point was found in settings workspace" };

    const clicks = { warm: 0, settings: 0 };
    const onWarm = () => { clicks.warm += 1; };
    const onSettings = () => { clicks.settings += 1; };
    const activeViewport = popover.querySelector(".advanced-tab-viewport");
    layout.addEventListener("pointerdown", onWarm, true);
    activeViewport?.addEventListener("pointerdown", onSettings, true);
    window.__e2WarmOpacityPointerProbe = {
      target, clicks, onWarm, onSettings, layout, activeViewport,
    };
    return { ok: true, target, clicks };
  });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const env = await startEditorAcceptance(output);
  const report = {
    status: "RUNNING",
    scope: "editor-hidden-warm-layout-visual-equivalence-diagnostic",
    productLayer: "Editor",
    entry: "real workspace options -> project settings",
    projectPath: paths.input,
    projectId: paths.fixtureProjectId,
    isolated: paths.isolated && env.isolated,
    viewport,
    viewportMode: "visible headful Chromium with emulated CSS viewport; not physical 4K acceptance",
    browserMode: "headful-visible",
    comparison: "opacity 0 same-state screenshot pair versus opacity 0.001 candidate",
    artifacts: [],
  };
  let browser;
  try {
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(30_000);
    await env.server.run(async () => {
      await env.open(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
      await page.waitForFunction(() => {
        const popover = document.querySelector(
          ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
        );
        const settings = popover?.querySelector('.advanced-tab-content.is-active[data-tab="settings"]');
        const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        const designer = layout?.querySelector(".runtime-layout-designer");
        const stage = layout?.querySelector(".runtime-layout-stage");
        const style = layout instanceof HTMLElement ? getComputedStyle(layout) : null;
        return settings instanceof HTMLElement
          && layout instanceof HTMLElement
          && layout.getAttribute("aria-hidden") === "true"
          && layout.hasAttribute("inert")
          && style?.opacity === "0"
          && style.pointerEvents === "none"
          && designer?.getAttribute("data-advanced-tab-ready") === "true"
          && stage instanceof HTMLElement
          && stage.clientWidth >= 2000
          && stage.clientHeight >= 1100
          && layout.querySelector(".runtime-layout-expected-preview");
      }, null, { timeout: 60_000 });
      await page.waitForFunction(() => {
        const panel = document.querySelector(".advanced-tools-panel");
        const popover = document.querySelector(".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)");
        const animations = [
          ...(panel?.getAnimations() ?? []),
          ...(popover?.getAnimations() ?? []),
          ...[...(panel?.querySelectorAll(".advanced-tab-content") ?? [])].flatMap(node => node.getAnimations()),
        ];
        return panel?.classList.contains("is-tab-idle")
          && animations.every(animation => !animation.pending && animation.playState !== "running");
      }, null, { timeout: 30_000 });

      const focusTarget = page.locator('[data-help-key="advanced.tab.settings"]:visible').first();
      await focusTarget.focus();
      const before = await readState(page);
      assert.equal(before.selectedTab, "settings");
      assert.equal(before.opacity, 0);
      const safePointerTarget = await verifyPointerOwnership(page);
      assert.equal(safePointerTarget.ok, true, safePointerTarget.reason);

      await page.mouse.move(0, 0);
      await page.waitForFunction(() => {
        const panel = document.querySelector(".advanced-tools-panel");
        const popover = document.querySelector(".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)");
        const animations = [
          ...(panel?.getAnimations() ?? []),
          ...(popover?.getAnimations() ?? []),
          ...[...(panel?.querySelectorAll(".advanced-tab-content") ?? [])].flatMap(node => node.getAnimations()),
        ];
        return panel?.classList.contains("is-tab-idle")
          && animations.every(animation => !animation.pending && animation.playState !== "running");
      }, null, { timeout: 30_000 });
      await page.mouse.click(safePointerTarget.target.x, safePointerTarget.target.y);
      const pointerCounts = await page.evaluate(() => {
        const probe = window.__e2WarmOpacityPointerProbe;
        const clicks = { ...probe.clicks };
        probe.layout.removeEventListener("pointerdown", probe.onWarm, true);
        probe.activeViewport?.removeEventListener("pointerdown", probe.onSettings, true);
        delete window.__e2WarmOpacityPointerProbe;
        return clicks;
      });
      const afterPointer = await readState(page);
      const pointerOwnership = {
        target: safePointerTarget.target,
        settingsStillActive: afterPointer.selectedTab === "settings",
        warmLayerDidNotReceivePointer: pointerCounts.warm === 0,
        settingsReceivedPointer: pointerCounts.settings === 1,
        clickCounts: pointerCounts,
      };

      const focusResult = await page.evaluate(() => {
        const layout = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        const beforePath = document.activeElement instanceof Element
          ? `${document.activeElement.tagName.toLowerCase()}.${String(document.activeElement.className).split(/\s+/).filter(Boolean)[0] ?? ""}`
          : null;
        const target = layout?.querySelector("button, input, select, textarea, a, [tabindex]");
        if (!target) throw new Error("warm layout has no focusable descendant for the inert-focus probe");
        target?.focus();
        return {
          activeElementInside: Boolean(layout?.contains(document.activeElement)),
          activeElementPath: document.activeElement instanceof Element
            ? `${document.activeElement.tagName.toLowerCase()}.${String(document.activeElement.className).split(/\s+/).filter(Boolean)[0] ?? ""}`
            : null,
          priorActiveElementPath: beforePath,
        };
      });

      await focusTarget.focus();
      await page.mouse.move(0, 0);
      report.pausedVisualAnimations = await freezeSettledVisualAnimations(page);
      const baselineImage = await captureClip(page, before.viewportRect, "opacity-0-baseline.png");
      const controlImage = await captureClip(page, before.viewportRect, "opacity-0-control.png");
      const controlPixelDiff = await comparePngBuffers(page, baselineImage.buffer, controlImage.buffer);

      await page.addStyleTag({
        content: '.advanced-tab-content.is-warm[data-tab="layout"]{opacity:0.001!important}',
      });
      await page.waitForFunction(() => {
        const layout = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        return layout instanceof HTMLElement && getComputedStyle(layout).opacity === "0.001";
      });
      const candidate = await readState(page);
      const candidatePixelDiffs = [];
      for (let repeat = 1; repeat <= 3; repeat += 1) {
        const candidateImage = await captureClip(
          page,
          candidate.viewportRect,
          `opacity-0001-candidate-${repeat}.png`,
        );
        candidatePixelDiffs.push(await comparePngBuffers(
          page,
          baselineImage.buffer,
          candidateImage.buffer,
          controlImage.buffer,
        ));
      }
      const pixelDiff = Object.fromEntries(
        ["maxChannelDelta", "changedPixels", "pixelsOverOneLevel",
          "pixelsOutsideControlNoise", "pixelsExceedingControlEnvelope"]
          .map(key => [key, Math.max(...candidatePixelDiffs.map(diff => diff[key]))]),
      );
      Object.assign(pixelDiff, {
        width: candidatePixelDiffs[0]?.width ?? 0,
        height: candidatePixelDiffs[0]?.height ?? 0,
        repeatCount: candidatePixelDiffs.length,
      });

      report.baseline = before;
      report.candidate = candidate;
      report.controlPixelDiff = controlPixelDiff;
      report.pixelDiff = pixelDiff;
      report.candidatePixelDiffs = candidatePixelDiffs;
      report.pointerOwnership = pointerOwnership;
      report.focusAttempt = focusResult;
      report.failures = getWarmLayerVisualEquivalenceFailures({
        baseline: before,
        candidate,
        pixelDiff,
        controlPixelDiff,
      });
      if (!pointerOwnership.settingsStillActive
        || !pointerOwnership.warmLayerDidNotReceivePointer
        || !pointerOwnership.settingsReceivedPointer) {
        report.failures.push("real pointer input did not remain owned by the active settings page");
      }
      if (focusResult.activeElementInside)
        report.failures.push("focus entered the inert warm layout layer");
      if (focusResult.priorActiveElementPath !== focusResult.activeElementPath)
        report.failures.push("attempted warm-layer focus changed the active element");
      if (candidate.activeElementPath !== before.activeElementPath)
        report.failures.push("candidate screenshot did not restore the baseline focus owner");

      assert.deepEqual(report.failures, [], JSON.stringify(report.failures));
      report.status = "PASS";
    });
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await env.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(`${report.status}: ${path.join(output, "report.json")}`);
  }
}

module.exports = { readState, comparePngBuffers, freezeSettledVisualAnimations,
  resumeSettledVisualAnimations, verifyPointerOwnership };
if (require.main === module) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
