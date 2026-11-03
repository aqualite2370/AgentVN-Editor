"use strict";
// Actual Runtime + public live-preview protocol inside an Editor-sized pane.
// The HOST stays >=1080p; 416x209 is the reproduced internal node-preview size.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Runtime-Dialog-Measurement-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const fullMatrix = process.argv.includes("--matrix");
const out = path.join(qa, `browser-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const original = read("F:/AgentVN/QA/Installed-Portrait-20261021-01/editor-03/report.json");
const checkpoint = "F:/AgentVN/Checkpoints/Runtime-Dialog-Measurement-20261021-01";
if (!fs.existsSync(checkpoint)) {
  fs.mkdirSync(checkpoint, { recursive: true });
  const files = ["GameCli_framework/src/styles/player.css", "GameCli_framework/src/components/player/DialogBox.tsx",
    "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"];
  const sources = files.map(file => {
    const target = path.join(checkpoint, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(target), sha(path.join(root, file)));
    return { file, path: target, sha256: sha(target) };
  });
  fs.writeFileSync(path.join(checkpoint, "checkpoint.json"), JSON.stringify({
    at: new Date().toISOString(), sources, devSha256: sha(path.join(root, "AgentVN Dev.exe")),
    note: "Affected-file recoverable checkpoint preserves pre-existing dirty contents; no Git reset/clean",
  }, null, 2), { flag: "wx" });
}
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "SOURCE_BROWSER_ACTUAL_RUNTIME_COMPACT_NODE_PREVIEW_SEAM_NOT_INSTALLED_ACCEPTANCE",
  checkpoint, cases: [], errors: [], sourceFiles: ["GameCli_framework/src/styles/player.css",
    "GameCli_framework/src/components/player/DialogBox.tsx"].map(file => ({ path: path.join(root, file), sha256: sha(path.join(root, file)) })),
  modelRequests: 0, fullMatrix };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let server, browser;
async function runCase(profile, width, dpr, reduced, pane, variant = "boundary") {
  const row = { profile: profile.type, width, height: width * 9 / 16, dpr, reduced, pane, variant, status: "RUNNING" };
  report.cases.push(row); save();
  const context = await browser.newContext({ viewport: { width, height: row.height },
    deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on("pageerror", e => { report.errors.push({ case: report.cases.length - 1, error: String(e), stack: e.stack }); save(); });
  page.on("console", msg => {
    if (msg.type() === "error") (row.consoleErrors ??= []).push(msg.text().slice(0, 2000));
    if (/Maximum update depth/.test(msg.text())) {
      (row.reactWarnings ??= []).push(msg.text()); save();
    }
  });
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(profile.path), { checkCRC32: true });
    assert.equal(sha(profile.path), profile.sha256);
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const script = JSON.parse(await zip.file("script.json").async("string"));
    const dialog = script.scenes.find(s => s.scene_id === script.entry_scene_id).commands[0];
    assert.equal(dialog.type, "dialog");
    if (variant !== "boundary") dialog.text = dialog.text.repeat(variant === "adaptive" ? 8 : 80);
    row.expectedText = dialog.text;
    const uiSkin = JSON.parse(await zip.file("ui/layout.json").async("string"));
    const assets = Object.fromEntries(await Promise.all(manifest.assets.map(async a =>
      [a.asset_id, `data:${a.mime_type};base64,${(await zip.file(a.path).async("nodebuffer")).toString("base64")}`])));
    await context.route(`${server.url}/qa-parent`, route => route.fulfill({ contentType: "text/html",
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
        <h1>Isolated node-preview measurement regression</h1>
        <iframe title="controlled node preview" style="border:0;width:${pane.width}px;height:${pane.height}px"></iframe>
        <script>window.responses=[];addEventListener("message",e=>{if(e.source===document.querySelector("iframe").contentWindow)responses.push(e.data)})</script>
        </body></html>` }));
    await page.goto(`${server.url}/qa-parent`);
    const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
    assert.deepEqual(actual, { width, height: row.height, dpr, reduced }); row.actual = actual;
    const target = page.locator("iframe");
    await target.evaluate((n, url) => { n.src = url; }, `${server.url}/?preview=1&embedded=1`);
    const element = await target.elementHandle();
    const runtime = await element.contentFrame(); assert(runtime);
    await runtime.waitForURL(`${server.url}/?preview=1&embedded=1`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => window.responses.some(m =>
      m.type === "agentvn.live-preview.ready" && m.sessionId === "runtime-boot"));
    const requestId = `dialog-measure-${report.cases.length}`, sessionId = requestId;
    await page.evaluate(({ manifest, script, uiSkin, assets, requestId, sessionId }) => {
      document.querySelector("iframe").contentWindow.postMessage({
        type: "agentvn.live-preview.init", protocolVersion: 2, sessionId, revision: 1, requestId, runId: requestId,
        manifest, script, uiSkin, assetUrls: assets, screen: "playing",
        start: { requestId, target: { sceneId: script.entry_scene_id, commandIndex: 0 },
          entryPath: [], mode: "stable_frame", playbackRate: 1, reducedMotion: true },
      }, location.origin);
    }, { manifest, script, uiSkin, assets, requestId, sessionId });
    await runtime.locator(".dialog-box").waitFor();
    row.samples = await runtime.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const box = document.querySelector(".dialog-box"), text = document.querySelector(".dialog-text");
        if (!box || !text) throw Error("Runtime lost the active dialogue");
        samples.push({ pages: Number(box.getAttribute("data-dialog-pages")), page: box.getAttribute("data-dialog-page"),
          font: getComputedStyle(text).fontSize, clientWidth: text.clientWidth,
          width: text.getBoundingClientRect().width, gutter: getComputedStyle(text).scrollbarGutter,
          scroll: [text.scrollWidth, text.scrollHeight], client: [text.clientWidth, text.clientHeight],
          text: text.textContent });
      }
      return samples;
    });
    assert.equal(new Set(row.samples.slice(-10).map(s => JSON.stringify(s))).size, 1, "Dialogue measurement must converge");
    assert.equal(row.samples.at(-1).clientWidth, Math.round(row.samples.at(-1).width), "Pagination cannot change a scrollbar gutter");
    assert(row.samples.every(s => s.scroll[0] <= s.client[0] + 1 && s.scroll[1] <= s.client[1] + 1),
      "Measured dialogue page cannot clip or overflow");
    if (variant === "adaptive") {
      assert.equal(row.samples.at(-1).pages, 1);
      assert(parseFloat(row.samples.at(-1).font) < 27.6);
    }
    if (variant === "extreme") assert(row.samples.at(-1).pages > 1);
    assert.equal(report.errors.filter(e => e.case === report.cases.length - 1).length, 0, "No real React render exceptions");
    assert.equal(row.reactWarnings?.length ?? 0, 0);
    if (width === 1920 && dpr === 1 && !reduced && pane.width === 416) {
      const before = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
      const targetPath = path.join(out, `${profile.type}-compact.png`);
      const png = await page.screenshot({ path: targetPath });
      assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]), before);
      assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), row.height * dpr);
      row.screenshot = { path: targetPath, sha256: sha(targetPath), actual: before };
    }
    row.pages = [];
    const pageCount = row.samples.at(-1).pages;
    assert(pageCount > 0 && pageCount <= 100, "Non-empty bounded actual pagination");
    for (let i = 0; i < pageCount; i++) {
      const observed = await runtime.locator(".dialog-box").evaluate(n => {
        const text = n.querySelector(".dialog-text");
        return { index: Number(n.getAttribute("data-dialog-page")), count: Number(n.getAttribute("data-dialog-pages")),
          text: text.textContent, font: getComputedStyle(text).fontSize,
          scroll: [text.scrollWidth, text.scrollHeight], client: [text.clientWidth, text.clientHeight] };
      });
      assert.equal(observed.index, i + 1); assert.equal(observed.count, pageCount);
      assert.equal(observed.font, row.samples.at(-1).font);
      assert(observed.scroll[0] <= observed.client[0] + 1 && observed.scroll[1] <= observed.client[1] + 1);
      row.pages.push(observed);
      await runtime.locator(".dialog-box").click();
    }
    assert.equal(row.pages.map(p => p.text).join(""), dialog.text, "Every source byte stays reachable through pages");
    await runtime.locator(".dialog-box").waitFor();
    row.afterClick = await runtime.locator(".dialog-box").evaluate(n => ({
      pages: n.getAttribute("data-dialog-pages"), page: n.getAttribute("data-dialog-page"),
      command: n.closest("[data-current-command-index]")?.getAttribute("data-current-command-index"),
    }));
    assert.equal(row.afterClick.command, "1", "Real pointer progression reaches the next authored command");
    row.status = "PASS";
  } catch (e) {
    row.status = "FAILED"; row.error = String(e.stack || e);
    row.responses = await page.evaluate(() => window.responses).catch(String);
    row.frames = [];
    for (const frame of page.frames()) row.frames.push({
      url: frame.url(), body: await frame.locator("body").innerText().catch(String),
    });
    throw e;
  } finally { await context.close(); save(); }
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "vite.log") });
  report.service = { url: server.url, pid: server.pid, runId: server.runId }; save();
  browser = await chromium.launch({ headless: true });
  await server.run(async () => {
    for (const profile of original.cartridges)
      for (const width of fullMatrix ? [1920, 2560, 3840] : [1920])
        for (const dpr of fullMatrix ? [1, 2] : [1])
          for (const reduced of [false, true])
            for (const pane of [{ width: 416, height: 209.1875 }, { width: 1280, height: 720 }])
              await runCase(profile, width, dpr, reduced, pane);
    for (const profile of original.cartridges) for (const reduced of [false, true])
      for (const variant of ["adaptive", "extreme"])
        await runCase(profile, 1920, 1, reduced, { width: 1280, height: 720 }, variant);
  });
  assert.equal(report.cases.length, fullMatrix ? 56 : 16);
  assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    try { await browser?.close(); await server?.stop(); report.cleanup = "OWNED_BROWSER_AND_SERVICE_STOPPED"; }
    catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, errors: report.errors.length, error: report.error }));
  });
