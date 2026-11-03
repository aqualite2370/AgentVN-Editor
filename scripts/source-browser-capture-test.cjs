"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const output = process.argv[2]; assert(output && !fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", cases: [] };
let browser;
(async () => {
  browser = await chromium.launch();
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2])
    for (const reduced of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      const page = await context.newPage();
      try {
        await page.setContent('<main style="font-size:32px;background:#183148;color:white">Source capture parameter self-test</main>');
        const expected = { width, height, dpr, reduced }, name = `${width}-${dpr}-${reduced}`;
        const shot = await captureSourceBrowser(page, path.join(output, `${name}.png`), expected);
        await assert.rejects(captureSourceBrowser(page, path.join(output, `${name}-invalid.png`),
          { ...expected, dpr: dpr + 1 }));
        assert(!fs.existsSync(path.join(output, `${name}-invalid.png`)));
        report.cases.push({ ...expected, status: "PASS", shot, wrongParameterRejected: true });
      } finally { await context.close(); }
    }
  assert.equal(report.cases.length, 12); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output }));
});
