"use strict";
const assert = require("node:assert/strict");
const { readAudioFocusSnapshot } = require("./android-audio-focus-snapshot.cjs");

async function main() {
  const evaluations = [];
  const client = {
    evaluate: async (expression) => {
      evaluations.push(expression);
      return { visibilityState: "visible", hasFocus: false, userAgent: "Android WebView" };
    },
  };
  const snapshot = await readAudioFocusSnapshot(client);
  assert.deepEqual(snapshot, { visibilityState: "visible", hasFocus: false, userAgent: "Android WebView" });
  assert.match(evaluations[0], /document\.visibilityState/);
  assert.match(evaluations[0], /document\.hasFocus\(\)/);
  assert.match(evaluations[0], /navigator\.userAgent/);
  console.log("android-audio-focus-snapshot: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
