"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { installWarmDescendantStyleDiagnostic } = require("./lib/e2-warm-descendant-style.cjs");

const properties = [
  "display", "position", "contain", "isolation", "z-index", "overflow-x", "overflow-y",
  "width", "height", "min-width", "min-height", "max-width", "max-height", "box-sizing",
  "grid-template-columns", "grid-template-rows", "flex-direction", "flex-wrap",
  "align-items", "align-self", "justify-content", "gap", "padding", "margin",
  "font-family", "font-size", "font-weight", "line-height", "color",
  "background-color", "background-image", "border-width", "border-radius", "box-shadow",
  "filter", "backdrop-filter", "will-change",
];

async function capture(page, phase) {
  return page.evaluate(({ phase, properties }) => {
    const panel = document.querySelector(
      '.toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden="true"]):not([inert])');
    const root = panel?.querySelector(`.advanced-tab-content.is-${phase}[data-tab="layout"]`);
    if (!(root instanceof HTMLElement)) throw new Error(`${phase} layout root missing`);
    if (phase === "warm") {
      const nodes = [root, ...root.querySelectorAll("*")].filter(node => node instanceof HTMLElement
        && !node.closest(".glass-selection-indicator"));
      window.__e2WarmDescendantStyleProbe = {
        root, nodes: nodes.map((node, id) => ({
          node, id, label: `${node.tagName.toLowerCase()}.${node.className}`,
          helpKey: node.getAttribute("data-help-key"),
          componentId: node.getAttribute("data-component-id"),
        })),
      };
    }
    const probe = window.__e2WarmDescendantStyleProbe;
    const rootRect = root.getBoundingClientRect();
    const rect = node => {
      const r = node.getBoundingClientRect();
      return { x: r.x - rootRect.x, y: r.y - rootRect.y, width: r.width, height: r.height };
    };
    return {
      phase, at: performance.now(), sameRoot: probe.root === root,
      rootRect: { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height },
      rootStyle: { opacity: getComputedStyle(root).opacity, contain: getComputedStyle(root).contain,
        inert: root.hasAttribute("inert"), ariaHidden: root.getAttribute("aria-hidden") },
      liveElementCount: root.querySelectorAll("*").length,
      nodes: probe.nodes.map(({ node, ...identity }) => ({
        ...identity, connected: node.isConnected && root.contains(node),
        rect: node.isConnected ? rect(node) : null,
        style: node.isConnected
          ? Object.fromEntries(properties.map(key => [key, getComputedStyle(node).getPropertyValue(key)]))
          : null,
      })),
    };
  }, { phase, properties });
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector(".advanced-tools-panel");
    const popover = document.querySelector(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)");
    const finite = [...(panel?.getAnimations({ subtree: true }) ?? []), ...(popover?.getAnimations() ?? [])]
      .filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    return panel?.classList.contains("is-tab-idle")
      && finite.every(animation => !animation.pending && animation.playState !== "running");
  }, null, { timeout: 30_000 });
}

async function main() {
  const paths = resolveAcceptancePaths();
  fs.mkdirSync(paths.output, { recursive: true });
  const report = {
    status: "RUNNING", kind: "warm-to-active-descendant-style-attribution-not-performance-or-ui-acceptance",
    productLayer: "Editor", projectPath: paths.input, projectId: paths.fixtureProjectId,
    viewport: { width: 3840, height: 2160 }, dpr: 1,
    viewportMode: "headful CSS viewport simulation; not physical 4K or installed acceptance",
    properties, intervention: "none; computed-style reads before/after navigation perturb timing",
    note: "Excludes glass-indicator presentation nodes, opacity/transform and pointer/focus states. Other time-varying style differences still require source confirmation.",
  };
  let env, browser;
  try {
    env = await startEditorAcceptance(paths.output);
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url };
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
    await env.server.run(async () => {
      await env.open(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
      await page.waitForFunction(() => {
        const root = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        const stage = root?.querySelector(".runtime-layout-stage");
        return root?.querySelector(".runtime-layout-designer")?.getAttribute("data-advanced-tab-ready") === "true"
          && stage instanceof HTMLElement && stage.clientWidth > 2000
          && root.querySelector(".runtime-layout-expected-preview");
      }, null, { timeout: 60_000 });
      await waitSettled(page);
      await page.mouse.move(0, 0);
      if (process.env.AGENTVN_E2_WARM_DESCENDANT_STYLE === "1") {
        report.intervention = await page.evaluate(installWarmDescendantStyleDiagnostic);
      }
      report.before = await capture(page, "warm");
      assert.equal(report.before.rootStyle.opacity, "0");
      assert.equal(report.before.rootStyle.inert, true);
      assert(report.before.nodes.length >= 100, "reject empty or incomplete descendant scan");
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await waitSettled(page);
      await page.mouse.move(0, 0);
      report.after = await capture(page, "active");
      assert.equal(report.after.sameRoot, true, "must compare the actual pre-mounted root, not a clone");
      assert.equal(report.after.rootStyle.opacity, "1");
      assert.equal(report.after.rootStyle.inert, false);
      const changedProperties = {};
      const changes = report.before.nodes.flatMap((before, index) => {
        const after = report.after.nodes[index];
        assert.equal(before.id, after.id);
        if (!after.connected) return [{ id: before.id, label: before.label, detached: true }];
        const styles = Object.fromEntries(properties.filter(key => before.style[key] !== after.style[key])
          .map(key => {
            changedProperties[key] = (changedProperties[key] ?? 0) + 1;
            return [key, { before: before.style[key], after: after.style[key] }];
          }));
        const geometry = Object.fromEntries(["x", "y", "width", "height"]
          .filter(key => Math.abs(before.rect[key] - after.rect[key]) > 0.5)
          .map(key => [key, { before: before.rect[key], after: after.rect[key],
            delta: after.rect[key] - before.rect[key] }]));
        return Object.keys(styles).length || Object.keys(geometry).length
          ? [{ id: before.id, label: before.label, helpKey: before.helpKey,
              componentId: before.componentId, styles, geometry }] : [];
      });
      report.summary = {
        scannedNodes: report.before.nodes.length, changedNodeCount: changes.length,
        changedStyleNodeCount: changes.filter(change => Object.keys(change.styles ?? {}).length).length,
        changedGeometryNodeCount: changes.filter(change => Object.keys(change.geometry ?? {}).length).length,
        detachedNodeCount: changes.filter(change => change.detached).length,
        changedProperties, changes,
      };
      await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
      await waitSettled(page);
      await page.waitForFunction(() => document.querySelector(
        '.advanced-tab-content.is-active[data-tab="settings"]')?.getAttribute("data-advanced-tab-interactive") === "true");
      report.restoredSettings = true;
      report.status = "COMPLETED";
    });
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    await env?.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({ status: report.status, reportPath: path.join(paths.output, "report.json"),
      scannedNodes: report.summary?.scannedNodes, changedStyleNodeCount: report.summary?.changedStyleNodeCount,
      changedGeometryNodeCount: report.summary?.changedGeometryNodeCount, error: report.error }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
