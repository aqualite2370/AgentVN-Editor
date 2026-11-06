"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out), "Use a new evidence directory");
fs.mkdirSync(out, { recursive: true });
const source = path.join(root, "GameCli_framework/src/components/common/OpeningScreen.tsx");
const css = fs.readdirSync(path.join(root, "GameCli_framework/dist/assets"))
  .filter(file => file.endsWith(".css"))
  .map(file => fs.readFileSync(path.join(root, "GameCli_framework/dist/assets", file), "utf8")).join("\n");
const bundle = buildSync({ stdin: { resolveDir: root, loader: "tsx", contents: `
  import React from "react";
  import { createRoot } from "./GameCli_framework/node_modules/react-dom/client";
  import { OpeningScreen } from "./GameCli_framework/src/components/common/OpeningScreen";
  const root = createRoot(document.getElementById("qa-root"));
  window.__openingSkip = { skipped: 0, completed: 0, cycled: 0, underlay: 0 };
  window.__renderOpening = (complete, presentation) => root.render(React.createElement(OpeningScreen, {
    animation: { kind: "image_sequence", image_asset_ids: ["frame"], frame_duration_ms: 60000, presentation },
    assetUrls: { frame: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='teal'/%3E%3C/svg%3E" },
    complete, onSkip: () => { window.__openingSkip.skipped++; window.__renderOpening(true); },
    onComplete: () => { window.__openingSkip.completed++; root.render(null); document.getElementById("underlay").focus(); },
    onCycleComplete: () => { window.__openingSkip.cycled++; }, onError: () => {},
  }));
  window.__renderOpening(false);
` }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false,
  nodePaths: [path.join(root, "GameCli_framework/node_modules")],
  define: { "process.env.NODE_ENV": '"production"' } }).outputFiles[0].text;
const report = { status: "RUNNING", scope: "REAL_OPENING_SCREEN_COMPONENT_SOURCE_BROWSER_ONLY",
  source: { path: source, sha256: createHash("sha256").update(fs.readFileSync(source)).digest("hex") },
  cases: [], screenshots: [], modelRequests: 0, cleanup: "PENDING" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser;
async function runCase(name, contextOptions, action) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...contextOptions });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setContent(`<style>${css}\n#underlay{position:fixed;inset:0;width:100%;height:100%}</style><button id="underlay">underlay</button><div id="qa-root"></div>
      <script>document.querySelector('#underlay').addEventListener('click',()=>window.__underlayClicks=(window.__underlayClicks||0)+1)</script>`);
    await page.addScriptTag({ content: bundle });
    await page.locator('[data-testid="runtime-opening-screen"]').waitFor();
    await action(page);
    row.state = await page.evaluate(() => ({ ...window.__openingSkip,
      underlayClicks: window.__underlayClicks || 0,
      screen: !!document.querySelector('[data-testid="runtime-opening-screen"]'),
      opacity: document.querySelector('[data-testid="runtime-opening-screen"]') &&
        getComputedStyle(document.querySelector('[data-testid="runtime-opening-screen"]')).opacity }));
    row.pageErrors = errors;
    assert.deepEqual(errors, []);
    row.status = "PASS";
  } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); }
  finally { await context.close(); save(); }
}
(async () => {
  browser = await chromium.launch({ headless: true });
  await runCase("right mouse button does not skip", {}, async page => {
    await page.mouse.click(900, 500, { button: "right" });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__openingSkip.skipped), 0);
  });
  await runCase("left mouse click skips once and consumes the same click", {}, async page => {
    await page.mouse.click(900, 500);
    await page.waitForFunction(() => window.__openingSkip.skipped === 1);
    await page.waitForFunction(() => window.__openingSkip.completed === 1);
    await page.locator('[data-testid="runtime-opening-screen"]').waitFor({state:"detached"});
    assert.equal(await page.evaluate(() => window.__openingSkip.skipped), 1);
    assert.equal(await page.evaluate(() => window.__underlayClicks || 0), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id),"underlay");
    await page.mouse.click(900,500);
    assert.equal(await page.evaluate(() => window.__underlayClicks),1);
  });
  await runCase("one touch skips once and consumes the synthesized click",
    { hasTouch: true, isMobile: true }, async page => {
      await page.touchscreen.tap(900, 500);
      await page.waitForFunction(() => window.__openingSkip.skipped === 1);
      await page.waitForFunction(() => window.__openingSkip.completed === 1);
      assert.equal(await page.evaluate(() => window.__openingSkip.skipped), 1);
      assert.equal(await page.evaluate(() => window.__underlayClicks || 0), 0);
    });
  await runCase("repeated clicks during exit do not repeat skip or completion", {}, async page => {
    await page.mouse.click(900, 500, { clickCount: 2, delay: 10 });
    await page.waitForFunction(() => window.__openingSkip.completed === 1);
    assert.equal(await page.evaluate(() => window.__openingSkip.skipped), 1);
    assert.equal(await page.evaluate(() => window.__underlayClicks || 0), 0);
  });
  await runCase("drag is not a tap and next real click still skips", {}, async page => {
    await page.mouse.move(700,500); await page.mouse.down();
    await page.mouse.move(900,500); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__openingSkip.skipped), 0);
    await page.mouse.click(900,500);
    await page.waitForFunction(() => window.__openingSkip.completed === 1);
    assert.equal(await page.evaluate(() => window.__openingSkip.skipped), 1);
  });
  await runCase("cancelled touch does not skip", { hasTouch: true }, async page => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x:900,y:500 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    assert.equal(await page.evaluate(() => window.__openingSkip.skipped), 0);
    await page.touchscreen.tap(900,500);
    await page.waitForFunction(() => window.__openingSkip.completed === 1);
    await cdp.detach();
  });
  for (const [width,height] of [[1920,1080],[2560,1440],[3840,2160]])
    for (const dpr of [1,2]) for (const reduced of [false,true]) {
      await runCase(`real component ${width}x${height} DPR${dpr} reduced=${reduced}`, {
        viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:reduced?"reduce":"no-preference",
      }, async page => {
        for (const config of [undefined, {mode:"fullscreen",fit:"cover"},
          {mode:"centered",fit:"contain",width_percent:64,height_percent:72},
          {mode:"centered",fit:"stretch",width_percent:64,height_percent:72}]) {
          await page.evaluate(config => window.__renderOpening(false,config),config);
          await page.waitForFunction(config => {
            const media=document.querySelector(".runtime-opening-media");
            return media && media.dataset.presentation === (config?.mode || "fullscreen")
              && getComputedStyle(media).getPropertyValue("--opening-media-fit").trim() ===
                (config?.fit === "stretch" ? "fill" : config?.fit || "contain");
          },config);
          const measured = await page.locator(".runtime-opening-media").evaluate(el => {
            const r=el.getBoundingClientRect(),stage=el.closest(".runtime-opening-screen");
            return {rect:r.toJSON(),stage:stage.getBoundingClientRect().toJSON(),inline:el.getAttribute("style"),
              cssWidth:getComputedStyle(el).width,transition:getComputedStyle(el).transition,
              fit:getComputedStyle(el.querySelector("img")).objectFit,
              focused:document.activeElement===stage,owned:stage.contains(document.elementFromPoint(2,2)),
              overflow:document.documentElement.scrollWidth-innerWidth};
          });
          const centered=config?.mode==="centered";
          assert(Math.abs(measured.rect.width-width*(centered ? .64 : 1))<2,JSON.stringify({config,measured,width,height}));
          assert(Math.abs(measured.rect.height-height*(centered ? .72 : 1))<2,JSON.stringify({config,measured,width,height}));
          assert(Math.abs(measured.rect.x-(width-measured.rect.width)/2)<2);
          assert(Math.abs(measured.rect.y-(height-measured.rect.height)/2)<2);
          assert.equal(measured.stage.width,width); assert.equal(measured.stage.height,height);
          assert.equal(measured.fit,config?.fit==="stretch"?"fill":config?.fit||"contain");
          assert(measured.focused&&measured.owned&&measured.overflow<=1);
        }
        await page.mouse.click(width/2,height/2);
        await page.waitForFunction(()=>window.__openingSkip.completed===1);
        assert.equal(await page.evaluate(()=>window.__openingSkip.skipped),1);
        assert.equal(await page.evaluate(()=>window.__underlayClicks||0),0);
      });
    }
})().catch(error => { report.fatal = String(error.stack || error); })
  .finally(async () => {
    if (browser) await browser.close();
    report.cleanup = "PASS"; report.finishedAt = new Date().toISOString();
    report.status = !report.fatal && report.cases.length === 18 && report.cases.every(c => c.status === "PASS")
      ? "PASS" : "FAILED";
    save(); console.log(JSON.stringify({ status: report.status,
      cases: report.cases.map(c => ({ name: c.name, status: c.status })), out }));
    process.exitCode = report.status === "PASS" ? 0 : 1;
  });
