"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settled: idle } = require("./lib/editor-sibling-motion-probe.cjs");
const attempt = process.argv[2];
assert(/^(?:red|green|matrix)-\d{2}$/.test(attempt || ""), "Fresh attempt required");
const out = `F:/AgentVN/QA/Editor-Sibling-Motion-20261021-01/safety-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);
const input = path.join(out, "导航安全隔离.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture(`sibling-safety-${attempt}`)), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), layer: "Editor",
  scope: "SOURCE_REAL_BROWSER_CONTROLLED_MODULE_FAILURE_NOT_INSTALLED", modelRequests: 0, cases: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const root = ".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)";
const button = (page, key) => page.locator(`${root} [data-help-key="advanced.tab.${key}"]`);
async function sample(page, start = true) {
  if (!start) return page.evaluate(() => window.__qaSiblingSafety.stop());
  await page.evaluate(root => {
    let raf, stopped = false;
    const frames = [];
    const read = () => {
      const panel = document.querySelector(root);
      const rect = n => n?.getBoundingClientRect().toJSON();
      return { at: performance.now(), phase: panel.querySelector(".advanced-tools-panel").className,
        panel: rect(panel), nav: rect(panel.querySelector("nav")),
        palette: rect(document.querySelector(".node-palette")),
        layers: [...panel.querySelectorAll(".advanced-tab-content")].map(n => ({
          tab: n.dataset.tab, opacity: Number(getComputedStyle(n).opacity), inert: n.inert,
          visible: !n.hidden && getComputedStyle(n).display !== "none",
          active: n.classList.contains("is-active"),
        })),
        focusInInert: !!document.activeElement?.closest("[inert]"),
        overflow: document.documentElement.scrollWidth - innerWidth };
    };
    const tick = () => { if (!stopped) { frames.push(read()); raf = requestAnimationFrame(tick); } };
    window.__qaSiblingSafety = { stop() { stopped = true; cancelAnimationFrame(raf); frames.push(read()); return frames; } };
    tick();
  }, root);
}
async function intermediate(page, key) {
  await page.waitForFunction(({ root, key }) => {
    const n = document.querySelector(`${root} .advanced-tab-content.is-active[data-tab="${key}"]`);
    const opacity = n && Number(getComputedStyle(n).opacity);
    return n && opacity > .15 && opacity < .85;
  }, { root, key }, { polling: "raf", timeout: 15000 });
}
function validateFrames(frames, target, stable = true) {
  assert(frames.length > 4, "Empty/short frame trace");
  const first = frames[0];
  for (const f of frames) {
    assert(!f.focusInInert, "Focus remained in an inactive page");
    assert(f.overflow <= 1, "Horizontal overflow");
    const visible = f.layers.filter(l => l.visible);
    assert(visible.reduce((sum, l) => sum + l.opacity, 0) >= .9, "Blank/dim frame during retarget");
    assert.equal(visible.filter(l => !l.inert).length, 1, "Navigation lost its unique input owner");
    if (stable) for (const k of ["x","y","width","height"])
      assert(Math.abs(f.panel[k] - first.panel[k]) < 1, `Same-size switch changed panel ${k}`);
  }
  assert.deepEqual(frames.at(-1).layers.filter(l => l.visible && !l.inert).map(l => l.tab), [target]);
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].at - frames[i-1].at > 45) continue; // A skipped sample cannot prove a pixel jump.
    for (const old of frames[i-1].layers.filter(l => l.visible && l.opacity > .01)) {
      const now = frames[i].layers.find(l => l.tab === old.tab);
      assert(Math.abs((now?.visible ? now.opacity : 0) - old.opacity) < .28,
        `${old.tab} snapped on cancellation/retarget`);
    }
  }
}
async function record(label, m, run) {
  const row = { ...m, label, status: "RUNNING" }; report.cases.push(row); save();
  try { await run(row); row.status = "PASS"; }
  catch(e) { row.status = "FAILED"; row.error = String(e.stack); }
  save(); console.log(JSON.stringify({ ...m, label, status: row.status, error: row.error?.split("\n")[0] }));
}
let env, browser;
(async () => {
  save(); env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.owner = { pid: env.server.pid, backendPid: env.backendPid, url: env.url, backendUrl: env.backendUrl };
  browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const matrix = process.env.SIBLING_MATRIX === "1"
    ? [[1920,1080],[2560,1440],[3840,2160]].flatMap(([width,height]) =>
      [1,2].flatMap(dpr => [false,true].map(reduced => ({width,height,dpr,reduced}))))
    : [{width:1920,height:1080,dpr:1,reduced:false}];
  for (const m of matrix) {
    const context = await browser.newContext({ viewport: {width:m.width,height:m.height}, deviceScaleFactor:m.dpr,
      reducedMotion:m.reduced ? "reduce" : "no-preference" });
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    page.on("pageerror", e => report.errors.push(String(e)));
    await env.server.run(async () => {
      await env.open(page); await page.locator('[data-workspace-surface="options"]:visible').click(); await idle(page,"settings");
      await record("keyboard-reverse-and-repeat", m, async row => {
        await sample(page); await button(page,"providers").focus(); await page.keyboard.press("Enter");
        await intermediate(page,"providers");
        const focus = await page.locator(`${root} .advanced-tab-content.is-leaving`).first().evaluate(node => {
          const target = node.querySelector("button,input,select,[tabindex='0']");
          target?.focus();
          return { tried:!!target, leaked:node.contains(document.activeElement) };
        });
        assert(focus.tried && !focus.leaked,"Outgoing page accepted focus");
        await button(page,"settings").focus(); await page.keyboard.press("Enter");
        await idle(page,"settings"); row.frames = await sample(page,false); validateFrames(row.frames,"settings");
        const before = await page.locator(`${root} .advanced-tab-content.is-active`).innerText();
        await button(page,"settings").press("Enter"); await button(page,"settings").press("Enter");
        assert.equal(await page.locator(`${root} .advanced-tab-content.is-active`).innerText(),before);
        assert.equal(await page.locator(`${root} .advanced-tab-content`).evaluateAll(nodes =>
          nodes.flatMap(n => n.getAnimations()).filter(a => a.playState === "running").length),0,
        "Repeated active-page input started another crossfade");
      });
      await button(page,"settings").click(); await idle(page,"settings");
      await record("three-target-retarget",m,async row => {
        await sample(page); await button(page,"providers").click(); await intermediate(page,"providers");
        await button(page,"history").click(); await idle(page,"history");
        row.frames = await sample(page,false); validateFrames(row.frames,"history");
      });
      await button(page,"layout").click(); await idle(page,"layout");
      await record("page-selection-no-shadow-and-real-hit",m,async row => {
        row.styles = [];
        for (const type of ["agentvn","renpy"]) {
          const active = page.locator(`${root} .advanced-tab-content.is-active`);
          if(type === "renpy") {
            await active.locator('[data-layout-type-option="renpy"]').click();
            await active.locator('[data-layout-type-option="renpy"][aria-pressed="true"]').waitFor();
          }
          const pages = active.locator(type === "renpy" ? ".renpy-editor-page-list button" : ".runtime-layout-screen-list button");
          assert(await pages.count() >= 5);
          for (const index of [0,1]) {
            const item = pages.nth(index); await item.click(); await item.hover();
            row.styles.push({type,...await item.evaluate(n => {
              const r = n.getBoundingClientRect(), marker = n.closest(".runtime-layout-sidebar").querySelector(".glass-selection-indicator");
              return { shadow: getComputedStyle(n).boxShadow, filter: getComputedStyle(n).filter,
                markerFilter: marker && getComputedStyle(marker).filter,
                hit: n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) };
            })});
          }
        }
        assert.equal(row.styles.length,4);
        assert(row.styles.every(s => s.shadow === "none" && s.filter === "none" && (!s.markerFilter || s.markerFilter === "none") && s.hit),
          "Layout page buttons/selection still cast shadows or cannot be clicked");
      });
    });
    await context.close();
  }
  // Actual network failure/latency, not a mocked navigation state machine.
  // Each fresh browser context owns an uncached app-module graph.
  for (const scenario of ["late-success","late-failure","failure-retry","timeout-retry"]) {
    const failure = scenario === "late-failure" || scenario === "failure-retry";
    const cancel = scenario.startsWith("late-");
    const context = await browser.newContext({ viewport: {width:1920,height:1080} });
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    let release, calls = 0, released = false;
    const gate = new Promise(resolve => { release = () => { released = true; resolve(); }; });
    await page.route("**/GenerationHistoryPanel.tsx*", async route => {
      calls++;
      if (calls === 1) {
        await gate;
        if (failure) { await route.abort("failed"); return; }
      }
      await route.continue();
    });
    await env.server.run(async () => {
      await env.open(page); await page.locator('[data-workspace-surface="options"]:visible').click(); await idle(page,"settings");
      await record(scenario, {controlledNetwork:true}, async row => {
        await sample(page); await button(page,"history").click();
        await page.waitForFunction(root => document.querySelector(`${root} .advanced-tools-panel.is-tab-preparing`),root);
        row.pendingOwners = await page.locator(`${root} .advanced-tab-content`).evaluateAll(nodes =>
          nodes.filter(n => !n.inert && !n.hidden).map(n => n.dataset.tab));
        assert.deepEqual(row.pendingOwners,["settings"],"Loading disabled the retained page before target readiness");
        if (cancel) {
          await button(page,"settings").click();
          const completed = page.waitForEvent(failure ? "requestfailed" : "requestfinished",
            request => request.url().includes("GenerationHistoryPanel.tsx"));
          release(); await completed; await idle(page,"settings");
          assert.equal(await page.locator(`${root} .advanced-tab-load-error`).count(),0,"Stale request published its error");
        } else {
          if (scenario !== "timeout-retry") release();
          await page.locator(`${root} .advanced-tab-load-error`).waitFor();
          if (scenario === "timeout-retry") {
            assert.match(await page.locator(`${root} .advanced-tab-load-error`).innerText(),/超时/);
            release();
          }
          assert.equal(await page.locator(`${root} .advanced-tab-content.is-active`).getAttribute("data-tab"),"settings");
          await page.getByRole("button",{name:"重试载入",exact:true}).click(); await idle(page,"history");
        }
        // Observe completion of the actual request, then idle frames; no arbitrary delay stands in for readiness.
        await page.waitForFunction(() => !document.querySelector(".advanced-tools-panel.is-tab-preparing"));
        row.frames = await sample(page,false);
        validateFrames(row.frames,cancel ? "settings" : "history");
        row.moduleCalls = calls;
        if (scenario === "failure-retry") assert(calls >= 2,"Retry did not request a fresh module URL");
      });
    });
    if (!released) release();
    await context.close();
  }
  assert.equal(report.cases.length,matrix.length*3+4);
  assert.deepEqual(report.errors,[]);
  assert(report.cases.every(c => c.status === "PASS"),"See failed safety cases");
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack); process.exitCode = 1; })
.finally(async () => {
  await browser?.close();
  try { await env?.stop(); report.cleanup = {status:"PASS"}; }
  catch(e) { report.status = "FAILED"; report.cleanup = {status:"FAILED",error:String(e)}; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({status:report.status,out,error:report.error}));
});
