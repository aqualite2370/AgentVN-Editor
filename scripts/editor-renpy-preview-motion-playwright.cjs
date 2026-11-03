"use strict";

// Editor-only device frame handoff. Real navigation, retained Runtime preview.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { viewports, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { geometry, verify: verifyGeometry, waitForRuntimePreview } = require("./editor-renpy-preview-geometry-playwright.cjs");
const paths = resolveAcceptancePaths();
const requested = (process.env.RENPY_MOTION_VIEWPORTS || "1080p,1440p,4k").split(",");
const matrix = viewports.filter(v => requested.includes(v.name));
const dpr = Number(process.env.RENPY_MOTION_DPR || 1);
const reduced = process.env.RENPY_MOTION_REDUCED === "1";
const report = { status: "RUNNING", scope: "Editor E2 device preview handoff; not Runtime/Release",
  isolation: paths, dpr, reduced, headful: process.env.RENPY_MOTION_HEADFUL === "1",
  viewportScope: "Chromium CSS viewport/DPR; not physical monitor or installed Release",
  cases: [], failures: [] };

// Also installed by begin() for the native WebView caller of this module.
function installFrameAnimationTracking() {
  if (window.__frameAnimationEvents) return;
  window.__frameAnimationEvents = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const animation = animate.apply(this, args);
    if (this.classList.contains("renpy-editor-device-frame")) {
      const record = (event) => window.__frameAnimationEvents.push({
        event, at: performance.now(), connected: this.isConnected,
        duration: animation.effect.getTiming().duration, currentTime: animation.currentTime,
        rect: this.getBoundingClientRect().toJSON(),
      });
      record("start");
      animation.addEventListener("finish", () => record("finish"), { once: true });
      animation.addEventListener("cancel", () => record("cancel"), { once: true });
    }
    return animation;
  };
}

async function begin(page) {
  await page.evaluate(installFrameAnimationTracking);
  return page.evaluate(() => {
    const center = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .renpy-title-editor .runtime-layout-center");
    const frame = center.querySelector(".renpy-editor-preview,.renpy-editor-runtime-viewport");
    const rect = node => node.getBoundingClientRect().toJSON();
    const capture = { frames: [], before: rect(frame), iframe: frame.querySelector("iframe"), done: false,
      lifecycleStart: window.__frameAnimationEvents.length, frame };
    window.__deviceMotion = capture;
    const tick = () => {
      if (capture.done) return;
      const current = center.querySelector(".renpy-editor-preview,.renpy-editor-runtime-viewport");
      const canvas = current.querySelector(".renpy-editor-device-canvas");
      const frameMatrix = new DOMMatrix(getComputedStyle(current).transform);
      const canvasMatrix = canvas ? new DOMMatrix(getComputedStyle(canvas).transform) : null;
      const title = current.querySelector(".renpy-title-view");
      const action = title?.querySelector(".renpy-title-action");
      capture.frames.push({ at: performance.now(), rect: rect(current),
        documentVisible: document.visibilityState, documentFocused: document.hasFocus(),
        center: rect(center), toolbar: rect(center.querySelector(".renpy-editor-preview-toolbar")),
        phase: current.dataset.previewPhase, opacity: getComputedStyle(current).opacity,
        transform: getComputedStyle(current).transform,
        iframeSame: current.querySelector("iframe") === capture.iframe,
        frameSame: current === capture.frame,
        canvasScale: canvasMatrix && { x: frameMatrix.a * canvasMatrix.a, y: frameMatrix.d * canvasMatrix.d },
        canvasRect: canvas && rect(canvas), framePhase: current.dataset.framePhase,
        title: title && { scale: Number(title.dataset.renpyScale), width: title.clientWidth, height: title.clientHeight,
          font: action && parseFloat(getComputedStyle(action).fontSize),
          configuredFont: Number(document.querySelector('input[aria-label="共享导航字号"]')?.value) },
        titleButtons: title && [...title.querySelectorAll(".renpy-title-action")].map(node => rect(node)),
        focus: { tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.slice(0, 80),
          title: document.activeElement?.getAttribute("title") },
        animations: center.getAnimations({ subtree: true }).map(a => ({
          duration: a.effect?.getTiming().duration, easing: a.effect?.getTiming().easing, state: a.playState,
          currentTime: a.currentTime, startTime: a.startTime, progress: a.effect?.getComputedTiming().progress,
        })), overflow: document.documentElement.scrollWidth - innerWidth });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return capture.before;
  });
}

function verifyTitleScale(capture) {
  for (const frame of capture.frames) {
    if (!frame.title) continue;
    const expected = Math.min(frame.title.width / 1280, frame.title.height / 720);
    assert(Math.abs(frame.title.scale - expected) < .003,
      `Title must measure its logical canvas, not ancestor presentation transforms: ${JSON.stringify(frame.title)}, expected=${expected}`);
    assert(Math.abs(frame.title.font - frame.title.configuredFont * expected) < .15,
      "Title font must match the configured font at one logical scale");
  }
}

async function finish(page, mode) {
  await page.waitForFunction(({ ratio }) => {
    const frames = window.__deviceMotion.frames;
    if (frames.length < 3) return false;
    return frames.slice(-2).every(f => Math.abs(f.rect.width / f.rect.height - ratio) < .003
      && f.framePhase !== "moving" && f.animations.every(a => a.state !== "running"));
  }, { ratio: mode === "desktop" ? 1280 / 720 : 915 / 412 });
  return page.evaluate(() => {
    window.__deviceMotion.done = true;
    const { frames, before, lifecycleStart } = window.__deviceMotion;
    return { frames, before, animationEvents: window.__frameAnimationEvents.slice(lifecycleStart) };
  });
}

function verify(capture) {
  const frames = capture.frames, before = capture.before, final = frames[frames.length - 1].rect;
  const distance = (a, b) => Math.max(...["left", "top", "width", "height"].map(k => Math.abs(a[k] - b[k])));
  capture.maxFrameGapMs = Math.max(0, ...frames.slice(1).map((f, i) => f.at - frames[i].at));
  assert(distance(before, final) > 5, "Test must change the actual frame, not click an already-selected mode");
  const intermediates = frames.filter(f => distance(f.rect, before) > 1.5 && distance(f.rect, final) > 1.5);
  assert(intermediates.length >= 2,
    `Continuous geometry handoff not observed (${intermediates.length} intermediate frames, `
    + `max rAF gap ${capture.maxFrameGapMs.toFixed(1)}ms); inspect animation lifecycle before attributing a product hard-cut`);
  assert(frames.some(f => f.animations.some(a => a.state === "running" && a.duration >= 480)),
    "Device handoff must own a continuous animation rather than delayed endpoint replacement");
  const firstChange = frames.findIndex(f => distance(f.rect, before) > .5);
  const settled = frames.findIndex((f, i) => i > firstChange && i < frames.length - 1
    && distance(f.rect, final) < .5 && distance(frames[i + 1].rect, final) < .5);
  assert(firstChange >= 0 && settled >= 0, "Missing visible transition interval");
  capture.visibleDurationMs = frames[settled].at - frames[firstChange].at;
  assert(capture.visibleDurationMs >= 480, "Visible frame handoff is truncated despite a longer nominal animation");
  const originalToolbar = frames[0].toolbar, originalCenter = frames[0].center;
  for (const f of frames) {
    assert(distance(f.toolbar, originalToolbar) <= 1 && distance(f.center, originalCenter) <= 1,
      "Device transition must not move the toolbar or its center grid track");
    assert(f.iframeSame, "Device switch must retain the actual Runtime iframe");
    assert(f.frameSame, "Device switch must retain its geometry animation owner");
    assert(f.overflow <= 1, "Device handoff creates horizontal overflow");
    assert(f.rect.left >= f.center.left - 1 && f.rect.right <= f.center.right + 1
      && f.rect.top >= f.toolbar.bottom - 1 && f.rect.bottom <= f.center.bottom + 1,
    "Device frame leaves or clips its stable center track");
    assert(Number(f.opacity) > .01, "Device handoff creates an empty preview frame");
    if (f.canvasScale) assert(Math.abs(f.canvasScale.x - f.canvasScale.y) <= .002,
      `Canvas/text must remain uniformly scaled throughout morph: ${JSON.stringify(f.canvasScale)}`);
    for (const button of f.titleButtons ?? []) assert(button.left >= f.rect.left - 1
      && button.right <= f.rect.right + 1 && button.top >= f.rect.top - 1 && button.bottom <= f.rect.bottom + 1,
    "Title action must remain visible throughout the device morph");
  }
}

async function main() {
  let env, browser, activePage;
  fs.mkdirSync(paths.output, { recursive: true });
  try {
    assert.equal(matrix.length, requested.length, "No empty or unknown matrix");
    env = await startEditorAcceptance(paths.output);
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    browser = await chromium.launch({ headless: process.env.RENPY_MOTION_HEADFUL !== "1" });
    report.browserVersion = browser.version();
    for (const viewport of matrix) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      activePage = page;
      await page.addInitScript(installFrameAnimationTracking);
      await page.bringToFront();
      page.setDefaultTimeout(25000);
      await env.server.run(async () => {
        await env.open(page);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
        await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
          && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
        const workbench = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
        await workbench.locator('[data-layout-type-option="renpy"]').click();
        const editor = workbench.locator(".renpy-title-editor");
        for (const screen of ["title", "about"]) {
          report.activeCase = { viewport: viewport.name, screen, step: "device-roundtrip" };
          await editor.locator(".runtime-layout-sidebar").getByRole("button", {
            name: screen === "title" ? "标题主页" : "关于", exact: true }).click();
          if (screen === "about") {
            await editor.locator('[data-preview-phase="ready"]').waitFor();
            await waitForRuntimePreview(page, "about");
          }
          for (const [mode, keyboard] of [["mobile", false], ["desktop", true]]) {
            const button = editor.getByRole("button", { name: mode === "mobile" ? "移动预览" : "桌面预览", exact: true });
            if (keyboard) await button.focus();
            await begin(page);
            if (keyboard) await page.keyboard.press("Enter"); else await button.click();
            const capture = await finish(page, mode);
            const item = { viewport: viewport.name, screen, mode, input: keyboard ? "keyboard" : "pointer",
              capture, status: "PASS" };
            try {
              verify(capture);
              verifyTitleScale(capture);
              verifyGeometry(await geometry(page, screen === "title"), ...(mode === "desktop" ? [1280, 720] : [915, 412]));
              assert(await button.evaluate(n => n === document.activeElement), "Device control must retain actual focus");
              if (screen === "about") {
                const runtime = await waitForRuntimePreview(page, "about");
                assert(runtime.text.length > 0, "Actual Runtime content must remain usable after device handoff");
              } else {
                await editor.locator(".renpy-title-action").filter({ hasText: "开始游戏" }).click();
                await editor.getByRole("status").filter({ hasText: "预览：开始游戏" }).waitFor();
              }
            }
            catch (error) { item.status = "FAILED"; item.error = error.message; report.failures.push(item.error); }
            report.cases.push(item);
            await page.screenshot({ path: path.join(paths.output, `${viewport.name}-${screen}-${mode}.png`) });
            console.log(`${item.status} ${viewport.name}:${screen}:${mode} ${item.error ?? ""}`);
          }
          report.activeCase.step = "reverse-start";
          await begin(page);
          await editor.getByRole("button", { name: "移动预览", exact: true }).click();
          await page.waitForFunction(() => {
            const frame = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .renpy-title-editor .renpy-editor-device-frame");
            const animation = frame?.getAnimations().find(a =>
              a.effect?.getKeyframes().some(k => String(k.transform).includes("translate")));
            const p = Number(animation?.currentTime) / Number(animation?.effect.getTiming().duration);
            return animation?.playState === "running" && p > .2 && p < .7;
          });
          report.activeCase.step = "reverse-redirect";
          await page.evaluate(() => {
            const frame = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .renpy-title-editor .renpy-editor-device-frame");
            const button = [...document.querySelectorAll(".renpy-editor-preview-toolbar button")]
              .find(n => n.textContent === "桌面预览");
            const readRect = frame.getBoundingClientRect;
            const animate = Element.prototype.animate;
            let redirecting = false;
            frame.getBoundingClientRect = function () {
              const rect = readRect.call(this);
              if (redirecting) window.__reversalRect = rect.toJSON();
              return rect;
            };
            Element.prototype.animate = function (...args) {
              const animation = animate.apply(this, args);
              if (this === frame && redirecting) {
                // Observe the exact first fill frame before the animation clock
                // advances, rather than a later CDP round trip after redirect.
                window.__reversalContinuity = {
                  before: window.__reversalRect, after: readRect.call(frame).toJSON(),
                  trusted: window.__reversalInputTrusted,
                  currentTime: animation.currentTime,
                };
                delete frame.getBoundingClientRect;
                Element.prototype.animate = animate;
                redirecting = false;
              }
              return animation;
            };
            button.addEventListener("click", event => {
              window.__reversalInputTrusted = event.isTrusted;
              redirecting = true;
            }, { once: true });
          });
          await editor.getByRole("button", { name: "桌面预览", exact: true }).focus();
          await page.keyboard.press("Enter");
          const continuity = await page.evaluate(() => window.__reversalContinuity);
          const interrupted = await finish(page, "desktop");
          const interruptedItem = { viewport: viewport.name, screen, mode: "reverse", status: "PASS", continuity, capture: interrupted };
          try {
            assert(continuity?.trusted && continuity.before && continuity.after,
              "Reverse must deliver trusted input and capture the real first redirect frame");
            for (const key of ["left", "top", "width", "height"])
              assert(Math.abs(continuity.before[key] - continuity.after[key]) < 6, "Reverse must start from the currently presented frame");
            assert(interrupted.frames.filter(f => f.framePhase === "moving").length >= 3, "Reverse lacks intermediate frames");
            for (const f of interrupted.frames) assert(f.iframeSame, "Reverse remounted Runtime");
            verifyTitleScale(interrupted);
            // Reversal returns to its starting endpoint, so validate both legs
            // with their shared final geometry rather than requiring a net change.
            for (const f of interrupted.frames) {
              assert(f.overflow <= 1, "Reverse creates horizontal overflow");
              if (f.canvasScale) assert(Math.abs(f.canvasScale.x - f.canvasScale.y) <= .002,
                "Reverse stretches the logical canvas");
              assert(f.rect.left >= f.center.left - 1 && f.rect.right <= f.center.right + 1
                && f.rect.top >= f.toolbar.bottom - 1 && f.rect.bottom <= f.center.bottom + 1,
              "Reverse clips the preview");
            }
            verifyGeometry(await geometry(page, screen === "title"), 1280, 720);
            const sameButton = editor.getByRole("button", { name: "移动预览", exact: true });
            await sameButton.focus();
            await page.keyboard.press("Enter");
            await page.waitForFunction(() => document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase === "moving");
            await page.evaluate(() => {
              const frame = document.querySelector(".renpy-editor-device-frame");
              window.__sameAnimation = frame.getAnimations()[0];
              const button = [...document.querySelectorAll(".renpy-editor-preview-toolbar button")]
                .find(node => node.textContent === "移动预览");
              button.addEventListener("click", event => {
                window.__duplicateInput = { trusted: event.isTrusted, state: window.__sameAnimation.playState };
              }, { once: true });
            });
            await page.keyboard.press("Enter");
            const duplicate = await page.evaluate(() => ({
              input: window.__duplicateInput,
              same: window.__sameAnimation === document.querySelector(".renpy-editor-device-frame").getAnimations()[0],
            }));
            interruptedItem.duplicate = duplicate;
            assert(duplicate.input?.trusted && duplicate.input.state === "running",
              "Duplicate target test must deliver a trusted input during its actual animation");
            assert(duplicate.same, "Duplicate target must not restart device animation");
            await page.waitForFunction(() => document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase === "idle");
            await editor.getByRole("button", { name: "桌面预览", exact: true }).click();
            await page.waitForFunction(() => document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase === "idle");
          } catch (error) { interruptedItem.status = "FAILED"; interruptedItem.error = error.message; report.failures.push(error.message); }
          report.cases.push(interruptedItem);
          console.log(`${interruptedItem.status} ${viewport.name}:${screen}:reverse ${interruptedItem.error ?? ""}`);
          // Exercise the live fit stage while the containing workbench morphs.
          // Final geometry after a settled entry alone cannot detect measuring
          // an ancestor's transient transform as the logical available area.
          await workbench.locator('[data-help-key="advanced.tab.settings"]').click();
          report.activeCase.step = "ancestor-morph";
          await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
            && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
          await workbench.locator('[data-help-key="advanced.tab.layout"]').click();
          await page.waitForFunction(() => {
            const panel = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
            const running = panel?.getAnimations().some(a => {
              const p = a.effect.getComputedTiming().progress;
              return a.playState === "running" && p > .1 && p < .75;
            });
            return running && panel.querySelector(".renpy-title-editor");
          });
          const duringMorph = await page.evaluate(() => {
            const stage = document.querySelector(".renpy-title-editor .is-device-stage");
            return { rect: stage.getBoundingClientRect().toJSON(), width: stage.clientWidth, height: stage.clientHeight };
          });
          const device = editor.getByRole("button", { name: "移动预览", exact: true });
          await device.focus();
          await page.keyboard.press("Enter");
          await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
            && !document.querySelector(".toolbar-popover.advanced.is-morphing")
            && document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase === "idle");
          const reentry = { viewport: viewport.name, screen, mode: "ancestor-morph", duringMorph,
            geometry: await geometry(page, screen === "title"), status: "PASS" };
          try {
            assert(Math.abs(duringMorph.rect.width - duringMorph.width) > 2
              || Math.abs(duringMorph.rect.height - duringMorph.height) > 2,
            "Reentry must actually exercise a transformed parent, not a settled workbench");
            verifyGeometry(reentry.geometry, 915, 412);
          } catch (error) { reentry.status = "FAILED"; reentry.error = error.message; report.failures.push(error.message); }
          report.cases.push(reentry);
          console.log(`${reentry.status} ${viewport.name}:${screen}:ancestor-morph ${reentry.error ?? ""}`);
          await editor.getByRole("button", { name: "桌面预览", exact: true }).click();
          await page.waitForFunction(() => document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase === "idle");
        }
      });
      await page.close();
      activePage = undefined;
    }
    assert.equal(report.cases.length, matrix.length * 8, "Missing device handoff paths");
    report.status = report.failures.length ? "FAILED" : "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = error.stack;
    if (activePage && !activePage.isClosed()) {
      report.failureScene = await activePage.evaluate(() => {
        const capture = window.__deviceMotion;
        if (capture) capture.done = true;
        const frame = document.querySelector(".renpy-editor-device-frame");
        return { focused: document.hasFocus(), visibility: document.visibilityState,
          activeElement: { tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.slice(0, 100) },
          modeButtons: [...document.querySelectorAll(".renpy-editor-preview-toolbar button")]
            .map(node => ({ text: node.textContent, pressed: node.getAttribute("aria-pressed") })),
          frame: frame && { rect: frame.getBoundingClientRect().toJSON(), phase: frame.dataset.framePhase,
            animations: frame.getAnimations().map(animation => ({
              state: animation.playState, timing: animation.effect.getComputedTiming(),
              keyframes: animation.effect.getKeyframes() })) },
          animationEvents: window.__frameAnimationEvents,
          capture: capture && { before: capture.before, totalFrames: capture.frames.length,
            firstFrames: capture.frames.slice(0, 600), lastFrames: capture.frames.slice(-20) } };
      }).catch(sceneError => ({ collectionError: String(sceneError) }));
      await activePage.screenshot({ path: path.join(paths.output, "failure-scene.png") }).catch(() => {});
    }
  }
  finally {
    await browser?.close(); await env?.stop();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output: paths.output, error: report.error }));
  }
  if (report.status !== "PASS") process.exitCode = 1;
}
module.exports = { begin, finish, verify, verifyTitleScale };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
