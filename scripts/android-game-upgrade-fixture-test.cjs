"use strict";
const assert = require("node:assert/strict");
const { retainedAndroidFixture, validateAndroidFixture } = require("./lib/android-game-upgrade-fixture.cjs");
const result = retainedAndroidFixture(); validateAndroidFixture(result);
assert.equal(result.gameVersion, "0.1.1"); assert.equal(result.versionCode, 1001);
assert.equal(result.project.project_id, "qa_android_pkg_20261021_10");
const mutations = [
  x => { x.project.project_id += "-new"; }, x => { x.gameVersion = "0.1.0"; },
  x => { x.versionCode = 1000; }, x => { x.applicationId += ".other"; },
  x => { x.project.nodes[1].data.scene.scene_id = "other"; },
  x => { x.project.edges = []; }, x => { x.project.nodes[1].data.scene.commands.pop(); },
  x => { x.source.sha256 = "0".repeat(64); },
];
for (const mutate of mutations) { const copy = structuredClone(result); mutate(copy); assert.throws(() => validateAndroidFixture(copy)); }
console.log(JSON.stringify({ status: "PASS", rejectedVariants: mutations.length,
  gameId: result.project.project_id, gameVersion: result.gameVersion, versionCode: result.versionCode }));
