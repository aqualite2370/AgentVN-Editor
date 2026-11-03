"use strict";

// Editor only. Exercises the actual options navigation, including the FLIP
// container morph; a settled-only measurement cannot detect moving masks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance, resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");

const paths = require.main === module ? resolveAcceptancePaths() : null;
const names = (process.env.MOTION_VIEWPORTS || "1080p").split(",");
const sizes = { "1080p": [1920, 1080], "1440p": [2560, 1440], "4k": [3840, 2160] };
assert(names.length && names.every(name => sizes[name]), "Non-empty desktop-only viewport matrix required");
const dpr = Number(process.env.MOTION_DPR || 1);
assert([1, 2].includes(dpr), "DPR must be 1 or 2");
const report = { status: "RUNNING", layer: "Editor", installed: false,
  isolation: paths, dpr, reducedMotion: process.env.MOTION_REDUCED === "1", cases: [] };
const popover = ".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)";
const tab = key => `${popover} [data-help-key="advanced.tab.${key}"]`;

async function idle(page, key) {
  await page.waitForFunction(({ selector, key }) => {
    const root = document.querySelector(selector);
    return root && !root.classList.contains("is-morphing")
      && !root.getAnimations({ subtree: false }).some(animation => animation.playState === "running")
      && root.querySelector(".advanced-tools-panel.is-tab-idle")
      && root.querySelector(".advanced-tab-content.is-active")?.dataset.tab === key;
  }, { selector: popover, key }, { timeout: 40000 });
}

async function beginSample(page) {
  await page.evaluate(selector => {
    const frames = [];
    const read = () => {
      const root = document.querySelector(selector);
      const nav = root?.querySelector("nav.glass-selection-group");
      const selected = nav?.querySelector('[data-glass-selected="true"]');
      const indicator = nav?.querySelector(".glass-selection-indicator");
      if (!nav || !selected || !indicator) return null;
      const box = node => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const animations = node => node.getAnimations().map(animation => ({
        state: animation.playState, time: animation.currentTime,
        timing: animation.effect?.getComputedTiming().duration,
        easing: animation.effect?.getTiming().easing,
      }));
      return { at: performance.now(), selected: selected.dataset.helpKey, nav: box(nav),
        button: box(selected), indicator: box(indicator),
        material: box(indicator.querySelector(".glass-selection-material")),
        adapter: box(indicator.querySelector(".static-glass-adapter")),
        indicatorStyle: { ...Object.fromEntries(["transform", "width", "height", "opacity", "visibility"]
          .map(key => [key, getComputedStyle(indicator)[key]])) },
        navWidth: nav.offsetWidth, navScroll: nav.querySelector(".glass-selection-viewport")?.scrollLeft,
        moving: indicator.dataset.glassMoving, markerAnimations: animations(indicator),
        morphing: root.classList.contains("is-morphing"), layoutMode: root.classList.contains("is-layout-mode"),
        root: box(root), workspace: box(document.querySelector(".editor-workspace")),
        inspector: document.querySelector(".scene-editor-pane")
          ? box(document.querySelector(".scene-editor-pane")) : null,
        palette: document.querySelector(".node-palette")
          ? box(document.querySelector(".node-palette")) : null,
        rootAnimations: animations(root), active: root.querySelector(".advanced-tab-content.is-active")?.dataset.tab,
        contentAnimations: [...root.querySelectorAll(".advanced-tab-content")]
          .flatMap(node => animations(node).map(animation => ({ tab: node.dataset.tab, ...animation }))),
        phase: root.querySelector(".advanced-tools-panel")?.className,
        interactiveOwners: [...root.querySelectorAll('[data-advanced-tab-interactive="true"]')]
          .filter(node => !node.inert).map(node => node.dataset.tab),
      };
    };
    let active = true;
    let handle;
    const tick = () => {
      if (!active) return;
      const frame = read();
      if (frame) frames.push(frame);
      handle = requestAnimationFrame(tick);
    };
    window.__selectionMaskSample = { frames, stop: () => {
      active = false;
      cancelAnimationFrame(handle);
      const frame = read();
      if (frame) frames.push(frame);
      return { frames, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
    } };
    tick();
  }, popover);
}

async function visiblePointerClick(page, key) {
  const button = page.locator(tab(key));
  // Do not wait for stability: this helper specifically exercises interruption.
  // A genuine background miss during motion is retained in the input trace;
  // never retry a wrong-button hit or silently claim a missed input succeeded.
  for (let attempt = 0; attempt < 4; attempt++) {
    const target = await button.evaluate(node => {
      const r = node.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = node.contains(document.elementFromPoint(x, y));
      if (hit && r.width > 0 && r.height > 0) {
        const probe = { receipt: null };
        const listener = e => { probe.receipt = { expected: node.contains(e.target),
          button: e.target instanceof Element && !!e.target.closest("button"),
          morphing: node.closest(".toolbar-popover")?.classList.contains("is-morphing"),
          trusted: e.isTrusted }; };
        document.addEventListener("click", listener, { capture: true, once: true });
        probe.stop = () => { document.removeEventListener("click", listener, true); return probe.receipt; };
        window.__selectionMaskPointerProbe = probe;
      }
      return { x, y, width: r.width, height: r.height, hit };
    });
    assert(target.width > 0 && target.height > 0, `Missing visible target ${key}`);
    assert(target.hit, `Target ${key} is covered by another live layer`);
    let receipt;
    try { await page.mouse.click(target.x, target.y); }
    finally { receipt = await page.evaluate(() => window.__selectionMaskPointerProbe.stop()); }
    assert(receipt?.trusted, `No trusted pointer receipt for ${key}`);
    if (receipt.expected) return;
    assert(!receipt.button, `Moving pointer hit a different button instead of ${key}`);
    assert(receipt.morphing, `Pointer missed ${key} outside a container morph`);
  }
  assert.fail(`Moving target ${key} was not reached in four real pointer attempts`);
}

async function main() {
  let env, browser;
  try {
    env = await startEditorAcceptance(paths.output);
    report.owner = { pid: env.server.pid, runId: env.server.runId, backendPid: env.backendPid,
      url: env.url, backendUrl: env.backendUrl };
    browser = await chromium.launch();
    for (const name of names) {
      const [width, height] = sizes[name];
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
        reducedMotion: report.reducedMotion ? "reduce" : "no-preference" });
      const page = await context.newPage();
      page.setDefaultTimeout(40000);
      await env.server.run(async () => {
        await env.open(page);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await idle(page, "settings");
        const scenarios = ["history", "library", "layout", "library", "assets", "history", "settings"]
          .map(key => ({ key, method: "pointer" }));
        scenarios.push({ key: "history", method: "keyboard" }, { key: "settings", method: "rapid-redirect" });
        for (const { key, method } of scenarios) {
          await beginSample(page);
          if (method === "keyboard") {
            // The preceding real click left focus on settings (the first tab).
            for (let index = 0; index < 7; index++) await page.keyboard.press("Tab");
            assert.equal(await page.locator(tab(key)).evaluate(node => node === document.activeElement), true,
              "Keyboard traversal must reach the actual history button");
            await page.keyboard.press("Enter");
          } else if (method === "rapid-redirect") {
            await visiblePointerClick(page, "layout");
            await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains("is-morphing"),
              popover);
            await visiblePointerClick(page, "library");
            await visiblePointerClick(page, key);
          } else {
            await page.locator(tab(key)).click();
          }
          await idle(page, key);
          // Two unique rendering frames, not a fixed settle timeout.
          await page.evaluate(() => new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const data = await page.evaluate(() => window.__selectionMaskSample.stop());
          const item = { viewport: name, target: key, method, ...data, failures: [] };
          report.cases.push(item);
          const frames = item.frames;
          const last = frames.at(-1);
          assert(frames.length >= 3, "Empty/missing frame matrix");
          assert.deepEqual(data.viewport, { width, height, dpr });
          assert.equal(data.reduced, report.reducedMotion);
          const delta = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y),
            Math.abs(a.width - b.width), Math.abs(a.height - b.height));
          if (delta(last.indicator, last.button) > 2)
            item.failures.push(`Settled mask/button mismatch ${delta(last.indicator, last.button).toFixed(2)}px`);
          if (frames.some(frame => frame.indicator.x < frame.nav.x - 3
            || frame.indicator.right > frame.nav.right + 3))
            item.failures.push("Moving mask escapes the actual navigation track");
          if (frames.some(frame => delta(frame.indicator, frame.material) > 2
            || delta(frame.indicator, frame.adapter) > 2))
            item.failures.push("Material has a second scale/offset distinct from the mask");
          if (frames.some(frame => frame.interactiveOwners.length > 1))
            item.failures.push("Multiple live input owners");
          // The user explicitly expanded complex desks over the retained Inspector.
          // Their enter/exit segment owns that larger footprint; compact-only paths
          // still obey the original canvas boundary. Neither may reflow background.
          const complexTransition = key === "layout" || frames.some(frame => frame.layoutMode || frame.active === "layout");
          if (!complexTransition && frames.some(frame => frame.inspector && frame.root.right > frame.inspector.x + 1))
            item.failures.push("Moving workbench covers the preserved Inspector track");
          if (frames.some(frame => frame.root.right > frame.workspace.right + 1))
            item.failures.push("Moving workbench escapes the full editing area");
          if (frames.some(frame => frame.inspector && delta(frame.inspector, frames[0].inspector) > 1
            || frame.palette && delta(frame.palette, frames[0].palette) > 1))
            item.failures.push("Moving workbench reflows retained background tracks");
          if (frames.some(frame => frame.palette && frame.root.x < frame.palette.right - 1))
            item.failures.push("Moving workbench covers the preserved node rail");
          if (method === "keyboard"
            && !frames.some(frame => frame.markerAnimations.some(animation => animation.state === "running")))
            item.failures.push("Keyboard navigation hard-cuts the selection marker");
          if (process.env.EDITOR_EXPECT_WORKSPACE_SPEED) {
            const speed = Number(process.env.EDITOR_EXPECT_WORKSPACE_SPEED);
            assert(Number.isFinite(speed) && speed > 0, "Invalid expected workspace playback rate");
            const contentTimings = frames.flatMap(frame => frame.contentAnimations)
              .filter(animation => animation.state === "running");
            const wide = tab => ["layout","theme","assets","animation","novel"].includes(tab);
            const sibling = wide(frames[0].active) === wide(key);
            const siblingMs = await page.evaluate(reduced => Number.parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue(
                reduced ? "--motion-editor-sibling-reduced" : "--motion-editor-sibling")),report.reducedMotion);
            const allowedTimings = (method === "rapid-redirect" ? [400,siblingMs] : [sibling ? siblingMs : 400])
              .map(ms => ms / speed);
            if ((method !== "rapid-redirect" && !contentTimings.length)
              || contentTimings.some(animation => !allowedTimings.some(ms => Math.abs(animation.timing - ms) <= 1)))
              item.failures.push("Content motion does not use the requested category playback rate");
            const morphTimings = frames.flatMap(frame => frame.rootAnimations)
              .filter(animation => animation.state === "running");
            if (frames.some(frame => frame.morphing)
              && (!morphTimings.length || morphTimings.some(animation =>
                Math.abs(animation.timing - (report.reducedMotion ? 640 : 960) / speed) > 1)))
              item.failures.push("Container morph does not use the requested category playback rate");
          }
          const errors = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            centerHit: (() => {
              const button = document.querySelector(
                '.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) nav [data-glass-selected="true"]');
              const r = button.getBoundingClientRect();
              return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            })(),
          }));
          if (errors.overflow || !errors.centerHit) item.failures.push(`Actual hit/overflow failure ${JSON.stringify(errors)}`);
          if (process.env.MASK_REMEASURE_PROBE === "1") {
            item.remeasureProbe = await page.evaluate(() => new Promise(resolve => {
              window.dispatchEvent(new Event("resize"));
              requestAnimationFrame(() => requestAnimationFrame(() => {
                const root = document.querySelector(
                  '.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) nav.glass-selection-group');
                const selected = root.querySelector('[data-glass-selected="true"]').getBoundingClientRect();
                const indicator = root.querySelector(".glass-selection-indicator").getBoundingClientRect();
                resolve({ x: indicator.x - selected.x, width: indicator.width - selected.width,
                  y: indicator.y - selected.y, height: indicator.height - selected.height });
              }));
            }));
          }
          if (item.failures.length || key === "library")
          {
            const png = await page.screenshot({ path: path.join(paths.output, `${name}-${key}-${report.cases.length}.png`) });
            assert.equal(png.readUInt32BE(16), width * dpr, "Actual PNG width must match sampled DPR");
            assert.equal(png.readUInt32BE(20), height * dpr, "Actual PNG height must match sampled DPR");
          }
          console.log(JSON.stringify({ viewport: name, key, method, frames: frames.length,
            lastDelta: delta(last.indicator, last.button), failures: item.failures }));
        }
      });
      await context.close();
    }
    assert.equal(report.cases.length, names.length * 9, "Missing matrix cases");
    assert.equal(report.cases.filter(item => item.failures.length).length, 0, "Mask geometry failures; see report");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack;
    process.exitCode = 1;
  } finally {
    try {
      await browser?.close();
      await env?.stop();
      if (env) {
        const stillListening = await Promise.all([env.url, `${env.backendUrl}/api/health`].map(async url => {
          try { await fetch(url, { signal: AbortSignal.timeout(1000) }); return url; }
          catch { return null; }
        }));
        report.cleanup = { status: stillListening.some(Boolean) ? "FAILED" : "PASS",
          respondingOwnedEndpoints: stillListening.filter(Boolean), browserClosed: true };
        assert(!stillListening.some(Boolean), "Owned acceptance service remains after cleanup");
      }
    } catch (error) {
      report.status = "FAILED";
      report.cleanup = { status: "FAILED", error: error.stack };
      process.exitCode = 1;
    }
    fs.mkdirSync(paths.output, { recursive: true });
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, report: path.join(paths.output, "report.json") }));
  }
}
module.exports = { idle, beginSample, visiblePointerClick };
if (require.main === module) void main();
