"use strict";
// Read-only event/DOM observation of an already attributed QA Player.
// Never synthesizes input or changes application state.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const input = process.argv[2], output = process.argv[3];
assert(input && output && !fs.existsSync(output));
const raw = JSON.parse(fs.readFileSync(input, "utf8"));
const owner = raw.launches.at(-1);
assert(owner && !owner.cleanup);
let browser, page;
const report = { status: "RUNNING", input, owner, events: [], error: null,
  observationOnly: true, syntheticInput: false, at: new Date().toISOString() };
(async () => {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${owner.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  await page.evaluate(() => {
    const state = () => {
      const d = document.querySelector(".dialog-box"), t = d?.querySelector(".dialog-text");
      return { page: d?.dataset.dialogPage, pages: d?.dataset.dialogPages,
        done: d?.dataset.dialogPageDone, textLength: t?.textContent.length,
        command: document.querySelector('[data-testid="game-state-playing"]')?.dataset.currentCommandIndex };
    };
    const events = [], listeners = [];
    const record = extra => {
      if (events.length < 10000) events.push({ at: performance.now(), ...state(), ...extra });
    };
    for (const name of ["pointerdown", "pointerup", "click", "keydown", "keyup"]) {
      const fn = e => {
        if (!e.target.closest?.(".dialog-box")) return;
        record({ event: name, detail: e.detail, trusted: e.isTrusted, key: e.key });
      };
      document.addEventListener(name, fn, true); listeners.push([name, fn]);
    }
    let previous = "";
    const observer = new MutationObserver(() => {
      const current = JSON.stringify(state());
      if (current !== previous) { previous = current; record({ event: "DOM" }); }
    });
    observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    record({ event: "attached" });
    window.__qaPaginationObservation = { events, stop() {
      observer.disconnect(); for (const [n, f] of listeners) document.removeEventListener(n, f, true);
    } };
  });
  for (let i = 0; i < 80; i++) {
    try {
      report.events = await page.evaluate(() => window.__qaPaginationObservation.events);
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
      await new Promise(resolve => setTimeout(resolve, 250));
    } catch (e) { report.disconnect = String(e); break; }
  }
  report.status = report.events.length ? "OBSERVED" : "EMPTY";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    if (page) await page.evaluate(() => {
      window.__qaPaginationObservation?.stop(); delete window.__qaPaginationObservation;
    }).catch(() => {});
    await browser?.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, events: report.events.length, output, error: report.error }));
  });
