#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

const result = spawnSync(
  process.execPath,
  ["scripts/advanced-tools-transition-regression-playwright.cjs"],
  { cwd: require("node:path").resolve(__dirname, ".."), encoding: "utf8" },
);

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("advanced-tools-intermediate-frame-playwright: PASS");
