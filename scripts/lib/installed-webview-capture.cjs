"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { sha256 } = require("./installed-acceptance.cjs");
async function readInstalledViewport(page, expected) {
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  assert.equal(actual.width, expected.width, "Actual native WebView viewport width differs from requested matrix");
  assert.equal(actual.height, expected.height, "Actual native WebView viewport height differs from requested matrix");
  assert.equal(actual.reduced, expected.reduced, "Actual native WebView reduced-motion state differs from requested matrix");
  assert(Math.abs(actual.dpr - expected.dpr) <= 0.001,
    `Actual native WebView DPR differs from requested matrix: ${actual.dpr} vs ${expected.dpr}`);
  return actual;
}
async function captureInstalledWebview(page, cdp, file, expected) {
  const before = await readInstalledViewport(page, expected);
  // Playwright page.screenshot() re-applies its context's default metrics for
  // CDP-attached native WebViews. Raw CDP preserves the actual emulation state.
  const captured = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(captured.data, "base64");
  const after = await readInstalledViewport(page, expected);
  const png = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  assert.equal(png.width, expected.width * expected.dpr, "Capture must preserve device pixel width");
  assert.equal(png.height, expected.height * expected.dpr, "Capture must preserve device pixel height");
  fs.writeFileSync(file, bytes, { flag: "wx" });
  return { path: file, sha256: sha256(bytes), before, after, png };
}
module.exports = { captureInstalledWebview, readInstalledViewport };
