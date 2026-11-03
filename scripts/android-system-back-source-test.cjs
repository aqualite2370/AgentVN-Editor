const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "build-runtime-standalone-android.ps1"),
  "utf8",
);
const activity = source.match(/\$activity = @'\r?\n([\s\S]*?)\r?\n'@/)?.[1] ?? "";

assert.match(activity, /onBackPressedDispatcher\.addCallback/,
  "Android hardware/system back must be handled through the lifecycle-aware dispatcher");
assert.match(activity, /agentvn:system-back/,
  "native Android back must dispatch the Runtime system-back event");
assert.match(activity, /webView\.evaluateJavascript/,
  "system back must be routed into the active WebView");
console.log("android-system-back-source-test: PASS");
