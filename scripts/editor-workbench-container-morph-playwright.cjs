#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const {
  root,
  viewports,
  resolveAcceptancePaths,
  startEditorAcceptance,
} = require("./lib/editor-ui-acceptance.cjs");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const defaultOutput = path.join(root, "output/playwright/editor-workbench-container-morph", runId);
const { output } = resolveAcceptancePaths({ output: defaultOutput });
const requested = (process.env.WORKBENCH_MORPH_VIEWPORTS || "1080p")
  .split(",").map(value => value.trim()).filter(Boolean);
const matrix = requested.map(name => viewports.find(viewport => viewport.name === name)).filter(Boolean);
const reducedMotion = process.env.WORKBENCH_MORPH_REDUCED === "1";
const headful = process.env.WORKBENCH_MORPH_HEADFUL === "1";
const report = {
  runId,
  status: "RUNNING",
  scope: "editor-options-compact-to-layout-workbench-container-morph",
  reducedMotion,
  headful,
  results: [],
};

async function waitIdle(page, tab) {
  await page.waitForFunction(name => {
    const panel = document.querySelector(".advanced-tools-panel");
    return panel?.classList.contains("is-tab-idle")
      && panel.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") === name;
  }, tab, { timeout: 30_000 });
}

async function sampleMorph(page, action, direction, viewportName, expectMorph = true) {
  const before = await page.locator(".toolbar-popover.advanced").boundingBox();
  assert(before, `${direction}: compact options container must be measurable before switching`);
  const beforeButtons = await page.locator(
    ".toolbar-popover.advanced .advanced-tools-panel > nav button",
  ).evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 };
  }));
  const capture = await page.evaluate(() => {
    const popover = document.querySelector(".toolbar-popover.advanced");
    window.__workbenchMorphCapture = { samples: [], active: true };
    const morphAnimations = new WeakMap();
    const record = () => {
      if (!window.__workbenchMorphCapture?.active) return;
      const node = document.querySelector(".toolbar-popover.advanced");
      if (node) {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        window.__workbenchMorphCapture.samples.push({
          at: performance.now(),
          className: node.className,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          transform: style.transform,
          transformOrigin: style.transformOrigin,
          opacity: Number(style.opacity),
          contentOpacity: Number(getComputedStyle(
            node.querySelector(".advanced-tools-panel") || node,
          ).opacity),
          ghostOpacity: (() => {
            const ghost = document.querySelector(".toolbar-popover-morph-ghost");
            return ghost ? Number(getComputedStyle(ghost).opacity) : null;
          })(),
          ghostButtons: (() => {
            const ghost = document.querySelector(".toolbar-popover-morph-ghost");
            return ghost ? [...ghost.querySelectorAll(".advanced-tools-panel > nav button")].map(button => {
              const rect = button.getBoundingClientRect();
              return { width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 };
            }) : null;
          })(),
          animations: node.getAnimations().map(animation => {
            if (!morphAnimations.has(animation)) {
              morphAnimations.set(animation, !("animationName" in animation)
                && animation.effect?.getKeyframes().some(frame =>
                  typeof frame.transform === "string" && frame.transform.includes("scale(")));
            }
            return {
              morph: morphAnimations.get(animation),
              playState: animation.playState,
              currentTime: animation.currentTime,
              duration: animation.effect?.getTiming().duration ?? null,
              easing: animation.effect?.getTiming().easing ?? null,
            };
          }),
          ghostHasFocus: Boolean(document.querySelector(".toolbar-popover-morph-ghost")
            ?.contains(document.activeElement)),
        });
        requestAnimationFrame(record);
      }
    };
    requestAnimationFrame(record);
    return Boolean(popover);
  });
  assert(capture, `${direction}: options container disappeared before the morph`);
  const actionPromise = action();
  if (expectMorph && !reducedMotion) {
    await page.waitForFunction(() => {
      const node = document.querySelector(".toolbar-popover.advanced");
      return node?.classList.contains("is-morphing")
        && node.getAnimations().some(animation => animation.playState === "running");
    }, undefined, { timeout: 3000 });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(output, `${viewportName}-${direction}-during.png`) });
  }
  await actionPromise;
  await page.waitForFunction(() => {
    const node = document.querySelector(".toolbar-popover.advanced");
    return node?.classList.contains("is-morphing")
      || node?.getAnimations().some(animation => animation.playState === "running");
  }, undefined, { timeout: 3000 }).catch(() => {});
  if (!expectMorph || reducedMotion) {
    await page.screenshot({ path: path.join(output, `${viewportName}-${direction}-during.png`) });
  }
  await page.waitForTimeout(340);
  await page.waitForFunction(() => {
    const node = document.querySelector(".toolbar-popover.advanced");
    return node
      && !node.classList.contains("is-morphing")
      && node.getAnimations().every(animation => animation.playState !== "running");
  }, undefined, { timeout: 3000 });
  const evidence = await page.evaluate(() => {
    const capture = window.__workbenchMorphCapture;
    if (capture) capture.active = false;
    const node = document.querySelector(".toolbar-popover.advanced");
    const nodeRail = document.querySelector(".editor-workspace > .node-palette");
    const workspace = document.querySelector(".editor-workspace");
    const rect = node?.getBoundingClientRect();
    const style = node ? getComputedStyle(node) : null;
    const readRect = value => {
      if (!value) return null;
      const box = value.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    return {
      samples: capture?.samples ?? [],
      after: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      layoutAnchors: {
        nodeRail: readRect(nodeRail),
        workspace: readRect(workspace),
      },
      finalClassName: node?.className ?? null,
      finalTransform: style?.transform ?? null,
      afterButtons: [...(node?.querySelectorAll(".advanced-tools-panel > nav button") ?? [])].map(button => {
        const rect = button.getBoundingClientRect();
        return { width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 };
      }),
      runningAnimations: node?.getAnimations().filter(animation => animation.playState === "running").length ?? 0,
      remainingMorphGhosts: document.querySelectorAll(".toolbar-popover-morph-ghost").length,
      activeTab: node?.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab"),
      activeInert: node?.querySelector(".advanced-tab-content.is-active")?.inert,
      activePointerEvents: node?.querySelector(".advanced-tab-content.is-active")
        ? getComputedStyle(node.querySelector(".advanced-tab-content.is-active")).pointerEvents : null,
      interactiveLayers: node?.querySelectorAll('[data-advanced-tab-interactive="true"]').length,
    };
  });
  return { direction, before, beforeButtons, ...evidence };
}

function assertWideWorkbenchGeometry(result, label, viewport) {
  assert(result.after, `${label}: target workbench geometry is missing`);

  // In the short-landscape contract the vertical node rail is intentionally
  // preserved. The wide workbench owns the remaining right-side track rather
  // than the full viewport; requiring viewport - 40px here would contradict
  // the product rule that the left rail must stay visible.
  const rail = result.layoutAnchors?.nodeRail;
  const shortLandscape = viewport.width > 640
    && viewport.width <= 900
    && viewport.height <= 480
    && rail
    && rail.width < viewport.width * 0.5;

  if (shortLandscape) {
    const rightInset = viewport.width - (result.after.left + result.after.width);
    assert(result.after.left >= rail.right - 1,
      `${label}: short-landscape workbench must begin at or after the preserved node rail`,
      { after: result.after, nodeRail: rail, viewport });
    assert(result.after.width >= viewport.width - rail.right - 40,
      `${label}: short-landscape workbench did not fill the available right-side track`,
      { after: result.after, nodeRail: rail, viewport });
    assert(rightInset <= 24,
      `${label}: short-landscape workbench left too much unused space at the right edge`,
      { after: result.after, nodeRail: rail, viewport, rightInset });
    return;
  }

  assert(result.after.width >= Math.min(viewport.width - 40, 960),
    `${label}: full workbench did not occupy the expected wide canvas`,
    { after: result.after, viewport });
}

function assertMorph(result, label, viewport, targetMode) {
  const frames = result.samples;
  const runningTransformFrames = frames.filter(sample =>
    sample.animations.some(animation => animation.morph && animation.playState === "running")
      && sample.transform !== "none"
      && sample.transform !== "matrix(1, 0, 0, 1, 0, 0)");
  assert(runningTransformFrames.length >= 3,
    `${label}: expected a visible interruptible FLIP transform on the options container`,
    {
      before: result.before,
      after: result.after,
      finalClassName: result.finalClassName,
      frames: frames.map(sample => ({
        at: sample.at,
        className: sample.className,
        rect: sample.rect,
        transform: sample.transform,
        animations: sample.animations,
      })),
    });
  assert(runningTransformFrames.some(sample => {
    const values = sample.transform.match(/matrix\(([^)]+)\)/)?.[1].split(",").map(Number);
    return values && (Math.abs(values[0] - 1) > 0.03
      || Math.abs(values[3] - 1) > 0.03
      || Math.abs(values[4]) > 12
      || Math.abs(values[5]) > 12);
  }), `${label}: FLIP transform did not visibly bridge the container geometry`, runningTransformFrames);
  const scaledContentFrames = runningTransformFrames.filter(sample => {
    const values = sample.transform.match(/matrix\(([^)]+)\)/)?.[1].split(",").map(Number);
    return values && (Math.abs(values[0] - 1) > 0.08 || Math.abs(values[3] - 1) > 0.08);
  });
  if (scaledContentFrames.length > 0) {
    assert(scaledContentFrames.some(sample => sample.contentOpacity <= 0.2),
      `${label}: workbench content must crossfade out while its container is visibly scaled`,
      scaledContentFrames.map(sample => ({
        at: sample.at,
        transform: sample.transform,
        contentOpacity: sample.contentOpacity,
        ghostOpacity: sample.ghostOpacity,
      })));
    assert(scaledContentFrames.some(sample =>
      sample.contentOpacity <= 0.2 && sample.ghostOpacity > 0.2),
    `${label}: outgoing content must remain visible at its original geometry during the morph`,
    scaledContentFrames.map(sample => ({
      at: sample.at,
      contentOpacity: sample.contentOpacity,
      ghostOpacity: sample.ghostOpacity,
    })));
    const outgoingFrame = scaledContentFrames.find(sample =>
      sample.contentOpacity <= 0.2 && sample.ghostOpacity > 0.2);
    assert.equal(outgoingFrame.ghostButtons?.length, result.beforeButtons.length,
      `${label}: outgoing navigation control count changed during the morph`);
    outgoingFrame.ghostButtons.forEach((button, index) => {
      const beforeButton = result.beforeButtons[index];
      assert(button.width >= beforeButton.width - 1
        && button.height >= beforeButton.height - 1,
      `${label}: visible outgoing navigation controls must not shrink during the morph`,
      { index, before: beforeButton, ghost: button });
    });
  } else {
    assert(runningTransformFrames.every(sample => sample.contentOpacity >= 0.98),
      `${label}: translation-only morphs must keep the workbench content visible`,
      runningTransformFrames.map(sample => ({
        at: sample.at,
        contentOpacity: sample.contentOpacity,
      })));
  }
  assertSettledMorph(result, label, viewport, targetMode);
}

function assertReducedMorph(result, label, viewport, targetMode) {
  const frames = result.samples.filter(sample =>
    sample.animations.some(animation => animation.morph && animation.playState === "running"
      && Math.abs(animation.duration - 640 / 1.5) < 1)
    && sample.transform !== "none"
    && sample.transform !== "matrix(1, 0, 0, 1, 0, 0)");
  assert(frames.length >= 3 && frames.at(-1).at - frames[0].at >= 480 / 1.5,
    `${label}: reduced motion lost its continuous visible handoff`, frames);
  const matrices = frames.map(sample => sample.transform.match(/matrix\(([^)]+)\)/)
    ?.[1].split(",").map(Number));
  assert(matrices.every(values => values?.length === 6
    && values.every(Number.isFinite)
    && values[0] >= 0.919 && values[0] <= 1.081
    && values[3] >= 0.919 && values[3] <= 1.081
    && Math.abs(values[1]) <= 0.001 && Math.abs(values[2]) <= 0.001
    && Math.abs(values[4]) <= 24.1 && Math.abs(values[5]) <= 24.1),
  `${label}: reduced morph exceeded its independent displacement/scale budget`, matrices);
  assert(new Set(matrices.map(values => values.join(","))).size >= 3,
    `${label}: reduced morph jumped between static poses`, matrices);
  assert(frames.every(sample => sample.rect.width > 0 && sample.rect.height > 0
    && sample.rect.left >= -1 && sample.rect.top >= -1
    && sample.rect.left + sample.rect.width <= viewport.width + 1
    && sample.rect.top + sample.rect.height <= viewport.height + 1),
  `${label}: reduced morph was clipped at a viewport edge`, frames);
  assert(frames.every(sample => sample.contentOpacity + (sample.ghostOpacity ?? 0) > 0),
    `${label}: reduced morph removed both presentation layers`, frames);
  result.reducedMotionEvidence = {
    visibleFrameCount: frames.length,
    visibleDurationMs: frames.at(-1).at - frames[0].at,
    durationMs: 640 / 1.5,
    maxTranslationPx: 24,
    scaleRange: [0.92, 1.08],
  };
  assertSettledMorph(result, label, viewport, targetMode);
}

function assertSettledMorph(result, label, viewport, targetMode) {
  const frames = result.samples;
  const morphFrames = frames.filter(sample => sample.animations.some(animation =>
    animation.morph && animation.playState === "running"));
  assert(morphFrames.every(sample => sample.transformOrigin.split(/\s+/)
    .slice(0, 2).every(value => Math.abs(parseFloat(value)) <= 0.01)),
  `${label}: active morph lost its measured top-left anchor during a render`,
  morphFrames.map(sample => ({ at: sample.at, transformOrigin: sample.transformOrigin,
    rect: sample.rect, transform: sample.transform, className: sample.className })));
  assert(frames.every(sample => !sample.ghostHasFocus),
    `${label}: presentation ghost captured keyboard focus`, frames);
  assert.equal(result.activeTab, targetMode === "wide" ? "layout" : "settings",
    `${label}: wrong final page owns the workbench`);
  assert(result.activeInert === false && result.activePointerEvents !== "none"
    && result.interactiveLayers === 1,
  `${label}: final interaction owner is unavailable or duplicated`, result);
  assert(frames.at(-1)?.contentOpacity >= 0.98,
    `${label}: workbench content must be fully readable after the container morph`,
    frames.slice(-4).map(sample => ({ at: sample.at, contentOpacity: sample.contentOpacity })));
  assert(result.after && (result.finalTransform === "none"
    || result.finalTransform === "matrix(1, 0, 0, 1, 0, 0)")
    && result.runningAnimations === 0
    && !result.finalClassName.includes("is-morphing"),
  `${label}: container morph must settle cleanly at the target geometry`, result);
  assert.equal(result.remainingMorphGhosts, 0,
    `${label}: outgoing visual layer must be removed when the morph settles`);
  assert(result.after.width > 0 && result.after.height > 0,
    `${label}: target workbench container geometry is invalid`, result.after);
  assert.equal(result.afterButtons.length, result.beforeButtons.length,
    `${label}: navigation button count changed between compact and wide modes`);
  result.afterButtons.forEach((button, index) => {
    const beforeButton = result.beforeButtons[index];
    assert(Math.abs(button.width - beforeButton.width) <= 1
      && Math.abs(button.height - beforeButton.height) <= 1,
    `${label}: navigation button sizes must be stable between compact and wide modes`,
    { index, before: beforeButton, after: button });
  });
  assert(result.after.left >= -1
    && result.after.top >= -1
    && result.after.left + result.after.width <= viewport.width + 1
    && result.after.top + result.after.height <= viewport.height + 1,
  `${label}: settled container escaped the viewport`, { after: result.after, viewport });
  if (targetMode === "wide") {
    assertWideWorkbenchGeometry(result, label, viewport);
  } else {
    assert(result.after.width <= Math.min(980, viewport.width - 24) + 1,
      `${label}: compact Options panel did not return to its bounded footprint`, { after: result.after, viewport });
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  assert(matrix.length > 0, `No matching workbench morph viewports: ${requested.join(",")}`);
  const env = await startEditorAcceptance(output);
  report.owner = { editorPid: env.server.pid, runId: env.server.runId, url: env.url, backendUrl: env.backendUrl };
  let browser;
  try {
    browser = await chromium.launch({ headless: !headful });
    for (const viewport of matrix) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: Number(process.env.WORKBENCH_MORPH_DPR || 1),
        reducedMotion: reducedMotion ? "reduce" : "no-preference",
      });
      page.setDefaultTimeout(30_000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.stack || error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await env.server.run(async () => {
        await env.open(page);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.locator(".toolbar-popover.advanced.is-open").waitFor({ state: "visible" });
        await waitIdle(page, "settings");

        const entering = await sampleMorph(page, async () => {
          const target = page.locator('[data-help-key="advanced.tab.layout"]:visible').first();
          await target.click();
          await waitIdle(page, "layout");
        }, "settings-to-layout", viewport.name);
        const result = { viewport, entering };
        report.results.push(result);
        if (reducedMotion) {
          assertReducedMorph(entering, `${viewport.name} reduced settings->layout`, viewport, "wide");
        } else {
          assertMorph(entering, `${viewport.name} settings->layout`, viewport, "wide");
        }
        await page.screenshot({ path: path.join(output, `${viewport.name}-layout.png`) });

        const leaving = await sampleMorph(page, async () => {
          const target = page.locator('[data-help-key="advanced.tab.settings"]:visible').first();
          await target.click();
          await waitIdle(page, "settings");
        }, "layout-to-settings", viewport.name);
        result.leaving = leaving;
        if (reducedMotion) {
          assertReducedMorph(leaving, `${viewport.name} reduced layout->settings`, viewport, "compact");
        } else {
          assertMorph(leaving, `${viewport.name} layout->settings`, viewport, "compact");
        }

        const withinMode = await sampleMorph(page, async () => {
          await page.locator('[data-help-key="advanced.tab.history"]:visible').first().click();
          await waitIdle(page, "history");
        }, "settings-to-history", viewport.name, false);
        result.withinMode = withinMode;
        assert(!withinMode.samples.some(sample =>
          sample.animations.some(animation => animation.playState === "running")
            && sample.transform !== "none"
            && sample.transform !== "matrix(1, 0, 0, 1, 0, 0)"),
        `${viewport.name}: ordinary compact-page navigation must not morph the outer container`, withinMode);
        assert(errors.length === 0, `${viewport.name}: browser errors`, errors);
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

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
