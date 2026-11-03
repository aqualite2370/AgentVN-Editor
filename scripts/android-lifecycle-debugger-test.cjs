"use strict";
// Diagnostic evidence classification only. No device, app, or model operations.
const assert = require("node:assert/strict");
const { debuggerConfig, parseDebuggerOutput, debuggerResult } = require("./lib/android-cache-debugger.cjs");
const base = { packageName: "com.agentvn.qa.exitagentvn20261024", runId: "exit-trace-01",
  localPort: 52825, remotePort: 38471, mode: "lifecycle-exit" };
assert.equal(debuggerConfig(base).mode, "lifecycle-exit");
assert.throws(() => debuggerConfig({ ...base, mode: "mutate-exit" }), /MODE_INVALID/);
const hit = { function: "exit", pid: 3218, tid: 3258, frames: [{ module: "libc.so" }],
  observation: "function-entry-not-exit-completion" };
const cleanup = "\nDEBUGGER_FORWARD_CLEANUP|0\nDEBUGGER_FILE_CLEANUP|0|0";
const natural = `LIFECYCLE_DEBUGGER_READY|3218\nLIFECYCLE_EXIT|${JSON.stringify(hit)}
LIFECYCLE_DEBUGGER_EXITED|0${cleanup}`;
assert.equal(parseDebuggerOutput(natural).lifecycleHits.length, 1);
assert.equal(parseDebuggerOutput(natural).naturallyExited, true);
assert.equal(parseDebuggerOutput(natural).detached, false, "Exit is not a successful detach");
assert.equal(debuggerResult(natural, 0, "lifecycle-exit").status, "COLLECTED");
assert.equal(debuggerResult(natural.replaceAll("\n", "\r\n"), 0, "lifecycle-exit").status, "COLLECTED");
assert.equal(debuggerResult(natural.split("\n").map(line => "(lldb) " + line).join("\n"),
  0, "lifecycle-exit").status, "COLLECTED", "NDK async prompt can precede an actual marker");
assert.equal(debuggerResult('(lldb) script print("LIFECYCLE_DEBUGGER_READY|3218")' + cleanup,
  0, "lifecycle-exit").status, "UNAVAILABLE", "A command echo still cannot satisfy a marker");
assert.equal(debuggerResult(natural, 0).status, "UNAVAILABLE", "Lifecycle evidence cannot satisfy cache observation");
for (const bad of [
  natural.replace(/LIFECYCLE_EXIT\|[^\n]+\n/, ""),
  natural.replace("LIFECYCLE_DEBUGGER_READY|3218", "DEBUGGER_WATCH_READY"),
  natural.replace("LIFECYCLE_DEBUGGER_EXITED|0", ""),
  natural.replace("DEBUGGER_FORWARD_CLEANUP|0", "DEBUGGER_FORWARD_CLEANUP|1"),
]) assert.notEqual(debuggerResult(bad, 0, "lifecycle-exit").status, "COLLECTED");
assert.notEqual(debuggerResult(natural, 1, "lifecycle-exit").status, "COLLECTED");
assert.equal(debuggerResult(natural + "\nDEBUGGER_WATCHER_RECOVERED|true", 0, "lifecycle-exit").status,
  "COLLECTED_WITH_WATCHER_RECOVERY", "Recovery cannot be hidden behind an ordinary collected status");
assert.throws(() => parseDebuggerOutput("LIFECYCLE_EXIT|not-json"), /Unexpected|JSON/);
console.log("android-lifecycle-debugger: PASS (bounded diagnostic scope, actual ready, natural exit, failure rejection)");
