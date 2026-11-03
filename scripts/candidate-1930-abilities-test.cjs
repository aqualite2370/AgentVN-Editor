"use strict";
// Offline preparation tests. Never launch a Player or touch its active profile.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { preparation, validatePreparation, buildFlow, buildSession, buildAudit } =
  require("./candidate-1930-abilities.cjs");
const vm = require("node:vm"), Module = require("node:module");
const p = preparation("01"), before = sha("scripts/installed-runtime-abilities-playwright.cjs");
validatePreparation(p);
let rejected = 0;
for (const mutate of [
  v => { v.scope = "CURRENT_DEV"; }, v => { v.candidateVersion = "1.9.24"; },
  v => { delete v.candidateVersion; },
  v => { v.executable = { ...v.executable, path: path.resolve("editor/src-tauri/binaries/agentvn-player.exe") }; },
  v => { v.sessionRoot = path.resolve("D:/AgentVN"); },
  v => { v.installId = "user_game"; }, v => { v.cartridges = []; },
  v => { v.fixture = { ...v.fixture, inputSha256: "0".repeat(64) }; },
]) {
  const bad = structuredClone(p); mutate(bad);
  assert.throws(() => validatePreparation(bad)); rejected++;
}
for (const [name, build, file] of [
  ["flow", buildFlow, "scripts/installed-runtime-abilities-playwright.cjs"],
  ["session", buildSession, "scripts/candidate-1924-abilities-session.cjs"],
  ["audit", buildAudit, "scripts/candidate-1924-abilities-audit.cjs"],
]) {
  const original = fs.readFileSync(file, "utf8"), result = build(original);
  new vm.Script(Module.wrap(result.source));
  let replay = original;
  for (const change of result.adaptations) {
    assert.equal(replay.split(change.before).length - 1, 1);
    replay = replay.replace(change.before, change.after);
  }
  assert.equal(replay, result.source);
  for (const change of result.adaptations.filter(c => original.includes(c.before))) {
    assert.throws(() => build(original.replace(change.before, "")), undefined, change.reason);
    assert.throws(() => build(original + "\n" + change.before), undefined, change.reason);
    rejected += 2;
  }
  if (name === "flow") {
    for (const fragment of [
      "business ? 16 : crossOnly ? 1", "assert.equal(retained.length, 6)",
      "assert.equal(moved.anchor, \"character\")", "assert.equal(absent.anchor, \"fallback\")",
      "assert.equal(fixed.anchor, \"fixed\")", "assert.deepEqual(await saves(), before",
      "waitNativeRuntimePage", "recordSaveGridLayers",
    ]) assert(result.source.includes(fragment), fragment);
  }
  if (name === "session") assert(!result.source.includes("fresh-export-audit-"));
  if (name === "audit") assert(result.source.includes("targetReadiness"));
}
assert.equal(sha("scripts/installed-runtime-abilities-playwright.cjs"), before);
console.log(JSON.stringify({ status: "PASS", scope: "OFFLINE_EXPLICIT_CANDIDATE_ABILITIES_PREPARATION_ONLY",
  candidateVersion: p.candidateVersion,
  rejected, productStarts: 0, profileChanges: 0, modelRequests: 0 }));
