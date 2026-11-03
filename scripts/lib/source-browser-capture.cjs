"use strict";
// Only for a Playwright-owned browser context with its own viewport/DPR.
// Never use this helper for a CDP-attached native WebView: page.screenshot()
// can reapply that context's defaults and invalidate native emulation evidence.
const fs = require("node:fs"), assert = require("node:assert/strict"), crypto = require("node:crypto");
async function captureSourceBrowser(page, file, expected) {
  assert(!fs.existsSync(file), "Never overwrite historical screenshots");
  const display = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const before = await display(); assert.deepEqual(before, expected);
  const bytes = await page.screenshot({ type: "png", scale: "device" });
  const after = await display(); assert.deepEqual(after, before);
  const png = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  assert.equal(png.width, expected.width * expected.dpr);
  assert.equal(png.height, expected.height * expected.dpr);
  fs.writeFileSync(file, bytes, { flag: "wx" });
  return { path: file, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), before, after, png,
    environment: "PLAYWRIGHT_OWNED_SOURCE_BROWSER_NOT_NATIVE_WEBVIEW" };
}
module.exports = { captureSourceBrowser };
