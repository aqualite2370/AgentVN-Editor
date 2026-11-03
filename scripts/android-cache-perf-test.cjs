"use strict";
const assert = require("node:assert/strict");
const { cachePerfScript, parseCachePerf, isPerfData, startCachePerf } = require("./lib/android-cache-perf.cjs");
assert.equal(typeof isPerfData, "function");
assert.equal(isPerfData(Buffer.from("cat: No such file or directory")), false);
assert.equal(isPerfData(Buffer.from("PERFILE2binary-data")), true);
const script = cachePerfScript({ packageName: "com.agentvn.game.test", runId: "perf-01" });
assert.match(script, /raw_syscalls:sys_enter/);
assert.match(script, /id == 263/);
assert.match(script, /--call-graph dwarf,8192/);
assert.match(script, /--clockid monotonic/);
assert(!script.includes("--clockid realtime"), "API35 selfcheck proved realtime unsupported");
assert.match(script, /PERF_CLOCK_SYNC/);
assert.match(script, /--duration 7/);
assert.match(script, /strace -f -ttt/);
assert.match(script, /-p "\$p"/);
const filesScript = cachePerfScript({ packageName: "com.agentvn.game.test", runId: "perf-01", fileTrace: true });
assert.match(filesScript, /newfstatat,stat,statx,openat,rename,renameat,renameat2/);
assert(!script.includes("newfstatat"), "Broader file tracing is opt-in and must not alter prior capture semantics");
assert(!/kill -STOP|chmod|chown|setenforce|setprop|rm |pm clear|\s-a\s/.test(script));
for (const bad of ["../x", "x;id", "x\nid"])
  assert.throws(() => cachePerfScript({ packageName: "com.agentvn.game.test", runId: bad }), /RUN_ID/);
const parsed = parseCachePerf("PERF_APP_PID|123\nPERF_EXIT|0\nSTRACE_EXIT|124\nREPORT_EXIT|0");
assert.equal(parsed.appPid, "123"); assert.equal(parsed.perfExitCode, 0);
assert.equal(parsed.straceExitCode, 124); assert.equal(parsed.reportExitCode, 0);
assert.equal(parseCachePerf("simpleperf: event not supported\nPERF_EXIT|1").perfExitCode, 1);
async function lifecycle() {
  const { EventEmitter } = require("node:events");
  for (const mode of ["ok", "disk-failure", "cleanup-failure"]) {
    const calls = []; let writes = 0;
    const observer = startCachePerf({ packageName: "com.agentvn.game.test", runId: "perf-01",
      label: "test", adb: "owned-adb", adbPort: 52921, serial: "emulator-5554", outputDir: "D:/isolated" }, {
      spawnProcess() {
        const child = new EventEmitter(); child.pid = 100;
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
        child.stdin.end = () => setImmediate(() => {
          child.stdout.emit("data", "PERF_WATCH_READY\nPERF_APP_PID|123\nPERF_EXIT|0\nSTRACE_EXIT|124\nREPORT_EXIT|0");
          child.emit("close", 0, null);
        });
        return child;
      },
      runProcess(exe, args) {
        calls.push(args);
        return { status: mode === "cleanup-failure" && args.includes("rmdir") ? 1 : 0,
          stdout: Buffer.from(args.some(value => value.endsWith("/perf.data")) ? "PERFILE2bounded capture" : "bounded capture"),
          stderr: Buffer.from("") };
      },
      writeFile() { if (++writes === 1 && mode === "disk-failure") throw Error("original disk error"); },
    });
    const result = await observer.completion;
    assert(calls.some(args => args.includes("rm")));
    assert(calls.some(args => args.includes("rmdir")));
    assert.equal(result.status, mode === "ok" ? "COLLECTED_REQUIRES_REVIEW"
      : mode === "cleanup-failure" ? "FAILED" : "UNAVAILABLE");
    if (mode === "disk-failure") assert.match(result.captureError, /original disk error/);
    if (mode === "cleanup-failure") assert.equal(result.cleanupStatus, "FAILED");
  }
  console.log("android-cache-perf: PASS (bounded app stacks, original errors, finally cleanup, capture/cleanup failures)");
}
lifecycle().catch(error => { console.error(error); process.exitCode = 1; });
