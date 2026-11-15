"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { observeStartup } = require("./lib/android-startup-observer.cjs");
const owner = { boot: "test-boot", pid: "2441" };
function setup(failures = 0) {
  const state = { connections: 0, disconnects: 0, events: [] };
  return { state, args: {
    identity: async () => owner,
    connect: async () => {
      const index = state.connections++; let closed = false;
      return { page: { url: () => "http://tauri.localhost/" + index, isClosed: () => closed,
        closeForTest: () => { closed = true; } },
      browser: { isConnected: () => true },
      disconnect: async () => { state.disconnects++; } };
    },
    ready: async page => {
      if (state.connections <= failures) {
        page.closeForTest(); throw Error("page.waitForFunction: Target page, context or browser has been closed");
      }
    },
    record: e => state.events.push(e)
  } };
}
test("stable startup commits once without another connection", async () => {
  const { args, state } = setup(); const result = await observeStartup(args);
  assert.equal(result.replacements, 0); assert.equal(state.connections, 1); assert.equal(state.disconnects, 0);
});
test("replaced startup document reacquired without a new host or boot", async () => {
  const { args, state } = setup(1); const result = await observeStartup(args);
  assert.equal(result.replacements, 1); assert.equal(state.disconnects, 1);
  assert.deepEqual(state.events.map(e => e.kind), ["connected", "observation-error", "connected", "ready"]);
});
test("unclosed page assertion failure must not retry", async () => {
  const { args, state } = setup(); args.ready = async () => { throw Error("wrong title screen"); };
  await assert.rejects(observeStartup(args), /wrong title/); assert.equal(state.connections, 1);
});
test("ordinary readiness timeout must not retry", async () => {
  const { args, state } = setup(); args.ready = async () => { throw Error("Timeout 45000ms exceeded"); };
  await assert.rejects(observeStartup(args), /Timeout/); assert.equal(state.connections, 1);
});
test("process death or restart is not a document replacement", async () => {
  const { args, state } = setup(1); let calls = 0;
  args.identity = async () => (++calls >= 3 ? { ...owner, pid: "2999" } : owner);
  await assert.rejects(observeStartup(args), /Startup host or boot changed/);
  assert.equal(state.connections, 1); assert.equal(state.disconnects, 0);
});
test("guest reboot is not a document replacement", async () => {
  const { args } = setup(1); let calls = 0;
  args.identity = async () => (++calls >= 3 ? { ...owner, boot: "new-boot" } : owner);
  await assert.rejects(observeStartup(args), /Startup host or boot changed/);
});
test("continued page disposal fails at the bounded limit", async () => {
  const { args, state } = setup(9);
  await assert.rejects(observeStartup(args), /Target page/);
  assert.equal(state.connections, 3); assert.equal(state.disconnects, 2);
});
test("deadline rejects further observation", async () => {
  const { args, state } = setup(); let clock = 0;
  await assert.rejects(observeStartup({ ...args, timeout: 5, now: () => (clock += 10) }), /deadline/);
  assert.equal(state.connections, 0);
});
