"use strict";
const assert = require("node:assert/strict");
const { classifyStartupConsoleErrors: classify } = require("./android-webview-startup-playwright.cjs");
const base = "http://127.0.0.1:12345";
const message = "Failed to load resource: the server responded with a status of 404 (Not Found)";
const expected = { text: message, location: { url: `${base}/fixed-only.json` } };
const response = { url: expected.location.url, status: 404 };
let cases = 0;
function check(errors, responses, optional, unexpected) {
  const result = classify(errors, responses, base);
  assert.equal(result.optional.length, optional);
  assert.equal(result.unexpected.length, unexpected);
  assert.equal(result.optional.length + result.unexpected.length, errors.length, "原始事件不得丢失");
  cases++;
}
check([expected], [response], 1, 0);
check([expected], [], 0, 1);
check([expected], [{ ...response, status: 500 }], 0, 1);
check([{ ...expected, text: "ReferenceError: startup failed" }], [response], 0, 1);
for (const url of [
  `${base}/assets/index.js`, `${base}/fixed-only.json?missing=1`,
  `${base}/other/fixed-only.json`, "http://other.invalid/fixed-only.json",
]) check([{ text: message, location: { url } }], [{ url, status: 404 }], 0, 1);
check([{ text: message }], [response], 0, 1);
check([expected, { text: "Uncaught TypeError: x" }], [response], 1, 1);
check([], [], 0, 0);
console.log(`PASS startup network policy ${cases} cases; only exact optional-marker 404 is non-blocking`);
