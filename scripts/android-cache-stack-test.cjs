"use strict";
const assert = require("node:assert/strict");
const { cacheStackScript, parseCacheStack, startCacheStack } = require("./lib/android-cache-stack.cjs");
const pkg = "com.agentvn.game.test";
const script = cacheStackScript(pkg);
assert(script.includes("strace -k"));
assert(script.includes("-P '/data/user/0/com.agentvn.game.test/cache/WebView/Default/HTTP Cache/Code Cache'"));
assert(script.includes("timeout -s INT 7"));
assert(!/\brm\b|\bchmod\b|\bchown\b|\btouch\b|\bsetenforce\b|\bpm clear\b|\badb root\b/.test(script));
for (const bad of ["com.test;id", "", "../app", "com.agentvn.x\nid"]) {
  assert.throws(() => cacheStackScript(bad), /PACKAGE_INVALID/);
}
const sample = [
  "STACK_SUPPORT|0", "TRACE_APP_PID|123",
  '[pid 200] 1792175688.363690 unlinkat(AT_FDCWD, "/data/user/0/com.agentvn.game.test/cache/WebView/Default/HTTP Cache/Code Cache", AT_REMOVEDIR) = 0',
  " > /apex/com.android.runtime/lib64/bionic/libc.so(unlinkat+0x10) [0x123]",
  " > /data/app/com.google.android.trichromelibrary/lib/x86_64/libmonochrome_64.so() [0x456]",
  "TRACE_EXIT|124",
].join("\n");
const parsed = parseCacheStack(sample);
assert.equal(parsed.stackSupport, true);
assert.equal(parsed.appPid, "123");
assert.equal(parsed.successfulDirectoryDeletes.length, 1);
assert.equal(parsed.stackFrames.length, 2);
assert.equal(parsed.traceExitCode, 124, "Bounded observer detach is not an app failure");
assert.equal(parseCacheStack("strace: invalid option -- k\nSTACK_SUPPORT|1").stackSupport, false);
assert.equal(parseCacheStack("STACK_SUPPORT|0\nTRACE_PID_NOT_FOUND").appPid, null);
async function testObserver() {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { EventEmitter } = require("node:events");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-cache-stack-"));
  try {
    for (const fail of [false, true]) {
      let submitted;
      const observer = startCacheStack({ adb: "owned.exe", adbPort: 52911, serial: "emulator-5554",
        packageName: pkg, outputDir: out, label: fail ? "failed" : "ready",
        spawnProcess(exe, args, options) {
          assert.equal(exe, "owned.exe");
          assert.deepEqual(args, ["-P", "52911", "-s", "emulator-5554", "shell", "su 0 sh"]);
          assert.equal(options.windowsHide, true);
          const child = new EventEmitter();
          child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
          child.stdin = { end(text) { submitted = text; } }; child.pid = 42;
          setImmediate(() => {
            if (fail) child.stderr.emit("data", "original ptrace denied");
            else child.stdout.emit("data", sample);
            child.emit("close", fail ? 1 : 0, null);
          });
          return child;
        } });
      const result = await observer.completion;
      assert(submitted.includes("STACK_SUPPORT"));
      assert.equal(result.status, fail ? "UNAVAILABLE" : "COLLECTED");
      if (fail) assert.match(fs.readFileSync(result.rawPath, "utf8"), /original ptrace denied/);
      assert.match(result.limitation, /perturb/);
    }
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
  console.log("android-cache-stack: PASS (safe bounded attach, stack attribution, unsupported tool, original errors)");
}
testObserver().catch(error => { console.error(error); process.exitCode = 1; });
