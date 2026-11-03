"use strict";
// Actual Runtime navigation. Pausing a real CSS transition is explicit compositor fault injection.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { readInstalledViewport } = require("./lib/current-native-capture.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt, /^(red|green|matrix)-\d{2}$/);
const out = path.resolve(`F:/AgentVN/QA/Runtime-Curtain-Completion-20261028-01/${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const compiled = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(compiled, compiled.exports);
const matrix = process.argv.includes("--smoke") ? [{ width: 1920, height: 1080, dpr: 2, reduced: false }]
  : [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true]
    .map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const layouts = process.argv.includes("--smoke") ? ["agentvn"] : ["agentvn", "renpy"];
const sources = [__filename, "GameCli_framework/src/app/RuntimeScreenNavigator.tsx", "GameCli_framework/src/styles/shell.css"];
const report = { status: "RUNNING", startedAt: new Date().toISOString(), scope: "REAL_SOURCE_RUNTIME_NOT_DEV_INSTALLED_OR_DEVICE",
  injection: "Only held cases pause/play the actual ::before CSS transition; ordinary cases use unmodified animation clocks/styles.",
  sources: sources.map(file => ({ path: path.resolve(file), sha256: sha(file) })), cases: [], errors: [], screenshots: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function fixture(layout) {
  const id = "curtain-completion", at = new Date().toISOString();
  return {
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.9.0", game_id: id,
      title: "黑场完成交接", author: "QA", version: "1.0.0", language: "zh-CN", entry_script: "script.json",
      entry_scene_id: "main", assets: [], created_at: at, updated_at: at },
    script: { schema_version: "1.1.0", game_id: id, title: "黑场完成交接", entry_scene_id: "main", characters: [],
      scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "黑场未结束时，不得切换功能页面。" }] }] },
    uiSkin: layout === "renpy" ? compiled.exports.createRenpyUILayout() : compiled.exports.getDefaultUISkinLayout(),
    assetUrls: {},
  };
}
async function ready(page, screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === screen
      && n?.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen, { timeout: 20000 });
}
async function record(page, hold) {
  await page.evaluate(hold => {
    window.__qaCurtain?.stop?.();
    const root = document.querySelector("[data-runtime-screen-transition]"), events = [], frames = [], paused = [];
    const ms = value => value.trim().endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000;
    const css = getComputedStyle(root), cover = ms(css.getPropertyValue("--runtime-screen-cover-duration"));
    const reveal = ms(css.getPropertyValue("--runtime-screen-reveal-duration"));
    const types = ["transitionrun", "transitionstart", "transitionend", "transitioncancel"];
    let done = false;
    const listener = e => {
      if (e.target !== root || e.pseudoElement !== "::before" || e.propertyName !== "opacity") return;
      const phase = root.dataset.runtimeTransitionPhase;
      events.push({ type: e.type, elapsed: e.elapsedTime * 1000, phase, at: performance.now() });
      if (e.type === "transitionrun" && phase === hold && !paused.length)
        for (const animation of root.getAnimations({ subtree: true }).filter(a =>
          a.transitionProperty === "opacity" && a.effect?.target === root && a.effect?.pseudoElement === "::before")) {
          animation.pause(); paused.push(animation);
        }
    };
    for (const type of types) root.addEventListener(type, listener);
    const sample = at => {
      frames.push({ at, phase: root.dataset.runtimeTransitionPhase, presented: root.dataset.runtimePresentedScreen,
        black: Number(getComputedStyle(root, "::before").opacity),
        functionalPages: root.querySelectorAll(".runtime-screen-transition-current").length,
        players: document.querySelectorAll(".story-player").length });
      if (!done) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__qaCurtain = { events, frames, paused, cover, reveal,
      stop() { done = true; for (const type of types) root.removeEventListener(type, listener); } };
  }, hold);
}
async function finish(page) {
  return page.evaluate(() => {
    const r = window.__qaCurtain; r.stop();
    return { events: r.events, frames: r.frames, cover: r.cover, reveal: r.reveal };
  });
}
function completeTrace(trace) {
  assert(trace.frames.length > 2);
  assert(trace.frames.every(f => f.functionalPages === 1 && f.players <= 1), "Never mount duplicate functional pages/players");
  const ends = trace.events.filter(e => e.type === "transitionend");
  assert.equal(trace.events.filter(e => e.type === "transitioncancel").length, 0, "Uninterrupted blackout cannot cancel itself");
  assert.equal(ends.length, 2, "Both actual CSS opacity transitions must finish");
  assert(Math.abs(ends[0].elapsed - trace.cover) < .01 && Math.abs(ends[1].elapsed - trace.reveal) < .01);
  for (const phase of ["covering", "revealing"])
    assert(trace.frames.some(f => f.phase === phase && f.black > .01 && f.black < .99), `${phase} needs visible intermediate frames`);
  assert(trace.frames.filter(f => f.phase === "swap").every(f => f.black >= .999), "Commit only behind an opaque curtain");
}
let server, browser, page;
(async () => {
  save();
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "vite.log") });
  report.owner = { pid: server.pid, runId: server.runId, url: server.url };
  browser = await chromium.launch();
  for (const m of matrix) for (const layout of layouts) {
    const item = { ...m, layout, status: "RUNNING", checks: [] }; report.cases.push(item); save();
    page = await browser.newPage({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: m.dpr,
      reducedMotion: m.reduced ? "reduce" : "no-preference" });
    page.on("pageerror", e => { report.errors.push(String(e)); save(); });
    await server.run(async () => {
      await page.goto(`${server.url}/?mode=preview`);
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
      await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: "curtain-completion", revision: 1, requestId: "init", runId: "init", screen: "title_menu", ...payload }, "*"), fixture(layout));
      await ready(page, "title_menu");
      item.viewport = await readInstalledViewport(page, m);
      await page.getByTestId("start-new-game").click(); await ready(page, "playing");
      for (const hold of ["covering", "revealing", null]) {
        await record(page, hold);
        await page.keyboard.press("Escape");
        if (hold) {
          await page.waitForFunction(() => window.__qaCurtain.paused.length === 1);
          const declared = await page.evaluate(hold => window.__qaCurtain[hold === "covering" ? "cover" : "reveal"], hold);
          // Deliberate negative observation: let the JS nominal timer expire while visual completion is held.
          await page.waitForTimeout(declared + 120);
          const held = await page.evaluate(() => {
            const n = document.querySelector("[data-runtime-screen-transition]");
            return { phase: n.dataset.runtimeTransitionPhase, presented: n.dataset.runtimePresentedScreen,
              black: Number(getComputedStyle(n, "::before").opacity),
              playStates: window.__qaCurtain.paused.map(a => a.playState) };
          });
          item.checks.push({ hold, held }); save();
          assert.equal(held.phase, hold, `${hold}: nominal JS time must not complete an unfinished CSS transition`);
          assert.deepEqual(held.playStates, ["paused"]);
          assert.equal(held.presented, hold === "covering" ? "playing" : "main_menu");
          await page.evaluate(() => window.__qaCurtain.paused.forEach(a => a.play()));
        }
        await ready(page, "main_menu");
        const trace = await finish(page); item.checks.at(-1)?.hold === hold || item.checks.push({ hold });
        item.checks.at(-1).trace = trace; completeTrace(trace); save();
        await page.getByTestId("continue-game").click(); await ready(page, "playing");
      }
      await record(page, "covering"); await page.keyboard.press("Escape");
      await page.waitForFunction(() => window.__qaCurtain.paused.length === 1);
      await page.keyboard.press("Escape"); await ready(page, "playing");
      const interrupted = await finish(page);
      assert(interrupted.events.some(e => e.type === "transitioncancel"), "Genuine back input must cancel the old covering transition");
      await record(page, null); await page.keyboard.press("Escape"); await ready(page, "main_menu");
      const afterInterrupt = await finish(page); completeTrace(afterInterrupt);
      item.checks.push({ name: "back-cancels-held-cover-and-next-navigation-finishes", interrupted, afterInterrupt });
      assert.equal(await page.locator(".story-player").count(), 0);
      const focus = await page.evaluate(() => {
        const n = document.activeElement;
        return n !== document.body && !n.closest("[inert], [aria-hidden='true']")
          && n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      });
      assert(focus, "Focus must finish on the new functional page");
      const before = await readInstalledViewport(page, m), file = path.join(out, `${layout}-${m.width}-${m.dpr}-${m.reduced}.png`);
      const bytes = await page.screenshot({ path: file, scale: "device" }), after = await readInstalledViewport(page, m);
      assert.deepEqual(after, before);
      assert.equal(bytes.readUInt32BE(16), m.width * m.dpr); assert.equal(bytes.readUInt32BE(20), m.height * m.dpr);
      report.screenshots.push({ path: file, before, after, sha256: sha(file) });
      item.status = "PASS"; save();
      console.log(`PASS curtain ${layout}/${m.width}/${m.dpr}/${m.reduced}`);
    });
    await page.close(); page = undefined;
  }
  assert.equal(report.cases.length, matrix.length * layouts.length); assert(report.cases.length > 0);
  assert(report.cases.every(c => c.status === "PASS" && c.checks.length === 4)); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    if (page && !page.isClosed()) {
      report.failureObservation = await page.evaluate(() => {
        const r = window.__qaCurtain; r?.stop(); return r && { events: r.events, frames: r.frames };
      }).catch(String);
    }
    await browser?.close(); await server?.stop();
    report.cleanup = { browserClosed: true, ownedServerStopped: true };
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  });
