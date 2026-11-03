"use strict";
// Offline source/preparation guard. No Player launch or ACL/profile mutation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { buildSession, buildFlow, buildRuntime, validateInstallation } = require("./candidate-1930-exit.cjs");
const { validateSnapshot, validatePredecessor, installationFile: current, predecessorScope } = require("./candidate-1930-exit.cjs");
assert.equal(typeof validateSnapshot, "function", "Current exit snapshot validator is required");
assert.equal(typeof validatePredecessor, "function", "Completed predecessor guard is required");
const before = { story: { scene: "ordinary_nvl", command: 1 }, history: ["第一句", "当前句"] };
const snapshot = { scene_id: "ordinary_nvl", command_index: 1, save_kind: "auto",
  history: [{ text: "第一句" }, { text: "当前句" }] };
validateSnapshot(before, snapshot);
for (const alter of [
  s => { s.history.pop(); }, s => { s.history.push({ text: "旧分支" }); },
  s => { s.history.reverse(); }, s => { s.scene_id = "old_scene"; },
  s => { s.command_index = 0; }, s => { s.save_kind = "manual"; },
]) {
  const invalid = structuredClone(snapshot); alter(invalid);
  assert.throws(() => validateSnapshot(before, invalid));
}
assert.throws(() => validateSnapshot({ ...before, history: [] }, { ...snapshot, history: [] }));
const predecessor = { status: "PASS", finishedAt: "2026-10-26T07:00:00.000Z",
  scope: predecessorScope,
  checks: Array.from({ length: 4 }, (_, i) => ({ name: `independent-check-${i}`, status: "PASS" })) };
validatePredecessor(predecessor);
for (const alter of [
  p => { p.status = "RUNNING"; }, p => { delete p.finishedAt; }, p => { p.checks = []; },
  p => { p.checks[0].status = "FAILED"; }, p => { p.cleanupError = "profile remains held"; },
  p => { p.scope = "INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY_AUDIT"; },
]) {
  const invalid = structuredClone(predecessor); alter(invalid);
  assert.throws(() => validatePredecessor(invalid));
}
validateInstallation(current);
for (const f of ["D:/AgentVN/installation.json",
  "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"])
  assert.throws(() => validateInstallation(f));
let rejected = 15;
for (const [build, name] of [
  [buildSession, "installed-runtime-exit-current.cjs"],
  [buildFlow, "native-runtime-exit-playwright.cjs"],
  [buildRuntime, "lib/installed-runtime-session.cjs"],
]) {
  const f = path.join(__dirname, name), digest = sha(f), original = fs.readFileSync(f, "utf8");
  const result = build(original); new vm.Script(Module.wrap(result.source));
  let replay = original;
  for (const c of result.adaptations) {
    assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after);
    if (original.includes(c.before)) {
      assert.throws(() => build(original.replace(c.before, "")));
      assert.throws(() => build(original + "\n" + c.before)); rejected += 2;
    }
  }
  assert.equal(replay, result.source); assert.equal(sha(f), digest);
  if (name === "native-runtime-exit-playwright.cjs") for (const fragment of [
    "await runCase(layout, kind)", '["retry", "discard", "auto_on", "auto_off"]',
    "assert.deepEqual(s.files(), entry.before.files)", 'await s.stop(true)',
    "write", "pendingACL", "validateSnapshot(entry.before, written)",
    'getByTestId("renpy-quick-history")', 'name: "打开历史记录"',
  ]) assert(result.source.includes(fragment), fragment);
  if (name === "lib/installed-runtime-session.cjs") assert(result.source.includes("waitNativeRuntimePage"));
}
console.log(JSON.stringify({ status: "PASS", scope: "OFFLINE_CURRENT_EXIT_TOOL_GUARD",
  rejected, productStarts: 0, profileChanges: 0, aclChanges: 0, modelRequests: 0 }));
