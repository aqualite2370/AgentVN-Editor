"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settled: idle } = require("./lib/editor-sibling-motion-probe.cjs");
const attempt = process.argv[2] || "red-01"; assert.match(attempt, /^(?:red|green|matrix)-\d{2}$/);
const out = `F:/AgentVN/QA/Editor-Sibling-Motion-20261021-01/${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);
const input = path.join(out, "同尺寸切页隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture(`sibling-motion-${attempt}`)), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), layer: "Editor",
  scope: "SOURCE_REAL_BROWSER_NOT_INSTALLED_RELEASE", modelRequests: 0, cases: [], screenshots: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const root = ".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)";
const button = (page, key) => page.locator(`${root} [data-help-key="advanced.tab.${key}"]`);
async function trace(page) {
  await page.evaluate(root => {
    const frames = []; let handle, stopped = false;
    const read = () => {
      const panel = document.querySelector(root), tools = panel.querySelector(".advanced-tools-panel");
      const rect = n => n?.getBoundingClientRect().toJSON();
      return { at: performance.now(), panel: rect(panel), nav: rect(tools.querySelector("nav")),
        palette: rect(document.querySelector(".node-palette")),
        actual: {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
          reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}, phase: tools.className,
        layers: [...tools.querySelectorAll(".advanced-tab-content")].map(n => ({
          tab: n.dataset.tab, opacity: Number(getComputedStyle(n).opacity), inert: n.inert, hidden: n.hidden,
          current: n.classList.contains("is-active"), display: getComputedStyle(n).display,
          animations: n.getAnimations().map(a => ({ duration: a.effect.getTiming().duration,
            easing: a.effect.getTiming().easing, state: a.playState, time: a.currentTime })),
        })), overflow: document.documentElement.scrollWidth - innerWidth };
    };
    const tick = () => { if (!stopped) { frames.push(read()); handle = requestAnimationFrame(tick); } };
    window.__qaSiblingTrace = { stop: () => { stopped = true; cancelAnimationFrame(handle); frames.push(read()); return frames; } };
    tick();
  }, root);
}
async function hover(page, key) {
  await page.mouse.move(1, 1);
  const read = () => button(page, key).evaluate(n => {
    const g = n.closest(".glass-selection-group"), indicator = g.querySelector(".glass-selection-indicator");
    const part = indicator.querySelector(".glass-selection-press");
    const box = e => e.getBoundingClientRect().toJSON();
    return { button: box(n), indicator: box(indicator), material: box(part),
      pressTransform: getComputedStyle(part).transform, buttonTransform: getComputedStyle(n).transform,
      radius: getComputedStyle(indicator).borderRadius, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const before = await read();
  const x = before.button.x + before.button.width / 2, y = before.button.y + before.button.height / 2;
  assert(await button(page,key).evaluate((n,{x,y}) => n.contains(document.elementFromPoint(x,y)),{x,y}),
    "Hover target is covered");
  // locator.hover() also scrolls ancestors into view, which changed the nav's
  // scrollTop by 6px and was incorrectly attributed to its hover transform.
  // Move a real pointer onto the already reachable button without that extra operation.
  await page.mouse.move(x,y);
  await page.waitForFunction(root => document.querySelector(`${root} .glass-selection-indicator`)?.dataset.glassHover === "true", root);
  await button(page, key).evaluate(async n => {
    const group = n.closest(".glass-selection-group");
    await Promise.all(group.getAnimations({ subtree: true }).filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
  });
  const after = await read(), failures = [];
  if (Math.abs(after.material.y - after.indicator.y) > .25
    || Math.abs(after.material.x - after.indicator.x) > .25
    || Math.abs(after.material.width - after.indicator.width) > .25
    || Math.abs(after.material.height - after.indicator.height) > .25)
    failures.push("Hover separates the glass face from its stationary border/base");
  if (Math.abs(before.button.y - after.button.y) > .25) failures.push("Hover lifts the option button");
  return { kind: "hover", key, before, after, failures };
}
let env, browser;
(async () => {
  save(); env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.owner = { pid: env.server.pid, backendPid: env.backendPid, url: env.url, backendUrl: env.backendUrl };
  browser = await chromium.launch({ args: process.env.SIBLING_GPU === "1" ? ["--use-angle=d3d11"] : [] });
  const matrix = process.env.SIBLING_MATRIX === "1"
    ? [[1920,1080], [2560,1440], [3840,2160]].flatMap(([width,height]) =>
      [1,2].flatMap(dpr => [false,true].map(reduced => ({ width,height,dpr,reduced }))))
    : [{ width:1920,height:1080,dpr:1,reduced:false }];
  for (const m of matrix) {
    const context = await browser.newContext({ viewport: { width:m.width,height:m.height },
      deviceScaleFactor:m.dpr, reducedMotion:m.reduced ? "reduce" : "no-preference" });
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    page.on("pageerror", e => report.errors.push(String(e)));
    await env.server.run(async () => {
      await env.open(page); await page.locator('[data-workspace-surface="options"]:visible').click(); await idle(page, "settings");
      const scenarios = [["settings","providers"], ["providers","history"], ["layout","theme"], ["theme","assets"]];
      for (const [from,to] of scenarios) {
        if (!await page.locator(`${root} .advanced-tab-content.is-active[data-tab="${from}"]`).count()) {
          await button(page,from).click(); await idle(page,from);
        }
        report.cases.push({ ...m, ...await hover(page,from) }); save();
        await trace(page); await button(page,to).click(); await idle(page,to);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const frames = await page.evaluate(() => window.__qaSiblingTrace.stop());
        const row = { ...m, kind:"sibling", from,to, frames, failures:[] };
        const blend = frames.filter(f => f.layers.some(l => l.tab === to && l.current && l.opacity > .05 && l.opacity < .95));
        const durations = frames.flatMap(f => f.layers.filter(l => l.tab === to).flatMap(l => l.animations))
          .filter(a => a.state === "running").map(a => a.duration);
        if (!durations.length || durations.some(ms => ms < (m.reduced ? 400 : 600)))
          row.failures.push("Equal-footprint content finishes before the deliberate sibling transition budget");
        if (blend.length < 4 || blend.at(-1).at - blend[0].at < (m.reduced ? 180 : 280))
          row.failures.push("Too little visible blend: apparent snap despite nominal animation");
        const last = frames.at(-1), owners = last.layers.filter(l => l.current && !l.inert);
        if (owners.length !== 1 || owners[0].tab !== to || owners[0].opacity < .99)
          row.failures.push("Final interactive owner is not the requested page");
        if (frames.some(f => f.layers.filter(l => l.current && !l.inert).length > 1 || f.overflow > 1))
          row.failures.push("Input ownership or page overflow failed");
        const first = frames[0];
        if (frames.some(f => ["panel","nav","palette"].some(n => f[n] && first[n]
          && ["x","y","width","height"].some(k => Math.abs(first[n][k]-f[n][k]) > 1))))
          row.failures.push("Equal-footprint switch unexpectedly moves/resizes the workbench");
        if (frames.some(f => JSON.stringify(f.actual) !== JSON.stringify(m)))
          row.failures.push("Actual viewport/DPR/motion parameters differ from declaration");
        row.visibleBlendMs = blend.length ? blend.at(-1).at-blend[0].at : 0;
        row.durations = [...new Set(durations)]; report.cases.push(row); save();
        console.log(JSON.stringify({ ...m, from,to, blendMs:row.visibleBlendMs, failures:row.failures }));
      }
      const actual = () => page.evaluate(() => ({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
        reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
      const before = await actual();
      const screenshot = path.join(out,`${m.width}x${m.height}-dpr${m.dpr}-${m.reduced?"reduced":"normal"}.png`);
      const png = await page.screenshot({path:screenshot});
      assert.deepEqual(before,m); assert.deepEqual(await actual(),m);
      assert.equal(png.readUInt32BE(16),m.width*m.dpr); assert.equal(png.readUInt32BE(20),m.height*m.dpr);
      report.screenshots.push({...m,path:screenshot}); save();
    });
    await context.close();
  }
  assert.equal(report.cases.length, (process.env.SIBLING_MATRIX === "1" ? 12 : 1) * 8);
  assert.deepEqual(report.errors, []);
  assert.equal(report.cases.filter(c => c.failures.length).length, 0, "See per-case failures");
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    await browser?.close();
    try {
      await env?.stop();
      if (env) {
        const responding = await Promise.all([env.url,`${env.backendUrl}/api/health`].map(async url => {
          try { await fetch(url,{signal:AbortSignal.timeout(500)}); return url; } catch { return null; }
        }));
        assert(!responding.some(Boolean)); report.cleanup = { status:"PASS", responding:[] };
      }
    } catch(e) { report.status = "FAILED"; report.cleanupError = String(e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status:report.status, out, error:report.error }));
  });
