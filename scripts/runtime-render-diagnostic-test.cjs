"use strict";
// QA instrumentation contracts only, not proof of a product fix.
const assert = require("node:assert/strict"), vm = require("node:vm");
const { runtimeRenderDiagnosticInit } = require("./lib/runtime-render-diagnostic.cjs");
function context(pathname = "/gamecli-preview/", existing, options = {}) {
  let clock = 0;
  const events = {};
  const window = existing ? { __REACT_DEVTOOLS_GLOBAL_HOOK__: existing } : {};
  window.parent = Object.freeze({ qaParent: true });
  vm.runInNewContext(`(${runtimeRenderDiagnosticInit.toString()})(${JSON.stringify(options)})`, {
    window, location: { pathname, origin: "http://tauri.localhost" }, document: { querySelector: () => null }, innerWidth: 1280, innerHeight: 720,
    performance: { now: () => ++clock }, addEventListener: (name, callback) => { events[name] = callback; },
  });
  return { window, events };
}
const cases = [];
function test(name, fn) { fn(); cases.push(name); console.log("PASS " + name); }
test("Does not instrument the outer Editor", () => {
  const { window } = context("/");
  assert.equal(window.__REACT_DEVTOOLS_GLOBAL_HOOK__, undefined);
  assert.equal(window.__agentvnRenderTrace, undefined);
});
test("Preserves any existing DevTools hook", () => {
  const hook = Object.freeze({ supportsFiber: true }), { window } = context("/gamecli-preview/", hook);
  assert.equal(window.__REACT_DEVTOOLS_GLOBAL_HOOK__, hook);
  assert.equal(window.__agentvnRenderTrace.status, "EXISTING_HOOK_NOT_REPLACED");
});
test("Captures real DialogBox hook state and dependency identity changes without mutation", () => {
  const { window } = context(), hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  assert.equal(hook.inject({}), 1);
  function Eo() {}
  const stable = Object.freeze({ value: 1 }), changed = Object.freeze({ value: 2 });
  const beforeState = Object.freeze(["one"]), afterState = Object.freeze(["one", "two"]);
  const previous = Object.freeze({ memoizedState: beforeState,
    next: Object.freeze({ memoizedState: Object.freeze({ deps: Object.freeze([stable, false]) }), next: null }) });
  const current = Object.freeze({ memoizedState: afterState,
    next: Object.freeze({ memoizedState: Object.freeze({ deps: Object.freeze([changed, false]) }), next: null }) });
  const fiber = Object.freeze({ type: Eo, memoizedState: current, alternate: Object.freeze({ memoizedState: previous }),
    child: null, sibling: null });
  const root = Object.freeze({ current: fiber });
  hook.onCommitFiberRoot(1, root);
  const trace = window.__agentvnRenderTrace, dialog = trace.snapshots[0].dialogs[0];
  assert.equal(trace.rendererCount, 1); assert.equal(trace.commits, 1);
  assert.equal(dialog.hookCount, 2); assert.equal(dialog.changed.length, 2);
  assert.equal(dialog.changed[0].after.length, 2);
  assert.equal(dialog.changed[1].dependencyChanges.length, 1);
  assert.equal(dialog.changed[1].dependencyChanges[0].index, 0);
  assert.equal(fiber.memoizedState, current); assert.equal(current.memoizedState, afterState);
  assert.equal(trace.errors.length, 0);
});
test("Unchanged hook objects do not become false changes", () => {
  const { window } = context(), state = Object.freeze({ memoizedState: Object.freeze([]), next: null });
  function Eo() {}
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, { current: {
    type: Eo, memoizedState: state, alternate: { memoizedState: state }, child: null, sibling: null,
  } });
  assert.equal(window.__agentvnRenderTrace.snapshots[0].dialogs[0].changed.length, 0);
});
test("Commit history and initialization metadata are bounded and exclude story payload", () => {
  const { window, events } = context(), hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  for (let i = 0; i < 70; i++) hook.onCommitFiberRoot(1, { current: { type: "main", child: null, sibling: null } });
  for (let i = 0; i < 30; i++) events.message({ data: { type: "agentvn.live-preview.init",
    revision: i, script: { secret: "not copied" }, sessionId: "isolated-qa", screen: "playing", uiSkin: { layout_type: "renpy" } } });
  const trace = window.__agentvnRenderTrace;
  assert.equal(trace.snapshots.length, 48); assert.equal(trace.commits, 70);
  assert.equal(trace.recentInit.length, 12);
  assert(!JSON.stringify(trace).includes("not copied"));
  assert.equal(trace.recentInit.at(-1).revision, 29);
  assert.doesNotThrow(() => JSON.stringify(trace));
});
test("Default probe never captures full initialization packets", () => {
  const { window, events } = context();
  events.message({ source: window.parent, origin: "http://tauri.localhost", data: {
    type: "agentvn.live-preview.init", manifest: { game_id: "installed-portrait-20261021-01-renpy-layout-preview" },
    script: { content: "private fixture" },
  } });
  assert.equal(window.__agentvnReplayInit, undefined);
});
test("Replay capture is opt-in, exact-fixture, same-origin/parent and detached from input", () => {
  const gameId = "installed-portrait-20261021-01-renpy-layout-preview";
  const { window, events } = context("/gamecli-preview/", undefined, { captureGameId: gameId });
  const data = Object.freeze({ type: "agentvn.live-preview.init",
    manifest: Object.freeze({ game_id: gameId }), script: Object.freeze({ content: "qa only" }) });
  for (const event of [
    { source: {}, origin: "http://tauri.localhost", data },
    { source: window.parent, origin: "https://invalid.example", data },
    { source: window.parent, origin: "http://tauri.localhost", data: { ...data, manifest: { game_id: "other" } } },
  ]) {
    events.message(event); assert.equal(window.__agentvnReplayInit, undefined);
  }
  events.message({ source: window.parent, origin: "http://tauri.localhost", data });
  assert.equal(JSON.stringify(window.__agentvnReplayInit), JSON.stringify(data));
  assert.notEqual(window.__agentvnReplayInit, data);
  window.__agentvnReplayInit.script.content = "changed copy";
  assert.equal(data.script.content, "qa only");
  assert(!JSON.stringify(window.__agentvnRenderTrace).includes("qa only"));
});
console.log(JSON.stringify({ status: "PASS", cases: cases.length, scope: "QA_PROBE_ONLY_NO_PRODUCT_FIX_CLAIM" }));
