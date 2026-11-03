"use strict";
// Test-only fallback when Computer Use is unavailable. This is a real native
// Tauri close request, NOT physical Alt+F4 or a system-button interaction.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const [launchFile, destination] = process.argv.slice(2);
assert(launchFile && destination && !fs.existsSync(destination), "Fresh close receipt required");
const launch = JSON.parse(fs.readFileSync(launchFile, "utf8"));
const capture = JSON.parse(fs.readFileSync(path.join(path.dirname(launchFile),
  launch.phase + "-capture-audit.json"), "utf8"));
assert.equal(capture.status, "PASS");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  method: "Native Tauri close command (not physical input)", launchFile,
  cdpPort: launch.cdpPort, physicalInputVerified: false };
let browser;
(async () => {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
  assert(page, "Owned installed WebView missing");
  report.url = page.url();
  const closed = page.waitForEvent("close", { timeout: 15000 });
  closed.catch(() => {});
  const invocation = page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
  invocation.catch(() => {});
  await Promise.race([closed, invocation]);
  await closed;
  // A closing WebView can destroy the execution context before IPC resolves.
  await invocation.catch(error => { report.closingContextResult = String(error); });
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    await browser?.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  });
