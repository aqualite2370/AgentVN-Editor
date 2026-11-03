"use strict";

const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { renderedDialogGlyphs } = require("./lib/rendered-dialog-glyphs.cjs");
const { measureSettingsIconProportions, assertSettingsIconProportions } = require("./lib/runtime-settings-proportions.cjs");
const root = path.resolve(__dirname, ".."), baseline = process.argv.includes("--baseline");
const output = path.join(root, "output/playwright/runtime-settings-proportions",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const loaded = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts", contents:
  'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(loaded, loaded.exports);
const report = { status: "RUNNING", scope: "Runtime settings icon/text proportions; isolated browser, not installed/device",
  startedAt: new Date().toISOString(), cases: [], pageErrors: [] };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
function fixture(type, authored) {
  const uiSkin = loaded.exports[type === "renpy" ? "createRenpyUILayout" : "getDefaultUISkinLayout"]();
  if (authored) {
    uiSkin.renpy ??= {};
    uiSkin.renpy.preferences = { buttonRoles: { category_pagination: {
      geometry: { width: 172, height: 54, fontSize: 24, paddingX: 8, paddingY: 4 },
      states: { normal: { textColor: "#81bbcc" }, selected: { textColor: "#ffee88" } },
    } } };
  }
  const id = `settings-proportion-${type}-${authored ? "authored" : "default"}`;
  return { uiSkin, assetUrls: {},
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.21.0",
      game_id: id, title: "设置比例隔离工程", author: "QA", version: "1.0.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [] },
    script: { schema_version: "1.1.0", game_id: id, title: "设置比例", entry_scene_id: "main",
      characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "设置页面图标、文字、真实操作与返回验收。" }] }] } };
}
async function idle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.dataset.runtimeScreenTransition === "idle"
    && !document.querySelector('[data-settings-transition="crossfading"]'));
}
async function inspect(page) {
  return page.evaluate(({ glyphsSource, proportionsSource }) => {
    const collect = new Function(`return (${glyphsSource})`)(), panel = document.querySelector(".settings-renpy");
    const proportions = new Function(`return (${proportionsSource})`)()();
    const box = node => node.getBoundingClientRect().toJSON();
    const controls = [...panel.querySelectorAll(".settings-tabs button, .settings-footer button")].map(button => {
      const rect = box(button), style = getComputedStyle(button), icon = button.querySelector(".precision-icon");
      const glyphs = collect(button);
      return { label: button.textContent.trim(), rect, font: parseFloat(style.fontSize),
        icon: icon ? box(icon) : null, iconCss: icon ? parseFloat(getComputedStyle(icon).width) : null,
        gap: parseFloat(style.columnGap),
        hit: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
        clipped: glyphs.some(g => g.left < rect.left - 1 || g.right > rect.right + 1
          || g.top < rect.top - 1 || g.bottom > rect.bottom + 1),
        color: style.color, selected: button.getAttribute("aria-pressed") === "true" };
    });
    return { panel: box(panel), controls, proportions, overflow: document.documentElement.scrollWidth - innerWidth,
      menuScale: Number(document.querySelector("[data-renpy-menu-scale]")?.dataset.renpyMenuScale || 1) };
  }, { glyphsSource: renderedDialogGlyphs.toString(), proportionsSource: measureSettingsIconProportions.toString() });
}
let server, browser, page;
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), port: 0,
    logFile: path.join(output, "vite.log") });
  report.owner = { pid: server.pid, runId: server.runId, url: server.url }; save();
  browser = await chromium.launch();
  for (const [width, height] of baseline ? desktopViewports.slice(0, 1) : desktopViewports)
    for (const [dpr, reduced] of baseline ? [[1, false]] : [[1, false], [2, false], [1, true], [2, true]])
      for (const type of baseline ? ["agentvn"] : ["agentvn", "renpy", "renpy-authored"]) {
        const authored = type === "renpy-authored", layout = authored ? "renpy" : type;
        const row = { width, height, dpr, reduced, type, status: "RUNNING", samples: [] };
        report.cases.push(row); save();
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
          reducedMotion: reduced ? "reduce" : "no-preference" });
        page = await context.newPage();
        page.on("pageerror", error => report.pageErrors.push(String(error)));
        try {
          await page.goto(`${server.url}/?mode=preview`);
          await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
          await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
            sessionId: payload.manifest.game_id, revision: 1, requestId: "init", runId: "init",
            screen: "title_menu", ...payload }, "*"), fixture(layout, authored));
          await page.getByTestId("game-state-title").waitFor(); await idle(page);
          await page.getByTestId("open-settings").click();
          await page.getByTestId("settings-screen").waitFor(); await idle(page);
          const first = await inspect(page); row.samples.push(first);
          await page.screenshot({ path: path.join(output, `${type}-${width}-${dpr}-${reduced}-before.png`) });
          const validate = sample => {
            assertSettingsIconProportions(sample.proportions);
            assert(sample.controls.every(control => control.hit && !control.clipped), "All text/actions must be visible and hittable");
            assert(sample.overflow <= 1, "Settings must not introduce page overflow");
          };
          validate(first);
          if (authored) assert(Math.abs(first.controls[0].font - 24 * first.menuScale) <= .1,
            "Authored category font must remain authoritative");
          for (const label of ["文字", "音频", "跳过", "系统", "显示"]) {
            const button = page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: label, exact: true });
            await button.click();
            await page.waitForFunction(label => document.querySelector(".settings-section-title")?.textContent === label, label);
            await idle(page);
            const current = await inspect(page); row.samples.push(current); validate(current);
            assert.equal(await button.getAttribute("aria-pressed"), "true");
            assert(["x", "y", "width", "height"].every(key => Math.abs(current.panel[key] - first.panel[key]) <= 1),
              "Category changes must not resize the settings panel");
          }
          const slider = page.getByRole("slider", { name: "Font scale", exact: true });
          const before = Number(await slider.inputValue());
          await slider.focus(); await page.keyboard.press("ArrowRight");
          assert(Number(await slider.inputValue()) > before, "Real keyboard adjustment remains usable");
          validate(await inspect(page));
          await page.getByTestId("settings-reset-default").click();
          assert.equal(Number(await slider.inputValue()), 1, "Reset action must still reset the actual settings");
          await page.getByTestId("settings-finish").click(); await idle(page);
          await page.getByTestId("game-state-title").waitFor();
          row.status = "PASS";
          console.log(`PASS ${type} ${width} DPR${dpr} reduced=${reduced}`);
        } catch (error) {
          row.status = "FAILED"; row.error = String(error.stack || error);
          await page.screenshot({ path: path.join(output, "failure.png") }); throw error;
        } finally { await context.close(); save(); }
      }
  assert.equal(report.cases.length, baseline ? 1 : 36);
  assert.deepEqual(report.pageErrors, []);
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close(); await server?.stop();
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, output, error: report.error }));
});
