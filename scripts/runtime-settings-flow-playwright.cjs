"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, "..");
const baseline = process.argv.includes("--baseline");
const nestedOnly = process.argv.includes("--nested-only");
const saveControlsOnly = process.argv.includes("--save-controls-only");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/runtime-settings-flow", runId);
const compiled = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(compiled, compiled.exports);
const report = { runId, scope: "R1-real-runtime-browser-isolated-small-cartridge-not-installed",
  baseline, nestedOnly, saveControlsOnly, status: "RUNNING", cases: [], pageErrors: [] };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
function fixture(type, authored = false) {
  const now = new Date().toISOString();
  const id = `r1-settings-${type}-${authored ? "authored" : "default"}`;
  const uiSkin = compiled.exports[type === "renpy" ? "createRenpyUILayout" : "getDefaultUISkinLayout"]();
  if (authored) {
    uiSkin.screens.find(s => s.screen_id === "title").components
      .find(c => c.component_type === "main_menu_settings_button").label = "设置与退出";
    uiSkin.screens.find(s => s.screen_id === "preferences").components
      .find(c => c.component_type === "settings_group").style = { backgroundColor: "#263f35", borderRadius: 9, opacity: 1 };
    uiSkin.tokens.colorAccent = "#b79a52";
  }
  return { manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.21.0",
    game_id: id, title: "R1 隔离设置工程", author: "QA", version: "1.0.0", language: "zh-CN",
    entry_script: "script.json", entry_scene_id: "main", assets: [], created_at: now, updated_at: now },
    script: { schema_version: "1.1.0", game_id: id, title: "R1 隔离设置工程", entry_scene_id: "main",
      characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "设置往返保持剧情和玩家偏好。" }] }] }, uiSkin, assetUrls: {} };
}
async function idle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle", undefined, { timeout: 20000 });
}
async function initialize(page, url, type, authored = false) {
  await page.goto(`${url}/?mode=preview`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
  await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
    sessionId: payload.manifest.game_id, revision: 1, requestId: "init", runId: "init", screen: "title_menu", ...payload }, "*"), fixture(type, authored));
  await page.getByTestId("game-state-title").waitFor();
  await idle(page);
}
async function sample(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".settings-renpy");
    const region = document.querySelector(".renpy-menu-outlet") ?? document.querySelector('[data-testid="settings-screen"]');
    const rect = node => node.getBoundingClientRect().toJSON();
    const controls = [...panel.querySelectorAll("button, input")].map(node => {
      const bounds = rect(node), css = getComputedStyle(node);
      let clipped = false;
      for (let parent = node.parentElement; parent && parent !== panel.parentElement; parent = parent.parentElement) {
        const pc = getComputedStyle(parent), pr = rect(parent);
        if (["hidden", "clip", "auto", "scroll"].includes(pc.overflowY)
          && (bounds.top < pr.top - 1 || bounds.bottom > pr.bottom + 1)) clipped = true;
        if (["hidden", "clip", "auto", "scroll"].includes(pc.overflowX)
          && (bounds.left < pr.left - 1 || bounds.right > pr.right + 1)) clipped = true;
      }
      return { label: node.getAttribute("aria-label") || node.textContent.trim(), rect: bounds,
        hit: node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)),
        clipped, radius: css.borderRadius, fontSize: parseFloat(css.fontSize), color: css.color,
        background: css.backgroundColor, border: css.borderWidth };
    });
    return { panel: rect(panel), region: rect(region), background: getComputedStyle(panel).backgroundColor,
      radius: getComputedStyle(panel).borderRadius, controls,
      sliders: [...panel.querySelectorAll(".settings-slider-fill")].map(node => ({
        color: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage,
        width: node.getBoundingClientRect().width })),
      title: panel.querySelector(".settings-section-title")?.textContent,
      menuScale: Number(document.querySelector("[data-renpy-menu-scale]")?.getAttribute("data-renpy-menu-scale") || 1),
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      tabsScroll: panel.querySelector(".settings-tabs").scrollHeight - panel.querySelector(".settings-tabs").clientHeight };
  });
}
async function changeTab(page, label) {
  await page.evaluate(() => {
    window.__r1TabFrames = [];
    window.__r1TabCapture = true;
    const tick = at => {
      const content = document.querySelector(".settings-content");
      const current = content?.querySelector("[data-settings-tab-current]") ?? content;
      const ghost = content?.querySelector("[data-runtime-transition-snapshot]");
      window.__r1TabFrames.push({ at, title: current?.querySelector("h3")?.textContent,
        opacity: current ? Number(getComputedStyle(current).opacity) : 1,
        ghostOpacity: ghost ? Number(getComputedStyle(ghost).opacity) : 0, ghostInert: ghost?.inert,
        animations: current?.getAnimations().filter(a => a.playState === "running").map(a => a.effect.getTiming().duration) ?? [],
        panel: document.querySelector(".settings-renpy")?.getBoundingClientRect().toJSON(),
        black: Number(getComputedStyle(document.querySelector("[data-runtime-screen-transition]"), "::before").opacity) });
      if (window.__r1TabCapture) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("navigation", { name: /分类/ }).getByRole("button", { name: label, exact: true }).click();
  await page.waitForFunction(expected => document.querySelector(".settings-section-title")?.textContent === expected, label);
  await page.waitForFunction(() => [...document.querySelectorAll(".settings-content, .settings-content *")]
    .every(n => n.getAnimations().every(a => a.playState !== "running")));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => { window.__r1TabCapture = false; return window.__r1TabFrames; });
}
async function check(name, context, action) {
  const record = { name, ...context, status: "CHECKING" }; report.cases.push(record);
  try { await action(record); record.status = "PASS"; }
  catch (error) { record.status = "FAILED"; record.error = String(error.stack || error); }
  persist();
}
async function checkNestedNavigation(page, context) {
  await check("page-navigation-retains-interrupted-category-composite", context, async record => {
    await page.getByRole("navigation", { name: /分类/ }).getByRole("button", { name: "文字", exact: true }).click();
    await page.waitForFunction(() => {
      const current = document.querySelector("[data-settings-tab-current]");
      return current && Number(getComputedStyle(current).opacity) > .2 && Number(getComputedStyle(current).opacity) < .65;
    });
    await page.getByTestId("renpy-menu-about").click();
    await page.waitForFunction(() => document.querySelector("[data-runtime-transition-phase]")?.getAttribute("data-runtime-transition-phase") === "crossfading");
    record.composite = await page.locator("[data-runtime-transition-snapshot]").evaluate(node => ({
      categoryPresentations: node.querySelectorAll(".settings-category-content").length,
      inert: node.inert, black: Number(getComputedStyle(document.querySelector("[data-runtime-screen-transition]"), "::before").opacity) }));
    assert(record.composite.inert && record.composite.categoryPresentations >= 2,
      "Switching the whole page midway through a category fade must retain both visible category presentations");
    assert(record.composite.black < .01);
    await idle(page);
  });
}
async function checkSaveControls(page, context, fromTitle = false) {
  await check("save-control-template-scale-quiet-shape-and-real-tabs", context, async record => {
    await page.getByTestId(fromTitle ? "open-save-load" : "renpy-menu-save-load").click();
    await page.getByTestId("save-slot-grid").waitFor(); await idle(page);
    record.metrics = await page.locator(".save-load-screen").evaluate(screen => {
      const scale = Number(document.querySelector("[data-renpy-menu-scale]").getAttribute("data-renpy-menu-scale"));
      const controls = [...screen.querySelectorAll(".save-mode-switch button, .save-kind-tabs button, .save-page-navigation button")].map(node => {
        const r = node.getBoundingClientRect(), css = getComputedStyle(node);
        return { rect: r.toJSON(), font: parseFloat(css.fontSize), radius: parseFloat(css.borderRadius),
          hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), disabled: node.disabled };
      });
      return { scale, controls, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(record.metrics.controls.length >= 7 && record.metrics.controls.every(c => c.font >= 16 * record.metrics.scale),
      "Save toolbar and paging controls must share the template scale instead of staying at a fixed 13px");
    assert(record.metrics.controls.every(c => (c.hit || c.disabled) && c.radius <= 7 * record.metrics.scale),
      "Save controls must remain quiet slightly-rounded rectangles with real pointer targets");
    assert(record.metrics.overflow <= 1);
    for (const label of ["自动", "快存", "手动"]) {
      const tab = page.getByRole("tab", { name: label, exact: true }); await tab.click();
      assert.equal(await tab.getAttribute("aria-selected"), "true");
      assert.equal(await page.getByTestId("save-slot-grid").count(), 1);
    }
  });
}
async function runPage(page, server, context) {
  await initialize(page, server.url, context.type);
  if (saveControlsOnly) { await checkSaveControls(page, context, true); return; }
  if (nestedOnly) {
    await page.getByTestId("open-settings").click(); await page.getByTestId("settings-screen").waitFor(); await idle(page);
    await checkNestedNavigation(page, context);
    return;
  }
  await check("default-title-settings-copy", context, async record => {
    record.label = (await page.getByTestId("open-settings").innerText()).trim();
    assert.equal(record.label, "设置");
  });
  await page.getByTestId("open-settings").click(); await page.getByTestId("settings-screen").waitFor(); await idle(page);
  await check("centered-bounded-settings-panel", context, async record => {
    const metrics = record.metrics = await sample(page), { panel: p, region: r } = metrics;
    assert(p.width <= r.width * .91 && p.height <= r.height * .94, "Settings panel must leave real space around its bounded content");
    assert(Math.abs((p.left + p.right) / 2 - (r.left + r.right) / 2) <= r.width * .03, "Settings panel must be centered in its safe content region");
    assert(Math.abs((p.top + p.bottom) / 2 - (r.top + r.bottom) / 2) <= r.height * .03, "Settings panel must be vertically centered");
    assert(metrics.pageOverflow <= 1 && metrics.tabsScroll <= 1, "Five settings categories must not overflow");
  });
  for (const label of ["文字", "音频", "跳过", "系统", "显示"]) {
    const frames = await changeTab(page, label);
    await check(`category-${label}-geometry-and-real-hit`, context, async record => {
      const metrics = record.metrics = await sample(page);
      assert.equal(metrics.title, label);
      assert(metrics.controls.every(c => c.hit && !c.clipped), "Every live category/input/footer control must be visible and actually hit-testable");
      assert(metrics.pageOverflow <= 1 && metrics.tabsScroll <= 1);
      assert(metrics.sliders.every(s => s.width === 0 || s.image !== "none"
        || !["transparent", "rgba(0, 0, 0, 0)"].includes(s.color)), "A nonzero slider value must have a visible filled portion");
      if (context.type === "renpy") {
        assert(metrics.controls.filter(c => c.label === label).some(c => c.fontSize >= 20 * metrics.menuScale),
          "Category text must share the template scale instead of staying fixed at 20px on 4K");
      }
    });
    await check(`category-${label}-continuous-handoff`, context, async record => {
      record.frames = frames;
      assert(frames.some(f => f.animations.length && f.opacity > .1 && f.opacity < .9 && f.ghostOpacity > .1 && f.ghostInert),
        "Settings category must retain an inert outgoing presentation and continuous incoming frames");
      assert(frames.every(f => f.black < .01), "Settings category must not create a black curtain");
      const first = frames[0]?.panel;
      assert(first && frames.every(f => ["x", "y", "width", "height"].every(k => Math.abs(f.panel[k] - first[k]) <= 1)),
        "Category transition must keep its outer panel geometry stable");
    });
  }
  await check("rapid-repeat-keyboard-and-single-form-owner", context, async record => {
    const nav = page.getByRole("navigation", { name: /分类/ });
    await nav.getByRole("button", { name: "文字", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-settings-tab-current]")?.getAnimations()
      .some(a => a.playState === "running"));
    record.beforeRepeat = await page.locator("[data-settings-tab-current]").evaluate(node => node.getAnimations()[0].currentTime);
    await nav.getByRole("button", { name: "文字", exact: true }).click();
    record.afterRepeat = await page.locator("[data-settings-tab-current]").evaluate(node => node.getAnimations()[0]?.currentTime);
    assert(record.afterRepeat >= record.beforeRepeat, "Repeated selection must not restart a transition");
    await nav.getByRole("button", { name: "音频", exact: true }).click();
    await nav.getByRole("button", { name: "系统", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".settings-content")?.getAttribute("data-settings-transition") === "idle");
    assert.equal(await page.locator(".settings-section-title").innerText(), "系统");
    assert.equal(await page.locator("[data-settings-tab-current]").count(), 1);
    assert.equal(await page.locator("[data-runtime-transition-snapshot]").count(), 0);
    assert.equal(await page.getByRole("checkbox", { name: "自动存档", exact: true }).count(), 1);
    await nav.getByRole("button", { name: "显示", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".settings-content")?.getAttribute("data-settings-transition") === "crossfading");
    assert.equal(await nav.getByRole("button", { name: "显示", exact: true }).evaluate(node => document.activeElement === node), true);
    await page.waitForFunction(() => document.querySelector(".settings-content")?.getAttribute("data-settings-transition") === "idle");
    assert.equal(await page.locator(".settings-section-title").innerText(), "显示");
  });
  await check("settings-adjustment-persists-through-pages", context, async record => {
    const slider = page.getByRole("slider", { name: "Font scale", exact: true });
    record.before = await slider.inputValue(); await slider.focus(); await page.keyboard.press("ArrowRight");
    record.after = await slider.inputValue(); assert(Number(record.after) > Number(record.before));
    await page.getByTestId("settings-finish").click(); await idle(page);
    await page.getByTestId("open-settings").click(); await page.getByTestId("settings-screen").waitFor(); await idle(page);
    assert.equal(await page.getByRole("slider", { name: "Font scale", exact: true }).inputValue(), record.after);
    await slider.focus(); await page.keyboard.press("ArrowLeft");
  });
  await page.screenshot({ path: path.join(output, `${context.type}-${context.width}-${context.dpr}-${context.reduced}-settings.png`) });
  if (context.type === "renpy") {
    await checkNestedNavigation(page, context);
    await checkSaveControls(page, context);
  }
  await check("author-copy-palette-and-panel-style-preserved", context, async record => {
    await initialize(page, server.url, context.type, true);
    assert.equal((await page.getByTestId("open-settings").innerText()).trim(), "设置与退出");
    await page.getByTestId("open-settings").click(); await page.getByTestId("settings-screen").waitFor(); await idle(page);
    record.metrics = await sample(page);
    assert.equal(record.metrics.background, "rgb(38, 63, 53)");
    assert(parseFloat(record.metrics.radius) > 0, "Explicit author radius must retain its normal Runtime scaling");
  });
}
(async () => {
  fs.mkdirSync(output, { recursive: true }); let server, browser;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(output, "vite.log") });
    report.owner = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    for (const [width, height] of baseline ? desktopViewports.slice(0, 1) : desktopViewports)
      for (const [dpr, reduced] of baseline ? [[1, false]] : [[1, false], [2, false], [1, true], [2, true]])
        for (const type of nestedOnly || saveControlsOnly ? ["renpy"] : ["agentvn", "renpy"]) {
          const context = { type, width, height, dpr, reduced };
          console.log(`START ${JSON.stringify(context)}`);
          const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr,
            reducedMotion: reduced ? "reduce" : "no-preference" });
          page.on("pageerror", error => report.pageErrors.push({ ...context, error: String(error) }));
          try { await server.run(() => runPage(page, server, context)); }
          finally { await page.close(); }
        }
    assert(report.cases.length > 0 && report.pageErrors.length === 0);
    const failed = report.cases.filter(c => c.status === "FAILED");
    report.status = failed.length ? "FAILED" : "PASS";
    console.log(`${report.status}: ${report.cases.length - failed.length}/${report.cases.length}; ${output}`);
    if (failed.length) process.exitCode = 1;
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally { await browser?.close(); await server?.stop(); persist(); }
})();
