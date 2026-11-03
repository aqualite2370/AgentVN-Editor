#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { readState, comparePngBuffers, freezeSettledVisualAnimations, verifyPointerOwnership } =
  require("./advanced-layout-warm-opacity-equivalence-playwright.cjs");
const { installWarmTopLayerDiagnostic, summarizeWarmTopLayerEvidence, getWarmTopLayerOpacity } =
  require("./lib/e2-warm-top-layer.cjs");

const paths = resolveAcceptancePaths();
const viewport = { width: 3840, height: 2160 };
const opacity = getWarmTopLayerOpacity(process.env.AGENTVN_ADVANCED_PERF_WARM_TOP_LAYER_OPACITY);
const materialProperties = [
  "color", "backgroundColor", "backgroundImage", "fontFamily", "fontSize",
  "fontWeight", "lineHeight", "borderColor", "borderWidth", "borderRadius",
  "padding", "boxShadow", "textShadow", "filter", "backdropFilter",
];

async function readMaterial(page) {
  return page.evaluate(properties => {
    const warm = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    if (!(warm instanceof HTMLElement)) throw new Error("warm layout missing");
    const targets = [
      ["root", warm],
      ["designer", warm.querySelector(".runtime-layout-designer")],
      ["stage", warm.querySelector(".runtime-layout-stage")],
      ["preview", warm.querySelector(".runtime-layout-expected-preview")],
      ["button", warm.querySelector("button")],
      ["input", warm.querySelector("input")],
    ];
    return Object.fromEntries(targets.map(([name, node]) => {
      if (!(node instanceof HTMLElement)) throw new Error(`missing material target ${name}`);
      const style = getComputedStyle(node);
      return [name, Object.fromEntries(properties.map(key => [key, style[key]]))];
    }));
  }, materialProperties);
}

async function screenshot(page, name) {
  return page.screenshot({ path: path.join(paths.output, name), type: "png", scale: "css" });
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector(".advanced-tools-panel");
    const popover = document.querySelector(".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)");
    const animations = [...(panel?.getAnimations({ subtree: true }) ?? []),
      ...(popover?.getAnimations() ?? [])];
    // Decorative infinite loops do not own page handoff.
    const finite = animations.filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    return panel?.classList.contains("is-tab-idle")
      && finite.every(animation => !animation.pending && animation.playState !== "running");
  }, null, { timeout: 30_000 });
}

async function main() {
  fs.mkdirSync(paths.output, { recursive: true });
  const env = await startEditorAcceptance(paths.output);
  const report = {
    status: "RUNNING", kind: "diagnostic-visual-equivalence-not-performance-acceptance",
    productLayer: "Editor", projectPath: paths.input, projectId: paths.fixtureProjectId,
    viewport, dpr: 1, opacity, viewportMode: "headful browser CSS viewport, not physical 4K",
    owner: { pid: env.server.pid, runId: env.server.runId, url: env.server.url }, failures: [],
  };
  let browser;
  try {
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const cdp = await browser.newBrowserCDPSession();
    try {
      const info = await cdp.send("SystemInfo.getInfo");
      report.gpu = info.gpu?.featureStatus;
      assert.equal(report.gpu?.gpu_compositing, "enabled", "hardware compositor required");
      assert.equal(report.gpu?.rasterization, "enabled", "ordinary raster backend required");
    } finally { await cdp.detach(); }
    await env.server.run(async () => {
      await env.open(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
      await page.waitForFunction(() => {
        const warm = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        return warm?.querySelector(".runtime-layout-designer")?.getAttribute("data-advanced-tab-ready") === "true"
          && warm.querySelector(".runtime-layout-stage")?.clientWidth >= 2000;
      }, null, { timeout: 60_000 });
      await waitSettled(page);
      const focusTarget = page.locator('[data-help-key="advanced.tab.settings"]:visible').first();
      await focusTarget.focus();
      await page.mouse.move(0, 0);
      await page.waitForFunction(() => !document.querySelector(".hover-help-card"),
        null, { timeout: 30_000 });
      report.pausedAnimations = await freezeSettledVisualAnimations(page);
      report.before = await readState(page);
      report.materialBefore = await readMaterial(page);
      const baseline = await screenshot(page, "baseline.png");
      const control = await screenshot(page, "baseline-control.png");
      report.controlPixelDiff = await comparePngBuffers(page, baseline, control);
      if (report.controlPixelDiff.pixelsOverOneLevel !== 0) {
        report.invalidBaseline = true;
        throw new Error("Same-state screenshot baseline is unstable; no candidate equivalence conclusion permitted.");
      }

      report.topLayer = await installWarmTopLayerDiagnostic(page, { opacity });
      report.topLayer.summary = summarizeWarmTopLayerEvidence(report.topLayer);
      assert.equal(report.topLayer.summary.valid, true, JSON.stringify(report.topLayer.summary));
      report.after = await readState(page);
      report.materialAfter = await readMaterial(page);
      report.materialDifferences = [];
      for (const [name, before] of Object.entries(report.materialBefore)) {
        for (const [property, value] of Object.entries(before)) {
          const candidate = report.materialAfter[name][property];
          if (candidate !== value) report.materialDifferences.push({ name, property, before: value, after: candidate });
        }
      }
      if (report.materialDifferences.length) report.failures.push("top layer changed preview materials/inherited styles");
      const candidate = await screenshot(page, "top-layer.png");
      report.pixelDiff = await comparePngBuffers(page, baseline, candidate, control);
      if (report.pixelDiff.pixelsExceedingControlEnvelope > 0)
        report.failures.push("visible pixels exceeded ordinary same-state screenshot noise by more than one level");
      for (const name of ["popover", "viewport"]) {
        if (JSON.stringify(report.before.geometry[name]) !== JSON.stringify(report.after.geometry[name]))
          report.failures.push(`top layer changed visible ${name} geometry`);
      }
      if (report.before.activeElementPath !== report.after.activeElementPath)
        report.failures.push("top layer stole focus");
      const ownership = await verifyPointerOwnership(page);
      assert.equal(ownership.ok, true, JSON.stringify(ownership));
      await page.mouse.click(ownership.target.x, ownership.target.y);
      report.pointer = await page.evaluate(() => {
        const probe = window.__e2WarmOpacityPointerProbe;
        const counts = { ...probe.clicks };
        probe.layout.removeEventListener("pointerdown", probe.onWarm, true);
        probe.activeViewport?.removeEventListener("pointerdown", probe.onSettings, true);
        return counts;
      });
      if (report.pointer.warm !== 0 || report.pointer.settings !== 1)
        report.failures.push("top layer intercepted background settings input");
      const focusProbe = await page.evaluate(() => {
        const warm = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        const before = document.activeElement;
        warm.querySelector("button")?.focus();
        return { entered: warm.contains(document.activeElement), unchanged: before === document.activeElement };
      });
      report.focusProbe = focusProbe;
      if (focusProbe.entered || !focusProbe.unchanged) report.failures.push("inert layer accepted focus");

      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.waitForFunction(() => {
        const active = document.querySelector('.advanced-tab-content.is-active[data-tab="layout"]:not([inert])');
        return active?.getAttribute("aria-hidden") !== "true"
          && active?.querySelector(".runtime-layout-designer")?.getAttribute("data-advanced-tab-ready") === "true";
      });
      await waitSettled(page);
      report.final = await page.evaluate(() => {
        const layer = document.querySelector('.advanced-tab-content.is-active[data-tab="layout"]');
        return {
          restored: window.__e2WarmTopLayerDiagnostic?.restored,
          restoreCount: window.__e2WarmTopLayerDiagnostic?.restoreCount,
          popoverAttribute: layer?.getAttribute("popover"),
          topLayer: layer?.matches(":popover-open"),
          style: layer?.getAttribute("style"),
          inert: layer?.hasAttribute("inert"),
          ghostCount: document.querySelectorAll(".toolbar-popover-morph-ghost").length,
        };
      });
      if (!report.final.restored || report.final.restoreCount !== 1
        || report.final.popoverAttribute !== null || report.final.topLayer
        || report.final.inert || report.final.ghostCount !== 0)
        report.failures.push("top layer restoration/real layout handoff failed");
      await screenshot(page, "layout-final.png");
      assert.deepEqual(report.failures, [], JSON.stringify(report.failures));
      report.status = "PASS";
    });
  } catch (error) {
    report.status = report.invalidBaseline ? "BLOCKED" : "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    await env.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(`${report.status}: ${path.join(paths.output, "report.json")}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
