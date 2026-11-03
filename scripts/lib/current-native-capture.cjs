"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { sha256 } = require("./installed-acceptance.cjs");
function validateNativeViewport(actual, expected) {
  assert.equal(actual.width, expected.width, "Native viewport width mismatch");
  assert.equal(actual.height, expected.height, "Native viewport height mismatch");
  assert.equal(actual.reduced, expected.reduced, "Native reduced-motion mismatch");
  assert(Number.isFinite(actual.dpr) && Number.isFinite(expected.dpr)
    && expected.dpr > 0 && Math.abs(actual.dpr - expected.dpr) <= 1e-6,
  "Native DPR differs beyond floating-point tail tolerance");
  return actual; // Preserve raw devicePixelRatio; never round evidence.
}
async function readInstalledViewport(page, expected) {
  return validateNativeViewport(await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches })), expected);
}
async function captureInstalledWebview(page, cdp, file, expected) {
  const before = await readInstalledViewport(page, expected);
  const captured = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(captured.data, "base64");
  const after = await readInstalledViewport(page, expected);
  assert.deepEqual(after, before, "Capture changed actual viewport/DPR/media");
  const png = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  assert.equal(png.width, expected.width * expected.dpr, "PNG device width mismatch");
  assert.equal(png.height, expected.height * expected.dpr, "PNG device height mismatch");
  fs.writeFileSync(file, bytes, { flag: "wx" });
  return { path: file, sha256: sha256(bytes), before, after, png, dprTailTolerance: 1e-6 };
}
module.exports = { validateNativeViewport, readInstalledViewport, captureInstalledWebview };
