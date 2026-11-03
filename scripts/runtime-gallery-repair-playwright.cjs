"use strict";
// Actual browser library import + public navigation; no store/API/native mocks.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Runtime-Gallery-Repair-20261020-01";
const name = process.argv[2] || "browser-01"; assert(/^browser-\d{2}$/.test(name));
const matrix = process.argv.includes("--matrix"), reducedCases = process.argv.includes("--reduced");
const rollbackRequired = process.argv.includes("--rollback");
const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const sources = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Native-Runtime-State-20261020-01/gallery-02/report.json", "utf8"));
const report = { status: "RUNNING", at: new Date().toISOString(),
  scope: "SOURCE_BROWSER_REAL_LIBRARY_IMPORT_NOT_NATIVE_INSTALL", cases: [], matrix: [],
  screenshots: [], pageErrors: [], realModelRequests: 0, rollbackRequired, error: null, cleanupError: null };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let server, browser;
async function ready(page, screen) {
  await page.waitForFunction(s => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === s
      && n.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen);
  await settleRuntime(page);
}
async function command(page, index) {
  await page.waitForFunction(i => {
    const n = document.querySelector('[data-testid="game-state-playing"]');
    return n?.getAttribute("data-current-scene-id") === "qa_gallery"
      && Number(n.getAttribute("data-current-command-index")) === i
      && document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true";
  }, index);
}
async function back(page, layout, screen) {
  await page.getByTestId(layout === "renpy" ? "renpy-menu-return" : "back-to-main-menu").click();
  await ready(page, screen);
}
async function shot(page, file) {
  const before = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const target = path.join(out, file);
  const bytes = await page.screenshot({ path: target });
  const after = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  assert.deepEqual(before, after);
  assert.equal(bytes.readUInt32BE(16), before.width * before.dpr);
  assert.equal(bytes.readUInt32BE(20), before.height * before.dpr);
  report.screenshots.push({ path: target, sha256: sha(target), before, after }); save();
}
async function gallery(page) {
  await page.keyboard.press("Escape"); await ready(page, "main_menu");
  await page.getByTestId("open-gallery").click(); await ready(page, "gallery");
}
async function start(page, cartridge, layout) {
  assert.equal(sha(cartridge.path), cartridge.sha256);
  await page.goto(`${server.url}/?mode=library`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByTestId("game-state-library").waitFor({ timeout: 45000 });
  await page.getByTestId("web-cartridge-file").setInputFiles(cartridge.path);
  await page.locator(".cartridge-spine").first().waitFor();
  await page.locator(".cartridge-spine").first().click();
  await page.getByRole("button", { name: "启动卡带", exact: true }).click(); await ready(page, "title_menu");
  await page.getByTestId("open-gallery").click(); await ready(page, "gallery");
  assert(await page.getByTestId("gallery-item-qa_gallery_anchor").locator("button").first().isDisabled());
  await back(page, layout, "title_menu");
  await page.getByTestId("start-new-game").click(); await ready(page, "playing"); await command(page, 0);
  if (layout === "renpy") await page.getByTestId("renpy-quick-settings").click();
  else { await page.keyboard.press("Escape"); await ready(page, "main_menu"); await page.getByTestId("open-settings").click(); }
  await ready(page, "settings");
  await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
  await page.locator('[data-settings-tab-current="system"]').waitFor();
  await page.getByRole("checkbox", { name: "自动存档", exact: true }).setChecked(false);
  await page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
  await page.locator('[data-settings-tab-current="text"]').waitFor();
  await page.getByRole("slider", { name: "Text speed", exact: true }).focus(); await page.keyboard.press("Home");
  await page.getByTestId("settings-finish").click();
  await ready(page, layout === "renpy" ? "playing" : "main_menu");
  if (layout !== "renpy") { await page.getByTestId("continue-game").click(); await ready(page, "playing"); }
  await command(page, 0); await page.locator(".dialog-box").click(); await command(page, 2);
  await gallery(page);
  await page.waitForFunction(() => !document.querySelector('[data-testid="gallery-item-qa_gallery_anchor"] button')?.disabled);
}
async function dimensions(page) {
  return page.getByTestId("gallery-screen").evaluate(panel => {
    const controls = [...panel.querySelectorAll("button")].filter(n => n.getBoundingClientRect().width > 0);
    return { overflow: document.documentElement.scrollWidth - innerWidth,
      controls: controls.map(n => { const r = n.getBoundingClientRect();
        return { rect: r.toJSON(), label: n.getAttribute("aria-label") || n.textContent, disabled: n.disabled,
          hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; }) };
  });
}
async function runCase(layout, broken, reduced) {
  const row = { layout, broken, reduced, status: "RUNNING" }; report.cases.push(row); save();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const cdp = await context.newCDPSession(page);
  page.on("pageerror", e => report.pageErrors.push({ layout, broken, error: String(e) }));
  try {
    const cartridge = (broken ? sources.brokenCartridges : sources.cartridges).find(c => c.layout === layout);
    row.cartridge = { path: cartridge.path, sha256: cartridge.sha256 };
    await start(page, cartridge, layout);
    if (broken) {
      const error = page.getByTestId("gallery-resource-error");
      // Record genuine image failure before requiring the missing user feedback.
      row.initial = await page.locator(".gallery-item img").evaluate(img => ({ complete: img.complete,
        width: img.naturalWidth, height: img.naturalHeight }));
      await shot(page, `${layout}-${reduced}-broken.png`);
      await error.waitFor({ state: "visible" }); assert.match(await error.innerText(), /无法加载|失败|损坏/);
      await page.getByRole("button", { name: "重试加载画廊图片", exact: true }).click();
      await error.waitFor({ state: "visible" }); row.retryDiagnostic = await error.innerText();
      await back(page, layout, "main_menu");
      await page.getByTestId("continue-game").click(); await ready(page, "playing"); await command(page, 2);
      row.originalStoryStillPlayable = true;
    } else {
      await page.locator(".gallery-item img").evaluate(img => img.decode());
      if (matrix && !reduced) for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduce of [false, true]) {
        const cell = { layout, width, height: width * 9 / 16, dpr, reduced: reduce, status: "RUNNING" };
        report.matrix.push(cell); save();
        // Read actual metrics after CDP override; resize alone cannot change DPR.
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: width * 9 / 16, deviceScaleFactor: dpr, mobile: false });
        await page.emulateMedia({ reducedMotion: reduce ? "reduce" : "no-preference" });
        const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
        assert.deepEqual(actual, { width, height: width * 9 / 16, dpr });
        cell.geometry = await dimensions(page); assert(cell.geometry.overflow <= 1 && cell.geometry.controls.length > 0);
        for (const b of cell.geometry.controls) assert(b.hit && b.rect.x >= -1 && b.rect.y >= -1
          && b.rect.right <= width + 1 && b.rect.bottom <= width * 9 / 16 + 1);
        cell.status = "PASS"; save();
      }
      if (matrix && !reduced) {
        await cdp.send("Emulation.clearDeviceMetricsOverride");
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      const original = await page.locator(".gallery-item img").evaluate(async img =>
        Array.from(new Uint8Array(await (await fetch(img.currentSrc)).arrayBuffer())));
      assert.equal(crypto.createHash("sha256").update(Buffer.from(original)).digest("hex"), cartridge.art.sha256);
      for (const kind of ["manual-exit", "scene-end"]) {
        await page.getByRole("button", { name: "读取画廊-本轮画廊图", exact: true }).click();
        await ready(page, "playing"); await command(page, 0);
        if (kind === "manual-exit") await page.keyboard.press("Escape");
        else {
          await page.locator(".dialog-box").click(); await command(page, 2);
          await page.locator(".dialog-box").click();
        }
        await ready(page, "gallery");
        await shot(page, `${layout}-${reduced}-${kind}.png`);
        await back(page, layout, "main_menu");
        await page.getByTestId("continue-game").click(); await ready(page, "playing"); await command(page, 2);
        assert((await page.locator(".dialog-box").innerText()).includes("GALLERY_AFTER"));
        if (rollbackRequired) {
          await page.keyboard.press("PageUp"); await command(page, 0);
          assert((await page.locator(".dialog-box").innerText()).includes("GALLERY_OPENING"));
          await page.keyboard.press("PageDown"); await command(page, 2);
          assert((await page.locator(".dialog-box").innerText()).includes("GALLERY_AFTER"));
          (row.rollbackRoundTrips ??= []).push(kind);
        }
        (row.restored ??= []).push(kind); await gallery(page);
      }
    }
    row.status = "PASS";
  } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  finally { await context.close(); save(); }
  console.log(`${row.status}: ${layout}/${broken ? "image" : "return"}/${reduced ? "reduced" : "normal"}`);
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, path.basename(__filename)), fs.constants.COPYFILE_EXCL);
  process.env.AGENTVN_TEST_PROJECT = sources.isolation.AGENTVN_TEST_PROJECT;
  process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  report.isolation = { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: out };
  report.productSources = ["GameCli_framework/src/store/runtimeStore.ts", "GameCli_framework/src/components/shell/GalleryScreen.tsx",
    "GameCli_framework/src/styles/shell.css", "GameCli_framework/src/engine/StoryEngine.ts"]
    .map(f => ({ path: path.join(root, f), sha256: sha(path.join(root, f)) }));
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, runId: server.runId, url: server.url }; save();
  browser = await chromium.launch({ headless: true });
  await server.run(async () => {
    for (const layout of ["agentvn", "renpy"]) for (const reduced of reducedCases ? [false, true] : [false])
      for (const broken of rollbackRequired ? [false] : [false, true]) await runCase(layout, broken, reduced);
  });
  report.status = report.cases.length === (reducedCases ? 8 : 4) / (rollbackRequired ? 2 : 1)
    && report.cases.every(c => c.status === "PASS"
      && (!rollbackRequired || c.rollbackRoundTrips?.length === 2))
    && report.matrix.length === (matrix ? 24 : 0) && report.matrix.every(c => c.status === "PASS")
    && !report.pageErrors.length ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try { await browser?.close(); await server?.stop(); report.ownedServiceStopped = true; }
  catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out }));
  if (report.status !== "PASS") process.exitCode = 1;
});
