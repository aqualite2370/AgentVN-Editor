"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const audit = path.resolve(process.argv[2]), out = path.resolve(process.argv[3]); assert(!fs.existsSync(out)); fs.mkdirSync(out); fs.copyFileSync(audit, path.join(out, "installer-resource-report.json"));
const report = { status: "RUNNING", steps: [] }; let owner, browser;
(async () => {
  owner = await startInstalledEditor(out); browser = await chromium.connectOverCDP(`http://127.0.0.1:${owner.state.cdpPort}`);
  const page = browser.contexts()[0].pages()[0]; const cdp = await browser.contexts()[0].newCDPSession(page);
  await page.locator("#root").waitFor();
  for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: dpr, mobile: false });
    const read = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches }));
    const before = await read();
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(out, `sample-${dpr}-${reduced}.png`), Buffer.from(screenshot.data, "base64"));
    const after = await read();
    report.steps.push({ expected: { dpr, reduced }, before, after });
    console.log(JSON.stringify(report.steps.at(-1)));
  }
  assert(report.steps.every(step => step.before.dpr === step.expected.dpr && step.before.reduced === step.expected.reduced
    && step.after.dpr === step.expected.dpr && step.after.reduced === step.expected.reduced)); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); if (owner) report.cleanup = await owner.stop(); fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2)); console.log(report.status); });
