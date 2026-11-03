"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const source = fs.readFileSync(path.join(__dirname, "android-apk-runtime-qa.cjs"), "utf8");
const localRequire = createRequire(__filename);
const context = vm.createContext({
  require: localRequire, __dirname, console, Buffer, setTimeout, clearTimeout, AbortSignal,
  process: { platform: "win32", pid: 123,
    argv: ["node", "qa", "--apk", "isolated.apk", "--package", "com.test",
      "--output", "中文完整剧情", "--scope", "installed-full-story"] },
});
vm.runInContext(source.slice(0, source.indexOf("\nmain().catch("))
  + "\nglobalThis.fullStory = typeof exerciseInstalledFullStory === 'function';", context);
assert.equal(context.fullStory, true,
  "Actual Android runner must expose an installed full-story flow; resource smoke cannot stand in for it");
const { assertStoryRestored, assertPagedText, fullStoryStatus, validateFullStoryInput } =
  require("./lib/android-full-story-flow.cjs");
const at = { scene: "nvl", command: 4, page: 2, pages: 3, mode: "nvl",
  text: "", nvl: ["甲", "乙"], done: true };
assertStoryRestored(at, structuredClone(at), "unchanged");
for (const [key, value] of [["pages", 2], ["page", 1], ["done", false], ["nvl", ["乙"]]]) {
  assert.throws(() => assertStoryRestored(at, { ...at, [key]: value }, "changed"), /changed/);
}
assertPagedText(["甲乙", "丙丁"], "甲乙丙丁");
assert.throws(() => assertPagedText(["甲乙", "乙丙丁"], "甲乙丙丁"), /authored/);
assert.throws(() => assertPagedText([], ""), /nonempty/);
const stages = { build: "PASS", runtime: "PASS", audio: "PASS", provenance: "PASS", cleanup: "PASS" };
assert.equal(fullStoryStatus(stages), "RUNTIME_PASS");
for (const stage of Object.keys(stages)) {
  assert.equal(fullStoryStatus({ ...stages, [stage]: "BLOCKED" }), "BLOCKED");
  assert.equal(fullStoryStatus({ ...stages, [stage]: "FAILED" }), "FAILED");
}
const fixture = { status: "FIXTURE_VALIDATED", projectId: "installed_resource_flow_story_test" };
const script = { scenes: ["main", "nvl", "bubble", "finish"].map(scene_id => ({ scene_id, commands: [
  { type: "dialog", text: "完整剧情" },
] })) };
validateFullStoryInput(fixture, { game_id: fixture.projectId }, script);
assert.throws(() => validateFullStoryInput(fixture, { game_id: "other" }, script), /identity/);
assert.throws(() => validateFullStoryInput(fixture, { game_id: fixture.projectId },
  { scenes: script.scenes.slice(0, 2) }), /four/);
console.log("android-full-story-flow: PASS (scope, exact restoration, complete text, provenance, status failures)");
