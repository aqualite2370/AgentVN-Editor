#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { root, viewports, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const acceptancePaths = resolveAcceptancePaths();
const output = acceptancePaths.output;
const report = {
  runId,
  scope: "editor-options-motion-not-installed-final",
  isolation: acceptancePaths,
  status: "RUNNING",
  cases: [],
};
const caseName = process.argv.find(arg => arg.startsWith("--case="))?.slice(7);
const selectedViewports = (process.env.MOTION_VIEWPORTS || "1080p,1440p,4k").split(",").map(name => name.trim()).filter(Boolean);
const matrix = selectedViewports.length ? viewports.filter(item => selectedViewports.includes(item.name)) : viewports;
assert(matrix.length > 0 && matrix.length === selectedViewports.length,
  "Editor motion acceptance accepts only 1080p, 2K and 4K landscape viewports.");

async function idle(page, tab, timeout = 10000) {
  await page.waitForFunction(tab => {
    const panel = document.querySelector(".advanced-tools-panel");
    return panel?.classList.contains("is-tab-idle")
      && panel.querySelector(".advanced-tab-content.is-active")?.dataset.tab === tab;
  }, tab, { timeout });
}
async function popoverMotionIdle(page) {
  await page.waitForFunction(() => {
    const popover = document.querySelector(".toolbar-popover.advanced");
    return popover
      && !popover.classList.contains("is-morphing")
      && !popover.getAnimations().some(animation => animation.playState === "running");
  }, undefined, { timeout: 5000 });
}
async function clickTab(page, tab) {
  const button = page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`);
  await button.scrollIntoViewIfNeeded();
  const rect = await button.boundingBox();
  assert(rect, "Navigation button must have real geometry");
  await button.click();
}
async function siblingTiming(page) {
  return page.evaluate(() => {
    const s=getComputedStyle(document.documentElement);
    const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
    const value=s.getPropertyValue(reduced ? "--motion-editor-sibling-reduced" : "--motion-editor-sibling").trim();
    const time=/^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/.exec(value);
    if (!time) throw new Error(`Expected a CSS time with units: ${value}`);
    return { duration:Number(time[1]) * (time[2] === "s" ? 1000 : 1)
      * (reduced ? 1 : Math.max(.25,Number(s.getPropertyValue("--motion-scale"))))
      / Number(s.getPropertyValue("--editor-workspace-playback-rate")),
      easing:s.getPropertyValue("--ease-editor-sibling").trim() };
  });
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  let env, browser, page;
  try {
    assert(matrix.length > 0, `No matching acceptance viewports: ${selectedViewports.join(",")}`);
    env = await startEditorAcceptance(output);
    report.isolation = {
      input: env.input,
      output: env.output,
      fixtureProjectId: env.fixtureProjectId,
      isolated: env.isolated,
    };
    report.owner = { editorPid: env.server.pid, runId: env.server.runId, url: env.url, backendUrl: env.backendUrl };
    browser = await chromium.launch();
    for (const viewport of matrix) {
      page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: Number(process.env.MOTION_DPR || 1),
        reducedMotion: process.env.MOTION_REDUCED === "1" ? "reduce" : "no-preference" });
      page.setDefaultTimeout(15000);
      await env.server.run(async () => {
        let releaseModule;
        let releaseWorkspaceModule;
        let rejectWorkspaceModule = caseName === "workspace-error";
        if (caseName === "workspace-error") {
          await page.route("**/components/assistant/AssistantChatPanel.tsx*", route =>
            rejectWorkspaceModule ? route.fulfill({ status: 503, body: "Intentional workspace failure" })
              : route.continue());
        }
        if (caseName === "workspace-load") {
          const gate = new Promise(resolve => { releaseWorkspaceModule = resolve; });
          await page.route("**/components/assistant/AssistantChatPanel.tsx*", async route => {
            await gate;
            await route.continue().catch(() => {});
          });
        }
        let rejectModule = caseName === "loaderror";
        if (caseName === "loaderror") {
          await page.route("**/components/advanced/AnimationEditorPanel.tsx*", route =>
            rejectModule ? route.fulfill({ status: 503, body: "Intentional acceptance load failure" })
              : route.continue());
        }
        if (["selection", "indicator", "supersede", "timeout", "rapid"].includes(caseName)) {
          const gate = new Promise(resolve => { releaseModule = resolve; });
          await page.route("**/components/advanced/AnimationEditorPanel.tsx*", async route => {
            await gate;
            await route.continue().catch(() => {});
          });
        }
        await env.open(page);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await idle(page, "settings");
        // Warm a real, inexpensive page first. The repro must not depend on module IO.
        await clickTab(page, "history");
        await idle(page, "history");
        await clickTab(page, "settings");
        await idle(page, "settings");
        if (caseName === "advanced-request-workbench") {
          const before = await page.evaluate(() => {
            const panel = document.querySelector(".toolbar-popover");
            const body = document.querySelector(".editor-workspace-body");
            const palette = document.querySelector(".node-palette");
            const panelRect = node => {
              const box = node?.getBoundingClientRect();
              return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
            };
            const rect = node => {
              const box = node?.getBoundingClientRect();
              return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
            };
            return {
              panelClass: panel?.className ?? null,
              task: panel?.getAttribute("data-workspace-task") ?? null,
              backgroundFilter: document.querySelector(".flow-surface")
                ? getComputedStyle(document.querySelector(".flow-surface")).filter : null,
              workspaceBodyFilter: body ? getComputedStyle(body).filter : null,
              workspaceBodyVisibility: body ? getComputedStyle(body).visibility : null,
              nodeRailPresentation: (() => {
                const rail = document.querySelector(".node-palette");
                const workspace = document.querySelector(".editor-workspace");
                const surfaces = [...document.querySelectorAll(".editor-workspace > .flow-surface")];
                return {
                  railFilter: rail ? getComputedStyle(rail).filter : null,
                  railOpacity: rail ? getComputedStyle(rail).opacity : null,
                  railVisibility: rail ? getComputedStyle(rail).visibility : null,
                  filteredAncestors: (() => {
                    const filters = [];
                    for (let node = rail; node; node = node.parentElement) {
                      const filter = getComputedStyle(node).filter;
                      if (filter !== "none") filters.push({ className: node.className, filter });
                    }
                    return filters;
                  })(),
                  backgroundSurfaces: surfaces.map(node => ({
                    className: node.className,
                    filter: getComputedStyle(node).filter,
                    rect: (() => {
                      const box = node.getBoundingClientRect();
                      return { x: box.x, y: box.y, width: box.width, height: box.height };
                    })(),
                  })),
                  workspaceRect: (() => {
                    const box = workspace?.getBoundingClientRect();
                    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
                  })(),
                };
              })(),
              backgroundInert: Boolean(body?.inert),
              paletteRect: rect(palette),
              panelRect: panelRect(panel),
              paletteButtonHit: (() => {
                const button = palette?.querySelector("button:not(:disabled)");
                if (!button) return false;
                const box = button.getBoundingClientRect();
                return Boolean(palette.contains(document.elementFromPoint(
                  box.left + box.width / 2,
                  box.top + box.height / 2,
                )));
              })(),
            };
          });
          await page.getByRole("button", { name: "去素材库", exact: true }).click();
          await idle(page, "library");
          const after = await page.evaluate(() => {
            const panel = document.querySelector(".toolbar-popover");
            const body = document.querySelector(".editor-workspace-body");
            const palette = document.querySelector(".node-palette");
            const rect = node => {
              const box = node?.getBoundingClientRect();
              return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
            };
            return {
              panelClass: panel?.className ?? null,
              task: panel?.getAttribute("data-workspace-task") ?? null,
              backgroundFilter: document.querySelector(".flow-surface")
                ? getComputedStyle(document.querySelector(".flow-surface")).filter : null,
              workspaceBodyFilter: body ? getComputedStyle(body).filter : null,
              workspaceBodyVisibility: body ? getComputedStyle(body).visibility : null,
              nodeRailPresentation: (() => {
                const rail = document.querySelector(".node-palette");
                const workspace = document.querySelector(".editor-workspace");
                const surfaces = [...document.querySelectorAll(".editor-workspace > .flow-surface")];
                return {
                  railFilter: rail ? getComputedStyle(rail).filter : null,
                  railOpacity: rail ? getComputedStyle(rail).opacity : null,
                  railVisibility: rail ? getComputedStyle(rail).visibility : null,
                  filteredAncestors: (() => {
                    const filters = [];
                    for (let node = rail; node; node = node.parentElement) {
                      const filter = getComputedStyle(node).filter;
                      if (filter !== "none") filters.push({ className: node.className, filter });
                    }
                    return filters;
                  })(),
                  backgroundSurfaces: surfaces.map(node => ({
                    className: node.className,
                    filter: getComputedStyle(node).filter,
                    rect: (() => {
                      const box = node.getBoundingClientRect();
                      return { x: box.x, y: box.y, width: box.width, height: box.height };
                    })(),
                  })),
                  workspaceRect: (() => {
                    const box = workspace?.getBoundingClientRect();
                    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
                  })(),
                };
              })(),
              backgroundInert: Boolean(body?.inert),
              paletteRect: rect(palette),
              panelRect: rect(panel),
              paletteVisibility: palette ? getComputedStyle(palette).visibility : null,
              paletteDisplay: palette ? getComputedStyle(palette).display : null,
              paletteButtonHit: (() => {
                const button = palette?.querySelector("button:not(:disabled)");
                if (!button) return false;
                const box = button.getBoundingClientRect();
                const topmost = document.elementFromPoint(
                  box.left + box.width / 2,
                  box.top + box.height / 2,
                );
                return {
                  hit: Boolean(palette.contains(topmost)),
                  topmost: topmost instanceof HTMLElement
                    ? `${topmost.tagName.toLowerCase()}.${String(topmost.className).replaceAll(" ", ".")}`
                    : topmost?.tagName ?? null,
                };
              })(),
              paletteOverlapsPanel: (() => {
                const paletteRect = rect(palette);
                const panelRect = rect(panel);
                return Boolean(paletteRect && panelRect
                  && paletteRect.x < panelRect.x + panelRect.width
                  && paletteRect.x + paletteRect.width > panelRect.x
                  && paletteRect.y < panelRect.y + panelRect.height
                  && paletteRect.y + paletteRect.height > panelRect.y);
              })(),
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          assert(before.panelClass?.includes("workspace-task-panel")
            && after.panelClass?.includes("workspace-task-panel")
            && after.task === "options",
          `An options-origin advanced-tools request must retain the right-workbench state: ${JSON.stringify({ before, after })}`);
          assert(after.backgroundFilter?.includes("blur(")
            && after.backgroundFilter !== "none",
          `An options-origin advanced-tools request must keep the softened workspace visible: ${JSON.stringify(after)}`);
          assert(after.workspaceBodyVisibility === "visible"
            && after.workspaceBodyFilter === "none"
            && after.nodeRailPresentation?.railVisibility === "visible"
            && Number(after.nodeRailPresentation?.railOpacity) >= 0.98
            && after.nodeRailPresentation?.filteredAncestors.length === 0
            && after.nodeRailPresentation?.backgroundSurfaces.some(surface => surface.filter.includes("blur(")),
          `Options must keep the node rail legible while blurring only the workspace content behind it: ${JSON.stringify(after.nodeRailPresentation)}`);
          assert(after.paletteVisibility === "visible"
            && after.paletteDisplay !== "none"
            && JSON.stringify(after.paletteRect) === JSON.stringify(before.paletteRect)
            && (after.backgroundInert || after.paletteButtonHit?.hit)
            && !after.paletteOverlapsPanel
            && !after.horizontalOverflow,
          `Advanced-tools navigation must preserve the node rail geometry without overflow: ${JSON.stringify({ before, after })}`);
          report.cases.push({
            viewport,
            name: "advanced-request-retains-options-workbench",
            status: "PASS",
            before,
            after,
          });
        }
        if (!caseName || caseName === "tokens") {
          const tokens = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            return Object.fromEntries(["--ease-out", "--ease-in-out", "--ease-ui-out", "--ease-ui-in-out"]
              .map(name => [name, style.getPropertyValue(name).trim()]));
          });
          assert(Object.values(tokens).every(value => value.startsWith("cubic-bezier(")),
            `Existing motion consumers have missing easing tokens: ${JSON.stringify(tokens)}`);
          report.cases.push({ viewport, name: "resolved-shared-easing-tokens", status: "PASS", tokens });
          const crossfadeCurve = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue("--ease-editor-crossfade").trim());
          assert.equal(crossfadeCurve, tokens["--ease-ui-out"],
            `Editor page crossfade must resolve to the responsive UI ease-out token: ${crossfadeCurve}`);
          report.cases.push({ viewport, name: "resolved-editor-crossfade-curve", status: "PASS", crossfadeCurve });
        }
        if (caseName === "workspace-load") {
          try {
            await page.locator('[data-workspace-surface="assistant"]:visible').click();
            const pending = await page.evaluate(() => ({
              selected: document.querySelector('[data-workspace-surface="assistant"]')?.getAttribute("aria-current"),
              old: Boolean(document.querySelector(".project-settings-panel")),
              oldInert: Boolean(document.querySelector(".toolbar-popover.advanced")?.inert),
              loading: [...document.querySelectorAll('[role="status"]')].some(node => node.textContent.includes("AI")),
            }));
            assert(pending.selected === "page" && pending.old && pending.oldInert && pending.loading,
              `Cold workspace load discarded the displayed page or feedback: ${JSON.stringify(pending)}`);
            await page.locator('[data-workspace-surface="options"]:visible').click();
            releaseWorkspaceModule();
            await idle(page, "settings");
            assert(await page.locator(".toolbar-popover.advanced").evaluate(node => !node.inert),
              "Cancelling a workspace request must restore the previous input owner");
            report.cases.push({ viewport, name: "cold-workspace-preserves-current-page", status: "PASS" });
          } finally { releaseWorkspaceModule(); }
        }
        if (caseName === "workspace-error") {
          await page.locator('[data-workspace-surface="assistant"]:visible').click();
          await page.locator(".workspace-load-feedback[role='alert']").waitFor({ state: "visible" });
          await idle(page, "settings");
          assert(await page.locator(".toolbar-popover.advanced").evaluate(node => !node.inert),
            "Failed workspace request must restore the displayed page");
          rejectWorkspaceModule = false;
          await page.getByRole("button", { name: "重试载入工作区", exact: true }).click();
          await page.locator('.toolbar-popover[data-workspace-task="assistant"]').waitFor({ state: "visible" });
          assert(await page.locator(".workspace-load-feedback").count() === 0, "Workspace retry must clear error");
          report.cases.push({ viewport, name: "workspace-failure-real-retry", status: "PASS" });
        }
        if (caseName === "workspace-motion") {
          await page.evaluate(() => {
            window.__workspacePresentationSamples = [];
            const nativeAnimate = HTMLElement.prototype.animate;
            HTMLElement.prototype.animate = function (keyframes, options) {
              const animation = nativeAnimate.call(this, keyframes, options);
              const panel = this.closest('.toolbar-popover[data-workspace-task="assistant"]');
              if (panel?.querySelector(".assistant-chat-panel") === this) {
                const record = { duration: Number(options?.duration) || 0, frames: [] };
                window.__workspacePresentationSamples.push(record);
                const sample = () => {
                  const currentPanel = document.querySelector('.toolbar-popover[data-workspace-task="assistant"]');
                  record.frames.push({
                    opacity: Number.parseFloat(getComputedStyle(this).opacity),
                    running: animation.playState === "running",
                    inputOwner: Boolean(currentPanel && !currentPanel.inert
                      && document.querySelector(".editor-workspace-body")?.inert),
                  });
                  if (animation.playState === "running" && record.frames.length < 12)
                    requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
              }
              return animation;
            };
            window.__restoreWorkspacePresentationProbe = () => {
              HTMLElement.prototype.animate = nativeAnimate;
              delete window.__restoreWorkspacePresentationProbe;
            };
          });
          await page.locator('[data-workspace-surface="assistant"]:visible').click();
          try {
            await page.waitForFunction(() => {
              return window.__workspacePresentationSamples?.some(sample =>
                sample.frames.some(frame => frame.running));
            }, undefined, { timeout: 3000 });
          } finally {
            await page.evaluate(() => window.__restoreWorkspacePresentationProbe?.());
          }
          const motion = await page.locator('.toolbar-popover[data-workspace-task="assistant"]')
            .evaluate(node => ({
              inert: node.inert,
              backgroundInert: document.querySelector(".editor-workspace-body").inert,
              samples: window.__workspacePresentationSamples,
            }));
          const observedFrames = motion.samples.flatMap(sample => sample.frames);
          const expectedPresentationDuration = (process.env.MOTION_REDUCED === "1" ? 480 : 800) / 1.5;
          assert(!motion.inert && motion.backgroundInert
            && observedFrames.some(frame => frame.running && frame.opacity >= 0.69 && frame.inputOwner)
            && motion.samples.every(sample => sample.duration === expectedPresentationDuration),
          `Workspace presentation blocks input or flashes: ${JSON.stringify(motion)}`);
          report.cases.push({ viewport, name: "workspace-ready-input-bounded-presentation", status: "PASS", motion });
        }
        if (caseName === "initial-request") {
          await page.locator('[data-workspace-surface="assistant"]:visible').click();
          await page.locator(".assistant-chat-panel:visible").getByRole("button", { name: "模型设置", exact: true }).click();
          await idle(page, "providers");
          await page.locator(".provider-settings-panel:visible").waitFor({ state: "visible" });
          report.cases.push({ viewport, name: "ai-model-settings-initial-navigation-replay", status: "PASS" });
        }
        if (!caseName || caseName === "workspace-repeat") {
          await clickTab(page, "history"); await idle(page, "history");
          await page.locator('[data-workspace-surface="options"]:visible').click();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert(await page.locator(".advanced-tab-content.is-active").getAttribute("data-tab") === "history",
            "Repeated top-level Options click reset the user's current subpage");
          await idle(page, "history");
          report.cases.push({ viewport, name: "workspace-repeat-retains-subpage", status: "PASS" });
        }
        if (!caseName || caseName === "repeat") {
          await clickTab(page, "settings"); await idle(page, "settings");
          const startedAt = Date.now();
          await clickTab(page, "history");
          await page.waitForFunction(() => document.querySelector(
            ".advanced-tab-content[data-tab='history'].is-entering"));
          await clickTab(page, "history");
          try { await idle(page, "history", 700); }
          catch (error) {
            const state = await page.evaluate(() => ({
              panel: document.querySelector(".advanced-tools-panel")?.className,
              layers: [...document.querySelectorAll(".advanced-tab-content")].map(node => ({
                tab: node.dataset.tab, class: node.className, inert: node.inert,
                opacity: getComputedStyle(node).opacity, pointerEvents: getComputedStyle(node).pointerEvents,
              })),
            }));
            throw new Error(`Repeated same-tab click did not settle within 700ms: ${JSON.stringify(state)}\n${error}`);
          }
          report.cases.push({ viewport, name: "repeat-same-target", status: "PASS", elapsedMs: Date.now() - startedAt });
        }
        if (!caseName || caseName === "focus") {
          await clickTab(page, "settings");
          await idle(page, "settings");
          await clickTab(page, "history");
          await page.waitForFunction(() => document.querySelector(
            ".advanced-tab-content[data-tab='history'].is-entering"));
          const focus = await page.evaluate(() => {
            const outgoing = document.querySelector(".advanced-tab-content.is-leaving");
            const target = outgoing?.querySelector("button, input, select, [tabindex='0']");
            target?.focus();
            return {
              outgoing: outgoing?.dataset.tab,
              tried: Boolean(target),
              leaked: Boolean(outgoing?.contains(document.activeElement)),
              hiddenFocusable: [...document.querySelectorAll(".advanced-tab-content:not(.is-active)")]
                .filter(node => !node.hidden && !node.inert && node.querySelector("button, input, select"))
                .map(node => node.dataset.tab),
            };
          });
          assert(focus.tried, "Focus repro must reach a real outgoing control");
          assert(!focus.leaked && focus.hiddenFocusable.length === 0,
            `Invisible/outgoing page accepted focus: ${JSON.stringify(focus)}`);
          await idle(page, "history");
          report.cases.push({ viewport, name: "inactive-focus-isolation", status: "PASS" });
        }
        if (!caseName || caseName === "reverse") {
          await clickTab(page, "settings"); await idle(page, "settings");
          await clickTab(page, "history");
          await page.waitForFunction(() => document.querySelector(
            ".advanced-tab-content[data-tab='history'].is-entering"));
          await clickTab(page, "settings");
          // Reverse once more while settings is entering, then return to it.
          await clickTab(page, "history");
          await clickTab(page, "settings");
          await idle(page, "settings");
          const final = await page.evaluate(() => {
            const node = document.querySelector(".advanced-tab-content.is-active");
            return { tab: node?.dataset.tab, opacity: getComputedStyle(node).opacity,
              inert: node.inert, interactive: node.dataset.advancedTabInteractive,
              visibleLayers: [...document.querySelectorAll(".advanced-tab-content")]
                .filter(node => !node.hidden && Number(getComputedStyle(node).opacity) > 0.01)
                .map(node => node.dataset.tab) };
          });
          assert(final.tab === "settings" && Number(final.opacity) > 0.99 && !final.inert
            && final.interactive === "true" && final.visibleLayers.join() === "settings",
            `Interrupted navigation left an invisible or stale active page: ${JSON.stringify(final)}`);
          report.cases.push({ viewport, name: "interrupted-reversal-final-owner", status: "PASS", final });
        }
        if (caseName === "selection" || caseName === "indicator") {
          try {
            await clickTab(page, "animation");
            await page.waitForFunction(() => document.querySelector(
              '[data-help-key="advanced.tab.animation"]')?.dataset.glassSelected === "true",
            undefined, { timeout: 100 });
            const status = await page.locator(".advanced-tools-panel").textContent();
            assert(status.includes("动画编辑"), "Loading target must be identifiable");
            await page.evaluate(() => new Promise(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert(await page.locator(".advanced-tools-panel > nav .glass-selection-indicator")
              .getAttribute("data-glass-state") !== "deferred",
            "Light selection must not defer behind the content/module transition");
            await page.waitForFunction(() => {
              const marker = document.querySelector(".advanced-tools-panel > nav .glass-selection-indicator");
              return marker && marker.getAnimations().every(animation =>
                animation.playState === "finished" || animation.playState === "idle");
            }, undefined, { timeout: 1000 });
            const marker = await page.evaluate(() => {
              const nav = document.querySelector(".advanced-tools-panel > nav.glass-selection-group");
              const selected = nav.querySelector('[data-glass-selected="true"]');
              const indicator = nav.querySelector(".glass-selection-indicator");
              const rect = node => {
                const r = node.getBoundingClientRect();
                return { left: r.left, top: r.top, width: r.width, height: r.height };
              };
              return { selected: rect(selected), marker: rect(indicator),
                opacity: getComputedStyle(indicator).opacity,
                state: indicator.dataset.glassState };
            });
            assert(Number(marker.opacity) > 0.99 && Object.keys(marker.selected).every(key =>
              Math.abs(marker.selected[key] - marker.marker[key]) <= 1.5),
            `Loading selection glass remains on a stale button: ${JSON.stringify(marker)}`);
            report.cases.push({ viewport, name: "cold-load-immediate-selection", status: "PASS" });
          } finally { releaseModule(); }
          await idle(page, "animation");
        }
        if (caseName === "supersede") {
          try {
            await clickTab(page, "animation");
            await page.waitForFunction(() => document.querySelector(
              ".advanced-tools-panel")?.classList.contains("is-tab-preparing"));
            await clickTab(page, "settings");
            await idle(page, "settings");
            const opacity = await page.locator(".advanced-tab-content.is-active")
              .evaluate(node => Number(getComputedStyle(node).opacity));
            assert(opacity > 0.99, `Returning to current page during a pending load left opacity=${opacity}`);
            releaseModule();
            await page.evaluate(() => new Promise(resolve => {
              let frames = 0;
              const sample = () => ++frames >= 24 ? resolve() : requestAnimationFrame(sample);
              requestAnimationFrame(sample);
            }));
            await idle(page, "settings");
            report.cases.push({ viewport, name: "pending-load-return-stale-response", status: "PASS" });
          } finally { releaseModule(); }
        }
        if (caseName === "rapid") {
          try {
            await clickTab(page, "animation");
            await clickTab(page, "library");
            await idle(page, "library");
            releaseModule();
            await page.evaluate(() => new Promise(resolve => {
              let frames = 0;
              const sample = () => ++frames >= 24 ? resolve() : requestAnimationFrame(sample);
              requestAnimationFrame(sample);
            }));
            await idle(page, "library");
            assert(await page.locator('[data-help-key="advanced.tab.library"]:visible')
              .getAttribute("data-glass-selected") === "true", "Late B response must not replace C selection");
            report.cases.push({ viewport, name: "rapid-a-b-c-final-target-only", status: "PASS" });
          } finally { releaseModule(); }
        }
        if (caseName === "loaderror") {
          await clickTab(page, "animation");
          await page.locator(".advanced-tab-load-error").waitFor({ state: "visible" });
          await idle(page, "settings");
          const retained = await page.locator(".advanced-tab-content.is-active").evaluate(node =>
            ({ opacity: getComputedStyle(node).opacity, inert: node.inert }));
          assert(Number(retained.opacity) > 0.99 && !retained.inert,
            `Failed load did not restore prior page input: ${JSON.stringify(retained)}`);
          rejectModule = false;
          await page.getByRole("button", { name: "重试载入", exact: true }).click();
          await idle(page, "animation");
          assert(await page.locator(".advanced-tab-load-error").count() === 0, "Retry must clear the error");
          report.cases.push({ viewport, name: "failed-load-retains-page-and-retries", status: "PASS" });
        }
        if (caseName === "timeout") {
          try {
            // Keep the browser's timers, RAF and native animation timeline on
            // one real clock. Clock.fastForward advances performance.now but
            // not WAAPI's DocumentTimeline, invalidating the retry transition.
            const started = Date.now();
            await clickTab(page, "animation");
            await page.locator(".advanced-tab-load-error").waitFor({ state: "visible", timeout: 40000 });
            const timeoutElapsedMs = Date.now() - started;
            assert(timeoutElapsedMs >= 29000 && timeoutElapsedMs <= 40000,
              `The real configured load timeout must fire: ${timeoutElapsedMs}ms`);
            assert((await page.locator(".advanced-tab-load-error").textContent()).includes("超时"),
              "Timeout must preserve its original cause");
            await idle(page, "settings");
            releaseModule();
            await page.getByRole("button", { name: "重试载入", exact: true }).click();
            await idle(page, "animation");
            report.cases.push({ viewport, name: "load-timeout-preserves-page-and-retries",
              status: "PASS", timeoutElapsedMs });
          } finally { releaseModule(); }
        }
        if (!caseName || caseName === "keyboard") {
          const expected = await siblingTiming(page);
          await page.locator('[data-help-key="advanced.tab.history"]:visible').focus();
          await page.keyboard.press("Enter");
          await page.waitForFunction(expected => {
            const panel = document.querySelector(".advanced-tools-panel");
            const active = panel?.querySelector(".advanced-tab-content.is-active");
            const leaving = panel?.querySelector(".advanced-tab-content.is-leaving");
            const animation = active?.getAnimations().find(candidate =>
              candidate.playState === "running" && Math.abs(Number(candidate.effect?.getTiming().duration) - expected.duration) < 1);
            return panel?.classList.contains("is-tab-crossfading")
              && active?.dataset.tab === "history"
              && active.getAttribute("data-advanced-tab-interactive") === "true"
              && !active.inert
              && leaving?.inert === true
              && document.activeElement?.getAttribute("data-help-key") === "advanced.tab.history"
              && Number(animation?.currentTime) >= 32
              && Number(animation?.currentTime) < Number(animation?.effect?.getTiming().duration);
          }, expected, { timeout: 5_000 });
          const handoff = await page.evaluate(() => {
            const active = document.querySelector(".advanced-tab-content.is-active");
            const leaving = document.querySelector(".advanced-tab-content.is-leaving");
            const animation = active?.getAnimations().find(candidate => candidate.playState === "running");
            return {
              activeTab: active?.dataset.tab ?? null,
              activeInert: active?.inert ?? null,
              activeInteractive: active?.getAttribute("data-advanced-tab-interactive") ?? null,
              activeOpacity: Number.parseFloat(getComputedStyle(active).opacity),
              leavingTab: leaving?.dataset.tab ?? null,
              leavingInert: leaving?.inert ?? null,
              leavingOpacity: Number.parseFloat(getComputedStyle(leaving).opacity),
              animationCurrentTime: Number(animation?.currentTime ?? 0),
              animationDuration: Number(animation?.effect?.getTiming().duration ?? 0),
              focusedHelpKey: document.activeElement?.getAttribute("data-help-key") ?? null,
            };
          });
          assert(handoff.activeOpacity > 0 && handoff.activeOpacity < 1
            && handoff.leavingOpacity > 0 && handoff.leavingOpacity < 1,
          `Keyboard page navigation must preserve a visible, continuous crossfade: ${JSON.stringify(handoff)}`);
          await idle(page, "history");
          report.cases.push({ viewport, name: "keyboard-navigation-retains-continuous-handoff",
            status: "PASS", handoff });
        }
        if (!caseName || caseName === "cancel") {
          await clickTab(page, "settings"); await idle(page, "settings");
          await clickTab(page, "history");
          await page.waitForFunction(() => document.querySelector(
            ".advanced-tab-content.is-active")?.getAnimations().some(a => a.playState === "running"));
          await page.evaluate(() => document.querySelector(".advanced-tab-content.is-active")
            .getAnimations().forEach(animation => animation.cancel()));
          await idle(page, "history", 700);
          assert(await page.locator(".advanced-tab-content.is-active").evaluate(node =>
            !node.inert && Number(getComputedStyle(node).opacity) > 0.99),
          "Cancelling presentation must leave the ready page interactive and visible");
          report.cases.push({ viewport, name: "cancelled-animation-settles-input", status: "PASS" });
        }
        if (!caseName || caseName === "geometry") {
          const measure = () => page.evaluate(() => {
            const nav = document.querySelector(".advanced-tools-panel > nav");
            const track = nav.querySelector(".glass-selection-track");
            const rect = nav.getBoundingClientRect();
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
              gap: getComputedStyle(track).gap,
              buttons: [...nav.querySelectorAll("button")].map(node => {
                const rect = node.getBoundingClientRect();
                return { width: Math.round(rect.width * 10) / 10,
                  height: Math.round(rect.height * 10) / 10 };
              }) };
          });
          const before = await measure();
          await clickTab(page, "layout"); await idle(page, "layout");
          await popoverMotionIdle(page);
          const after = await measure();
          assert.deepEqual(after.buttons, before.buttons,
            `Navigation button sizes changed after the workbench morphed: ${JSON.stringify({ before, after })}`);
          assert.equal(after.gap, before.gap,
            `Navigation spacing changed after the workbench morphed: ${JSON.stringify({ before, after })}`);
          assert(after.buttons.every(button => button.width >= 100 && button.height >= 40),
            `Navigation controls must retain usable dimensions after the morph: ${JSON.stringify(after.buttons)}`);
          report.cases.push({ viewport, name: "navigation-controls-fixed-size-through-workbench-morph",
            status: "PASS", before, after });
        }
        if (!caseName || caseName === "motion") {
          await clickTab(page, "history"); await idle(page, "history");
          await clickTab(page, "settings");
          await page.waitForFunction(() => document.querySelector(
            ".advanced-tab-content[data-tab='settings'].is-entering"));
          const motion = await page.evaluate(() => {
            const active = document.querySelector(".advanced-tab-content.is-active");
            const animations = active.getAnimations({ subtree: true });
            const durations = animations.map(a => a.effect.getTiming().duration);
            const easings = animations.map(a => a.effect.getTiming().easing);
            const motionCurve = getComputedStyle(document.documentElement)
              .getPropertyValue("--ease-editor-sibling").trim();
            const activeStyle = getComputedStyle(active);
            const candidates = [...active.querySelectorAll("button, input")];
            let button = candidates.find(node => {
              const r = node.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom < innerHeight;
            });
            // A 412/299px-high window intentionally scrolls the content area.
            // Reveal a real control rather than pretending a header is clickable.
            if (!button && candidates.length) {
              button = candidates[0];
              button.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
            const rect = button?.getBoundingClientRect();
            const point = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
            const hit = point ? document.elementFromPoint(point.x, point.y) : null;
            const describe = node => node ? {
              tag: node.tagName,
              className: typeof node.className === "string" ? node.className : "",
              text: node.textContent?.trim().slice(0, 80) ?? "",
              helpKey: node.getAttribute?.("data-help-key") ?? null,
            } : null;
            const clippingAncestors = [];
            for (let parent = button?.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              if (/(hidden|clip|auto|scroll)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
                const r = parent.getBoundingClientRect();
                clippingAncestors.push({ ...describe(parent), rect: {
                  left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                }, overflow: `${style.overflowX}/${style.overflowY}` });
              }
            }
            return { durations, easings, motionCurve,
              cssAnimationName: activeStyle.animationName,
              cssAnimationDuration: activeStyle.animationDuration,
              hasTarget: Boolean(button), target: describe(button),
              targetRect: rect && { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
              hitPoint: point, hit: describe(hit), hitActive: active.contains(hit),
              activeRect: (() => { const r = active.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })(),
              panelLayout: (() => {
                const panel = active.closest(".toolbar-popover");
                const viewport = active.closest(".advanced-tab-viewport");
                const palette = document.querySelector(".editor-workspace > .node-palette");
                const toolbar = document.querySelector(".editor-toolbar");
                const describeLayout = node => {
                  if (!node) return null;
                  const rect = node.getBoundingClientRect();
                  const style = getComputedStyle(node);
                  return {
                    className: node.className,
                    rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
                    position: style.position,
                    top: style.top,
                    right: style.right,
                    bottom: style.bottom,
                    left: style.left,
                    width: style.width,
                    height: style.height,
                    minHeight: style.minHeight,
                    maxHeight: style.maxHeight,
                    overflow: `${style.overflowX}/${style.overflowY}`,
                  };
                };
                return {
                  viewportInlineStyle: viewport?.getAttribute("style") ?? null,
                  popover: describeLayout(panel),
                  viewport: describeLayout(viewport),
                  nodePalette: describeLayout(palette),
                  toolbar: describeLayout(toolbar),
                };
              })(),
              clippingAncestors,
              pointerEvents: getComputedStyle(active).pointerEvents };
          });
          assert(motion.durations.length > 0, "Real animation must run on pointer navigation");
          const expectedPageDuration = (await siblingTiming(page)).duration;
          assert(motion.durations.every(ms => ms === expectedPageDuration)
            && motion.easings.every(easing => easing === motion.motionCurve)
            && motion.cssAnimationName === "none",
            `Page motion must preserve the mode-specific continuous transition duration: ${JSON.stringify({ ...motion, expectedPageDuration })}`);
          if (viewport.width >= 641 && viewport.width <= 900 && viewport.height <= 480) {
            const panel = motion.panelLayout.popover?.rect;
            const palette = motion.panelLayout.nodePalette?.rect;
            const toolbar = motion.panelLayout.toolbar?.rect;
            assert(panel && toolbar && panel.top >= toolbar.bottom
              && panel.bottom <= viewport.height && panel.height >= viewport.height - toolbar.bottom - 24,
              `Short landscape workbench must fit the space below global navigation: ${JSON.stringify(motion.panelLayout)}`);
            assert(palette && palette.width > 0 && palette.height > 0
              && (palette.right <= panel.left || panel.right <= palette.left
                || palette.bottom <= panel.top || panel.bottom <= palette.top),
              `Short landscape options workbench must leave the node palette visible and geometrically separate: ${JSON.stringify(motion.panelLayout)}`);
          }
          assert(motion.hasTarget && motion.hitActive && motion.pointerEvents !== "none",
            `Ready page remains input-locked during decorative motion: ${JSON.stringify(motion)}`);
          await idle(page, "settings");
          report.cases.push({ viewport, name: "bounded-motion-ready-input", status: "PASS", motion });
        }
      });
      await page.screenshot({ path: path.join(output, `${viewport.name}.png`) });
      await page.close(); page = undefined;
    }
    assert(report.cases.length > 0, "Acceptance cannot pass without behavior cases");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await env?.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`${report.status}: ${path.join(output, "report.json")}`);
    if (report.error) console.error(report.error);
  }
}
main();
