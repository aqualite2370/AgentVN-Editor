"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, ".."), runId = new Date().toISOString().replace(/[:.]/g, "-");
const baseline = process.argv.includes("--baseline");
const output = path.join(root, "output/playwright/runtime-r2-editor-parity", runId);
fs.mkdirSync(output, { recursive: true });
const input = path.join(output, "isolated-r2.vnproj"), loaded = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { loader: "ts", resolveDir: root,
  contents: 'export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin"; export { resolveQuickMenuPresentation } from "./shared/cartridge/quickMenuMetrics";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(loaded, loaded.exports);
const project = fixture(`r2-parity-${runId}`), skin = loaded.exports.getDefaultUISkinLayout();
const menu = skin.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu");
menu.rect = { x: 82, y: 51, width: 18, height: 8, anchor: "top_right" };
project.editor_settings.runtimeUILayout = skin;
fs.writeFileSync(input, JSON.stringify(project));
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(output, "service");
const report = { status: "RUNNING", scope: "Editor actual layout preview; not installed acceptance", runId, input, cases: [] };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
(async () => {
  let env, browser;
  try {
    env = await startEditorAcceptance(); browser = await chromium.launch();
    report.owner = { pid: env.server.pid, backendPid: env.backendPid, url: env.url };
    for (const [width, height] of baseline ? desktopViewports.slice(0, 1) : desktopViewports) for (const dpr of baseline ? [1] : [1, 2]) for (const reduced of baseline ? [false] : [false, true]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
      page.setDefaultTimeout(30000);
      const errors = []; page.on("pageerror", e => errors.push(String(e)));
      try {
        await env.server.run(async () => {
          await env.open(page);
          await page.locator('[data-workspace-surface="options"]:visible').click();
          await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
          await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle") && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
          const designer = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .runtime-layout-designer");
          await designer.locator('[data-help-key="layout.screen"]').filter({ hasText: "播放页" }).click();
          const controls = designer.getByTestId("runtime-quick-menu-preview-controls");
          for (const state of ["collapsed", "expanded", "collapsed"]) {
            if (state === "collapsed" && report.cases.filter(c => c.width === width && c.dpr === dpr && c.reduced === reduced).length === 0)
              await controls.locator(`[data-preview-quick-menu-state="${state}"]`).click();
            else await designer.getByTestId("preview-quick-menu-toggle").click();
            await page.waitForFunction(state => document.querySelector(".runtime-layout-expected-preview.is-player")?.getAttribute("data-preview-quick-menu-state") === state, state);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.waitForFunction(() => [...document.querySelectorAll('.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .runtime-layout-expected-preview *')]
              .every(n => n.getAnimations().every(a => a.playState !== "running")));
            const actual = await designer.locator(".runtime-layout-expected-preview.is-player").evaluate(node => {
              const frame = node.getBoundingClientRect(), surface = node.querySelector(".preview-quick-menu-surface");
              const menu = surface.getBoundingClientRect(), preview = node.querySelector(".preview-quick-menu-preview");
              const toggle = node.querySelector(".preview-quick-menu-toggle").getBoundingClientRect();
              return { frame: frame.toJSON(), menu: menu.toJSON(), toggle: toggle.toJSON(),
                authoredFrame: { width: Number(preview.dataset.previewQuickMenuAuthoredFrameWidth), height: Number(preview.dataset.previewQuickMenuAuthoredFrameHeight) },
                renderScale: Number(preview.dataset.previewQuickMenuRenderScale),
                actions: [...node.querySelectorAll(".preview-quick-menu-buttons button")].map(n => {
                  const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width/2, r.y+r.height/2);
                  return { rect: r.toJSON(), hit: n.contains(hit), hitElement: hit?.className,
                    pointerEvents: getComputedStyle(n).pointerEvents, visibility: getComputedStyle(n).visibility };
                }), overflow: document.documentElement.scrollWidth - innerWidth };
            });
            const dialog = skin.screens.find(s=>s.screen_id === "player").components.find(c=>c.component_type === "dialog_panel");
            const expected = loaded.exports.resolveQuickMenuPresentation({ layout: { rect: menu.rect }, dialogRect: dialog.rect,
              dialogueTop: dialog.rect.y / 100 * actual.authoredFrame.height, authoredFrame: actual.authoredFrame, viewport: actual.authoredFrame,
              renderScale: actual.renderScale, state });
            const item = { width, height, dpr, reduced, state, actual, expected, status: "CHECKING" }; report.cases.push(item);
            assert(Math.abs(actual.menu.width - expected.root.width) < 2 && Math.abs(actual.menu.height - expected.root.height) < 2);
            assert(Math.abs(actual.menu.left - actual.frame.left - expected.root.left) < 2);
            assert(Math.abs(actual.menu.top - actual.frame.top - expected.root.top) < 2);
            assert(Math.abs(actual.toggle.left - actual.frame.left - expected.root.left - expected.toggle.left) < 2);
            assert(Math.abs(actual.toggle.top - actual.frame.top - expected.root.top - expected.toggle.top) < 2);
            assert(actual.overflow <= 1);
            if (state === "expanded") assert(actual.actions.length === 7 && actual.actions.every(a=>a.hit && a.rect.left >= actual.frame.left-1 && a.rect.right<=actual.frame.right+1 && a.rect.top>=actual.frame.top-1 && a.rect.bottom<=actual.frame.bottom+1));
            item.status="PASS"; persist();
          }
          assert.equal(errors.length, 0); await page.screenshot({ path: path.join(output, `${width}-${dpr}-${reduced}.png`) });
        });
      } finally { await page.close(); }
    }
    assert.equal(report.cases.length, baseline ? 3 : 36); report.status = "PASS";
  } catch(e) { report.status="FAILED"; report.error=String(e.stack||e); process.exitCode=1; }
  finally { await browser?.close(); await env?.stop(); persist(); console.log(`Evidence: ${output}`); }
})();
