"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { installPerformanceObservers, finishPerformanceObservation } = require("./lib/e2-performance-observers.cjs");

async function main() {
  const paths = resolveAcceptancePaths();
  fs.mkdirSync(paths.output, { recursive: true });
  const report = {
    status: "RUNNING", kind: "real-browser-audit-observer-regression-not-editor-ui-acceptance",
    projectPath: paths.input, viewport: { width: 1920, height: 1080 }, tests: [],
  };
  let browser;
  try {
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: report.viewport });
    await page.setContent("<!doctype html><div id='marker'>Performance observer boundary fixture</div>");
    await page.evaluate(() => {
      window.__advancedLayoutTransitionAudit = {
        start: 0, longTasks: [], longAnimationFrames: [], raw: [],
        onRawPerformanceEntry(kind, entry) {
          this.raw.push({ kind, startTime: entry.startTime, duration: entry.duration });
        },
      };
    });
    await page.evaluate(installPerformanceObservers);
    report.boundaryWindow = await page.evaluate(async () => {
      const state = window.__advancedLayoutTransitionAudit;
      if (!state.longAnimationFrameSupported) throw new Error("Real Long Animation Frame API unavailable");
      return new Promise(resolve => requestAnimationFrame(() => {
        const workloadStart = performance.now();
        while (performance.now() - workloadStart < 25) {}
        state.start = performance.now();
        const remainingStart = performance.now();
        while (performance.now() - remainingStart < 65) {}
        document.querySelector("#marker").textContent = "rendered after measurement-window start";
        resolve({ workloadStart, start: state.start, workloadEnd: performance.now() });
      }));
    });
    await page.waitForFunction(() => {
      const state = window.__advancedLayoutTransitionAudit;
      return state.raw.some(entry => entry.kind === "long-animation-frame"
        && entry.startTime < state.start && entry.startTime + entry.duration > state.start);
    }, null, { timeout: 10_000 });
    report.boundaryEvidence = await page.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit;
      return { start: state.start, raw: state.raw, frames: state.longAnimationFrames, tasks: state.longTasks };
    });
    const rawCrossing = report.boundaryEvidence.raw.filter(entry => entry.kind === "long-animation-frame"
      && entry.startTime < report.boundaryEvidence.start
      && entry.startTime + entry.duration > report.boundaryEvidence.start);
    assert(rawCrossing.length > 0, "browser must actually deliver a boundary-crossing long frame");
    assert(report.boundaryEvidence.frames.some(entry => rawCrossing.some(raw =>
      raw.startTime === entry.startTime && raw.duration === entry.duration)),
    "actual observer must retain a frame that starts before the measurement window but overlaps it");
    assert(report.boundaryEvidence.tasks.some(entry => entry.startTime < report.boundaryEvidence.start
      && entry.startTime + entry.duration > report.boundaryEvidence.start),
    "actual observer must retain the crossing long task");
    report.tests.push({ name: "real-boundary-crossing-frame-and-task", status: "PASS" });

    // Stop inside a real busy rendering frame, before its LoAF can be
    // generated. Exercise the same finishing function used by the audit.
    await page.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit;
      state.longTasks = [];
      state.longAnimationFrames = [];
      state.raw = [];
    });
    await page.evaluate(fn => { window.__finishObservation = (0, eval)(`(${fn})`); },
      finishPerformanceObservation.toString());
    report.endBoundary = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(async () => {
      const state = window.__advancedLayoutTransitionAudit;
      state.start = performance.now();
      state.running = true;
      state.onObservationEnd = end => { state.stoppedAt = end; };
      const busyStart = performance.now();
      while (performance.now() - busyStart < 75) {}
      document.querySelector("#marker").textContent = "rendered at observation stop";
      const boundary = await window.__finishObservation();
      resolve({ boundary, start: state.start, running: state.running,
        stoppedAt: state.stoppedAt, frames: state.longAnimationFrames, tasks: state.longTasks });
    })));
    assert.equal(report.endBoundary.running, false);
    assert.equal(report.endBoundary.stoppedAt, report.endBoundary.boundary.end);
    assert(report.endBoundary.boundary.deliveredAt > report.endBoundary.boundary.end);
    if (!report.endBoundary.frames.length) {
      await page.waitForFunction(() => window.__advancedLayoutTransitionAudit.raw
        .some(entry => entry.kind === "long-animation-frame"), null, { timeout: 10_000 }).catch(() => {});
      report.lateDeliveryEvidence = await page.evaluate(() => {
        const state = window.__advancedLayoutTransitionAudit;
        return { now: performance.now(), raw: state.raw, frames: state.longAnimationFrames };
      });
    }
    assert(report.endBoundary.frames.some(entry => entry.startTime < report.endBoundary.boundary.end
      && entry.startTime + entry.duration > report.endBoundary.start),
    "finishing must retain the final real frame, even when not generated at stop time");
    assert(report.endBoundary.tasks.some(entry => entry.startTime < report.endBoundary.boundary.end
      && entry.startTime + entry.duration > report.endBoundary.start));
    report.repeatedEndBoundary = await page.evaluate(finishPerformanceObservation);
    assert.equal(report.repeatedEndBoundary.end, report.endBoundary.boundary.end,
      "a repeated stop must preserve the original measurement endpoint");
    report.tests.push({ name: "real-final-frame-delivery-with-fixed-endpoint", status: "PASS" });

    // Deterministic queued-record seam: stopping before callback delivery
    // must not discard records, and draining twice must not duplicate them.
    const pendingPage = await browser.newPage();
    await pendingPage.evaluate(() => {
      window.__advancedLayoutTransitionAudit = { start: 100, longTasks: [], longAnimationFrames: [] };
      window.PerformanceObserver = class {
        static supportedEntryTypes = ["long-animation-frame"];
        constructor(callback) { this.callback = callback; this.records = []; }
        observe(options) {
          this.records = [options.type === "long-animation-frame"
            ? { startTime: 95, duration: 60, blockingDuration: 10, renderStart: 150,
                styleAndLayoutStart: 151, scripts: [] }
            : { name: "self", startTime: 99, duration: 65 }];
        }
        takeRecords() { const records = this.records; this.records = []; return records; }
      };
    });
    await pendingPage.evaluate(installPerformanceObservers);
    report.drainEvidence = await pendingPage.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit;
      state.drainPerformanceObservers();
      state.drainPerformanceObservers();
      return { tasks: state.longTasks, frames: state.longAnimationFrames };
    });
    assert.equal(report.drainEvidence.tasks.length, 1);
    assert.equal(report.drainEvidence.frames.length, 1);
    report.tests.push({ name: "pending-record-drain-without-duplicates", status: "PASS" });

    await pendingPage.evaluate(() => {
      const state = window.__advancedLayoutTransitionAudit;
      state.start = performance.now() - 10;
      state.longTasks = [{ name: "self", startTime: state.start - 1, duration: 100 }];
      state.longAnimationFrames = [];
      state.longAnimationFrameSupported = true;
      const nativeTimer = window.setTimeout;
      // Exercise the real timeout failure path without a ten-second test wait.
      window.setTimeout = callback => nativeTimer(callback, 0);
    });
    await assert.rejects(() => pendingPage.evaluate(finishPerformanceObservation),
      /Performance collection incomplete/);
    await assert.rejects(() => pendingPage.evaluate(finishPerformanceObservation),
      /Performance collection incomplete/);
    report.tests.push({ name: "missing-final-frame-is-collection-failure", status: "PASS" });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(`${report.status}: ${path.join(paths.output, "report.json")}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
