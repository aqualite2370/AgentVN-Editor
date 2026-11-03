#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const {
  resolveAcceptancePaths,
  startEditorAcceptance,
} = require("./lib/editor-ui-acceptance.cjs");

const paths = resolveAcceptancePaths();
const output = paths.output;
const disableClosingBackdropBlur =
  process.env.EDITOR_TRANSITION_DISABLE_CLOSING_BLUR === "1";
const disableEditorShellBoot =
  process.env.EDITOR_TRANSITION_DISABLE_SHELL_BOOT === "1";
const disableContainerTransform =
  process.env.EDITOR_TRANSITION_DISABLE_CONTAINER_TRANSFORM === "1";
const configuredBackdropBlur = process.env.EDITOR_TRANSITION_BACKDROP_BLUR_PX;
const backdropBlurPx = configuredBackdropBlur === undefined
  ? null
  : Number(configuredBackdropBlur);
const removeOverlayOverscan =
  process.env.EDITOR_TRANSITION_REMOVE_OVERLAY_OVERSCAN === "1";
const removeContainerScale =
  process.env.EDITOR_TRANSITION_REMOVE_CONTAINER_SCALE === "1";
const configuredStartDelay = process.env.EDITOR_TRANSITION_DIAGNOSTIC_START_DELAY_MS;
const diagnosticStartDelayMs = configuredStartDelay === undefined
  ? null
  : Number(configuredStartDelay);
const viewports = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "4k", width: 3840, height: 2160 },
];
const report = {
  runId: new Date().toISOString(),
  scope: "editor-container-transition-lightweight-raf-diagnostic",
  sampling: "rAF timestamps, CSSAnimation clock, Long Animation Frame/Long Task entries; no layout/style reads",
  probe: [
    disableClosingBackdropBlur && "disable closing full-screen backdrop blur",
    disableEditorShellBoot && "disable nested editor-shell entry opacity animation",
    disableContainerTransform && "preserve container opacity timing but remove transform",
    backdropBlurPx !== null && `set closing full-screen backdrop blur to ${backdropBlurPx}px`,
    removeOverlayOverscan && "remove only the loading overlay's 32px viewport overscan",
    removeContainerScale && "preserve container opacity/vertical movement while removing scale",
    diagnosticStartDelayMs !== null && `diagnostic-only synchronized transition delay ${diagnosticStartDelayMs}ms`,
  ].filter(Boolean).join("; ") || "baseline product styling",
  isolation: paths,
  browser: null,
  results: [],
  status: "RUNNING",
};

function summarizeFrames(frames) {
  const gaps = frames.slice(1).map((frame, index) => frame.at - frames[index].at);
  const sorted = [...gaps].sort((left, right) => left - right);
  const percentile = value => sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]
    : null;
  return {
    frameCount: frames.length,
    elapsedMs: frames.length > 1 ? frames.at(-1).at - frames[0].at : null,
    maxGapMs: gaps.length ? Math.max(...gaps) : null,
    p95GapMs: percentile(0.95),
    medianGapMs: percentile(0.5),
    meanGapMs: gaps.length
      ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
      : null,
    animationStart: frames.find(frame => frame.animationTime >= 0)?.at ?? null,
    animationEnd: [...frames].reverse().find(frame =>
      Number.isFinite(frame.animationDuration)
        && frame.animationTime >= frame.animationDuration)?.at ?? null,
  };
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const app = await startEditorAcceptance(output);
  try {
    for (const viewport of viewports) {
      const browser = await chromium.launch({ headless: false });
      try {
        const diagnostics = await browser.newBrowserCDPSession();
        const system = await diagnostics.send("SystemInfo.getInfo").catch(() => null);
        report.browser = {
          version: browser.version(),
          gpuRenderer: system?.gpu?.devices?.[0]?.deviceString ?? "unavailable",
          gpuFeatureStatus: system?.gpu?.featureStatus ?? null,
        };
        await diagnostics.detach().catch(() => {});

        const page = await browser.newPage({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          reducedMotion: "no-preference",
        });
        page.setDefaultTimeout(60_000);
        const errors = [];
        page.on("pageerror", error => errors.push(error.stack || error.message));
        page.on("console", message => {
          if (message.type() === "error") errors.push(message.text());
        });

        await app.server.run(async () => {
          await page.goto(app.url, { waitUntil: "domcontentloaded" });
          if (disableClosingBackdropBlur || disableEditorShellBoot
            || disableContainerTransform || removeContainerScale) {
            const probeRules = [];
            if (disableClosingBackdropBlur) {
              probeRules.push(`
                .project-entry-loading-overlay.is-closing {
                  backdrop-filter: none !important;
                  -webkit-backdrop-filter: none !important;
                }
              `);
            }
            if (disableEditorShellBoot) {
              probeRules.push(`
                .app-transition-stage.is-enter-cartridge .editor-shell {
                  animation: none !important;
                }
              `);
            }
            if (disableContainerTransform) {
              probeRules.push(`
                @keyframes container-boot {
                  0%, 34% { opacity: 0; transform: none; }
                  54% { opacity: 0.72; transform: none; }
                  100% { opacity: 1; transform: none; }
                }
              `);
            }
            if (removeContainerScale) {
              probeRules.push(`
                @keyframes container-boot {
                  0%, 34% { opacity: 0; transform: translateY(14px); }
                  54% { opacity: 0.72; transform: translateY(5px); }
                  100% { opacity: 1; transform: translateY(0); }
                }
              `);
            }
            await page.addStyleTag({
              content: probeRules.join("\n"),
            });
          }
          const visualProbeRules = [];
          if (backdropBlurPx !== null) {
            assert(Number.isFinite(backdropBlurPx) && backdropBlurPx >= 0 && backdropBlurPx <= 4,
              "EDITOR_TRANSITION_BACKDROP_BLUR_PX must be between 0 and 4");
            visualProbeRules.push(`
              .project-entry-loading-overlay.is-closing {
                backdrop-filter: blur(${backdropBlurPx}px) !important;
                -webkit-backdrop-filter: blur(${backdropBlurPx}px) !important;
              }
            `);
          }
          if (removeOverlayOverscan) {
            visualProbeRules.push(`
              .project-entry-loading-overlay {
                width: 100vw !important;
                height: 100dvh !important;
                min-height: 100dvh !important;
              }
            `);
          }
          if (visualProbeRules.length) {
            await page.addStyleTag({ content: visualProbeRules.join("\n") });
          }
          if (diagnosticStartDelayMs !== null) {
            assert(Number.isFinite(diagnosticStartDelayMs)
              && diagnosticStartDelayMs >= 0 && diagnosticStartDelayMs <= 3000,
            "EDITOR_TRANSITION_DIAGNOSTIC_START_DELAY_MS must be between 0 and 3000");
            await page.addStyleTag({
              content: `
                .project-entry-loading-overlay.is-closing {
                  animation-delay: ${diagnosticStartDelayMs}ms !important;
                }
                .app-transition-stage.is-enter-cartridge .app-view-editor.is-entering {
                  animation-delay: ${diagnosticStartDelayMs}ms !important;
                }
              `,
            });
          }
          const input = page.locator(".project-import-button input").first();
          await input.waitFor({ state: "attached" });
          await page.waitForFunction(() => [
            ...document.querySelectorAll(".project-import-button input"),
          ].some(node => node instanceof HTMLInputElement && !node.disabled));

          await page.evaluate(() => {
            const capture = {
              frames: [],
              settledEditorFrames: [],
              longAnimationFrames: [],
              longTasks: [],
              phase: "transition",
              stopped: false,
            };
            window.__lightweightTransitionCapture = capture;
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
            if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
              const observer = new PerformanceObserver(entries => {
                for (const entry of entries.getEntries()) {
                  capture.longTasks.push({
                    startTime: entry.startTime,
                    duration: entry.duration,
                    name: entry.name,
                  });
                }
              });
              observer.observe({ type: "longtask", buffered: true });
              capture.longTaskObserver = observer;
            }
            const tick = () => {
              if (capture.stopped) return;
              if (capture.phase === "settled-editor") {
                capture.settledEditorFrames.push({ at: performance.now() });
                requestAnimationFrame(tick);
                return;
              }
              const view = document.querySelector(".app-view-editor");
              const animation = view?.getAnimations().find(candidate =>
                candidate instanceof CSSAnimation
                  && candidate.animationName === "container-boot");
              if (animation) {
                capture.frames.push({
                  at: performance.now(),
                  animationTime: Number(animation.currentTime),
                  animationDuration: Number(animation.effect?.getTiming().duration),
                  playState: animation.playState,
                });
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });

          await input.setInputFiles(paths.input);
          await page.waitForFunction(() => {
            const view = document.querySelector(".app-view-editor");
            const animation = view?.getAnimations().find(candidate =>
              candidate instanceof CSSAnimation
                && candidate.animationName === "container-boot");
            return animation?.playState === "finished";
          }, undefined, { timeout: 30_000 });
          await page.waitForFunction(() =>
            !document.querySelector(".project-entry-loading-overlay"), undefined,
          { timeout: 30_000 });

          await page.evaluate(() => {
            window.__lightweightTransitionCapture.phase = "settled-editor";
          });
          await page.waitForFunction(() =>
            window.__lightweightTransitionCapture.settledEditorFrames.length >= 90,
          undefined, { timeout: 30_000 });
          await page.evaluate(() => {
            const capture = window.__lightweightTransitionCapture;
            const stage = document.querySelector(".app-transition-stage");
            const view = document.querySelector(".app-view-editor");
            if (!(stage instanceof HTMLElement) || !(view instanceof HTMLElement))
              throw new Error("settled replay requires the live editor transition stage");
            capture.initialTransition = capture.frames;
            capture.frames = [];
            capture.phase = "transition";
            stage.classList.add("is-enter-cartridge", "is-project-entry-loading");
            view.classList.remove("is-active");
            view.classList.add("is-entering");
            const overlay = document.createElement("div");
            overlay.className = "project-entry-loading-overlay is-closing";
            overlay.dataset.overlayKind = "project-entry";
            overlay.setAttribute("aria-hidden", "true");
            stage.append(overlay);
            window.__lightweightTransitionReplayOverlay = overlay;
          });
          await page.waitForFunction(() => {
            const view = document.querySelector(".app-view-editor");
            const animation = view?.getAnimations().find(candidate =>
              candidate instanceof CSSAnimation
                && candidate.animationName === "container-boot");
            return animation?.playState === "finished";
          }, undefined, { timeout: 10_000 });
          await page.evaluate(async () => {
            await new Promise(resolve => requestAnimationFrame(() =>
              requestAnimationFrame(resolve)));
            window.__lightweightTransitionCapture.phase = "settled-editor";
            window.__lightweightTransitionReplayOverlay?.remove();
            window.__lightweightTransitionReplayOverlay = null;
            document.querySelector(".app-view-editor")?.classList.remove("is-entering");
            document.querySelector(".app-view-editor")?.classList.add("is-active");
            document.querySelector(".app-transition-stage")
              ?.classList.remove("is-enter-cartridge", "is-project-entry-loading");
            await new Promise(resolve => requestAnimationFrame(() =>
              requestAnimationFrame(resolve)));
          });
          const frames = await page.evaluate(() => {
            window.__lightweightTransitionCapture.stopped = true;
            window.__lightweightTransitionCapture.longAnimationFrameObserver?.disconnect();
            window.__lightweightTransitionCapture.longTaskObserver?.disconnect();
            return {
              transition: window.__lightweightTransitionCapture.initialTransition,
              replayedAfterSettle: window.__lightweightTransitionCapture.frames,
              settledEditor: window.__lightweightTransitionCapture.settledEditorFrames,
              longAnimationFrames: window.__lightweightTransitionCapture.longAnimationFrames,
              longTasks: window.__lightweightTransitionCapture.longTasks,
            };
          });
          const result = {
            viewport,
            transition: summarizeFrames(frames.transition),
            replayedAfterSettle: summarizeFrames(frames.replayedAfterSettle),
            settledEditor: summarizeFrames(frames.settledEditor),
            longAnimationFrames: frames.longAnimationFrames,
            longTasks: frames.longTasks,
            errors,
          };
          report.results.push(result);
          assert(frames.transition.length >= 3,
            `${viewport.name}: expected multiple animation frames, captured ${frames.transition.length}`);
          assert(frames.settledEditor.length >= 90,
            `${viewport.name}: expected a settled-editor frame baseline, captured ${frames.settledEditor.length}`);
          assert(errors.length === 0,
            `${viewport.name}: browser errors: ${errors.join("\n")}`);
        });
        await page.close();
      } finally {
        await browser.close();
      }
    }
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
  } finally {
    await app.stop();
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
  }
  if (report.status !== "PASS") throw new Error(report.error);
  console.log(`editor-transition-lightweight-raf-diagnostic: PASS (${output})`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
