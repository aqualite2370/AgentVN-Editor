#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  EXPECTED_ASSET_INVENTORY_SHA256,
  EXPECTED_SOURCE_BYTES,
  EXPECTED_SOURCE_SHA256,
  collectHiddenGrowthBaseline,
  copyFixtureToIsolation,
  resolveT0Paths,
} = require("./t0-baseline-harness.cjs");

const FIXTURE = {
  projectId: "project_msiz08p7_0_89ebc8a8cb",
  title: "隐忍的成长",
  nodeCount: 19,
  edgeCount: 21,
  sceneNodeCount: 16,
  choiceNodeCount: 2,
  assetCount: 143,
  sourceBytes: EXPECTED_SOURCE_BYTES,
  rawSha256: EXPECTED_SOURCE_SHA256,
  assetInventorySha256: EXPECTED_ASSET_INVENTORY_SHA256,
};

function runHiddenGrowthFixturePreflight({ root, outputDir } = {}) {
  const repoRoot = root || path.resolve(__dirname, "..");
  const paths = resolveT0Paths(repoRoot);
  const baseline = collectHiddenGrowthBaseline(repoRoot);
  const isolation = copyFixtureToIsolation(repoRoot);
  const outputManifest = path.join(outputDir || path.dirname(paths.baselineManifest), "fixture-manifest.json");

  if (outputManifest !== paths.baselineManifest) {
    fs.mkdirSync(path.dirname(outputManifest), { recursive: true });
    fs.copyFileSync(paths.baselineManifest, outputManifest);
  }

  return {
    fixture: {
      sourcePath: baseline.source.path,
      tempProjectPath: isolation.copyPath,
      sourceSha256: baseline.source.sha256,
      sourceBytes: baseline.source.bytes,
      project: baseline.project,
      assetTypeCounts: baseline.assets.typeCounts,
      assetInventorySha256: baseline.assets.inventorySha256,
    },
    project: baseline.project,
    assets: baseline.assets,
    sourceMutated: baseline.sourceMutated,
    outputManifest,
  };
}

if (require.main === module) {
  const result = runHiddenGrowthFixturePreflight({ root: process.env.AGENTVN_ROOT || path.resolve(__dirname, "..") });
  console.log(`hidden-growth-fixture-preflight: PASS (${result.outputManifest})`);
}

module.exports = { FIXTURE, runHiddenGrowthFixturePreflight };
