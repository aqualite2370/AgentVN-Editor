#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, viewports, fixture, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const acceptancePaths = resolveAcceptancePaths();
const output = acceptancePaths.output;
const selected = (process.env.EDITOR_TRANSITION_VIEWPORTS || "")
  .split(",").map(value => value.trim()).filter(Boolean);
const reducedMotion = process.env.EDITOR_TRANSITION_REDUCED === "1";
const deviceScaleFactor = Number(process.env.EDITOR_TRANSITION_DPR || 1);
const headful = process.env.EDITOR_TRANSITION_HEADFUL === "1";
const cpuThrottleRate = Number(process.env.EDITOR_TRANSITION_CPU_THROTTLE_RATE || 1);
const matrix = selected.length ? viewports.filter(viewport => selected.includes(viewport.name)) : [
  viewports.find(viewport => viewport.name === "1080p"),
  viewports.find(viewport => viewport.name === "4k"),
  viewports.find(viewport => viewport.name === "narrow"),
];
const report = {
  runId,
  status: "RUNNING",
  scope: "home-to-editor-container-transition",
  deviceScaleFactor,
  cpuThrottleRate,
  reducedMotion,
  headful,
  isolation: acceptancePaths,
  results: [],
};

function isIdentityTransform(value) {
  return value === "none" || value === "matrix(1, 0, 0, 1, 0, 0)";
}

function assertContainerTransition(samples, final, label, reduceMotion, requireRenderedCadence, longAnimationFrames = []) {
  const transformed = samples.filter(sample =>
    !isIdentityTransform(sample.transform));
  assert(transformed.length >= 2,
    `${label}: every mode must retain a smooth spatial Editor container entrance\n${JSON.stringify({ transformed, samples })}`);
  assert(final && final.opacity > 0.99
    && isIdentityTransform(final.transform),
  `${label}: editor container did not settle to its final state`, final);
  if (!reduceMotion) {
    const initialLayoutBox = transformed[0].layoutBox;
    assert(transformed.every(sample =>
      Math.abs(sample.layoutBox.left - initialLayoutBox.left) <= 1
        && Math.abs(sample.layoutBox.top - initialLayoutBox.top) <= 1
        && Math.abs(sample.layoutBox.width - initialLayoutBox.width) <= 1
        && Math.abs(sample.layoutBox.height - initialLayoutBox.height) <= 1),
    `${label}: transition changed layout geometry while the compositor transform was active\n${JSON.stringify({ transformed, final })}`);
  }

  // Reduced motion keeps the spatial handoff; its displacement is asserted
  // independently below instead of substituting a crossfade-only animation.
  const expectedEnterAnimation = "container-boot";
  const synchronizedFrames = samples.filter(sample =>
    sample.overlayClass?.includes("is-closing")
      && sample.animationName === expectedEnterAnimation
      && sample.overlayAnimationName === "project-entry-overlay-out"
      && Number.isFinite(sample.viewAnimationTime)
      && Number.isFinite(sample.overlayAnimationTime));
  assert(synchronizedFrames.length > 0,
    `${label}: Editor container must use its mode-appropriate entrance in sync with the project-entry overlay\n${JSON.stringify(samples.slice(0, 30))}`);
  assert(synchronizedFrames.every(sample =>
    sample.animationDuration === (reduceMotion ? "0.52s" : "1.12s")
      && sample.overlayAnimationDuration === (reduceMotion ? "0.52s" : "1.12s")
      && sample.animationTimingFunction === "cubic-bezier(0.16, 0.86, 0.18, 1)"),
  `${label}: Editor container and loading overlay must use the expected duration and retained easing\n${JSON.stringify(synchronizedFrames)}`);
  assert(synchronizedFrames.some(sample =>
    Math.abs(sample.viewAnimationTime - sample.overlayAnimationTime) <= 100),
  `${label}: editor container animation must stay synchronized with the loading overlay reveal\n${JSON.stringify(synchronizedFrames)}`);
  if (reduceMotion) {
    const crossfadeFrames = synchronizedFrames.filter(sample => sample.opacity > 0.05 && sample.opacity < 0.95
      && Number(sample.viewAnimationTime) > 0
      && Number(sample.viewAnimationTime) < 520);
    assert(crossfadeFrames.length >= 1,
      `${label}: reduced motion must keep a smooth, observable opacity transition\n${JSON.stringify(synchronizedFrames)}`);
  }
  if (requireRenderedCadence) {
    const visibleIntermediateFrames = synchronizedFrames.filter(sample =>
      sample.opacity > 0.05 && sample.opacity < 0.95);
    const times = synchronizedFrames.map(sample => sample.sampledAt).filter(Number.isFinite);
    const gaps = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
    const p95Gap = gaps.length
      ? gaps[Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1)]
      : Infinity;
    const startAt = synchronizedFrames.find(sample => Number(sample.viewAnimationTime) >= 0)?.sampledAt;
    const endAt = synchronizedFrames.find(sample =>
      Number(sample.viewAnimationTime) >= Number(sample.animationDurationMs))?.sampledAt
      ?? synchronizedFrames.at(-1)?.sampledAt;
    const overlappingLongFrames = longAnimationFrames.filter(frame =>
      frame.startTime <= endAt && frame.startTime + frame.duration >= startAt);
    assert(visibleIntermediateFrames.length >= 3 && p95Gap <= 33.4,
      `${label}: GPU-backed transition must expose continuous rendered samples at a smooth cadence`
        + ` (intermediate=${visibleIntermediateFrames.length}, p95GapMs=${p95Gap}, limit=33.4ms)\n`
        + JSON.stringify(synchronizedFrames));
    assert(!overlappingLongFrames.some(frame => frame.duration >= 50),
      `${label}: editor initialization long animation frames must settle before the visible container morph`
        + ` (overlap=${overlappingLongFrames.filter(frame => frame.duration >= 50).length})\n`
        + JSON.stringify(overlappingLongFrames));
  }
}

function assertLibraryReturnTransition(samples, label, reduceMotion, requireRenderedCadence) {
  const frames = samples.filter(sample => sample.homeAnimationName === "project-library-return");
  assert(frames.length >= 2,
    `${label}: returning home must use the GitHub project-library-return container transition\n${JSON.stringify(samples.slice(0, 30))}`);
  assert(frames.every(sample =>
    sample.homeAnimationDuration === (reduceMotion ? "0.52s" : "1.7s")
      && sample.homeAnimationTimingFunction === "cubic-bezier(0.16, 0.86, 0.18, 1)"),
  `${label}: home return must preserve the GitHub transition duration and easing\n${JSON.stringify(frames)}`);
  assert(frames.some(sample => sample.editorAnimationName === "cartridge-container-unload"
    && sample.editorAnimationDuration === (reduceMotion ? "0.52s" : "0.96s")
    && sample.editorAnimationTimingFunction === "cubic-bezier(0.36, 0, 0.18, 1)"),
  `${label}: outgoing editor container must use the GitHub unload transition\n${JSON.stringify(frames)}`);
  if (reduceMotion) {
    assert(frames.some(sample => !isIdentityTransform(sample.homeTransform)
      && Number(sample.homeAnimationTime) > 0
      && Number(sample.homeAnimationTime) < 520)
      && frames.some(sample => !isIdentityTransform(sample.editorTransform)
        && Number(sample.editorAnimationTime) > 0
        && Number(sample.editorAnimationTime) < 520),
    `${label}: reduced-motion return must preserve smooth spatial transitions for both containers`,
    frames);
    assert(frames.some(sample => sample.homeOpacity > 0.05 && sample.homeOpacity < 0.95
      && Number(sample.homeAnimationTime) > 0
      && Number(sample.homeAnimationTime) < 520),
      `${label}: reduced-motion return must visibly crossfade instead of cutting directly`,
      frames);
  }
  if (requireRenderedCadence) {
    const visibleIntermediateFrames = frames.filter(sample =>
      sample.homeOpacity > 0.05 && sample.homeOpacity < 0.95);
    const times = frames.map(sample => sample.at).filter(Number.isFinite);
    const gaps = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
    const p95Gap = gaps.length
      ? gaps[Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1)]
      : Infinity;
    assert(visibleIntermediateFrames.length >= 3 && p95Gap <= 100,
      `${label}: GPU-backed return transition must remain observable through its complete path`
        + ` (intermediate=${visibleIntermediateFrames.length}, p95GapMs=${p95Gap})\n`
        + JSON.stringify(frames));
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  assert(matrix.length > 0, `No matching transition viewports: ${selected.join(",")}`);
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
    const browserDiagnostics = await browser.newBrowserCDPSession();
    const systemInfo = await browserDiagnostics.send("SystemInfo.getInfo").catch(() => null);
    report.browser = {
      version: browser.version(),
      gpuRenderer: systemInfo?.gpu?.devices?.[0]?.deviceString ?? "unavailable",
      gpuFeatureStatus: systemInfo?.gpu?.featureStatus ?? null,
    };
    const requireRenderedCadence = headful
      && report.browser.gpuFeatureStatus?.gpu_compositing === "enabled";
    await browserDiagnostics.detach().catch(() => {});
    for (const viewport of matrix) {
      const fixtureId = `transition_${runId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${viewport.name}`;
      const fixturePath = path.join(output, `${viewport.name}-entry-project.vnproj`);
      fs.writeFileSync(fixturePath, JSON.stringify(fixture(fixtureId)), "utf8");
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor,
        reducedMotion: reducedMotion ? "reduce" : "no-preference",
      });
      const pageSession = await page.context().newCDPSession(page);
      if (cpuThrottleRate !== 1) {
        assert(Number.isFinite(cpuThrottleRate) && cpuThrottleRate >= 1 && cpuThrottleRate <= 8,
          "EDITOR_TRANSITION_CPU_THROTTLE_RATE must be between 1 and 8");
        await pageSession.send("Emulation.setCPUThrottlingRate", {
          rate: cpuThrottleRate,
        });
      }
      page.setDefaultTimeout(30_000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.stack || error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await env.server.run(async () => {
        await page.goto(env.url, { waitUntil: "domcontentloaded" });
        const input = page.locator(".project-import-button input").first();
        await input.waitFor({ state: "attached" });
        await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
          .some(node => node instanceof HTMLInputElement && !node.disabled));
        await page.evaluate(() => {
          const capture = {
            samples: [],
            longAnimationFrames: [],
            frame: 0,
            done: false,
            layoutBox: null,
          };
          window.__editorEntryTransitionCapture = capture;
          if (PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
            const observer = new PerformanceObserver(entries => {
              for (const entry of entries.getEntries()) {
                capture.longAnimationFrames.push({
                  startTime: entry.startTime,
                  duration: entry.duration,
                  blockingDuration: entry.blockingDuration,
                  renderStart: entry.renderStart,
                  styleAndLayoutStart: entry.styleAndLayoutStart,
                  scripts: (entry.scripts || []).slice(0, 6).map(script => ({
                    invokerType: script.invokerType,
                    invoker: script.invoker,
                    sourceURL: script.sourceURL,
                    sourceFunctionName: script.sourceFunctionName,
                    duration: script.duration,
                    executionStart: script.executionStart,
                  })),
                });
              }
            });
            observer.observe({ type: "long-animation-frame", buffered: true });
            capture.longAnimationFrameObserver = observer;
          }
          const sample = () => {
            const view = document.querySelector(".app-view-editor");
            if (view) {
              const overlay = document.querySelector('.project-entry-loading-overlay[data-overlay-kind="project-entry"]');
              const viewAnimation = view.getAnimations().find(animation =>
                animation instanceof CSSAnimation && animation.animationName === "container-boot");
              const overlayAnimation = overlay?.getAnimations().find(animation =>
                animation instanceof CSSAnimation && animation.animationName === "project-entry-overlay-out");
              if (viewAnimation instanceof CSSAnimation) {
                // Avoid forcing full-viewport geometry reads on every frame.
                // At 4K, the sampler must not starve the transition it measures.
                if (!capture.layoutBox) {
                  capture.layoutBox = {
                    left: view.offsetLeft,
                    top: view.offsetTop,
                    width: view.offsetWidth,
                    height: view.offsetHeight,
                  };
                }
                const style = getComputedStyle(view);
                const overlayStyle = overlay ? getComputedStyle(overlay) : null;
                capture.samples.push({
                  frame: ++capture.frame,
                  sampledAt: performance.now(),
                  animationName: viewAnimation.animationName,
                  animationDuration: `${Number(viewAnimation.effect?.getTiming().duration) / 1000}s`,
                  animationDurationMs: Number(viewAnimation.effect?.getTiming().duration),
                  animationTimingFunction: style.animationTimingFunction,
                  overlayAnimationDuration: overlayStyle?.animationDuration ?? "0s",
                  transform: style.transform,
                  opacity: Number(style.opacity),
                  layoutBox: capture.layoutBox,
                  overlayClass: overlay?.className ?? null,
                  overlayOpacity: overlayStyle ? Number(overlayStyle.opacity) : null,
                  overlayAnimationName: overlayAnimation instanceof CSSAnimation ? overlayAnimation.animationName : null,
                  overlayAnimationTime: overlayAnimation?.currentTime ?? null,
                  viewAnimationTime: viewAnimation.currentTime ?? null,
                  previewIframePresent: Boolean(document.querySelector(".embedded-runtime-preview-frame iframe")),
                });
              }
            }
            if (!capture.done && capture.frame < 240) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        await input.setInputFiles(fixturePath);
        await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60_000 });
        await page.locator('.project-entry-loading-overlay[data-overlay-kind="project-entry"].is-closing')
          .waitFor({ state: "attached", timeout: 30_000 });
        await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"), undefined, { timeout: 30_000 });
        await page.locator(".embedded-runtime-preview-frame iframe").waitFor({ state: "attached", timeout: 30_000 });
        await page.locator(".embedded-runtime-preview-status.is-ready").waitFor({ state: "visible", timeout: 60_000 });
        const transition = await page.evaluate(() => {
          const capture = window.__editorEntryTransitionCapture;
          capture.done = true;
          capture.longAnimationFrameObserver?.disconnect();
          const view = document.querySelector(".app-view-editor");
          const rect = view?.getBoundingClientRect();
          return {
              samples: capture.samples,
              longAnimationFrames: capture.longAnimationFrames,
              sampleCadence: (() => {
              const times = capture.samples.map(sample => sample.sampledAt);
              const gaps = times.slice(1).map((time, index) => time - times[index]);
              return {
                activeFrameCount: times.length,
                maxGapMs: gaps.length ? Math.max(...gaps) : null,
                meanGapMs: gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null,
                p95GapMs: gaps.length
                  ? gaps.sort((left, right) => left - right)[Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1)]
                  : null,
              };
            })(),
            final: view ? {
              animationName: getComputedStyle(view).animationName,
              transform: getComputedStyle(view).transform,
              opacity: Number(getComputedStyle(view).opacity),
              rect: rect && { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
              layoutBox: { left: view.offsetLeft, top: view.offsetTop, width: view.offsetWidth, height: view.offsetHeight },
            } : null,
            previewIframePresentAfterEntry: Boolean(document.querySelector(".embedded-runtime-preview-frame iframe")),
            previewStatusAfterEntry: document.querySelector(".embedded-runtime-preview-status")?.className ?? null,
          };
        });
        const viewportResult = { viewport, fixtureId, transition };
        report.results.push(viewportResult);
        await page.screenshot({ path: path.join(output, `${viewport.name}-reveal.png`) });
        assertContainerTransition(
          transition.samples,
          transition.final,
          viewport.name,
          reducedMotion,
          requireRenderedCadence,
          transition.longAnimationFrames,
        );
        assert(
          transition.samples.length > 0 && transition.samples.every(sample => !sample.previewIframePresent),
          `${viewport.name}: embedded GameCLI iframe must remain unmounted during the cold container morph\n`
            + JSON.stringify(transition.samples.filter(sample => sample.previewIframePresent)),
        );
        assert(
          transition.previewIframePresentAfterEntry
            && transition.previewStatusAfterEntry?.includes("is-ready"),
          `${viewport.name}: deferred GameCLI preview must mount and complete its ready handshake after entry\n`
            + JSON.stringify({
              previewIframePresentAfterEntry: transition.previewIframePresentAfterEntry,
              previewStatusAfterEntry: transition.previewStatusAfterEntry,
            }),
        );
        assert(errors.length === 0, `${viewport.name}: browser errors`, errors);
        await page.evaluate(() => {
          const capture = { samples: [], done: false };
          window.__editorReturnTransitionCapture = capture;
          const sample = () => {
            const home = document.querySelector(".app-view-home");
            const editor = document.querySelector(".app-view-editor");
            const homeAnimation = home?.getAnimations().find(animation =>
              animation instanceof CSSAnimation && animation.animationName === "project-library-return");
            const editorAnimation = editor?.getAnimations().find(animation =>
              animation instanceof CSSAnimation && animation.animationName === "cartridge-container-unload");
            if (homeAnimation || editorAnimation) {
              const homeStyle = home ? getComputedStyle(home) : null;
              const editorStyle = editor ? getComputedStyle(editor) : null;
              capture.samples.push({
                at: performance.now(),
                homeClass: home?.className ?? null,
                homeAnimationName: homeAnimation?.animationName ?? homeStyle?.animationName ?? "none",
                homeAnimationDuration: homeStyle?.animationDuration ?? "0s",
                homeAnimationTimingFunction: homeStyle?.animationTimingFunction ?? "ease",
                homeAnimationTime: homeAnimation?.currentTime ?? null,
                homeOpacity: homeStyle ? Number(homeStyle.opacity) : null,
                homeTransform: homeStyle?.transform ?? "none",
                editorClass: editor?.className ?? null,
                editorAnimationName: editorAnimation?.animationName ?? editorStyle?.animationName ?? "none",
                editorAnimationDuration: editorStyle?.animationDuration ?? "0s",
                editorAnimationTimingFunction: editorStyle?.animationTimingFunction ?? "ease",
                editorAnimationTime: editorAnimation?.currentTime ?? null,
                editorOpacity: editorStyle ? Number(editorStyle.opacity) : null,
                editorTransform: editorStyle?.transform ?? "none",
              });
            }
            if (!capture.done && capture.samples.length < 1_000) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        await page.locator(".toolbar-home-button").click();
        await page.waitForFunction(() => document.querySelector(".app-view-home")
          ?.classList.contains("is-entering"), undefined, { timeout: 10_000 });
        try {
          await page.waitForFunction(options => {
            const samples = window.__editorReturnTransitionCapture?.samples ?? [];
            const minimumFrames = options.continuous ? 3 : 1;
            return samples.filter(sample => sample.homeAnimationName === "project-library-return"
              && sample.homeOpacity > 0.05 && sample.homeOpacity < 0.95
              && Number(sample.homeAnimationTime) > 0
              && Number(sample.homeAnimationTime) < (options.reduced ? 520 : 1700)
              && sample.homeAnimationDuration !== "0s").length >= minimumFrames;
          }, { reduced: reducedMotion, continuous: requireRenderedCadence }, { timeout: 5_000 });
        } catch (error) {
          const diagnostics = await page.evaluate(() => {
            const home = document.querySelector(".app-view-home");
            const style = home ? getComputedStyle(home) : null;
            return {
              className: home?.className ?? null,
              animationName: style?.animationName ?? null,
              animationDuration: style?.animationDuration ?? null,
              opacity: style ? Number(style.opacity) : null,
              animations: home?.getAnimations().map(animation => ({
                playState: animation.playState,
                currentTime: animation.currentTime,
                duration: animation.effect?.getTiming().duration,
              })) ?? [],
              capturedFrames: window.__editorReturnTransitionCapture?.samples.length ?? 0,
              lastSamples: window.__editorReturnTransitionCapture?.samples.slice(-12) ?? [],
            };
          });
          report.results.push({ viewport, fixtureId, returnDiagnostic: diagnostics });
          error.message += `\nreturn transition diagnostics: ${JSON.stringify(diagnostics)}`;
          throw error;
        }
        await page.waitForFunction(() => (
          !document.querySelector(".app-view.is-entering")
          && !document.querySelector(".app-view.is-exiting")
          && document.querySelector(".app-view-home.is-active")
        ), undefined, { timeout: 30_000 });
        const returnTransition = await page.evaluate(() => {
          const capture = window.__editorReturnTransitionCapture;
          capture.done = true;
          const home = document.querySelector(".app-view-home");
          return {
            samples: capture.samples,
            homeStillEnteringMidTransition: Boolean(home?.classList.contains("is-entering")),
          };
        });
        assertLibraryReturnTransition(
          returnTransition.samples,
          viewport.name,
          reducedMotion,
          requireRenderedCadence,
        );
        const settledViewState = await page.evaluate(() => ({
          activeHome: Boolean(document.querySelector(".app-view-home.is-active")),
          enteringCount: document.querySelectorAll(".app-view.is-entering").length,
          exitingCount: document.querySelectorAll(".app-view.is-exiting").length,
        }));
        assert(settledViewState.activeHome && settledViewState.enteringCount === 0
          && settledViewState.exitingCount === 0,
        `${viewport.name}: container transition must settle to one interactive home view`,
        settledViewState);
        Object.assign(viewportResult, { returnTransition, settledViewState });

      });
      await page.screenshot({ path: path.join(output, `${viewport.name}.png`) });
      await pageSession.detach().catch(() => {});
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
