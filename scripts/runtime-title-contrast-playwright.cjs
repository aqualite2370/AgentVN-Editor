"use strict";
// Real production Runtime only; no Editor state or user project is opened.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { startProductionServer, fixture } = require("./android-webview-startup-playwright.cjs");
const root = path.resolve(__dirname, "..");
const legacy = process.argv.includes("--legacy"), smoke = process.argv.includes("--smoke");
let chromium;
if (legacy) {
  const tools = path.join(root, "output/compatibility-tools/legacy-chromium-playwright-1.8.1");
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(tools, "browsers");
  ({ chromium } = require(path.join(tools, "node_modules/playwright-chromium")));
} else ({ chromium } = require("../editor/node_modules/playwright"));
const out = path.join(root, "output/playwright/runtime-title-contrast", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "PRODUCTION_RUNTIME_TITLE_COLOR_NOT_INSTALLED_OR_ANDROID_ACCEPTANCE",
  startedAt: new Date().toISOString(), legacy, smoke, expectedCaseCount: smoke ? 5 : 60, cases: [], cleanup: {},
  sources: ["GameCli_framework/src/styles/shell.css", "GameCli_framework/src/styles/variables.css",
    "GameCli_framework/src/components/shell/MainMenu.tsx", "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
    "shared/cartridge/uiSkin.ts", "shared/cartridge/uiLayoutProfiles.ts",
    "scripts/runtime-title-contrast-playwright.cjs", "scripts/android-webview-startup-playwright.cjs"]
    .map(relative => ({ relative, sha256: require("node:crypto").createHash("sha256")
      .update(fs.readFileSync(path.join(root, relative))).digest("hex") })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const built = require("../editor/node_modules/esbuild").buildSync({
  stdin: { contents: 'export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";', resolveDir: root, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", built.outputFiles[0].text)(loaded, loaded.exports);
function payloadFor(kind) {
  const payload = fixture(kind === "renpy");
  if (kind !== "absent" && kind !== "renpy") payload.uiSkin = loaded.exports.getDefaultUISkinLayout();
  if (kind === "token") payload.uiSkin.tokens.colorInk = "#9de3c5";
  if (kind === "component") {
    const hero = payload.uiSkin.screens.find(s => s.screen_id === "title").components.find(c => c.component_type === "main_menu_hero");
    hero.style = { ...hero.style, color: "#ffc278" };
  }
  return payload;
}
function luminance(rgb) {
  const channels = rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
async function ready(page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="start-new-game"]');
    const seam = document.querySelector("[data-runtime-screen-transition]");
    if (!button || button.disabled || seam?.getAttribute("data-runtime-screen-transition") !== "idle"
      || document.querySelector(".boot-overlay, .game-launch-blackout")) return false;
    for (let n = button; n instanceof Element; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (+s.opacity < .99 || s.visibility === "hidden" || s.display === "none" || n.hasAttribute("inert")) return false;
    }
    const r = button.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }, null, { timeout: 20000 });
}
async function inspect(page, selector) {
  return page.$eval(selector, node => {
    const s = getComputedStyle(node), r = node.getBoundingClientRect();
    const scope = node.closest(".ui-skin-scope");
    return { color: s.color, fontSize: s.fontSize, rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      scopeInk: getComputedStyle(scope).getPropertyValue("--ink").trim(),
      ancestors: [node.parentElement, scope, scope.parentElement].map(n => ({ class: n.className, color: getComputedStyle(n).color })),
      actual: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
}
async function runCase(browser, owner, spec) {
  const row = { ...spec, status: "RUNNING", errors: [], blockedRequests: [] }; report.cases.push(row); save();
  const context = await browser.newContext({ viewport: spec.viewport, deviceScaleFactor: spec.dpr,
    reducedMotion: spec.reduced ? "reduce" : "no-preference" });
  try {
    const page = await context.newPage();
    // Playwright 1.8 ignores newContext.reducedMotion. Set the real engine's
    // media feature explicitly, then verify it rather than trusting the label.
    if (legacy) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", { features: [
        { name: "prefers-reduced-motion", value: spec.reduced ? "reduce" : "no-preference" },
      ] });
    }
    page.on("pageerror", error => row.errors.push(String(error.stack || error)));
    await context.route("**/*", route => {
      if (route.request().url().startsWith(owner.url + "/") || /^(data|blob):/.test(route.request().url())) return route.continue();
      row.blockedRequests.push(route.request().url()); return route.abort();
    });
    await owner.run(async () => {
      await page.goto(`${owner.url}/?mode=preview`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
      await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: "isolated-title-color", revision: 1, requestId: "init", runId: "init",
        screen: "title_menu", ...payload }, "*"), payloadFor(spec.kind));
      await ready(page);
      const selector = spec.kind === "renpy" ? ".renpy-title-heading h1" : ".menu-hero h1";
      row.before = await inspect(page, selector);
      assert.deepEqual(row.before.actual, { ...spec.viewport, dpr: spec.dpr, reduced: spec.reduced });
      row.screenshot = path.join(out, `${spec.id}.png`);
      await page.screenshot({ path: row.screenshot });
      row.afterCapture = await inspect(page, selector);
      assert.deepEqual(row.afterCapture.actual, { ...spec.viewport, dpr: spec.dpr, reduced: spec.reduced });
      const sharp = require("../GameCli_framework/node_modules/sharp");
      const pixel = await sharp(row.screenshot).removeAlpha().extract({
        left: Math.round(spec.viewport.width * spec.dpr * .04), top: Math.round(spec.viewport.height * spec.dpr * .3),
        width: 1, height: 1,
      }).raw().toBuffer();
      const rgb = row.before.color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const bg = [...pixel].slice(0, 3), fgL = luminance(rgb), bgL = luminance(bg);
      row.backgroundPixel = bg; row.contrast = (Math.max(fgL, bgL) + .05) / (Math.min(fgL, bgL) + .05);
      assert(row.contrast >= 3, `Large default title contrast ${row.contrast.toFixed(3)} < 3; ${row.before.color}`);
      if (spec.kind === "token") assert.equal(row.before.color, "rgb(157, 227, 197)", "Keep explicitly authored token");
      if (spec.kind === "component") assert.equal(row.before.color, "rgb(255, 194, 120)", "Keep explicit component override");
      assert.equal(row.before.overflow, false);
      const r = row.before.rect;
      assert(r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0
        && r.x + r.width <= spec.viewport.width + 1 && r.y + r.height <= spec.viewport.height + 1, "Title cropped or outside frame");
      await page.click('[data-testid="open-settings"]');
      await page.click('[data-testid="settings-finish"]');
      await ready(page);
      row.afterReturn = await inspect(page, selector);
      assert.equal(row.afterReturn.color, row.before.color, "Menu return must preserve authored/default colors");
      await page.click('[data-testid="start-new-game"]');
      await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.includes("仅用于启动诊断"));
      assert.equal(row.errors.length, 0); assert.equal(row.blockedRequests.length, 0);
      row.flow = "TITLE_COLOR_SETTINGS_RETURN_AND_START_PASS";
      row.status = "PASS";
    });
  } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); }
  finally { await context.close(); save(); }
}
async function main() {
  let owner, browser;
  try {
    owner = await startProductionServer();
    report.service = { url: owner.url, pid: owner.pid, runId: owner.runId };
    browser = await chromium.launch({ headless: true }); report.browser = browser.version();
    const viewports = smoke ? [[1920, 1080]] : require("./lib/current-acceptance-viewports.cjs").desktopViewports;
    matrix: for (const [width, height] of viewports) for (const dpr of smoke ? [1] : [1, 2])
      for (const reduced of smoke ? [process.argv.includes("--reduced")] : [false, true])
        for (const kind of ["absent", "default", "token", "component", "renpy"]) {
          await runCase(browser, owner, { id: `${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}-${kind}`,
            viewport: { width, height }, dpr, reduced, kind });
          if (report.cases.at(-1).status !== "PASS") break matrix;
        }
    assert.equal(report.cases.length, smoke ? 5 : 60);
    assert.equal(new Set(report.cases.map(c => c.id)).size, report.cases.length);
    for (const source of report.sources)
      assert.equal(require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(root, source.relative)))
        .digest("hex"), source.sha256, "Source changed during title acceptance");
    report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); }
  finally {
    if (browser) { await browser.close(); report.cleanup.browserClosed = true; }
    if (owner) { await owner.stop(); report.cleanup.serverStopped = true; report.served = [...owner.served.values()]; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, cases: report.cases.map(c => ({ id: c.id,
      status: c.status, color: c.before?.color, contrast: c.contrast, error: c.error })), error: report.error }, null, 2));
    process.exitCode = report.status === "PASS" ? 0 : 1;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
