"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/playwright/android-native-insets", new Date().toISOString().replace(/[:.]/g, "-"));
const loaded = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(loaded, loaded.exports);
const report = { status: "RUNNING", scope: "Runtime-browser-controlled-native-insets-not-Android-device",
  output, cases: [], pageErrors: [] };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true].flatMap(reduced =>
  ["renpy", "agentvn"].map(layout => ({ width, height: width * 9 / 16, dpr, reduced, layout })))));
matrix.push({ width: 1920, height: 1080, dpr: 2.625, reduced: false, layout: "renpy" });
const fixture = layout => {
  const now = new Date().toISOString();
  return { uiSkin: layout === "renpy" ? loaded.exports.createRenpyUILayout() : loaded.exports.getDefaultUISkinLayout(),
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.21.0",
      game_id: "native-insets-isolated", title: "原生安全区隔离验收", author: "QA", version: "1.0.0",
      language: "zh-CN", entry_script: "script.json", entry_scene_id: "main", assets: [], created_at: now, updated_at: now },
    script: { schema_version: "1.1.0", game_id: "native-insets-isolated", title: "原生安全区隔离验收",
      entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "设备旋转和菜单往返不应造成错误的安全区位移。" },
          { type: "narration", text: "第二句用于保持剧情状态。" }] }] }, assetUrls: {} };
};
async function settle(page) {
  await page.waitForFunction(() =>
    document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") === "idle"
    && !document.querySelector(".game-launch-blackout"));
}
async function snapshot(page) {
  return page.evaluate(() => {
    const scope = document.querySelector(".ui-skin-scope"), bar = document.querySelector(".playback-controls");
    const rect = bar?.getBoundingClientRect(), style = scope ? getComputedStyle(scope) : null;
    const buttons = [...(bar?.querySelectorAll("button") ?? [])].map(button => {
      const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { label: button.textContent.trim(), disabled: button.disabled,
        rect: box.toJSON(), hit: !!hit && button.contains(hit) };
    });
    return { requests: window.__nativeInsetsRequests, dpr: devicePixelRatio,
      insets: style ? Object.fromEntries(["top", "right", "bottom", "left"].map(side =>
        [side, style.getPropertyValue("--runtime-safe-" + side)])) : null,
      rect: rect?.toJSON(), buttons, viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth - innerWidth,
      position: document.querySelector(".story-player")?.getAttribute("data-current-command-index") };
  });
}
function assertInsets(sample, raw) {
  assert(sample.requests > 0, "Runtime must request native insets after registering the listener");
  for (const side of ["top", "right", "bottom", "left"]) {
    const value = Number(sample.insets[side]?.match(/max\(([\d.]+)px/)?.[1]);
    assert(Math.abs(value - raw[side] / sample.dpr) < .01, `${side} physical pixels were not converted to CSS pixels`);
  }
  assert(sample.overflow <= 1, "Native insets caused horizontal overflow");
}
function assertBar(sample, layout) {
  assert(sample.rect && sample.rect.width > 0 && sample.rect.height > 0);
  assert(sample.rect.left >= -1 && sample.rect.right <= sample.viewport.width + 1);
  assert(sample.rect.top >= -1 && sample.rect.bottom <= sample.viewport.height + 1);
  if (layout === "renpy") {
    assert.equal(sample.buttons.length, 8);
    assert(sample.buttons.every(button => button.hit || button.disabled), "Quick bar button is occluded");
    assert(sample.buttons.every(button => Math.abs(button.rect.y - sample.buttons[0].rect.y) < 1), "Quick bar wrapped");
    for (let index = 1; index < sample.buttons.length; index++) {
      assert(sample.buttons[index].rect.left >= sample.buttons[index - 1].rect.right - .5, "Quick bar buttons overlap");
    }
  } else assert(sample.buttons.some(button => button.hit && button.label === ""), "Collapsed quick menu is not reachable");
}
(async () => {
  fs.mkdirSync(output, { recursive: true }); persist();
  const server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0,
    logFile: path.join(output, "vite.log") });
  const browser = await chromium.launch({ headless: true });
  report.owner = { pid: server.pid, runId: server.runId, url: server.url };
  try {
    await server.run(async () => {
    for (const config of matrix) {
      const item = { ...config, status: "RUNNING" }; report.cases.push(item);
      const page = await browser.newPage({ viewport: { width: config.width, height: config.height },
        deviceScaleFactor: config.dpr, hasTouch: true, reducedMotion: config.reduced ? "reduce" : "no-preference",
        userAgent: "Mozilla/5.0 (Linux; Android 15; AgentVN QA) AppleWebKit/537.36 Chrome/148 Mobile Safari/537.36" });
      page.on("pageerror", error => report.pageErrors.push(String(error)));
      try {
        await page.addInitScript(() => {
          window.__nativeInsetsRequests = 0;
          window.__nativeInsets = { top: 74, right: 0, bottom: 84, left: 132 };
          window.AgentVNViewport = { requestInsets() {
            window.__nativeInsetsRequests++;
            window.dispatchEvent(new CustomEvent("agentvn:android-insets", { detail: {
              ...window.__nativeInsets, coordinateSpace: "physical", revision: window.__nativeInsetsRequests } }));
          } };
        });
        await page.goto(`${server.url}/?mode=preview`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
        await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
          sessionId: "native-insets", revision: 1, requestId: "init", runId: "init", screen: "title_menu", ...payload }, "*"), fixture(config.layout));
        await page.getByTestId("start-new-game").waitFor(); await settle(page);
        await page.getByTestId("start-new-game").click();
        await page.getByTestId("game-state-playing").waitFor(); await settle(page);
        item.before = await snapshot(page);
        assertInsets(item.before, { top: 74, right: 0, bottom: 84, left: 132 });
        assertBar(item.before, config.layout);
        await page.evaluate(() => {
          window.__nativeInsets = { top: 74, right: 132, bottom: 84, left: 0 };
          window.AgentVNViewport.requestInsets();
          window.dispatchEvent(new CustomEvent("agentvn:android-resume"));
        });
        await page.waitForFunction(() => {
          const scope = document.querySelector(".ui-skin-scope");
          return scope?.getAttribute("data-runtime-safe-revision") !== "0"
            && scope?.getAttribute("data-ui-viewport-phase") === "stable";
        });
        item.rotated = await snapshot(page);
        assertInsets(item.rotated, { top: 74, right: 132, bottom: 84, left: 0 });
        assertBar(item.rotated, config.layout);
        assert.equal(item.rotated.position, item.before.position);
        if (config.layout === "renpy") {
          await page.getByTestId("renpy-quick-settings").click();
          await page.getByTestId("settings-screen").waitFor(); await settle(page);
          await page.getByTestId("settings-finish").click();
          await page.getByTestId("game-state-playing").waitFor(); await settle(page);
          item.returned = await snapshot(page); assertBar(item.returned, config.layout);
          assertInsets(item.returned, { top: 74, right: 132, bottom: 84, left: 0 });
          assertBar(item.returned, config.layout);
        }
        await page.screenshot({ path: path.join(output, `${config.layout}-${config.width}-${config.dpr}-${config.reduced}.png`) });
        item.status = "PASS";
      } catch (error) {
        item.status = "FAILED"; item.error = String(error.stack || error);
        await page.screenshot({ path: path.join(output, "failure.png") });
        throw error;
      } finally { await page.close(); persist(); }
    }
    assert.equal(report.cases.length, 25); assert.equal(report.pageErrors.length, 0);
    report.status = "PASS";
    });
  } finally { await browser.close(); await server.stop(); }
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { persist(); console.log(`${report.status}: ${path.join(output, "report.json")}`); });
