"use strict";
// Prepared while native opening acceptance is running; run after it finishes.
// Real SavePageTransition + actual minified CSS, not a rewritten parser test.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const attempt = process.argv[2]; assert.match(attempt || "", /^(red|green)-\d{2}$/);
const root = path.resolve(__dirname, "..");
const out = path.join("F:/AgentVN/QA/Runtime-SavePage-Time-20261024-01", attempt);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const styles = fs.readdirSync(path.join(root, "GameCli_framework/dist/assets"))
  .filter(file => file.endsWith(".css")).map(file => path.join(root, "GameCli_framework/dist/assets", file));
const css = styles.map(file => fs.readFileSync(file, "utf8")).join("\n");
assert(/--motion-emphasis:\s*\.42s/.test(css) && /--motion:\s*\.22s/.test(css));
const component = path.join(root, "GameCli_framework/src/components/shell/SavePageTransition.tsx");
const compiled = buildSync({ stdin: { resolveDir: root, loader: "tsx", contents: `
  import React, { useRef, useState, useLayoutEffect } from "react";
  import { createRoot } from "./GameCli_framework/node_modules/react-dom/client";
  import { SavePageTransition } from "./GameCli_framework/src/components/shell/SavePageTransition";
  function Fixture() {
    const ref = useRef(null), [page, setPage] = useState(1);
    useLayoutEffect(() => { window.__flipSavePage = direction => {
      ref.current.prepare(direction); setPage(value => value + direction);
    }; }, []);
    return <SavePageTransition ref={ref} pageKey={String(page)}>
      <div className="save-grid"><button type="button">第{page}页</button></div>
    </SavePageTransition>;
  }
  createRoot(document.getElementById("fixture")).render(<Fixture />);
` }, bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
  nodePaths: [path.join(root, "GameCli_framework/node_modules")],
  define: { "process.env.NODE_ENV": '"production"' } }).outputFiles[0].text;
const report = { status: "RUNNING", cases: [], modelRequests: 0,
  scope: "REAL_SAVE_PAGE_COMPONENT_WITH_PRODUCTION_CSS_NOT_FULL_RUNTIME_OR_INSTALLATION",
  source: { path: component, sha256: sha(component) },
  styles: styles.map(file => ({ path: file, sha256: sha(file) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
let browser;
(async () => {
  browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu"] });
  const diagnostic = await browser.newBrowserCDPSession();
  const { gpu } = await diagnostic.send("SystemInfo.getInfo");
  report.renderer = { features: gpu.featureStatus, renderer: gpu.auxAttributes.glRenderer };
  assert.equal(gpu.featureStatus.gpu_compositing, "enabled"); await diagnostic.detach();
  for (const reduced of [false, true]) for (const spelling of ["production-seconds", "milliseconds"]) {
    const row = { reduced, spelling, expected: reduced ? 220 : 420, status: "RUNNING" };
    report.cases.push(row); save();
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
      reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await context.newPage();
    try {
      const override = spelling === "milliseconds" ? `--save-page-duration:${row.expected}ms!important;` : "";
      await page.setContent(`<style>${css}
        #fixture{position:absolute;left:100px;top:100px;width:960px;height:500px}
        .save-page-viewport{height:500px;${override}}
      </style><div id="fixture"></div>`);
      await page.evaluate(() => {
        window.__savePageCalls = []; window.__savePageFrames = []; window.__captureSavePage = true;
        const original = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = original.apply(this, args);
          window.__savePageCalls.push({ duration: animation.effect.getTiming().duration,
            layer: this.getAttribute("data-save-page-layer"), at: performance.now() });
          return animation;
        };
        const tick = () => {
          if (!window.__captureSavePage) return;
          const current = document.querySelector(".save-page-current");
          if (current) window.__savePageFrames.push({ at: performance.now(),
            opacity: Number(getComputedStyle(current).opacity), transform: getComputedStyle(current).transform });
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.addScriptTag({ content: compiled });
      await page.getByRole("button", { name: "第1页", exact: true }).waitFor();
      row.token = await page.locator(".save-page-viewport").evaluate(el =>
        getComputedStyle(el).getPropertyValue("--save-page-duration").trim());
      await page.evaluate(() => window.__flipSavePage(1));
      await page.waitForFunction(() => window.__savePageCalls.length === 2);
      row.calls = await page.evaluate(() => window.__savePageCalls);
      assert(row.calls.every(call => call.duration === row.expected),
        `${spelling}: real incoming/outgoing animations must preserve CSS seconds/milliseconds`);
      await page.waitForFunction(() => !document.querySelector('[data-save-page-layer="retained"]'));
      row.frames = await page.evaluate(() => window.__savePageFrames);
      assert(row.frames.filter(f => f.opacity > .02 && f.opacity < .98).length >= 2,
        "Normal and reduced-motion page flip need real intermediate frames");
      assert.equal(await page.getByRole("button", { name: "第2页", exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "第1页", exact: true }).count(), 0);
      row.status = "PASS";
    } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); }
    finally {
      await page.evaluate(() => { window.__captureSavePage = false; }).catch(() => {});
      await context.close(); row.contextClosed = true; save();
    }
  }
  assert.equal(sha(component), report.source.sha256);
  assert.equal(report.cases.length, 4); assert(report.cases.every(c => c.status === "PASS"));
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); report.browserClosed = true; report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.map(c => ({
    reduced: c.reduced, spelling: c.spelling, token: c.token, status: c.status, calls: c.calls, error: c.error,
  })) }));
});
