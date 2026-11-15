"use strict";
const assert = require("node:assert/strict");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const own = "com.agentvn.game.test";
const lines = [
  "11-14 10:00:00.000 100 101 E chromium: [1114/100000.000000:ERROR:variations_seed_loader.cc(37)] Seed missing signature.",
  "11-14 10:00:00.001 100 102 I RustStdoutStderr: [1114/100000.000000:ERROR:variations_seed_loader.cc(37)] Seed missing signature.",
  "11-14 10:00:00.002 100 102 I RustStdoutStderr: [WARNING:dns_config_service_android.cc(81)] Failed to read DnsConfig.",
  "11-14 10:00:00.003 100 102 I RustStdoutStderr: [ERROR:new_implementation.cc(1)] New error",
  "11-14 10:00:00.004 100 102 I RustStdoutStderr: FORTIFY: native failure",
  "11-14 10:00:00.005 100 101 W app: Entry not found",
  `11-14 10:00:00.006 1 2 I ActivityManager: Start proc 200:com.google.android.webview:sandboxed_process0/u0i1 for {${own}/org.chromium.content.app.SandboxedProcessService0:0}`,
  "11-14 10:00:00.007 200 201 W SystemServiceRegistry: No service published for: uimode",
  "11-14 10:00:00.008 300 301 E chromium: unrelated failure",
  "11-14 10:00:00.009 300 302 I RustStdoutStderr: [ERROR:a.cc(1)] unrelated mirror",
  "11-14 10:00:00.010 100 102 I RustStdoutStderr: [INFO:a.cc(1)] Normal",
  "11-14 10:00:00.011 100 102 I RustStdoutStderr: asset text mentions ERROR",
  "11-14 10:00:00.012 100 102 D RustStdoutStderr: [ERROR:a.cc(1)] debug text",
];
const result = scopedRuntimeLog(lines, own, [100]);
assert.deepEqual(result.messages, [...lines.slice(0, 6), lines[7]]);
assert.deepEqual(result.fatal, [lines[4]]);
assert(!result.messages.some(l => /unrelated|Normal|asset text|debug text/.test(l)));
assert.equal(scopedRuntimeLog(lines.join("\n"), own, [100]).messages.length, 7);
assert.deepEqual(scopedRuntimeLog(lines, "com.agentvn.unrelated", [400]).messages, []);
assert.deepEqual(scopedRuntimeLog([], own, [100]).messages, []);
console.log("PASS: complete native/forwarded severities, owned renderer, unrelated PID and plain-text rejection");
