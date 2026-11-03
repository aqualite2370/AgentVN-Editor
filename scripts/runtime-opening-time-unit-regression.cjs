"use strict";
// Real production OpeningScreen component + actual minified Runtime CSS.
// This does not substitute for a complete Runtime or installed-player flow.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const attempt = process.argv[2]; assert.match(attempt || "", /^(red|green)-\d{2}$/);
const root = path.resolve(__dirname, "..");
const out = path.join("F:/AgentVN/QA/Runtime-Opening-Time-20261024-01", attempt);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const cssFiles = fs.readdirSync(path.join(root, "GameCli_framework/dist/assets"))
  .filter(f => f.endsWith(".css")).map(f => path.join(root, "GameCli_framework/dist/assets", f));
const css = cssFiles.map(f => fs.readFileSync(f, "utf8")).join("\n");
assert(/--motion-emphasis:\s*\.42s/.test(css) &&
  /--opening-fade-duration:\s*var\(--motion-emphasis\)/.test(css),
  "Use actual production minified clocks, including inherited timing");
const source = path.join(root, "GameCli_framework/src/components/common/OpeningScreen.tsx");
const bundle = buildSync({ stdin: { resolveDir: root, loader: "tsx", contents: `
  import React from "react";
  import { createRoot } from "./GameCli_framework/node_modules/react-dom/client";
  import { OpeningScreen } from "./GameCli_framework/src/components/common/OpeningScreen";
  const root = createRoot(document.getElementById("qa-root"));
  const complete = () => { window.__completionCount++; };
  const ignore = () => {};
  window.__completionCount = 0;
  window.__renderOpening = (done) => root.render(React.createElement(OpeningScreen, {
    animation: { kind: "default" }, assetUrls: {}, complete: done,
    onComplete: complete, onCycleComplete: ignore, onError: ignore,
  }));
  window.__renderOpening(false);
` }, bundle: true, platform: "browser", format: "iife", write: false,
  jsx: "automatic", nodePaths: [path.join(root, "GameCli_framework/node_modules")],
  define: { "process.env.NODE_ENV": '"production"' } }).outputFiles[0].text;
const report = { status: "RUNNING", at: new Date().toISOString(),
  scope: "REAL_COMPONENT_AND_MINIFIED_CSS_NOT_FULL_RUNTIME_OR_INSTALLATION",
  source: { path: source, sha256: sha(source) },
  styles: cssFiles.map(f => ({ path: f, sha256: sha(f) })), cases: [], modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser;
(async () => {
  browser = await chromium.launch();
  for (const reduced of [false, true]) for (const spelling of ["production-seconds", "milliseconds"]) {
    const row = { reduced, spelling, expected: reduced ? 180 : 420, status: "RUNNING" };
    report.cases.push(row); save();
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
      reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await context.newPage();
    try {
      const override = spelling === "milliseconds"
        ? `.runtime-opening-screen{--opening-fade-duration:${row.expected}ms!important}` : "";
      await page.setContent(`<style>${css}\n${override}</style><div id="qa-root"></div>`);
      await page.evaluate(() => {
        window.__openingUnitFrames = []; window.__captureOpeningUnit = true;
        const frame = () => {
          if (!window.__captureOpeningUnit) return;
          const root = document.querySelector(".runtime-opening-screen"),
            media = document.querySelector(".runtime-opening-media");
          if (root && media) window.__openingUnitFrames.push({
            root: Number(getComputedStyle(root).opacity), media: Number(getComputedStyle(media).opacity),
          });
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      await page.addScriptTag({ content: bundle });
      const media = page.locator(".runtime-opening-media"); await media.waitFor();
      row.actual = await media.evaluate(n => ({
        token: getComputedStyle(n).getPropertyValue("--opening-fade-duration").trim(),
        duration: n.getAnimations()[0]?.effect.getTiming().duration,
      }));
      assert.equal(row.actual.duration, row.expected, `${spelling}: actual WAAPI clock must retain CSS time units`);
      await page.waitForFunction(() => document.querySelector(".runtime-opening-media")
        ?.getAnimations().every(a => a.playState === "finished"));
      row.entrance = await page.evaluate(() => window.__openingUnitFrames);
      assert(row.entrance.filter(f => f.media > .02 && f.media < .98).length >= 2);
      assert(row.entrance.every(f => f.root >= .999), "Opaque backdrop while media enters");
      await page.evaluate(() => window.__renderOpening(true));
      const stage = page.locator(".runtime-opening-screen");
      await page.waitForFunction(() => document.querySelector(".runtime-opening-screen")?.getAnimations().length > 0);
      row.exitDuration = await stage.evaluate(n => n.getAnimations()[0].effect.getTiming().duration);
      assert.equal(row.exitDuration, row.expected);
      await page.waitForFunction(() => window.__completionCount === 1);
      assert((await page.evaluate(() => window.__openingUnitFrames))
        .filter(f => f.root > .02 && f.root < .98).length >= 2);
      row.status = "PASS";
    } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
    finally {
      await page.evaluate(() => { window.__captureOpeningUnit = false; }).catch(() => {});
      await context.close(); row.contextClosed = true; save();
    }
  }
  assert.equal(sha(source), report.source.sha256, "Do not change source during regression");
  assert(report.cases.length === 4 && report.cases.every(c => c.status === "PASS"));
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); report.browserClosed = true; report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.map(c => ({
    reduced: c.reduced, spelling: c.spelling, status: c.status, actual: c.actual, error: c.error,
  })), error: report.error }));
});
