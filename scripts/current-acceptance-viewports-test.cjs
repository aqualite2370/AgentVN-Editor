#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const { desktopViewports, currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
assert.deepEqual(currentAcceptanceViewports(), desktopViewports);
assert.deepEqual(currentAcceptanceViewports([[1920, 1080], [3840, 2160]]), [
  [1920, 1080], [3840, 2160],
]);
for (const invalid of [[], [[1280, 720]], [[1920, 1080], [390, 844]]])
  assert.throws(() => currentAcceptanceViewports(invalid));
console.log("PASS current acceptance viewport policy");
