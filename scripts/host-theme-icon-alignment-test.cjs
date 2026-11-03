"use strict";
// Read-only assertions against the real installed WebView, never a source browser.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const [launchFile, destination] = process.argv.slice(2);
assert(launchFile && destination && !fs.existsSync(destination), "Fresh evidence directory required");
const launch = JSON.parse(fs.readFileSync(launchFile, "utf8"));
fs.mkdirSync(destination);
let browser;
const report = { status: "RUNNING", scope: "READ_ONLY_INSTALLED_THEME_ICON_GEOMETRY",
  version: launch.actualVersion, executableSha256: launch.executableSha256, startedAt: new Date().toISOString() };
(async () => {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
  assert(page, "Actual installed page is missing");
  const geometry = await page.locator(".theme-tone-switch:visible").evaluate(button => {
    const thumb = button.querySelector(".theme-switch-thumb");
    const icons = [...thumb.querySelectorAll(".theme-icon")]
      .filter(icon => Number(getComputedStyle(icon).opacity) > 0.99);
    const t = thumb.getBoundingClientRect();
    return { button: button.getBoundingClientRect().toJSON(), thumb: t.toJSON(),
      icons: icons.map(icon => {
        const r = icon.getBoundingClientRect();
        return { className: icon.getAttribute("class"), rect: r.toJSON(),
          deltaX: r.x + r.width / 2 - (t.x + t.width / 2),
          deltaY: r.y + r.height / 2 - (t.y + t.height / 2),
          outsideThumb: r.left < t.left - 0.75 || r.right > t.right + 0.75
            || r.top < t.top - 0.75 || r.bottom > t.bottom + 0.75 };
      }) };
  });
  report.geometry = geometry;
  const expected = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const cdp = await page.context().newCDPSession(page);
  report.capture = await captureInstalledWebview(page, cdp, path.join(destination, "installed-theme-icon.png"), expected);
  assert.equal(geometry.icons.length, 1, "Exactly one settled visible theme icon required");
  for (const icon of geometry.icons) {
    assert(Math.abs(icon.deltaX) <= 0.75 && Math.abs(icon.deltaY) <= 0.75 && !icon.outsideThumb,
      `Theme icon is not centered/contained: ${JSON.stringify(icon)}`);
  }
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    // Disconnect CDP only, do not close the native window or its browser process.
    await browser?.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  });
