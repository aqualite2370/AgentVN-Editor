#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { runHiddenGrowthFixturePreflight } = require("./hidden-growth-fixture-preflight.cjs");

const result = runHiddenGrowthFixturePreflight({
  root: process.env.AGENTVN_ROOT || require("node:path").resolve(__dirname, ".."),
  outputDir: process.env.AGENTVN_HIDDEN_GROWTH_OUTPUT || undefined,
});

assert.equal(result.project.project_id, "project_msiz08p7_0_89ebc8a8cb");
assert.equal(result.project.title, "隐忍的成长");
assert.equal(result.project.nodeCount, 19);
assert.equal(result.project.edgeCount, 21);
assert.equal(result.project.sceneNodeCount, 16);
assert.equal(result.project.choiceNodeCount, 2);
assert.equal(result.project.assetCount, 143);
assert.equal(result.fixture.sourceBytes, 1580089);
assert.equal(result.fixture.assetInventorySha256, "c258d296fa0e5a2164496ff70b008541f6b953c4cd168c7d866da9d6ec3157a4");
assert.equal(result.assets.missing, 0);
assert.equal(result.assets.hashMismatches, 0);
assert.equal(result.assets.unsafePaths, 0);
assert.equal(result.sourceMutated, false);
assert.notEqual(result.fixture.tempProjectPath, result.fixture.sourcePath);
assert.ok(result.outputManifest);

console.log("hidden-growth-fixture-preflight-test: PASS");
