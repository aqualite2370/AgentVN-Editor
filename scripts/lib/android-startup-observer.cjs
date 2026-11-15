"use strict";
const assert = require("node:assert/strict");

// Re-observe a replaced startup WebView without relaunching the app or
// replaying an input. A changed host process/boot is always a failure.
async function observeStartup({ identity, connect, ready, record = () => {},
  maxReplacements = 2, timeout = 60000, now = Date.now }) {
  const owner = await identity();
  assert(owner.boot && /^\d+$/.test(owner.pid), "Startup owner must be attributable");
  const deadline = now() + timeout;
  let session;
  for (let attempt = 0; attempt <= maxReplacements; attempt++) {
    assert.deepEqual(await identity(), owner, "Startup host or boot changed");
    assert(now() < deadline, "Startup observation deadline exceeded");
    session = await connect(deadline - now());
    record({ kind: "connected", attempt, owner, url: session.page.url() });
    try {
      await ready(session.page, Math.max(1, deadline - now()));
      assert.deepEqual(await identity(), owner, "Startup host or boot changed");
      assert(!session.page.isClosed() && session.browser.isConnected(), "Ready page disappeared");
      record({ kind: "ready", attempt, owner, url: session.page.url() });
      return { ...session, owner, replacements: attempt };
    } catch (error) {
      const replaced = session.page.isClosed() || !session.browser.isConnected();
      // Do not swallow a genuine selector/assertion/timeout or arbitrary
      // script failure merely because it happened during startup.
      const closedError = /Target (?:page|browser|context).*closed|browser has been closed/i.test(String(error));
      record({ kind: "observation-error", attempt, owner, replaced,
        error: String(error), at: new Date().toISOString() });
      if (!replaced || !closedError || attempt >= maxReplacements || now() >= deadline) throw error;
      assert.deepEqual(await identity(), owner, "Startup host or boot changed");
      await session.disconnect();
    }
  }
  throw Error("Startup observation exhausted");
}
module.exports = { observeStartup };
