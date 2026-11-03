#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const {
  root,
  resolveAcceptancePaths,
  startEditorAcceptance,
} = require("./lib/editor-ui-acceptance.cjs");

const output = resolveAcceptancePaths({
  output: path.join(root, "output/playwright/advanced-layout-warm-mount", new Date().toISOString().replace(/[:.]/g, "-")),
}).output;

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const env = await startEditorAcceptance(output);
  const report = {
    status: "RUNNING",
    scope: "editor-layout-initial-warm-mount",
    viewport: { width: 3840, height: 2160 },
    results: [],
  };
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 3840, height: 2160 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(30_000);
    await env.server.run(async () => {
      await env.open(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator(".toolbar-popover.advanced.is-open").waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const panel = document.querySelector(".advanced-tools-panel");
        return panel?.classList.contains("is-tab-idle")
          && panel.querySelector('.advanced-tab-content.is-active[data-tab="settings"]');
      });
      await page.waitForFunction(() => {
        const layout = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        const stage = layout?.querySelector(".runtime-layout-stage");
        return stage instanceof HTMLElement && stage.clientWidth > 0 && stage.clientHeight > 0;
      });

      const evidence = await page.evaluate(() => {
        const popover = document.querySelector(".toolbar-popover.advanced");
        const viewport = document.querySelector(".advanced-tab-viewport");
        const settings = document.querySelector('.advanced-tab-content.is-active[data-tab="settings"]');
        const layout = document.querySelector('.advanced-tab-content[data-tab="layout"]');
        const rect = (node) => {
          if (!(node instanceof HTMLElement)) return null;
          const value = node.getBoundingClientRect();
          return { x: value.x, y: value.y, width: value.width, height: value.height };
        };
        const style = layout instanceof HTMLElement ? getComputedStyle(layout) : null;
        return {
          popover: rect(popover),
          viewport: rect(viewport),
          settings: rect(settings),
          layoutPresent: layout instanceof HTMLElement,
          layoutClassName: layout?.className ?? null,
          layoutAriaHidden: layout?.getAttribute("aria-hidden") ?? null,
          layoutInert: layout?.hasAttribute("inert") ?? false,
          layoutHidden: layout?.hidden ?? null,
          layoutOpacity: style ? Number(style.opacity) : null,
          layoutVisibility: style?.visibility ?? null,
          layoutPointerEvents: style?.pointerEvents ?? null,
          layoutRect: rect(layout),
          layoutComputedWidth: style?.width ?? null,
          layoutComputedMaxWidth: style?.maxWidth ?? null,
          layoutScroll: rect(layout?.querySelector(".advanced-tab-scroll")),
          layoutDesigner: rect(layout?.querySelector(".runtime-layout-designer")),
          layoutGrid: rect(layout?.querySelector(".runtime-layout-grid")),
          layoutCenter: rect(layout?.querySelector(".runtime-layout-center")),
          layoutStageWrap: rect(layout?.querySelector(".runtime-layout-stage-wrap")),
          layoutStage: rect(layout?.querySelector(".runtime-layout-stage")),
          layoutStageClientSize: (() => {
            const stage = layout?.querySelector(".runtime-layout-stage");
            return stage instanceof HTMLElement
              ? { width: stage.clientWidth, height: stage.clientHeight }
              : null;
          })(),
        };
      });
      assert.equal(evidence.layoutPresent, true, "layout tab must be pre-mounted while settings is active");
      assert.match(evidence.layoutClassName, /\bis-warm\b/, "pre-mounted layout must be a warm layer");
      assert.equal(evidence.layoutAriaHidden, "true", "warm layout must remain aria-hidden");
      assert.equal(evidence.layoutInert, true, "warm layout must remain inert");
      assert.equal(evidence.layoutHidden, false, "warm layout must remain mounted for rendering");
      assert.equal(evidence.layoutOpacity, 0, "warm layout must not be visible before activation");
      assert.equal(evidence.layoutPointerEvents, "none", "warm layout must not receive pointer input");
      assert(evidence.layoutStageClientSize
        && evidence.layoutStageClientSize.width > 0
        && evidence.layoutStageClientSize.height > 0,
        "warm layout stage must have measurable geometry");
      report.results.push(evidence);
      assert(evidence.layoutStageClientSize.width >= 2000
        && evidence.layoutStageClientSize.height >= 1100,
        "warm layout stage must use the wide-workbench geometry on desktop",
        evidence.layoutStageClientSize);
      assert(evidence.settings && evidence.settings.width > 0 && evidence.settings.height > 0,
        "settings must remain visible");
      await page.screenshot({ path: path.join(output, "warm-mount.png") });
    });
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

main().catch(() => {
  process.exitCode = 1;
});
