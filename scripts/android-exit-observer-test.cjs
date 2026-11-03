"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { observeAndroidExit } = require("./lib/android-exit-observer.cjs");
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.evaluate(() => {
      const callbacks = new Map(), sent = [], bridge = {};
      Object.defineProperty(bridge, "invoke", { value: function(cmd) {
        return new Promise((resolve, reject) => {
          const callback = 101, error = 102;
          callbacks.set(callback, resolve); callbacks.set(error, reject);
          bridge.postMessage({ cmd, callback, error });
        });
      } });
      Object.defineProperty(bridge, "postMessage", { value: function(message) { sent.push(message); } });
      Object.defineProperty(bridge, "runCallback", { value: function(id, data) { callbacks.get(id)(data); } });
      window.__TAURI_INTERNALS__ = bridge;
      window.__testNativeSent = sent;
      window.__testOriginalBridge = Object.values(Object.getOwnPropertyDescriptors(bridge)).map(d => d.value);
    });
    const client = await page.context().newCDPSession(page);
    const observer = await observeAndroidExit(client);
    await page.evaluate(() => { window.__testResult = window.__TAURI_INTERNALS__.invoke("native-close-probe"); });
    const pending = await observer.snapshot();
    assert.equal(pending.pauses, 0);
    assert.equal(pending.trace.invocations.length, 1);
    assert.equal(pending.trace.invocations[0].command, "native-close-probe");
    assert.deepEqual(pending.trace.calls.map(c => [c.command, c.callback, c.error]), [["native-close-probe", 101, 102]]);
    assert.equal(pending.trace.replies.length, 0, "unanswered native IPC remains pending");
    await page.evaluate(() => window.__TAURI_INTERNALS__.runCallback(101, "done"));
    assert.equal(await page.evaluate(() => window.__testResult), "done");
    const completed = await observer.snapshot();
    assert.equal(completed.trace.replies.length, 1); assert.equal(completed.trace.replies[0].id, 101);
    assert(Object.values(completed.descriptors).every(d => d.writable === false && d.configurable === false));
    const cleanup = await observer.stop(); assert.equal(cleanup.removedBreakpoints, 3); assert.equal(cleanup.pauses, 0);
    assert.equal(await page.evaluate(() => Object.values(Object.getOwnPropertyDescriptors(window.__TAURI_INTERNALS__))
      .every((d, i) => d.value === window.__testOriginalBridge[i])), true);
    assert.equal(await page.evaluate(() => "__qaAndroidExitTrace" in window), false);
    console.log("PASS sealed IPC: actual call observation, pending/reply correlation, native function identity, cleanup");
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
