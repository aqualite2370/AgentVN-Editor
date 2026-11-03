"use strict";
// Editor E2 only. Real Options entry, owned isolated fixture, no model calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { viewports, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const paths = resolveAcceptancePaths();
const requested = (process.env.RENPY_GEOMETRY_VIEWPORTS || "1080p,1440p,4k").split(",");
const matrix = viewports.filter(item => requested.includes(item.name));
const dpr = Number(process.env.RENPY_GEOMETRY_DPR || 1);
const reduced = process.env.RENPY_GEOMETRY_REDUCED === "1";
const report = { status: "RUNNING", scope: "Editor E2 preview geometry, not Runtime/Release acceptance",
  isolation: paths, dpr, reduced, cases: [], failures: [] };

async function geometry(page, isTitle) {
  return page.evaluate(isTitle => {
    const center = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .renpy-title-editor .runtime-layout-center");
    const frame = center.querySelector(isTitle ? ".renpy-editor-preview" : ".renpy-editor-runtime-viewport");
    const toolbar = center.querySelector(".renpy-editor-preview-toolbar");
    const status = center.querySelector(".renpy-preview-status");
    const rect = node => node?.getBoundingClientRect().toJSON();
    const box = frame.getBoundingClientRect();
    const centerStyle = getComputedStyle(center);
    const iframe = frame.querySelector("iframe");
    const buttons = [...frame.querySelectorAll(".renpy-title-action")].map(node => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { label: node.textContent, rect: r.toJSON(), hit: node.contains(hit) };
    });
    return { frame: box.toJSON(), center: rect(center), toolbar: rect(toolbar), status: rect(status),
      gap: parseFloat(centerStyle.rowGap), rows: centerStyle.gridTemplateRows,
      statusMarginTop: parseFloat(getComputedStyle(status).marginTop),
      declaredAspect: getComputedStyle(frame).aspectRatio, buttons,
      iframe: iframe && { rect: rect(iframe), layoutWidth: iframe.clientWidth,
        layoutHeight: iframe.clientHeight, transform: getComputedStyle(iframe).transform },
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth };
  }, isTitle);
}

function verify(value, width, height) {
  const ratio = width / height;
  assert(Math.abs(value.frame.width - value.frame.height * ratio) <= 1.5,
    `Preview must preserve ${width}x${height}; actual ${value.frame.width}x${value.frame.height}; rows ${value.rows}`);
  const availableHeight = value.status.top - value.statusMarginTop - value.toolbar.bottom - value.gap * 2;
  const fitWidth = Math.min(value.center.width, availableHeight * ratio);
  assert(value.frame.width >= fitWidth - 3, "Preview should use the largest uniform fit, not shrink arbitrarily");
  assert(value.frame.left >= value.center.left - 1 && value.frame.right <= value.center.right + 1,
    "Preview must remain inside its center track");
  assert(value.frame.top >= value.toolbar.bottom - 1 && value.frame.bottom <= value.status.top + 1,
    "Preview must not clip toolbar or status");
  assert(value.frame.top >= value.center.top - 1 && value.frame.bottom <= value.center.bottom + 1
    && value.status.bottom <= value.center.bottom + 1 && value.toolbar.top >= value.center.top - 1,
  "Preview and its status must remain inside the vertical center track, not overflow together");
  assert(value.horizontalOverflow <= 1, "Preview must not produce horizontal overflow");
  for (const button of value.buttons) {
    assert(button.hit, `Title action ${button.label} must receive a real click`);
    assert(button.rect.left >= value.frame.left - 1 && button.rect.right <= value.frame.right + 1
      && button.rect.top >= value.frame.top - 1 && button.rect.bottom <= value.frame.bottom + 1,
    `Title action ${button.label} must not be clipped`);
  }
  if (value.iframe) {
    assert.equal(value.iframe.layoutWidth, width);
    assert.equal(value.iframe.layoutHeight, height);
    assert(Math.abs(value.iframe.rect.width - value.frame.width) <= 1.5
      && Math.abs(value.iframe.rect.height - value.frame.height) <= 1.5,
    "Runtime iframe and visible frame must share one uniform scale");
  }
}

async function waitForRuntimePreview(page, screen) {
  const handle = await page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .renpy-editor-runtime-viewport iframe").elementHandle();
  const frame = await handle.contentFrame();
  assert(frame, "Actual Runtime preview must have a connected document");
  await frame.waitForFunction(screen => {
    const nav = document.querySelector(".runtime-screen-transition");
    const content = document.querySelector(".about-card-content");
    if (!nav || !content || nav.dataset.runtimeTransitionPhase !== "idle"
      || nav.dataset.runtimePresentedScreen !== screen || nav.dataset.runtimeCommittedScreen !== screen
      || document.querySelector('[data-testid="game-launch-blackout"]')) return false;
    for (let node = content; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (Number(style.opacity) < 0.99 || style.visibility !== "visible" || style.display === "none") return false;
    }
    const curtain = getComputedStyle(nav, "::before");
    return ["none", "normal"].includes(curtain.content) || Number(curtain.opacity) <= 0.001;
  }, screen);
  return frame.locator(".about-card-content").evaluate(node => ({
    text: node.textContent.trim(), rect: node.getBoundingClientRect().toJSON(),
    presented: document.querySelector(".runtime-screen-transition").dataset.runtimePresentedScreen,
    phase: document.querySelector(".runtime-screen-transition").dataset.runtimeTransitionPhase,
  }));
}

async function main() {
  fs.mkdirSync(paths.output, { recursive: true });
  let env, browser;
  try {
    assert.equal(matrix.length, requested.length, "Unknown/empty viewport matrix");
    env = await startEditorAcceptance(paths.output);
    browser = await chromium.launch({ headless: process.env.RENPY_GEOMETRY_HEADFUL !== "1" });
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    for (const viewport of matrix) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      page.setDefaultTimeout(25000);
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      await env.server.run(async () => {
        await env.open(page);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
        await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
          && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
        const workbench = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
        await workbench.locator('[data-layout-type-option="renpy"]').click();
        await workbench.locator(".renpy-title-editor").waitFor();
        const editor = workbench.locator(".renpy-title-editor");
        for (const screen of ["title", "about"]) {
          const sidebar = editor.locator(".runtime-layout-sidebar");
          const label = screen === "title" ? "标题主页" : "关于";
          await sidebar.getByRole("button", { name: label, exact: true }).click();
          await page.waitForFunction(screen => document.querySelector(".renpy-title-editor")?.dataset.editorPage === screen, screen);
          for (const mode of ["desktop", "mobile", "desktop"]) {
            await editor.getByRole("button", { name: mode === "desktop" ? "桌面预览" : "移动预览", exact: true }).click();
            let runtime;
            if (screen !== "title") {
              await editor.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
              runtime = await waitForRuntimePreview(page, screen);
              assert(runtime.text.length > 0, "Final Runtime page must show real content");
            }
            await page.waitForFunction(() => document.querySelector(".renpy-editor-device-frame")?.dataset.framePhase !== "moving");
            // Two stable frames, no fixed delay or forced clicks.
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const value = await geometry(page, screen === "title");
            const size = mode === "desktop" ? [1280, 720] : [915, 412];
            const item = { viewport, screen, mode, size, geometry: value, runtime, status: "PASS" };
            try { verify(value, ...size); }
            catch (error) {
              item.status = "FAILED"; item.error = error.message;
              report.failures.push({ viewport: viewport.name, screen, mode, error: error.message });
            }
            report.cases.push(item);
            await page.screenshot({ path: path.join(paths.output, `${viewport.name}-${screen}-${mode}-${report.cases.length}.png`) });
            if (screen === "title") {
              await editor.locator(".renpy-title-action").filter({ hasText: "开始游戏" }).click();
              await editor.getByRole("status").filter({ hasText: "预览：开始游戏" }).waitFor();
            }
          }
        }
        assert.deepEqual(errors, [], "Browser errors");
      });
      await page.close();
    }
    assert.equal(report.cases.length, matrix.length * 6, "No missing preview mode cases");
    report.status = report.failures.length ? "FAILED" : "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = error.stack;
  } finally {
    await browser?.close();
    await env?.stop();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
      failures: report.failures, error: report.error, output: paths.output }));
  }
  if (report.status !== "PASS") process.exitCode = 1;
}
module.exports = { geometry, verify, waitForRuntimePreview };
function auditNative() {
  const source = process.env.RENPY_GEOMETRY_NATIVE_REPORT;
  assert(source && path.isAbsolute(source), "Explicit native report path required");
  const native = JSON.parse(fs.readFileSync(source, "utf8"));
  assert.equal(native.status, "PASS");
  assert.equal(native.results.length, 10, "Must audit all native scenes");
  let checks = 0;
  for (const scene of native.results) {
    assert.equal(scene.previewGeometry.length, 4, "Every scene needs both pages and both device modes");
    for (const item of scene.previewGeometry) {
      verify(item.geometry, ...(item.mode === "desktop" ? [1280, 720] : [915, 412]));
      if (item.screen === "about") {
        assert.equal(item.runtime.phase, "idle");
        assert.equal(item.runtime.presented, "about");
        assert(item.runtime.text.length > 0);
      }
      checks++;
    }
  }
  assert.equal(checks, 40);
  assert.deepEqual(native.cleanup.remainingOwnedProcesses, []);
  const result = { status: "PASS", scope: "Supplemental clipping audit of real native DOM records",
    source, scenes: native.results.length, checks, cleanup: native.cleanup, at: new Date().toISOString() };
  fs.mkdirSync(paths.output, { recursive: true });
  fs.writeFileSync(path.join(paths.output, "native-geometry-audit.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
if (require.main === module) {
  if (process.argv.includes("--audit-native")) {
    try { auditNative(); } catch (error) { console.error(error); process.exitCode = 1; }
  } else main().catch(error => { console.error(error); process.exitCode = 1; });
}
