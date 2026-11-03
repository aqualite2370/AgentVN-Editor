"use strict";
// QA only: the DevTools endpoint can precede creation/navigation of its page.
// Resolve from actual Playwright events; never treat endpoint readiness as UI readiness.
const assert = require("node:assert/strict");
function isRuntimeURL(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname === "tauri.localhost";
  } catch { return false; }
}
function waitNativeRuntimePage(browser, { timeout = 20000, observe = () => {} } = {}) {
  assert(Number.isFinite(timeout) && timeout > 0);
  return new Promise((resolve, reject) => {
    const subscriptions = [], contexts = new Set(), pages = new Set();
    let timer, settled = false;
    function on(owner, event, fn) {
      owner.on(event, fn); subscriptions.push(() => owner.off(event, fn));
    }
    function finish(error, page) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      for (const remove of subscriptions.reverse()) remove();
      error ? reject(error) : resolve(page);
    }
    function scan(reason) {
      if (settled) return;
      try {
        for (const context of browser.contexts()) {
          if (!contexts.has(context)) {
            contexts.add(context); on(context, "page", () => scan("page-created"));
          }
          for (const page of context.pages()) if (!pages.has(page)) {
            pages.add(page);
            on(page, "framenavigated", () => scan("navigation"));
            on(page, "close", () => scan("page-closed"));
          }
        }
        const candidates = [...pages].filter(p => !p.isClosed() && isRuntimeURL(p.url()));
        observe({ reason, urls: [...pages].filter(p => !p.isClosed()).map(p => p.url()),
          candidates: candidates.length });
        if (candidates.length > 1) finish(Error("Multiple native Runtime pages; ownership is ambiguous"));
        else if (candidates.length === 1) finish(null, candidates[0]);
      } catch (error) { finish(error); }
    }
    on(browser, "disconnected", () => finish(Error("Native browser disconnected before Runtime page readiness")));
    // Chromium normally exposes its context at connect time. A later context
    // is discovered when browser target creation is forwarded by the caller.
    on(browser, "context", () => scan("context-created"));
    timer = setTimeout(() => {
      scan("timeout");
      if (!settled) finish(Error("Native Runtime page did not navigate to tauri.localhost before deadline"));
    }, timeout);
    scan("connected");
  });
}
module.exports = { isRuntimeURL, waitNativeRuntimePage };
