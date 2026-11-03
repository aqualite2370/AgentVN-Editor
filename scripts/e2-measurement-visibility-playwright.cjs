"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { installMeasurementVisibilityTracking, getMeasurementVisibilityFailures } =
  require("./lib/e2-measurement-visibility.cjs");

async function main() {
  const paths = resolveAcceptancePaths();
  fs.mkdirSync(paths.output, { recursive: true });
  const report = { kind: "measurement-visibility-infrastructure-not-product-acceptance",
    status: "RUNNING", project: paths.input, tests: [] };
  let browser, page, browserSession, ownedWindow;
  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    page = await context.newPage();
    await page.setContent('<button id="target">真实点击</button>');
    await page.bringToFront();
    browserSession = await browser.newBrowserCDPSession();
    const pageSession = await context.newCDPSession(page);
    await pageSession.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    report.focusEmulation = "disabled-for-real-window-visibility-infrastructure-test";
    const { targetInfo } = await pageSession.send("Target.getTargetInfo");
    ownedWindow = await browserSession.send("Browser.getWindowForTarget", { targetId: targetInfo.targetId });
    report.ownedWindow = ownedWindow;
    const setWindowState = state => browserSession.send("Browser.setWindowBounds",
      { windowId: ownedWindow.windowId, bounds: { windowState: state } });
    await page.evaluate(() => { window.__advancedLayoutTransitionAudit = { running: false }; });
    await page.evaluate(installMeasurementVisibilityTracking);
    await page.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit;
      state.visibilitySamples = [];
      state.running = true;
      state.samplePageVisibility("start");
      document.querySelector("#target").addEventListener("pointerdown", event => {
        if (event.isTrusted) state.samplePageVisibility("input");
      });
    });
    await page.locator("#target").click();
    const visible = await page.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit;
      state.samplePageVisibility("end");
      state.running = false;
      return state.visibilitySamples;
    });
    assert.deepEqual(getMeasurementVisibilityFailures(visible, { inputRequired: true }), []);
    assert.equal(visible.filter(sample => sample.phase === "input").length, 1);
    report.tests.push({ name: "visible-trusted-input-lifecycle", status: "PASS", samples: visible });

    await page.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit;
      state.visibilitySamples = [];
      state.running = true;
      state.samplePageVisibility("start");
    });
    await setWindowState("minimized");
    const minimized = await browserSession.send("Browser.getWindowBounds", { windowId: ownedWindow.windowId });
    report.minimizedWindowObservation = { windowId: ownedWindow.windowId, ...minimized };
    assert.equal(minimized.bounds.windowState, "minimized", "must prove actual owned window was minimized");
    await page.waitForFunction(() => !document.hasFocus(), null, { timeout: 10_000, polling: 50 });
    await setWindowState("normal");
    await page.bringToFront();
    await page.waitForFunction(() => document.hasFocus(), null, { timeout: 10_000, polling: 50 });
    const hidden = await page.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit;
      state.samplePageVisibility("end");
      state.running = false;
      return state.visibilitySamples;
    });
    assert(hidden.some(sample => sample.phase === "blur" && !sample.hasFocus));
    assert.equal(hidden.at(-1).hidden, false, "ending visible cannot erase an earlier minimized interval");
    assert(getMeasurementVisibilityFailures(hidden, {
      windowStates: [{ phase: "minimized-check", windowId: ownedWindow.windowId, ...minimized }],
    }).some(failure => failure.includes("minimized")));
    report.tests.push({ name: "real-minimized-window-rejected-even-with-visible-DOM-and-foreground-return",
      status: "PASS", samples: hidden, minimized });

    const beforeCleanup = await page.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit;
      state.stopVisibilityTracking();
      state.running = true;
      return state.visibilitySamples.length;
    });
    await setWindowState("minimized");
    await page.waitForFunction(() => !document.hasFocus(), null, { timeout: 10_000, polling: 50 });
    await setWindowState("normal");
    await page.bringToFront();
    await page.waitForFunction(() => document.hasFocus(), null, { timeout: 10_000, polling: 50 });
    assert.equal(await page.evaluate(() => window.__advancedLayoutTransitionAudit.visibilitySamples.length),
      beforeCleanup, "disposed visibility listeners must stop recording");
    assert(getMeasurementVisibilityFailures([]).length > 0);
    assert(getMeasurementVisibilityFailures(visible.filter(sample => sample.phase !== "input"),
      { inputRequired: true }).length > 0);
    assert(getMeasurementVisibilityFailures([...visible].reverse(), { inputRequired: true }).length > 0);
    report.tests.push({ name: "listener-cleanup-and-incomplete-evidence-rejection", status: "PASS" });
    assert.equal(report.tests.length, 3);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    report.failedWindow = ownedWindow ? await browserSession.send("Browser.getWindowBounds",
      { windowId: ownedWindow.windowId }).catch(error => ({ error: String(error) })) : null;
    report.failedVisibility = await page?.evaluate(() => ({
      state: document.visibilityState, hidden: document.hidden, hasFocus: document.hasFocus(),
      samples: window.__advancedLayoutTransitionAudit?.visibilitySamples,
    })).catch(error => ({ error: String(error) }));
    process.exitCode = 1;
  } finally {
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(`${report.status}: ${path.join(paths.output, "report.json")}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
