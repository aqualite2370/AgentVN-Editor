#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { viewports, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");

const acceptance = resolveAcceptancePaths();
const output = acceptance.output;
// This tests the desktop auxiliary overlay contract. The narrow full-width
// responsive presentation is covered by the dedicated Options/assistant
// workspace suite and must not be mistaken for a second Options entry.
const selectedNames = ["1080p", "4k"];
const matrix = selectedNames.map(name => viewports.find(viewport => viewport.name === name)).filter(Boolean);
const report = {
  runId: new Date().toISOString(),
  scope: "editor-auxiliary-provider-overlay-preserves-workspace-geometry",
  isolation: acceptance,
  status: "RUNNING",
  cases: [],
};

function measurePresentation() {
  const rect = element => {
    if (!element) return null;
    const value = element.getBoundingClientRect();
    return {
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom,
      width: value.width,
      height: value.height,
    };
  };
  const intersects = (a, b) => Boolean(a && b
    && a.left < b.right && a.right > b.left
    && a.top < b.bottom && a.bottom > b.top);
  const palette = document.querySelector(".node-palette");
  const flow = document.querySelector(".flow-surface");
  const inspector = document.querySelector(".scene-editor-pane");
  const body = document.querySelector(".editor-workspace-body");
  const panel = document.querySelector(".toolbar-popover.advanced");
  const paletteRect = rect(palette);
  const flowRect = rect(flow);
  const inspectorRect = rect(inspector);
  const panelRect = rect(panel);
  const paletteStyle = palette && getComputedStyle(palette);
  const bodyStyle = body && getComputedStyle(body);
  const flowStyle = flow && getComputedStyle(flow);
  const paletteFilteredAncestors = [];
  for (let current = palette; current; current = current.parentElement) {
    const filter = getComputedStyle(current).filter;
    if (filter !== "none") paletteFilteredAncestors.push({ className: String(current.className), filter });
  }
  return {
    panelClass: panel?.className ?? null,
    panelTask: panel?.getAttribute("data-workspace-task") ?? null,
    panelInert: Boolean(panel?.inert),
    panelRect,
    paletteRect,
    paletteDisplay: paletteStyle?.display ?? "missing",
    paletteVisibility: paletteStyle?.visibility ?? "missing",
    paletteOpacity: Number(paletteStyle?.opacity ?? 0),
    paletteCoveredByPanel: intersects(paletteRect, panelRect),
    paletteFilteredAncestors,
    flowRect,
    flowFilter: flowStyle?.filter ?? "none",
    inspectorRect,
    bodyVisibility: bodyStyle?.visibility ?? "missing",
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
}

function closeEnoughRect(before, after, tolerance = 1) {
  return Boolean(before && after
    && ["left", "top", "width", "height"].every(key => Math.abs(before[key] - after[key]) <= tolerance));
}

async function main() {
  let environment;
  let browser;
  try {
    assert.equal(matrix.length, 2, "The desktop and 4K auxiliary-overlay viewports must both be configured.");
    fs.mkdirSync(output, { recursive: true });
    environment = await startEditorAcceptance(output);
    report.owner = {
      editorPid: environment.server.pid,
      runId: environment.server.runId,
      url: environment.url,
      backendUrl: environment.backendUrl,
    };
    browser = await chromium.launch();

    for (const viewport of matrix) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        reducedMotion: "no-preference",
      });
      page.setDefaultTimeout(30_000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.stack || error.message));
      page.on("console", message => {
        if (message.type() === "error") errors.push(message.text());
      });

      await environment.server.run(async () => {
        await environment.open(page);
        const sceneNode = page.locator(".react-flow__node-sceneNode").first();
        await sceneNode.waitFor({ state: "visible" });
        await sceneNode.click();
        const sceneWorkbench = page.locator(".floating-command-workbench");
        if (await sceneWorkbench.isVisible().catch(() => false)) {
          await page.getByRole("button", { name: "关闭事件工作台", exact: true }).click();
          await sceneWorkbench.waitFor({ state: "hidden" });
        }
        const generateNext = page.getByRole("button", { name: "辅助生成后续", exact: true });
        await generateNext.waitFor({ state: "visible" });
        const before = await page.evaluate(measurePresentation);

        // This is an auxiliary provider-configuration overlay, not a second Options
        // workspace entry. It is exercised separately to ensure it does not hide or
        // resize the node rail/canvas while the real Options path is tested elsewhere.
        await generateNext.click();
        await page.locator(".toolbar-popover.advanced.is-open").waitFor({ state: "visible" });
        await page.locator(".advanced-tools-panel").waitFor({ state: "visible" });
        await page.waitForFunction(() => {
          const panel = document.querySelector(".toolbar-popover.advanced");
          return panel && !panel.getAnimations().some(animation => animation.playState === "running");
        });
        const after = await page.evaluate(measurePresentation);
        const result = {
          viewport,
          action: "场景节点 → 辅助生成后续 → 缺少模型时打开模型/连接辅助浮层",
          expectedPresentation: "auxiliary overlay; not a primary workspace task panel",
          before,
          after,
          errors,
        };
        report.cases.push(result);

        assert(after.panelClass?.includes("advanced"),
          `${viewport.name}: the missing-provider action must open the Advanced Tools overlay`,
          result);
        assert.equal(after.panelTask, null,
          `${viewport.name}: auxiliary provider overlay must not be misclassified as the primary Options workspace`,
          result);
        assert.equal(after.bodyVisibility, "visible",
          `${viewport.name}: event-opened workbench must retain the editor workspace`);
        assert.equal(after.paletteDisplay, "flex",
          `${viewport.name}: node construction controls must remain laid out`);
        assert.equal(after.paletteVisibility, "visible",
          `${viewport.name}: node construction controls must remain visible`);
        assert(after.paletteRect?.width > 0 && after.paletteRect?.height > 0,
          `${viewport.name}: node construction controls must retain real geometry`);
        assert(!after.paletteCoveredByPanel,
          `${viewport.name}: right-side workbench must not cover the node rail`);
        assert.equal(after.flowFilter, "none",
          `${viewport.name}: this auxiliary overlay route must retain its own non-workspace presentation semantics`);
        assert.equal(after.paletteFilteredAncestors.length, 0,
          `${viewport.name}: keep the node rail legible rather than blurring its controls`);
        assert(closeEnoughRect(before.paletteRect, after.paletteRect)
          && closeEnoughRect(before.flowRect, after.flowRect)
          && closeEnoughRect(before.inspectorRect, after.inspectorRect),
        `${viewport.name}: opening the workbench must not reclaim or shift workspace tracks`,
        result);
        assert.equal(after.horizontalOverflow, false,
          `${viewport.name}: opening the workbench must not create horizontal overflow`);
        assert.deepEqual(errors, [],
          `${viewport.name}: the route must not produce browser errors`);
      });
      await page.close();
    }
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    if (browser) {
      const pages = browser.contexts().flatMap(context => context.pages());
      await Promise.all(pages.map((page, index) =>
        page.screenshot({ path: path.join(output, `failure-${index + 1}.png`), fullPage: false }).catch(() => {})));
    }
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    await environment?.stop().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(`${report.status}: ${path.join(output, "report.json")}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
