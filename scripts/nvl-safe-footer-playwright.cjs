"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const output = process.env.AGENTVN_QA_OUTPUT
  || path.join(root, "output/playwright/nvl-safe-footer", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", scope: "Runtime browser native-inset regression; not device acceptance",
  cases: [], pageErrors: [], startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const loaded = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(loaded, loaded.exports);
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const selectedMatrix = process.env.NVL_SAFE_WIDTH
  ? matrix.filter(config => config.width === Number(process.env.NVL_SAFE_WIDTH)) : matrix;
assert(selectedMatrix.length > 0, "NVL native-inset matrix must not be empty");
const sentence = "NVL 超长单句验收：清页、分页、快存、快读和回滚之后不重播或丢失文字。";
async function inspect(page, label) {
  // A remounted reader measures its font in a layout effect. Await the
  // semantic measurement and stable rendered frames, as the existing NVL
  // restoration acceptance does; do not wait for a geometry assertion to pass.
  await page.evaluate(async () => {
    let previous = "", stable = 0;
    for (let frame = 0; frame < 180; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const dialog = document.querySelector(".dialog-box"), content = document.querySelector(".nvl-page");
      const text = content?.querySelector(".nvl-page-text");
      const value = JSON.stringify({ data: { ...dialog?.dataset }, font: text && getComputedStyle(text).fontSize,
        rect: content?.getBoundingClientRect().toJSON(), text: text?.textContent });
      stable = value === previous ? stable + 1 : 0; previous = value;
      if (stable >= 5 && dialog?.dataset.dialogFontMode === "adaptive"
        && dialog.dataset.dialogPageDone === "true") return;
    }
    throw Error("NVL rendered measurement did not settle");
  });
  const result = await page.evaluate(() => {
    const dialog = document.querySelector(".dialog-box"), content = document.querySelector(".nvl-page");
    const bar = document.querySelector(".renpy-quick-bar");
    return { dialog: dialog.getBoundingClientRect().toJSON(), content: content.getBoundingClientRect().toJSON(),
      bar: bar.getBoundingClientRect().toJSON(), pages: Number(dialog.dataset.dialogPages),
      page: Number(dialog.dataset.dialogPage), text: content.querySelector(".nvl-page-text")?.textContent,
      scrollHeight: content.scrollHeight, clientHeight: content.clientHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
      measurement: [".nvl-page-line.is-current", ".nvl-page-text", ".nvl-page-speaker",
        ".nvl-page-measure", ".nvl-page-measure .nvl-page-text"].map(selector => {
          const element = document.querySelector(selector), style = element && getComputedStyle(element);
          return element ? { selector, rect: element.getBoundingClientRect().toJSON(), clientWidth: element.clientWidth,
            font: style.fontSize, lineHeight: style.lineHeight, padding: style.padding, maxHeight: style.maxHeight } : null;
        }),
      buttons: [...bar.querySelectorAll("button")].map(button => {
        const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { label: button.textContent, hit: button.contains(hit), disabled: button.disabled };
      }) };
  });
  assert(result.content.bottom <= result.bar.top - .5,
    `${label}: NVL text overlaps native safe-area quick bar: ${JSON.stringify({ content: result.content, bar: result.bar })}`);
  assert(result.dialog.bottom <= result.bar.top - .5, `${label}: reading frame must leave space for quick actions`);
  assert(result.scrollHeight <= result.clientHeight + 1 && result.overflow <= 1,
    `${label}: no scroll or clipping: ${JSON.stringify({ ...result, text: result.text?.slice(0, 80) })}`);
  assert.equal(result.buttons.length, 9, "Retain the original eight actions and the new Hide action");
  assert(result.buttons.every(button => button.hit || button.disabled), `${label}: all actions remain hittable`);
  return result;
}
let browser, server, page;
(async () => {
  save();
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), port: 0,
    logFile: path.join(output, "vite.log") });
  report.service = { pid: server.pid, url: server.url }; save();
  browser = await chromium.launch({ headless: true });
  await server.run(async () => {
    for (const config of selectedMatrix) {
      const text = sentence.repeat(400 * Math.ceil(config.width / 1920) ** 2);
      const row = { ...config, status: "RUNNING" }; report.cases.push(row); save();
      const context = await browser.newContext({ viewport: { width: config.width, height: config.height },
        deviceScaleFactor: config.dpr, hasTouch: true, reducedMotion: config.reduced ? "reduce" : "no-preference",
        userAgent: "Mozilla/5.0 (Linux; Android 15; AgentVN QA) AppleWebKit/537.36 Chrome/148 Mobile Safari/537.36" });
      page = await context.newPage();
      page.on("pageerror", error => report.pageErrors.push(String(error)));
      try {
        await page.addInitScript(() => {
          window.__nvlNativeInsets = { top: 74, right: 132, bottom: 84, left: 0 };
          window.AgentVNViewport = { requestInsets() {
            window.dispatchEvent(new CustomEvent("agentvn:android-insets", { detail: {
              ...window.__nvlNativeInsets, coordinateSpace: "physical", revision: 1 } }));
          } };
        });
        await page.goto(`${server.url}/?mode=preview`);
        await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
        await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
          sessionId: "safe-footer", revision: 1, requestId: "init", runId: "init", screen: "title_menu", ...payload }, "*"),
        { uiSkin: loaded.exports.createRenpyUILayout(),
          manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.21.0",
            game_id: "safe-footer-isolated", title: "NVL安全区", author: "QA", version: "1.0.0", language: "zh-CN",
            entry_script: "script.json", entry_scene_id: "main", assets: [],
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          script: { schema_version: "1.7.0", game_id: "safe-footer-isolated", title: "NVL安全区", entry_scene_id: "main",
            characters: [{ character_id: "alice", name: "小岚" }], scenes: [{
              scene_id: "main", title: "Long NVL", chapter: 1, tags: [], commands: [
                { type: "dialog", character_id: "alice", presentation_mode: "nvl", text },
              ] }] }, assetUrls: {} });
        await page.getByTestId("start-new-game").click();
        await page.getByTestId("game-state-playing").waitFor();
        await page.waitForFunction(() => !document.querySelector(".game-launch-blackout")
          && document.querySelector(".dialog-box")?.dataset.dialogFontMode === "adaptive"
          && Number(document.querySelector(".dialog-box")?.dataset.dialogPages) > 1);
        await page.locator(".dialog-box").press("Enter");
        await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
        row.before = await inspect(page, "initial long NVL");
        await page.getByTestId("renpy-quick-settings").click();
        await page.getByTestId("settings-screen").waitFor();
        await page.getByTestId("settings-finish").click();
        await page.getByTestId("game-state-playing").waitFor();
        await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")?.dataset.runtimeScreenTransition === "idle");
        row.returned = await inspect(page, "menu return");
        assert.equal(row.returned.pages, row.before.pages);
        assert.equal(row.returned.page, row.before.page);
        assert.equal(row.returned.text, row.before.text);
        await page.evaluate(() => {
          window.__nvlNativeInsets = { top: 74, right: 0, bottom: 84, left: 132 };
          window.AgentVNViewport.requestInsets();
          window.dispatchEvent(new CustomEvent("agentvn:android-resume"));
        });
        await page.waitForFunction(() => document.querySelector(".ui-skin-scope")?.dataset.uiViewportPhase === "stable");
        row.rotated = await inspect(page, "opposite landscape");
        await page.screenshot({ path: path.join(output, `${config.width}-${config.dpr}-${config.reduced}.png`) });
        row.status = "PASS";
      } catch (error) {
        row.status = "FAILED"; row.error = String(error.stack || error);
        await page.screenshot({ path: path.join(output, "failure.png") }); throw error;
      } finally { await context.close(); save(); }
    }
  });
  assert.equal(report.cases.length, selectedMatrix.length); assert.deepEqual(report.pageErrors, []);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    await browser?.close(); await server?.stop();
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, output, error: report.error }));
  });
