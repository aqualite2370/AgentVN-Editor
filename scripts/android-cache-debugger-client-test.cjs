"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const lldb = process.argv[2];
assert(lldb, "Explicit NDK lldb path required");
const directory = path.join(__dirname, "lib").replaceAll("\\", "/");
function run(script) {
  return spawnSync(lldb, ["--batch", "-o", `script import sys,lldb;sys.path.insert(0,${JSON.stringify(directory)});import android_cache_debugger as probe;${script}`],
    { encoding: "utf8", windowsHide: true, timeout: 15000 });
}
const good = run('assert lldb.debugger.IsValid(); print("LLDB_IMPORT_PASS")');
assert.equal(good.status, 0); assert.match(good.stdout, /^LLDB_IMPORT_PASS\r?$/m);
const signals = run('s=lldb.debugger.GetSelectedTarget().GetProcess().GetUnixSignals(); assert all(hasattr(s, name) for name in ("GetSignalNumberFromName", "SetShouldSuppress", "SetShouldStop", "SetShouldNotify")); print("LLDB_SIGNAL_API_PASS")');
assert.equal(signals.status, 0); assert.match(signals.stdout, /^LLDB_SIGNAL_API_PASS\r?$/m);
const echoed = run('assert False, "intentional guard"; print("LLDB_FALSE_MARKER")');
assert.match(echoed.stdout, /LLDB_FALSE_MARKER/);
assert.doesNotMatch(echoed.stdout, /^LLDB_FALSE_MARKER\r?$/m, "Command echo cannot prove execution");
assert.equal(echoed.status, 0, "This NDK can exit zero after a script assertion; require the actual marker");
const bad = run('probe.entry(lldb.debugger, "Z:/agentvn-nonexistent-cache-probe.json")');
assert.equal(bad.status, 1, "Python exceptions must not silently exit zero");
assert.match(bad.stderr + bad.stdout, /FileNotFoundError/);
console.log("android-cache-debugger-client: PASS (real NDK client import, debugger binding, original exception and exit code)");
