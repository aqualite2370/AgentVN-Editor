"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { finishDebuggerWatcher } = require("./lib/android-cache-debugger.cjs");
async function run() {
  assert.equal(typeof finishDebuggerWatcher, "function", "Debugger finally must not await a stuck ADB transport forever");
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"],
    { windowsHide: true, stdio: "ignore" });
  const closed = new Promise(resolve => child.once("close", code => resolve(code)));
  try {
    const started = Date.now(), result = await finishDebuggerWatcher(child, closed, 100);
    assert.equal(result.recovered, true); assert.equal(child.exitCode !== null || child.signalCode !== null, true);
    assert(Date.now() - started < 4000);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; }
  const normal = spawn(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true, stdio: "ignore" });
  const done = new Promise(resolve => normal.once("close", resolve));
  const result = await finishDebuggerWatcher(normal, done, 2000);
  assert.equal(result.recovered, false); assert.equal(result.exitCode, 0);
  console.log("android-debugger-watcher: PASS (actual hung owned child recovered, normal child unchanged)");
}
run().catch(e => { console.error(e); process.exitCode = 1; });
