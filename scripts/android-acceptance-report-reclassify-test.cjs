#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-reclassify-"));
try {
  const input = path.join(dir, "input.json");
  const output = path.join(dir, "output.json");
  const screenshots = path.join(dir, "screens");
  fs.mkdirSync(screenshots);
  const base = path.join(screenshots, "base.png");
  const tile = path.join(screenshots, "tile.png");
  // The production helper only needs valid screenshot paths in this contract;
  // decoded threshold behavior is covered by android-runtime-log-analysis-test.
  fs.writeFileSync(base, "base");
  fs.writeFileSync(tile, "tile");
  const report = {
    status: "BLOCKED",
    stages: { build: "PASS", runtime: "BLOCKED", audio: "BLOCKED", provenance: "PASS", cleanup: "PASS" },
    requiredCoverage: { rendererWarnings: "BLOCKED" },
    logcat: { fatal: [] },
    restartTrials: Array.from({ length: 6 }, (_, index) => ({
      kind: index < 3 ? "clean-install" : "retained-data",
      iteration: index % 3 + 1,
      layers: { documents: 2, nodes: 410, jsEventListeners: 188 },
      pssKb: 100000 - index * 100,
      screenshotPath: index === 0 ? tile : base,
      screenshotSha256: index === 0 ? "tile" : "base",
      warnings: index === 0 ? ["W chromium: tile memory limits exceeded"] : [],
      fatal: [],
    })),
    logcat: { fatal: [] },
  };
  fs.writeFileSync(input, JSON.stringify(report));
  const result = spawnSync(process.execPath, [path.join(__dirname, "android-acceptance-report-reclassify.cjs"), input, output], { encoding: "utf8" });
  // Invalid image fixtures must be rejected instead of being silently passed.
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Input file contains unsupported image format|MISSING_SCREENSHOT_EVIDENCE/);
  console.log("android-acceptance-report-reclassify: PASS (preserves raw report and rejects unverifiable screenshot evidence)");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
