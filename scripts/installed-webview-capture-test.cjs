"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
assert(process.argv[2] && process.argv[3], "node script <actual-installation-audit> <fresh-output> [--legacy-playwright-capture]");
const out = path.resolve(process.argv[3]); assert(!fs.existsSync(out)); fs.mkdirSync(out);
fs.copyFileSync(path.resolve(process.argv[2]), path.join(out, "installer-resource-report.json"));
const legacy = process.argv.includes("--legacy-playwright-capture");
const report = { status: "RUNNING", legacyDiagnostic: legacy, cases: [] };
let owner, browser;
(async () => {
  owner = await startInstalledEditor(out);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${owner.state.cdpPort}`);
  const page = browser.contexts()[0].pages()[0];
  await page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true }).click({ trial: true });
  const cdp = await page.context().newCDPSession(page);
  for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: dpr, mobile: false });
    const read = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
    const expected = { width: 1920, height: 1080, dpr, reduced }, before = await read();
    assert.deepEqual(before, expected);
    const row = { expected, before }; report.cases.push(row);
    const file = path.join(out, `sample-${dpr}-${reduced}.png`);
    if (legacy) await page.screenshot({ path: file });
    else {
      const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
      row.capture = await captureInstalledWebview(page, cdp, file, expected);
    }
    row.after = await read();
    const png = fs.readFileSync(file);
    row.png = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    assert.deepEqual(row.after, expected, "Capture must not change actual DPR or media mode");
    assert.equal(row.png.width, 1920 * dpr, "Screenshot must record actual device pixels");
    assert.equal(row.png.height, 1080 * dpr);
    row.status = "PASS";
  }
  assert.equal(report.cases.length, 4); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    await browser?.close().catch(() => {});
    if (owner) report.cleanup = await owner.stop();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error }));
  });
