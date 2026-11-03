"use strict";
// Diagnostic feedback loop for visible pixels after the same three preference
// round trips. Import exact native-test cartridges through real browser UI.
// No existing native/CDP connection or user profile is touched.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const sharp = require("../GameCli_framework/node_modules/sharp");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const options = process.argv.slice(3);
assert.equal(new Set(options).size, options.length);
assert(options.every(option => ["--production", "--original-wait"].includes(option)));
const production = options.includes("--production"), originalWait = options.includes("--original-wait");
const root = path.resolve(__dirname, "..");
const out = `F:/AgentVN/QA/Settings-Rendering-20261029-01/paint-${production ? "production" : "browser"}-${attempt}${originalWait ? "-original-wait" : ""}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const fixtureRoot = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/settings-effects-installed-1934-01";
const fixtures = ["agentvn", "renpy"].map(layout => {
  const file = path.join(fixtureRoot, `${layout}.vncart`);
  return { layout, path: file, sha256: sha(file) };
});
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: production
    ? "ISOLATED_PRODUCTION_BROWSER_EXACT_NATIVE_FIXTURE_PAINT_DIAGNOSTIC_NOT_NATIVE_OR_INSTALLED_ACCEPTANCE"
    : "ISOLATED_SOURCE_BROWSER_EXACT_NATIVE_FIXTURE_PAINT_DIAGNOSTIC_NOT_NATIVE_OR_INSTALLED_ACCEPTANCE",
  waitContract: originalWait ? "ORIGINAL_PAGE_IDLE_WITHOUT_GLOBAL_CURTAIN" : "PAGE_IDLE_AND_GLOBAL_CURTAIN_REMOVED",
  fixtures, cases: [], pageErrors: [], modelRequests: 0, productChanges: 0, builds: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let server, browser;
async function productionServer() {
  const { preview } = await import(require("node:url").pathToFileURL(
    path.join(root, "GameCli_framework/node_modules/vite/dist/node/index.js")).href);
  const runId = require("node:crypto").randomUUID(), ownerPath = `/__agentvn_paint_owner/${runId}`;
  const live = await preview({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), configLoader: "native",
    preview: { host: "127.0.0.1", port: 0, strictPort: true, open: false },
    plugins: [{ name: "agentvn-paint-preview-owner", configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== ownerPath) return next();
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ pid: process.pid, runId }));
      });
    } }] });
  const address = live.httpServer.address(); assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const owner = { pid: process.pid, runId, url,
    async assertAlive() {
      const response = await fetch(url + ownerPath, { signal: AbortSignal.timeout(3000) });
      assert(response.ok); assert.deepEqual(await response.json(), { pid: process.pid, runId });
    },
    async stop() {
      live.httpServer.closeAllConnections?.();
      await new Promise((resolve, reject) => live.httpServer.close(error => error ? reject(error) : resolve()));
    } };
  try {
    await owner.assertAlive();
    const dist = path.join(root, "GameCli_framework/dist");
    report.productionFiles = fs.readdirSync(dist, { recursive: true }).filter(p => fs.statSync(path.join(dist, p)).isFile())
      .map(p => ({ path: path.join(dist, p), sha256: sha(path.join(dist, p)) }));
    return owner;
  } catch (error) { await owner.stop(); throw error; }
}
async function ready(page, screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.dataset.runtimePresentedScreen === screen && n.dataset.runtimeScreenTransition === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"],.boot-overlay');
  }, screen);
}
async function playing(page) {
  const state = await page.locator("[data-runtime-presented-screen]").getAttribute("data-runtime-presented-screen");
  if (state === "main_menu") {
    await page.getByTestId("continue-game").click(); await ready(page, "playing");
  } else if (!originalWait) await ready(page, "playing");
}
async function settings(page, layout, name, value) {
  if (layout === "renpy") await page.getByTestId("renpy-quick-settings").click();
  else {
    await page.keyboard.press("Escape"); await ready(page, "main_menu");
    await page.getByTestId("open-settings").click();
  }
  await ready(page, "settings");
  await page.locator(".settings-tabs").getByRole("button", { name: "显示", exact: true }).click();
  await page.locator('[data-settings-tab-current="display"]').waitFor();
  if (typeof value === "boolean") await page.getByRole("checkbox", { name, exact: true }).setChecked(value);
  else {
    const slider = page.getByRole("slider", { name, exact: true });
    await slider.focus(); await slider.press("Home");
    for (let i = 0; i < (name === "Font scale" ? 12 : 9); i++) await slider.press("ArrowRight");
    assert.equal(Number(await slider.inputValue()), value);
  }
  await page.getByTestId("settings-finish").click();
  await page.waitForFunction(() => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.dataset.runtimeScreenTransition === "idle"
      && ["playing", "main_menu", "title_menu"].includes(n.dataset.runtimePresentedScreen);
  });
  await playing(page);
}
async function probe(page) {
  return page.locator(".dialog-text").evaluate(n => {
    const ancestors = [];
    for (let p = n; p instanceof Element; p = p.parentElement) {
      const s = getComputedStyle(p);
      ancestors.push({ tag: p.tagName, className: p.className, opacity: Number(s.opacity),
        filter: s.filter, visibility: s.visibility, display: s.display });
    }
    const range = document.createRange(); range.selectNodeContents(n);
    const transition = document.querySelector("[data-runtime-screen-transition]");
    const pseudo = transition && getComputedStyle(transition, "::before");
    return { text: n.textContent, color: getComputedStyle(n).color,
      rect: n.getBoundingClientRect().toJSON(), textRects: [...range.getClientRects()].map(r => r.toJSON()),
      ancestors, cumulativeOpacity: ancestors.reduce((v, a) => v * a.opacity, 1),
      transition: { phase: transition?.dataset.runtimeTransitionPhase,
        screen: transition?.dataset.runtimePresentedScreen, style: transition?.dataset.runtimeTransitionStyle,
        pseudoOpacity: pseudo?.opacity, pseudoBackground: pseudo?.backgroundColor },
      launchBlackout: Boolean(document.querySelector('[data-testid="game-launch-blackout"]')),
      launchCurtainOpacity: document.querySelector('[data-testid="game-launch-blackout"]')
        ? getComputedStyle(document.querySelector('[data-testid="game-launch-blackout"]')).opacity : null,
      modalCount: document.querySelectorAll('[role="dialog"]').length,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      animations: document.getAnimations().map(a => ({ playState: a.playState,
        target: a.effect?.target?.className, pseudo: a.effect?.pseudoElement,
        progress: a.effect?.getComputedTiming().progress })) };
  });
}
async function capture(page, file) {
  const before = await probe(page);
  await page.screenshot({ path: file, animations: "allow", caret: "initial" });
  const after = await probe(page), bytes = fs.readFileSync(file);
  assert.deepEqual(after.viewport, before.viewport);
  assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
  const rect = before.textRects[0];
  const region = { left: Math.ceil(rect.left), top: Math.ceil(rect.top),
    width: Math.floor(rect.right) - Math.ceil(rect.left), height: Math.floor(rect.bottom) - Math.ceil(rect.top) };
  const { data, info } = await sharp(file).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let maxChannel = 0;
  for (let i = 0; i < data.length; i += info.channels)
    maxChannel = Math.max(maxChannel, data[i], data[i + 1], data[i + 2]);
  return { path: file, sha256: sha(file), before, after, region, maxChannel };
}
(async () => {
  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  server = production ? await productionServer() : await startOwnedViteServer({
    root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, runId: server.runId, url: server.url }; save();
  browser = await chromium.launch();
  for (const fixture of fixtures) {
    await server.assertAlive();
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
      reducedMotion: "no-preference" });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on("pageerror", e => { report.pageErrors.push(String(e)); save(); });
    const c = { layout: fixture.layout, status: "RUNNING", changes: [] }; report.cases.push(c); save();
    try {
      await page.goto(`${server.url}/?mode=library`);
      await page.getByTestId("game-state-library").waitFor();
      await page.getByTestId("web-cartridge-file").setInputFiles(fixture.path);
      await page.locator(".cartridge-spine").first().click();
      await page.getByRole("button", { name: "启动卡带", exact: true }).click(); await ready(page, "title_menu");
      await page.getByTestId("start-new-game").click(); await ready(page, "playing");
      await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
      await page.locator(".dialog-box").click();
      await page.getByRole("button", { name: "选择：display", exact: true }).click();
      await page.waitForFunction(() => {
        const n = document.querySelector('[data-testid="game-state-playing"]');
        return n?.dataset.currentSceneId === "display" && n.dataset.currentCommandIndex === "0";
      });
      await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
      c.initial = await probe(page); save();
      for (const [name, value] of [["Font scale", 1.35], ["Line spacing", 1.25], ["High contrast text", true]]) {
        await settings(page, fixture.layout, name, value);
        c.changes.push({ name, value, rendered: await probe(page) }); save();
      }
      c.atReady = await capture(page, path.join(out, `${fixture.layout}-ready.png`)); save();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      c.afterPresentedFrames = await capture(page, path.join(out, `${fixture.layout}-two-frames.png`)); save();
      assert.equal(c.atReady.before.color, "rgb(255, 255, 255)");
      assert(!c.atReady.before.launchBlackout, "Page idle precedes the separate global curtain completion");
      assert(c.atReady.maxChannel >= 200, `White body pixels are dim at ready: ${c.atReady.maxChannel}`);
      assert(c.afterPresentedFrames.maxChannel >= 200,
        `White body pixels remain dim after two real frames: ${c.afterPresentedFrames.maxChannel}`);
      c.status = "PASS";
    } catch (e) {
      c.status = "FAILED"; c.error = String(e.stack || e);
    } finally {
      c.finishedAt = new Date().toISOString(); save(); await context.close();
      console.log(JSON.stringify({ layout: c.layout, status: c.status,
        pixelsAtReady: c.atReady?.maxChannel, pixelsAfterFrames: c.afterPresentedFrames?.maxChannel, error: c.error }));
    }
  }
  assert.equal(report.cases.length, 2); assert.deepEqual(report.pageErrors, []);
  assert(report.cases.every(c => c.status === "PASS"));
  for (const fixture of fixtures) assert.equal(sha(fixture.path), fixture.sha256);
  for (const file of report.productionFiles ?? []) assert.equal(sha(file.path), file.sha256);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    await browser?.close(); await server?.stop();
    let responds = false;
    if (server) try { responds = (await fetch(server.url, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    assert(!responds); report.cleanup = { status: "PASS", isolatedBrowserClosed: true, ownedServerResponds: false };
  } catch (e) { report.status = "FAILED"; report.cleanup = { status: "FAILED", error: String(e.stack || e) }; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cleanup: report.cleanup, error: report.error }));
});
