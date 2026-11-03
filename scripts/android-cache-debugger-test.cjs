"use strict";
const assert = require("node:assert/strict");
const { debuggerWatchScript, debuggerConfig, debuggerInstallCommands, parseDebuggerOutput } = require("./lib/android-cache-debugger.cjs");
const config = debuggerConfig({
  packageName: "com.agentvn.game.test", runId: "bounded-01",
  localPort: 52825, remotePort: 38471,
});
const script = debuggerWatchScript(config);
assert.equal(typeof debuggerInstallCommands, "function", "Windows push must explicitly enable only the staged debugger");
assert.deepEqual(debuggerInstallCommands(config, "C:/ndk/lldb-server").at(-1),
  ["shell", "chmod", "700", "/data/local/tmp/agentvn-cache-bounded-01/lldb-server"]);
assert(!script.includes("kill -STOP"), "Do not hold the whole app stopped while waiting for the host");
assert.match(script, /timeout -s INT 12/);
assert.match(script, /lldb-server' gdbserver.*--attach/);
assert.match(script, /kill -CONT/);
assert.match(script, /cmdline/);
assert(!/setenforce|chmod|chown|pm clear|adb root/.test(script));
for (const bad of ["../x", "a;id", "x\nid"]) {
  assert.throws(() => debuggerConfig({ ...config, runId: bad }), /RUN_ID_INVALID/);
  assert.throws(() => debuggerConfig({ ...config, packageName: bad }), /PACKAGE_INVALID/);
}
for (const port of [0, 1, 65536, "52825;id"]) {
  assert.throws(() => debuggerConfig({ ...config, localPort: port }), /PORT_INVALID/);
}
const hit = { function: "unlinkat", path: "Code Cache", frames: [
  { module: "libc.so" }, { module: "libopenjdk.so" },
] };
const result = parseDebuggerOutput(`noise\nCACHE_DELETE|${JSON.stringify(hit)}\nCACHE_DEBUGGER_DETACHED|true\nDEBUGGER_FORWARD_CLEANUP|0\nDEBUGGER_FILE_CLEANUP|0|0`);
assert.equal(result.hits.length, 1);
assert.equal(result.detached, true);
assert.equal(result.cleanupStatus, "PASS");
assert.equal(parseDebuggerOutput("DEBUGGER_FORWARD_CLEANUP|1\nDEBUGGER_FILE_CLEANUP|0|0").cleanupStatus, "FAILED");
assert.equal(parseDebuggerOutput("original attach denied").cleanupStatus, "UNVERIFIED");
assert.equal(parseDebuggerOutput("error: original attach denied").hits.length, 0);
assert.throws(() => parseDebuggerOutput("CACHE_DELETE|not-json"), /Unexpected|JSON/);
console.log("android-cache-debugger: PASS (validated bounded attach, exact identity, cleanup, raw failure)");
