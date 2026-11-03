"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { root, out, qa, sha } = require("./layout-resources-source-test.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const exportedFile = process.env.AGENTVN_RESOURCES_GREEN; assert(exportedFile);
const exported = read(exportedFile); assert.equal(exported.status, "PASS");
const output = process.env.AGENTVN_RESOURCES_PLAYER_OUTPUT; assert(output && !fs.existsSync(output));
const smoke = process.argv.includes("--smoke"), prep = read(path.join(out, "preparation.json"));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(prep.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), path.resolve(output));
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", at: new Date().toISOString(), source: { path: exportedFile, sha256: sha(fs.readFileSync(exportedFile)) },
  scope: "Source Runtime browser; actual file-input cartridge importer, library and story engine. NOT installed/standalone/Android",
  cases: [], modelRequests: 0, testSha256: sha(fs.readFileSync(__filename)),
  sources: ["GameCli_framework/src/uiSkin/uiSkinRuntime.tsx", "GameCli_framework/src/components/shell/MainMenu.tsx",
    "GameCli_framework/src/app/App.tsx", "GameCli_framework/src/store/runtimeStore.ts",
    "GameCli_framework/src/cartridge/desktopLibrary.ts", "shared/cartridge/unpacker.ts"]
    .map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })) };
let browser, server;
async function ready(page, screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.dataset.runtimePresentedScreen === screen && n.dataset.runtimeTransitionPhase === "idle"
      && !document.querySelector(".game-launch-blackout");
  }, screen);
}
async function actualBytes(locator, background = false) {
  const actual = await locator.evaluate(async (node, background) => {
    const url = background ? getComputedStyle(node).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]
      : node.currentSrc || node.src;
    if (!url) throw Error("Displayed asset URL missing");
    const r = await fetch(url); if (!r.ok) throw Error(`Asset HTTP ${r.status}`);
    return { kind: url.split(":")[0], bytes: [...new Uint8Array(await r.arrayBuffer())] };
  }, background);
  return { sha256: sha(Buffer.from(actual.bytes)), bytes: actual.bytes.length, kind: actual.kind };
}
(async () => {
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(output, "vite.log") });
  report.service = { url: server.url, pid: server.pid, runId: server.runId };
  browser = await chromium.launch();
  for (const c of smoke ? exported.cases.slice(0, 1) : exported.cases) for (const type of ["agentvn", "renpy"]) {
    const artifact = c.cartridges.find(a => a.type === type);
    assert.equal(sha(fs.readFileSync(artifact.path)), artifact.sha256);
    const item = { key: `${c.key}-${type}`, width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced,
      type, artifact, status: "RUNNING", checks: [], pageErrors: [] }; report.cases.push(item);
    const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dpr,
      reducedMotion: c.reduced ? "reduce" : "no-preference" });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on("pageerror", e => item.pageErrors.push(String(e)));
    try {
      await server.run(async () => {
        await page.goto(`${server.url}/?mode=library`);
        await page.getByTestId("web-cartridge-file").setInputFiles(artifact.path);
        await page.getByRole("button", { name: "启动卡带", exact: true }).click();
        await ready(page, "title_menu"); await settleRuntime(page);
        const hero = page.locator(".main-menu-title-hero-background:visible").first();
        await hero.waitFor();
        const image = await actualBytes(hero, true);
        const expected = prep.resources.find(r => r.role === `${type === "agentvn" ? "agent" : "renpy"}-only`);
        assert.equal(image.sha256, expected.sha256);
        item.checks.push({ name: "actual-file-import-and-active-title-image-bytes", status: "PASS", image });
        const start = page.getByTestId("start-new-game");
        await start.focus(); await start.click({ trial: true });
        item.geometry = await start.evaluate(n => {
          const r = n.getBoundingClientRect();
          return { rect: r.toJSON(), hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
            focused: document.activeElement === n, clipped: n.scrollWidth > n.clientWidth + 1,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        const g = item.geometry; assert(g.hit && g.focused && !g.clipped && g.overflow <= 1);
        assert(g.rect.left >= -1 && g.rect.top >= -1 && g.rect.right <= c.width + 1 && g.rect.bottom <= c.height + 1);
        item.checks.push({ name: "actual-title-button-focus-hit-bounds-and-overflow", status: "PASS" });
        item.screenshot = await captureSourceBrowser(page, path.join(output, `${item.key}.png`),
          { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
        await start.click(); await ready(page, "playing");
        const story = page.getByTestId("focused-image"); await story.waitFor();
        await page.waitForFunction(() => {
          const n = document.querySelector('[data-testid="focused-image"]'); return n?.complete && n.naturalWidth > 0;
        });
        const actual = await actualBytes(story);
        assert.equal(actual.sha256, prep.resources.find(r => r.role === "story-protected").sha256);
        await page.getByTestId("focused-image-overlay").click();
        await page.waitForFunction(() => document.querySelector(".dialog-box")?.textContent.includes("RESOURCE_STORY"));
        item.checks.push({ name: "protected-story-image-decoded-and-original-narration-reached", status: "PASS", actual });
        assert.deepEqual(item.pageErrors, []);
      });
      item.status = "PASS";
    } catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); }
    finally {
      await context.close(); console.log(JSON.stringify({ key: item.key, status: item.status, error: item.error }));
      fs.writeFileSync(path.join(output, "progress.json"), JSON.stringify(report, null, 2));
    }
  }
  assert.equal(report.cases.length, smoke ? 2 : 24);
  assert(report.cases.every(c => c.status === "PASS" && c.checks.length === 3));
  for (const s of report.sources) assert.equal(sha(fs.readFileSync(path.join(root, s.file))), s.sha256);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await server?.stop();
  let responds = false;
  if (server) { try { responds = (await fetch(server.url, { signal: AbortSignal.timeout(1000) })).ok; } catch {} }
  report.cleanup = { status: responds ? "FAILED" : "PASS", responds };
  if (responds) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output }));
});
