"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { renderedDialogGlyphs } = require("./lib/rendered-dialog-glyphs.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, "..");
assert(process.argv[2], "Explicit isolated exported cartridge directory required");
const cartridge = path.resolve(process.argv[2]);
assert(cartridge.startsWith(path.join(root, "output") + path.sep), "Use an isolated acceptance export");
const read = name => JSON.parse(fs.readFileSync(path.join(cartridge, name), "utf8"));
const manifest = read("manifest.json"), script = read("script.json"), uiSkin = read("ui/layout.json");
assert(manifest.game_id.startsWith("installed_resource_flow_story_"), "Do not test a user project");
script.entry_scene_id = manifest.entry_scene_id = "bubble";
const assetUrls = Object.fromEntries(manifest.assets.map(asset => {
  const file = path.resolve(cartridge, asset.path);
  assert(file.startsWith(cartridge + path.sep), "Invalid fixture asset path");
  return [asset.asset_id, `data:${asset.mime_type};base64,${fs.readFileSync(file).toString("base64")}`];
}));
const output = path.join(root, "output/playwright/bubble-native-insets",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const native = { width: 915, height: 412, dpr: 2.625, reduced: false, deviceReplay: true };
const matrix = process.argv.includes("--baseline") ? [native] : [native, { ...native, reduced: true },
  ...desktopViewports.flatMap(([width, height]) => [1, 2].flatMap(dpr =>
    [false, true].map(reduced => ({ width, height, dpr, reduced, deviceReplay: false }))))];
const report = { status: "RUNNING", scope: "Source browser replay of installed Android failure, not device acceptance",
  cartridge, cases: [], errors: [], startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
async function settled(page) {
  await page.evaluate(async () => {
    let previous, stable = 0;
    for (let index = 0; index < 180; index++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const dialog = document.querySelector(".dialog-box"), text = dialog?.querySelector(".dialog-text");
      const key = JSON.stringify({ data: { ...dialog?.dataset }, rect: text?.getBoundingClientRect().toJSON(),
        scrollHeight: text?.scrollHeight, content: text?.textContent });
      stable = key === previous ? stable + 1 : 0; previous = key;
      if (stable >= 5 && dialog?.dataset.dialogPageDone === "true"
        && dialog.dataset.dialogBubbleAnchor !== "pending"
        && !dialog.getAnimations().some(animation => animation.playState === "running")) return;
    }
    throw Error("Bubble measurement did not settle");
  });
}
async function measure(page) {
  return page.evaluate(source => {
    const glyphs = new Function(`return (${source})`)();
    const dialog = document.querySelector(".dialog-box"), text = dialog.querySelector(".dialog-text");
    const rect = element => element?.getBoundingClientRect().toJSON();
    const style = element => {
      const css = getComputedStyle(element);
      return Object.fromEntries(["fontFamily", "fontSize", "lineHeight", "height", "maxHeight", "minHeight",
        "paddingTop", "paddingBottom", "display", "flex", "overflowY"].map(key => [key, css[key]]));
    };
    return { dialog: rect(dialog), text: rect(text), glyphs: glyphs(text),
      styles: { dialog: style(dialog), text: style(text) }, span: rect(text.firstElementChild),
      speaker: rect(dialog.querySelector(".speaker")), indicator: rect(dialog.querySelector(".continue-indicator")),
      scrollWidth: text.scrollWidth, clientWidth: text.clientWidth,
      scrollHeight: text.scrollHeight, clientHeight: text.clientHeight,
      anchor: dialog.dataset.dialogBubbleAnchor, content: text.textContent,
      bar: rect(document.querySelector(".renpy-quick-bar")),
      viewport: { width: innerWidth, height: innerHeight },
      pageOverflow: document.documentElement.scrollWidth - innerWidth };
  }, renderedDialogGlyphs.toString());
}
function validate(value) {
  const { dialog, text, bar, viewport } = value;
  assert(value.scrollWidth <= value.clientWidth + 1 && value.scrollHeight <= value.clientHeight + 1,
    `Bubble text must not clip/scroll: ${JSON.stringify(value)}`);
  assert(dialog.left >= -1 && dialog.top >= -1 && dialog.right <= viewport.width + 1
    && dialog.bottom <= viewport.height + 1 && value.pageOverflow <= 1, "Bubble/viewport overflow");
  assert(text.top >= dialog.top - 1 && text.bottom <= dialog.bottom + 1, "Text outside bubble");
  assert(value.glyphs.length > 0);
  for (const glyph of value.glyphs) {
    assert(glyph.left >= text.left - 1 && glyph.right <= text.right + 1
      && glyph.top >= text.top - 1 && glyph.bottom <= text.bottom + 1, "Visible glyph clipped by text region");
    assert(Math.min(glyph.right, bar.right) - Math.max(glyph.left, bar.left) <= 1
      || Math.min(glyph.bottom, bar.bottom) - Math.max(glyph.top, bar.top) <= 1, "Glyph overlaps quick bar");
  }
}
async function advance(page) {
  const before = await page.locator(".story-player").getAttribute("data-current-command-index");
  await page.locator(".dialog-box").press("Enter");
  await page.waitForFunction(before => document.querySelector(".story-player")?.dataset.currentCommandIndex !== before, before);
  await settled(page);
}
let server, browser, page;
(async () => {
  save();
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), port: 0,
    logFile: path.join(output, "vite.log") });
  report.owner = { pid: server.pid, runId: server.runId, url: server.url }; save();
  browser = await chromium.launch();
  for (const config of matrix) {
    const row = { ...config, status: "RUNNING", samples: [] }; report.cases.push(row); save();
    const context = await browser.newContext({ viewport: { width: config.width, height: config.height },
      deviceScaleFactor: config.dpr, hasTouch: config.deviceReplay,
      reducedMotion: config.reduced ? "reduce" : "no-preference",
      ...(config.deviceReplay ? { userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/148 Mobile Safari/537.36" } : {}) });
    page = await context.newPage();
    page.on("pageerror", error => report.errors.push(String(error)));
    try {
      if (config.deviceReplay) await page.addInitScript(() => {
        window.AgentVNViewport = { requestInsets() {
          window.dispatchEvent(new CustomEvent("agentvn:android-insets", { detail: {
            top: 74, right: 132, bottom: 84, left: 0, coordinateSpace: "physical", revision: 1 } }));
        } };
      });
      await page.goto(`${server.url}/?mode=preview`);
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
      await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: "native-bubble", revision: 1, requestId: "init", runId: "init", screen: "title_menu", ...payload }, "*"),
      { manifest, script, uiSkin, assetUrls });
      await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-state-playing").waitFor();
      await page.waitForFunction(() => !document.querySelector(".game-launch-blackout")
        && document.querySelector(".dialog-box")?.dataset.dialogBubbleAnchor === "character");
      await settled(page);
      for (const expectedAnchor of ["character", "character", "fallback"]) {
        const value = await measure(page); row.samples.push(value); save();
        assert.equal(value.anchor, expectedAnchor);
        await page.screenshot({ path: path.join(output,
          `${config.width}-${config.dpr}-${config.reduced}-${row.samples.length}.png`) });
        validate(value);
        if (row.samples.length < 3) await advance(page);
      }
      row.status = "PASS";
      console.log(`PASS ${config.width} DPR${config.dpr} reduced=${config.reduced}`);
    } catch (error) {
      row.status = "FAILED"; row.error = String(error.stack || error);
      await page.screenshot({ path: path.join(output, "failure.png") }); throw error;
    } finally { await context.close(); save(); }
  }
  assert.equal(report.cases.length, matrix.length);
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close(); await server?.stop();
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, output, error: report.error?.slice(0, 180) }));
});
