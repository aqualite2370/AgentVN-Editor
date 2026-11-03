"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const [launchFile, destination] = process.argv.slice(2);
assert(launchFile && destination && !fs.existsSync(destination), "Fresh old-runtime behavior evidence required");
fs.mkdirSync(destination);
const launch = JSON.parse(fs.readFileSync(launchFile, "utf8"));
assert.equal(launch.status, "PASS");
assert.equal(launch.executable.actualPeVersion, "1.8.0");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_HISTORICAL_PLAYER_BINARY_CARTRIDGE_BEHAVIOR_NOT_CURRENT_VERSION_SIMULATION",
  case: launch.case, executable: launch.executable, fixture: launch.fixture, checks: [], screenshots: [] };
let browser;
function check(name, condition, details) {
  report.checks.push({ name, status: condition ? "PASS" : "FAILED", details });
}
(async () => {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
  assert(page, "Actual old WebView page missing");
  const cdp = await page.context().newCDPSession(page);
  // A real WebView emulated viewport, explicitly not a physical 1080p screen.
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  await page.waitForFunction(() => /开始游戏|无法|失败|版本|不兼容/.test(document.body.innerText), null, { timeout: 20000 });
  // Wait for bounded entry effects through their actual animation state.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  report.initialText = await page.locator("body").innerText();
  report.initialAccessibility = await page.locator("body").ariaSnapshot();
  report.viewportType = "Actual old native WebView emulated 1920x1080 DPR1 ordinary mode, not complete desktop matrix";
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, "initial.png"), expected));
  const start = page.getByRole("button", { name: "开始游戏", exact: true });
  const startVisible = await start.isVisible();
  const startEnabled = startVisible && await start.isEnabled();
  const canStart = startVisible && startEnabled;
  report.startControl = { visible: startVisible, enabled: startEnabled };
  if (launch.fixture.expectedOldBehavior === "ACCEPT") {
    check("Old supported control reaches correct game title", canStart && report.initialText.includes(launch.fixture.title));
    if (canStart) {
      await start.click();
      await page.getByText(launch.fixture.sentinel, { exact: true }).waitFor({ timeout: 20000 });
      report.playText = await page.locator("body").innerText();
      check("Real Start action plays control narration", report.playText.includes(launch.fixture.sentinel));
      report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, "control-play.png"), expected));
    }
  } else {
    const meaningfulRefusal = /版本|不兼容|不支持/.test(report.initialText)
      && /更新|升级|过低|支持|要求/.test(report.initialText);
    check("Old binary refuses new capability before enabling Start", !canStart, { canStart });
    check("Player shows explicit version/capability refusal", meaningfulRefusal, { text: report.initialText });
    if (launch.case === "advanced-layout") {
      report.refusalStage = "OLD_LAYOUT_SCHEMA_VALIDATION_BEFORE_PROTOCOL_VALIDATION";
      check("Layout refusal identifies actual unsupported schema and component",
        /ui_layout_version/.test(report.initialText) && /2\.0\.0/.test(report.initialText)
        && /1\.0\.0/.test(report.initialText) && /component_type[^\n]*mask/.test(report.initialText));
      report.minimumRuntimeGate = "NOT_REACHED: actual old layout schema validator rejected first";
    } else {
      report.refusalStage = "RUNTIME_PROTOCOL_VALIDATION";
      check("Refusal identifies required and actual Runtime protocol versions",
        report.initialText.includes(launch.fixture.minimumRuntimeVersion) && report.initialText.includes("0.5.0"));
    }
    check("Unsupported narration is not rendered", !report.initialText.includes(launch.fixture.sentinel));
    if (canStart) {
      // If it incorrectly accepts, exercise the real visible button to
      // determine whether unsupported content is silently played.
      await start.click();
      const outcome = await Promise.race([
        page.getByText(launch.fixture.sentinel, { exact: true }).waitFor({ timeout: 15000 }).then(() => "SENTINEL_PLAYED"),
        page.waitForFunction(() => /版本过低|不兼容|不支持.*功能|无法.*卡带/.test(document.body.innerText),
          null, { timeout: 15000 }).then(() => "LATE_REFUSAL")
      ]).catch(error => `NO_PROVEN_TERMINAL:${error.message}`);
      report.actualStartOutcome = outcome;
      report.playText = await page.locator("body").innerText();
      check("Unsupported story is never silently played", outcome !== "SENTINEL_PLAYED", { outcome });
      report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, "unexpected-start.png"), expected));
    }
  }
  const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  check("Actual refusal/control viewport does not overflow horizontally", overflow.scrollWidth <= overflow.width + 1, overflow);
  if (launch.fixture.expectedOldBehavior === "REJECT") {
    report.errorGeometry = await page.getByRole("alert").evaluate(alert => {
      const rect = alert.getBoundingClientRect();
      const buttons = [...alert.querySelectorAll("button")].map(button => {
        const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { text: button.textContent, rect: r.toJSON(), hit: hit === button || button.contains(hit),
          inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
      });
      return { rect: rect.toJSON(), width: innerWidth, height: innerHeight, buttons };
    });
    check("Long refusal and retry/copy controls remain bounded and hittable",
      report.errorGeometry.rect.left >= 0 && report.errorGeometry.rect.top >= 0
      && report.errorGeometry.rect.right <= report.errorGeometry.width
      && report.errorGeometry.rect.bottom <= report.errorGeometry.height
      && report.errorGeometry.buttons.length === 2 && report.errorGeometry.buttons.every(b => b.inside && b.hit),
      report.errorGeometry);
  }
})().catch(error => { report.error = String(error.stack || error); })
  .finally(async () => {
    await browser?.close().catch(() => {});
    report.status = report.error || !report.checks.length || report.checks.some(c => c.status !== "PASS") ? "FAILED" : "PASS";
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  });
