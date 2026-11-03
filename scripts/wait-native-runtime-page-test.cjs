"use strict";
const assert = require("node:assert/strict"), { EventEmitter } = require("node:events");
const { isRuntimeURL, waitNativeRuntimePage } = require("./lib/wait-native-runtime-page.cjs");
function fixture(urls) {
  const browser = new EventEmitter(), context = new EventEmitter(), pages = urls.map(url => {
    const page = new EventEmitter();
    page.address = url; page.closed = false; page.url = () => page.address; page.isClosed = () => page.closed;
    return page;
  });
  browser.contexts = () => [context]; context.pages = () => pages;
  const clean = () => [browser, context, ...pages].every(x => x.eventNames().every(e => x.listenerCount(e) === 0));
  return { browser, context, pages, clean };
}
(async () => {
  let checks = 0;
  const f = fixture(["about:blank"]);
  assert.equal(f.browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")), undefined,
    "Reproduce the exact legacy synchronous-selection failure");
  const events = [], pending = waitNativeRuntimePage(f.browser, { observe: e => events.push(e) });
  f.pages[0].address = "http://tauri.localhost/index.html"; f.pages[0].emit("framenavigated");
  assert.equal(await pending, f.pages[0]); assert(f.clean());
  assert.deepEqual(events.map(e => e.reason), ["connected", "navigation"]); checks++;
  const immediate = fixture(["http://tauri.localhost/"]);
  assert.equal(await waitNativeRuntimePage(immediate.browser), immediate.pages[0]); assert(immediate.clean()); checks++;
  const future = fixture([]);
  const later = waitNativeRuntimePage(future.browser);
  const page = fixture(["https://tauri.localhost/"]).pages[0]; future.pages.push(page); future.context.emit("page", page);
  assert.equal(await later, page); assert(future.clean()); checks++;
  for (const url of ["https://example.com/tauri.localhost", "http://tauri.localhost.evil/", "file:///tauri.localhost"])
    assert.equal(isRuntimeURL(url), false);
  const ambiguous = fixture(["http://tauri.localhost/", "https://tauri.localhost/"]);
  await assert.rejects(waitNativeRuntimePage(ambiguous.browser), /ambiguous/); assert(ambiguous.clean()); checks++;
  const closed = fixture(["about:blank"]), waiting = waitNativeRuntimePage(closed.browser);
  closed.browser.emit("disconnected"); await assert.rejects(waiting, /disconnected/); assert(closed.clean()); checks++;
  const never = fixture(["about:blank"]);
  await assert.rejects(waitNativeRuntimePage(never.browser, { timeout: 15 }), /deadline/); assert(never.clean()); checks++;
  console.log(JSON.stringify({ status: "PASS", checks, scope: "QA_EVENT_READINESS_ONLY", productChanges: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
