#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "android-apk-runtime-qa.cjs"),
  "utf8",
);
const playRequest = source.indexOf('await waitFor(');
const playRequestExpression = source.indexOf('phase === "play-request"');
const capture = source.indexOf("capture-emulator-audio.py");

assert(playRequest >= 0, "runtime QA must wait for a BGM play request");
assert(playRequestExpression >= 0, "runtime QA must identify the BGM play request");
assert(capture >= 0, "runtime QA must invoke scoped emulator audio capture");
assert(
  playRequestExpression < capture,
  "BGM play request must be observed before audio capture starts",
);

console.log("android-audio-capture-order-contract: PASS");
