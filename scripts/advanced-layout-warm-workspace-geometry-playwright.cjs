"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { getWarmGeometryEquivalenceFailures } = require("./lib/advanced-layout-transition-activation.cjs");

const paths = resolveAcceptancePaths();
const dpr = Number(process.env.WARM_GEOMETRY_DPR || "1");
assert([1, 2].includes(dpr));
const reduced = process.env.WARM_GEOMETRY_REDUCED === "1";
const matrix = [[1920, 1080], [2560, 1440], [3840, 2160]];
const report = { status: "RUNNING", productLayer: "Editor",
  scope: "actual hidden/active layout workspace geometry, not overall motion or installed acceptance",
  isolation: paths, dpr, reduced, startedAt: new Date().toISOString(), cases: [] };

async function settle(page, tab) {
  await page.waitForFunction(tab => {
    const panel = document.querySelector(".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)");
    const tools = panel?.querySelector(".advanced-tools-panel");
    return tools?.classList.contains("is-tab-idle")
      && tools.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") === tab
      && !document.querySelector(".toolbar-popover-morph-ghost,[data-geometry-snapshot-owner]")
      && [...panel.getAnimations(), ...[...tools.querySelectorAll(".advanced-tab-content")]
        .flatMap(node => node.getAnimations())]
        .every(animation => !animation.pending && animation.playState !== "running");
  }, tab, { timeout: 30_000 });
}

async function read(page, warm) {
  return page.evaluate(warm => {
    const root = document.querySelector(`.advanced-tab-content.${warm ? "is-warm" : "is-active"}[data-tab="layout"]`);
    const rect = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height,
        scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight };
    };
    const selectors = { content: null, designer: ".runtime-layout-designer", grid: ".runtime-layout-grid",
      stageWrap: ".runtime-layout-stage-wrap", stage: ".runtime-layout-stage" };
    const geometry = Object.fromEntries(Object.entries(selectors).map(([key, selector]) =>
      [key, rect(selector ? root?.querySelector(selector) : root)]));
    const panel = root?.closest(".toolbar-popover"), panelStyle = panel && getComputedStyle(panel);
    const header = root?.querySelector(".runtime-layout-header");
    return { geometry, inert: root?.inert, ariaHidden: root?.getAttribute("aria-hidden"),
      opacity: root && getComputedStyle(root).opacity,
      nodePalette: rect(document.querySelector(".node-palette")),
      canvas: rect(document.querySelector(".flow-surface")),
      inspector: rect(document.querySelector(".scene-editor-pane")),
      workspaceWidth: getComputedStyle(document.documentElement).getPropertyValue("--workspace-task-width"),
      workspaceLeft: getComputedStyle(document.documentElement).getPropertyValue("--workspace-task-left"),
      workspaceRight: getComputedStyle(document.documentElement).getPropertyValue("--workspace-task-right"),
      rootClientWidth: document.documentElement.clientWidth,
      panel: { rect: rect(panel), clientWidth: panel?.clientWidth, offsetWidth: panel?.offsetWidth,
        overflowX: panelStyle?.overflowX, overflowY: panelStyle?.overflowY,
        padding: panelStyle?.padding, border: panelStyle?.borderWidth,
        left: panelStyle?.left, right: panelStyle?.right },
      header: rect(header),
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio } };
  }, warm);
}

async function main() {
  const env = await startEditorAcceptance(paths.output);
  report.server = { url: env.url, backendUrl: env.backendUrl };
  let browser;
  try {
    browser = await chromium.launch({ headless: false });
    for (const [width, height] of matrix) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      const page = await context.newPage();
      const result = { width, height, status: "RUNNING", failures: [] };
      report.cases.push(result);
      try {
        await env.open(page);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
        await settle(page, "settings");
        await page.waitForFunction(() => {
          const root = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
          return root?.querySelector("[data-advanced-tab-ready]")?.getAttribute("data-advanced-tab-ready") === "true";
        }, undefined, { timeout: 30_000 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        result.hidden = await read(page, true);
        assert.equal(result.hidden.inert, true);
        assert.equal(result.hidden.ariaHidden, "true");
        assert(Number(result.hidden.opacity) <= 0.001);
        await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
        await settle(page, "layout");
        result.active = await read(page, false);
        result.failures.push(...getWarmGeometryEquivalenceFailures({
          hidden: result.hidden.geometry, active: result.active.geometry,
        }));
        assert.equal(result.active.inert, false);
        for (const key of ["nodePalette", "canvas", "inspector"]) {
          assert.deepEqual(result.active[key], result.hidden[key], `${key} must retain its workspace track`);
        }
        const stage = result.active.geometry.stage;
        const bounds = result.active.geometry.stageWrap;
        assert(stage.x >= bounds.x && stage.y >= bounds.y
          && stage.x + stage.width <= bounds.x + bounds.width + 1
          && stage.y + stage.height <= bounds.y + bounds.height + 1, "active canvas must not be clipped");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
          "no horizontal page overflow");
        await page.screenshot({ path: path.join(paths.output, `${width}x${height}-active.png`) });
        await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
        await settle(page, "settings");
        result.returned = await read(page, true);
        result.failures.push(...getWarmGeometryEquivalenceFailures({
          hidden: result.returned.geometry, active: result.active.geometry,
        }).map(message => `return: ${message}`));
        assert.deepEqual(result.failures, []);
        result.status = "PASS";
      } catch (error) {
        result.status = "FAILED";
        result.error = error.stack || String(error);
      } finally {
        await context.close();
      }
    }
    assert.equal(report.cases.length, matrix.length, "nonempty complete viewport matrix required");
    report.status = report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
    if (report.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    await env.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({ status: report.status, dpr, reduced,
      cases: report.cases.map(item => ({ width: item.width, height: item.height,
        status: item.status, failures: item.failures, error: item.error })),
      reportPath: path.join(paths.output, "report.json") }, null, 2));
  }
}
module.exports = { settle, read };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
