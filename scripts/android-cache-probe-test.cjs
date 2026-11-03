"use strict";
const assert = require("node:assert/strict");
const { cacheProbeCommand, parseCacheProbe, startCacheProbe } = require("./lib/android-cache-probe.cjs");
const pkg = "com.agentvn.game.test";
const command = cacheProbeCommand(pkg);
assert(command.startsWith("su 0 sh -c "));
assert(command.includes(`/data/user/0/${pkg}/cache`));
assert(command.includes("sleep 0.05"));
assert(!/\brm\b|\bchmod\b|\bchown\b|\btouch\b|\bsetenforce\b|\bpm clear\b|\badb root\b/.test(command),
  "Observe only; never repair or weaken cache permissions");
for (const unsafe of ["com.test;id", "../app", "com.test\nid", "", "com.test'"]) {
  assert.throws(() => cacheProbeCommand(unsafe), /PACKAGE_INVALID/);
}
const parent = `/data/user/0/${pkg}/cache/WebView/Default/HTTP Cache`;
const parsed = parseCacheProbe([
  "SAMPLE|0|1792174038.100",
  `STATE|10|10219|10219|700|1792174038|${parent}`,
  `STATE|12|10219|10219|700|1792174038|${parent}/Code Cache/wasm`,
  "SAMPLE|1|1792174038.150",
  `stat: '${parent}': No such file or directory`,
  "SAMPLE|2|1792174038.200",
  `STATE|20|10219|10219|700|1792174038|${parent}`,
  "SAMPLE|3|1792174038.250",
  `STATE|20|10219|10219|700|1792174038|${parent}`,
].join("\n"));
assert.equal(parsed.samples.length, 4);
assert.equal(parsed.directoryTransitions.length, 3,
  "Retain parent and child disappearance plus parent replacement");
assert(parsed.directoryTransitions.some(row => row.path === parent && row.after === null));
assert(parsed.directoryTransitions.some(row => row.path === parent && row.after?.inode === "20"));
assert.equal(parsed.samples[0].directories[0].uid, 10219);
assert.equal(parsed.samples[0].directories[0].mode, "700");
assert.equal(parseCacheProbe("su: inaccessible or not found").samples.length, 0,
  "Never invent samples when inspection is unavailable");
assert.throws(() => parseCacheProbe("SAMPLE|0|1\nSTATE|bad"), /INVALID_CACHE_PROBE_STATE/);
async function testObserver() {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { EventEmitter } = require("node:events");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-cache-probe-"));
  try {
    for (const fail of [false, true]) {
      const label = fail ? "failed" : "collected";
      const observer = startCacheProbe({ adb: "owned-adb.exe", adbPort: 51345, serial: "emulator-5554",
        packageName: pkg, outputDir: out, label, spawnProcess(exe, args, options) {
          assert.equal(exe, "owned-adb.exe");
          assert.deepEqual(args.slice(0, 5), ["-P", "51345", "-s", "emulator-5554", "shell"]);
          assert.equal(options.windowsHide, true);
          const child = new EventEmitter();
          child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 123;
          setImmediate(() => {
            if (fail) { child.emit("error", Error("original spawn failure")); child.stderr.emit("data", "original denial"); }
            else child.stdout.emit("data", Array.from({ length: 100 }, (_, i) =>
              `SAMPLE|${i}|1.${i}\nSTATE|10|10219|10219|700|1|${parent}`).join("\n"));
            child.emit("close", fail ? 1 : 0, null);
          });
          return child;
        } });
      const result = await observer.completion;
      assert.equal(result.status, fail ? "UNAVAILABLE" : "COLLECTED");
      assert.equal(result.samples.length, fail ? 0 : 100);
      const raw = fs.readFileSync(result.rawPath, "utf8");
      if (fail) { assert.match(raw, /original denial/); assert.match(result.spawnError, /original spawn failure/); }
      assert.match(result.limitation, /not an app-context access test/);
    }
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
  console.log("android-cache-probe: PASS (safe observer, ownership, inode lifecycle, raw failure, bounded cleanup)");
}
testObserver().catch(error => { console.error(error); process.exitCode = 1; });
