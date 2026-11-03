"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const out = process.argv[2]; assert(out && !fs.existsSync(out));
(async () => {
  const results = [];
  for (const args of [[], ["--use-angle=d3d11"], ["--disable-frame-rate-limit", "--disable-gpu-vsync"]]) {
    const browser = await chromium.launch({ headless: true, args });
    try {
      const cdp = await browser.newBrowserCDPSession();
      const info = await cdp.send("SystemInfo.getInfo");
      const page = await browser.newPage({ viewport: { width: 3840, height: 2160 } });
      await page.setContent('<div style="position:fixed;inset:0;background:linear-gradient(#fdf4ee,#ddd);filter:blur(2px)">Viewport diagnostic</div>');
      const frames = await page.evaluate(() => new Promise(resolve => {
        const samples = [];
        function frame(t) { samples.push(t); if (samples.length >= 15) resolve(samples); else requestAnimationFrame(frame); }
        requestAnimationFrame(frame);
      }));
      results.push({ args, gpu: info.gpu, frames, deltas: frames.slice(1).map((t, i) => t - frames[i]) });
    } finally { await browser.close(); }
  }
  fs.writeFileSync(out, JSON.stringify({ scope: "BLANK_BROWSER_RENDER_DIAGNOSTIC_NOT_PRODUCT_ACCEPTANCE", results }, null, 2), { flag: "wx" });
  console.log(JSON.stringify(results.map(r => ({ args: r.args, gpu: r.gpu.devices, deltas: r.deltas }))));
})().catch(e => { console.error(e); process.exitCode = 1; });
