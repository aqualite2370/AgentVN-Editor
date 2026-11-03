"use strict";
// Current source Runtime, real preference controls, official live-preview input.
// No store writes. Covers ordinary/NVL/bubble and explicit author font/color.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, ".."), [attempt, option] = process.argv.slice(2);
assert.match(attempt || "", /^[a-z0-9-]+$/); assert(!option || option === "--matrix");
const out = `F:/AgentVN/QA/Settings-Rendering-20261029-01/${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const compiled = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(compiled, compiled.exports);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "SOURCE_RUNTIME_REAL_PREFERENCE_EFFECTS_LIVE_PREVIEW_NOT_NATIVE_OR_INSTALLED",
  cases: [], screenshots: [], pageErrors: [], modelRequests: 0,
  sources: ["GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/styles/player.css",
    "GameCli_framework/src/store/runtimePreferences.ts", __filename].map(p => ({ path: path.resolve(p), sha256: sha(p) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let server, browser;
async function ready(page, screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.dataset.runtimePresentedScreen === screen && n.dataset.runtimeScreenTransition === "idle"
      && !document.querySelector(".game-launch-blackout,.boot-overlay");
  }, screen);
}
async function readText(page, mode) {
  return page.locator(mode === "nvl" ? '[data-nvl-current="true"] .nvl-page-text' : ".dialog-text").evaluate(n => {
    const s = getComputedStyle(n), r = n.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(n);
    const region = n.closest(".nvl-page") ?? n;
    return { font: parseFloat(s.fontSize), line: parseFloat(s.lineHeight), color: s.color, shadow: s.textShadow,
      text: n.textContent, rect: r.toJSON(), lines: [...range.getClientRects()].map(r => r.toJSON()),
      region: region.getBoundingClientRect().toJSON(),
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
async function displayPreferences(page, layout, scaled) {
  if (layout === "renpy") await page.getByTestId("renpy-quick-settings").click();
  else { await page.keyboard.press("Escape"); await ready(page, "main_menu"); await page.getByTestId("open-settings").click(); }
  await ready(page, "settings");
  for (const [name, value, steps] of [["Font scale", scaled ? 1.35 : 1, scaled ? 12 : 5],
    ["Line spacing", scaled ? 1.25 : 1, scaled ? 9 : 4]]) {
    const slider = page.getByRole("slider", { name, exact: true });
    await slider.focus(); await slider.press("Home");
    for (let i = 0; i < steps; i++) await slider.press("ArrowRight");
    assert.equal(Number(await slider.inputValue()), value);
  }
  await page.getByRole("checkbox", { name: "High contrast text", exact: true }).setChecked(scaled);
  await page.getByTestId("settings-finish").click();
  await page.waitForFunction(() => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.dataset.runtimeScreenTransition === "idle"
      && ["playing", "main_menu", "title_menu"].includes(n.dataset.runtimePresentedScreen);
  });
  if (await page.locator("[data-runtime-screen-transition]").getAttribute("data-runtime-presented-screen") === "main_menu") {
    await page.getByTestId("continue-game").click();
  }
  await ready(page, "playing");
}
async function caseRun(page, v, mode, authored) {
  const c = { id: report.cases.length + 1, ...v, mode, authored, status: "RUNNING", assertions: [] }; report.cases.push(c); save();
  try {
    await page.goto(`${server.url}/?mode=preview`); await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
    const id = `qa-setting-render-${c.id}`, text = "玩家字号行距和高对比度须真实生效";
    const skin = compiled.exports[v.layout === "renpy" ? "createRenpyUILayout" : "getDefaultUISkinLayout"]();
    const now = new Date().toISOString();
    const command = { ...(mode === "centered" ? { type: "narration", narration_style: "centered" }
      : { type: "dialog", character_id: "hero", presentation_mode: mode }), text,
      ...(authored ? { dialog_style_mode: "manual", dialog_style: { font_size: 22, text_color: "#b6c7d8" } } : {}) };
    await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
      sessionId: payload.manifest.game_id, revision: 1, requestId: "init", runId: "init", screen: "title_menu", ...payload }, "*"), {
      manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.25.0",
        game_id: id, title: "玩家文字设置隔离回归", author: "QA", version: "1.0.0", language: "zh-CN",
        entry_script: "script.json", entry_scene_id: "entry", assets: [], created_at: now, updated_at: now },
      script: { schema_version: "1.10.0", game_id: id, title: "玩家文字设置隔离回归", entry_scene_id: "entry",
        characters: [{ character_id: "hero", name: "测试" }], scenes: [{ scene_id: "entry", title: "entry",
          chapter: 1, tags: [], commands: [command] }] }, uiSkin: skin, assetUrls: {},
      start: { requestId: "init", target: { sceneId: "entry", commandIndex: 0 }, entryPath: [],
        mode: "stable_frame", playbackRate: 1, reducedMotion: v.reduced },
    });
    await ready(page, "title_menu");
    await page.getByTestId("start-new-game").click(); await ready(page, "playing");
    const selector = mode === "nvl" ? '[data-nvl-current="true"] .nvl-page-text' : ".dialog-text";
    await page.locator(selector).waitFor();
    await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent === text, { selector, text });
    c.before = await readText(page, mode);
    await displayPreferences(page, v.layout, true); c.after = await readText(page, mode);
    for (const [name, fn] of [
      ["Actual body font responds to the 135% preference", () => assert(Math.abs(c.after.font / c.before.font - 1.35) < .025)],
      ["Actual line-height ratio responds to 125% spacing", () => assert(Math.abs(c.after.line / c.after.font / (c.before.line / c.before.font) - 1.25) < .025)],
      ["High contrast reaches visible body even with author color", () => {
        assert.equal(c.after.color, "rgb(255, 255, 255)"); assert.notEqual(c.after.shadow, "none");
      }],
      ["Text remains complete and within its reading region", () => {
        assert.equal(c.after.text, text); assert.equal(c.after.overflow, 0);
        const b = c.after.region;
        assert(c.after.lines.every(r => r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1));
      }],
    ]) {
      try { fn(); c.assertions.push({ name, status: "PASS" }); }
      catch (e) { c.assertions.push({ name, status: "FAILED", error: String(e) }); }
    }
    c.status = c.assertions.every(a => a.status === "PASS") ? "PASS" : "FAILED";
    if (!authored) {
      const file = path.join(out, `${v.layout}-${v.width}-${v.dpr}-${v.reduced}-${mode}.png`);
      const before = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      await page.screenshot({ path: file }); const b = fs.readFileSync(file);
      assert.equal(b.readUInt32BE(16), v.width * v.dpr); assert.equal(b.readUInt32BE(20), v.height * v.dpr);
      const after = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.deepEqual(after, before);
      report.screenshots.push({ path: file, sha256: sha(file), before, after, png: { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } });
    }
    await displayPreferences(page, v.layout, false); c.restored = await readText(page, mode);
    try {
      assert.equal(c.restored.text, text); assert.equal(c.restored.color, c.before.color);
      assert(Math.abs(c.restored.font - c.before.font) < .05);
      assert(Math.abs(c.restored.line - c.before.line) < .05);
      assert.equal(c.restored.shadow, c.before.shadow);
      c.assertions.push({ name: "Turning preferences off restores the original author appearance and full text", status: "PASS" });
    } catch (e) { c.assertions.push({ name: "Turning preferences off restores the original author appearance and full text", status: "FAILED", error: String(e) }); }
    c.status = c.assertions.every(a => a.status === "PASS") ? "PASS" : "FAILED";
  } catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { c.finishedAt = new Date().toISOString(); save(); console.log(`${c.status} ${JSON.stringify(v)} ${mode} author=${authored}`); }
}
(async () => {
  save();
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  for (const s of report.sources.filter(s => s.path !== __filename)) {
    const copy = path.join(out, "sources", path.relative(root, s.path));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(s.path, copy, fs.constants.COPYFILE_EXCL);
    s.snapshot = copy;
  }
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, runId: server.runId, url: server.url };
  browser = await chromium.launch();
  const jobs = ["agentvn", "renpy"].flatMap(layout => (option ? [1920, 2560, 3840] : [1920]).flatMap(width =>
    (option ? [1, 2] : [1]).flatMap(dpr => (option ? [false, true] : [false])
      .map(reduced => ({ layout, width, height: width * 9 / 16, dpr, reduced })))));
  let nextJob = 0;
  async function worker() {
    while (nextJob < jobs.length) {
      const v = jobs[nextJob++];
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dpr,
        reducedMotion: v.reduced ? "reduce" : "no-preference" });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on("pageerror", e => report.pageErrors.push(String(e)));
      try { for (const mode of ["dialog", "nvl", "bubble", "centered"]) for (const authored of [false, true])
        await server.run(() => caseRun(page, v, mode, authored)); }
      finally { await context.close(); }
    }
  }
  report.concurrency = option ? 3 : 1;
  const workers = await Promise.allSettled(Array.from({ length: report.concurrency }, worker));
  for (const r of workers) if (r.status === "rejected") throw r.reason;
  assert.equal(report.cases.length, option ? 192 : 16);
  assert.equal(new Set(report.cases.map(c => [c.layout, c.width, c.dpr, c.reduced, c.mode, c.authored].join("/"))).size, report.cases.length);
  assert.equal(report.screenshots.length, report.cases.length / 2);
  assert(report.cases.every(c => c.assertions.length === 5));
  for (const s of report.sources) assert.equal(sha(s.path), s.sha256);
  assert.equal(report.pageErrors.length, 0); assert(report.cases.every(c => c.status === "PASS"));
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    await browser?.close(); await server?.stop();
    let responding = false;
    if (server) try { responding = (await fetch(server.url, { signal: AbortSignal.timeout(1200) })).ok; } catch {}
    assert(!responding, "Owned service still responds after stop");
    report.cleanup = { status: "PASS", browserClosed: true, ownedServerStopped: true, serviceResponds: responding };
  } catch (e) {
    report.status = "FAILED"; report.cleanup = { status: "FAILED", error: String(e.stack || e) }; process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error }));
});
