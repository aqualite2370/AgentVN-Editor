"use strict";
function displayMatches(v, physical, expected) {
  return physical.width === expected.width && physical.height === expected.height &&
    Number.isFinite(v.dpr) && v.dpr > 0 && v.ready === true &&
    Math.abs(v.width * v.dpr - physical.width) <= 2 &&
    Math.abs(v.height * v.dpr - physical.height) <= 2 &&
    Math.abs(v.visualWidth - v.width) <= 1 && Math.abs(v.visualHeight - v.height) <= 1 &&
    Math.abs(v.scopeWidth - v.visualWidth) <= 1 && Math.abs(v.scopeHeight - v.visualHeight) <= 1;
}
async function settleDisplay({ page, cmd, expected, timeout = 30000 }) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) {
    const bytes = cmd(["exec-out", "screencap", "-p"], { binary: true }).stdout;
    if (bytes.length < 24 || bytes.subarray(1, 4).toString() !== "PNG") throw Error("Fresh device PNG required");
    const physical = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    const viewport = await page.evaluate(() => {
      const s = document.querySelector('.ui-skin-scope');
      return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        visualWidth: visualViewport.width, visualHeight: visualViewport.height,
        scopeWidth: parseFloat(s?.style.width), scopeHeight: parseFloat(s?.style.height),
        ready: s?.getAttribute("data-ui-viewport-ready") === "true" };
    });
    last = { physical, viewport };
    if (displayMatches(viewport, physical, expected)) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error("Android display and WebView coordinate frame did not settle: " + JSON.stringify(last));
}
module.exports = { displayMatches, settleDisplay };
