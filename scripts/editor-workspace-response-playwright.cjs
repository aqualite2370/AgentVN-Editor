"use strict";
// Editor only: real clicks and real rendered animation frames. No Runtime
// theme changes, timing overrides, performance probes or fixed settle delays.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths, startEditorAcceptance, viewports } = require("./lib/editor-ui-acceptance.cjs");
const { selectEarlyRenderedResponse } = require("./lib/editor-early-rendered-response.cjs");
const paths = resolveAcceptancePaths();
const reduced = process.env.RESPONSE_REDUCED === "1";
const dpr = Number(process.env.RESPONSE_DPR || 1);
const headful = process.env.RESPONSE_HEADFUL !== "0";
const requested = (process.env.RESPONSE_VIEWPORTS || "1080p,1440p,4k").split(",");
const matrix = viewports.filter(viewport => requested.includes(viewport.name));
const report = { status: "RUNNING", scope: "Editor workspace early response; not Runtime or installed Release",
  isolation: paths, reduced, dpr, headful, contentEntry: "warmed by real navigation; first-click jank deferred by user",
  cases: [] };

async function arm(page, kind, selector) {
  await page.evaluate(({ kind, selector }) => {
    const state = window.__workspaceResponse = {
      kind, selector, frames: [], started: null, seen: false, done: false, quiet: 0,
    };
    const start = event => {
      if (event.isTrusted && state.started === null) state.started = performance.now();
    };
    document.addEventListener("pointerdown", start, { once: true, capture: true });
    const tick = () => {
      if (state.done) return;
      if (state.started !== null) {
        const node = document.querySelector(selector);
        const animations = node?.getAnimations().filter(a => a.playState === "running"
          && (kind === "entry" ? a.animationName === "workspace-task-enter" : !a.animationName)) || [];
        if (animations.length) {
          state.seen = true; state.quiet = 0;
          const rect = node.getBoundingClientRect();
          const rail = document.querySelector(".node-palette").getBoundingClientRect();
          for (const a of animations) {
            const timing = a.effect.getComputedTiming();
            const keys = a.effect.getKeyframes();
            const fromOpacity = Number(keys[0].opacity), toOpacity = Number(keys.at(-1).opacity);
            const opacity = Number(getComputedStyle(node).opacity);
            const renderedProgress = Number.isFinite(fromOpacity) && Number.isFinite(toOpacity)
              && Math.abs(toOpacity - fromOpacity) > .005
              ? (opacity - fromOpacity) / (toOpacity - fromOpacity) : null;
            state.frames.push({ at: performance.now() - state.started,
              clock: Number(a.currentTime) / Number(timing.duration), progress: timing.progress,
              renderedProgress, easing: a.effect.getTiming().easing,
              keyframeEasing: keys[0].easing, duration: timing.duration, opacity,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              rail: { x: rail.x, y: rail.y, width: rail.width, height: rail.height },
              overflow: document.documentElement.scrollWidth - innerWidth });
          }
        } else if (state.seen && ++state.quiet >= 2) {
          state.done = true;
        }
        if (performance.now() - state.started > 10000) state.done = true;
      }
      if (!state.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { kind, selector });
}

async function finish(page, viewport, kind) {
  await page.waitForFunction(() => window.__workspaceResponse.done, undefined, { timeout: 15000 });
  const capture = await page.evaluate(() => window.__workspaceResponse);
  report.activeCapture = { viewport: viewport.name, kind, ...capture };
  assert(capture.seen && capture.frames.length >= 3, `${kind}: real intermediate frames required`);
  const proof = selectEarlyRenderedResponse(capture.frames);
  assert(proof, `${kind}: must observe a quarter frame or actual earlier threshold attainment`);
  const { sample } = proof;
  report.cases.push({ viewport: viewport.name, kind, frames: capture.frames,
    firstQuarter: sample, responseEvidenceMethod: proof.method });
  assert(Number.isFinite(sample.renderedProgress) && sample.renderedProgress >= .45,
    `${kind}: sluggish rendered first-quarter progress ${sample.renderedProgress} at clock ${sample.clock.toFixed(3)}`);
  const firstRail = capture.frames[0].rail;
  for (const f of capture.frames) {
    assert(f.overflow <= 1, `${kind}: horizontal overflow`);
    assert(f.rect.x >= -1 && f.rect.y >= -1
      && f.rect.x + f.rect.width <= viewport.width + 1
      && f.rect.y + f.rect.height <= viewport.height + 1, `${kind}: workspace clipped`);
    for (const k of ["x", "y", "width", "height"])
      assert(Math.abs(f.rail[k] - firstRail[k]) <= 1, `${kind}: node rail moved`);
  }
}

async function idle(page, tab) {
  await page.waitForFunction(tab => {
    const panel = document.querySelector(".advanced-tools-panel");
    return panel?.classList.contains("is-tab-idle")
      && panel.querySelector(".advanced-tab-content.is-active")?.dataset.tab === tab;
  }, tab);
}

async function main() {
  let env, browser, page;
  fs.mkdirSync(paths.output, { recursive: true });
  try {
    env = await startEditorAcceptance(paths.output);
    assert(matrix.length > 0 && matrix.length === requested.length, "No empty or unknown response matrix");
    browser = await chromium.launch({ headless: !headful });
    for (const viewport of matrix) {
      page = await browser.newPage({ viewport, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      await env.server.run(async () => {
        await env.open(page);
        await arm(page, "entry", ".toolbar-popover.workspace-task-panel:not(.toolbar-popover-morph-ghost)");
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await finish(page, viewport, "entry");
        await idle(page, "settings");
        // Measure the visual curve after real first-load completion. Cold
        // loading is tested separately; user deferred its performance gate.
        await page.locator('[data-help-key="advanced.tab.history"]:visible').click();
        await idle(page, "history");
        await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
        await idle(page, "settings");
        await arm(page, "content", '.advanced-tab-content.is-entering[data-tab="history"]');
        await page.locator('[data-help-key="advanced.tab.history"]:visible').click();
        await finish(page, viewport, "content");
        await idle(page, "history");
        await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
        await idle(page, "settings");
        await arm(page, "morph", ".toolbar-popover.advanced.is-morphing:not(.toolbar-popover-morph-ghost)");
        await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
        await finish(page, viewport, "morph");
        await idle(page, "layout");
        await page.screenshot({ path: path.join(paths.output, `${viewport.name}-layout.png`) });
      });
      await page.close();
    }
    assert.equal(report.cases.length, matrix.length * 3, "complete desktop response matrix required");
    delete report.activeCapture;
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = error.stack; process.exitCode = 1;
    await page?.screenshot({ path: path.join(paths.output, "failure.png") }).catch(() => {});
  } finally {
    await browser?.close(); await env?.stop();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
      error: report.error, output: paths.output }));
  }
}
main();
