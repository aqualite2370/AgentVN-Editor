"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { initializeOwnedAdb } = require("./lib/android-adb-handoff.cjs");
const base = "F:/AgentVN/QA/Android-Exit-20261024-01";
const out = path.join(base, process.argv[2] || "handoff-test");
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const coldBoot = JSON.parse(fs.readFileSync(path.join(base, "device-14/runtime/cold-boot.json"), "utf8"));
const startedAt = "2026-10-24T00:46:39.851Z", success = stdout => ({ status: 0, stdout, stderr: "" });
const offline = () => ({ status: 1, stdout: "", stderr: "adb.exe: device offline\r\n" });
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "CONTROLLED_QA_INITIALIZATION_SEAM_NOT_DEVICE_OR_PRODUCT_ACCEPTANCE", cases: [] };
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function fixture({ states = [success("device")], boots = [success(coldBoot.bootId)], start = success("") } = {}) {
  let now = 0, owned = false, stateIndex = 0, bootIndex = 0;
  const calls = [], attempts = [], sleeps = [];
  return { calls, attempts, sleeps, get owned() { return owned; },
    options: { coldBoot, startedAt, timeoutMs: 100, intervalMs: 10, now: () => now,
      sleep: async ms => { sleeps.push(ms); now += ms; },
      onServerStarted: () => { owned = true; },
      onAttempt: attempt => attempts.push(attempt),
      command: async (args, timeoutMs) => {
        calls.push({ args, timeoutMs });
        if (args[0] === "start-server") return start;
        assert(owned, "No device command before server ownership");
        if (args[0] === "get-state") return states[Math.min(stateIndex++, states.length - 1)];
        assert.deepEqual(args, ["shell", "cat", "/proc/sys/kernel/random/boot_id"]);
        return boots[Math.min(bootIndex++, boots.length - 1)];
      }
    } };
}
test("initial offline becomes ready; only read commands before verified identity", async () => {
  const f = fixture({ states: [offline(), success("device")] });
  const result = await initializeOwnedAdb(f.options);
  assert.equal(result.status, "PASS"); assert.equal(result.observedBootId, coldBoot.bootId);
  assert.deepEqual(f.calls.map(c => c.args[0]), ["start-server", "get-state", "get-state", "shell"]);
  assert.equal(f.attempts.length, 2); assert.equal(f.sleeps.length, 1);
});
test("transport drops between ready state and boot ID, retries both", async () => {
  const f = fixture({ boots: [offline(), success(coldBoot.bootId)] });
  const result = await initializeOwnedAdb(f.options);
  assert.equal(result.status, "PASS"); assert.equal(f.attempts.length, 2);
  assert.equal(f.calls.filter(c => c.args[0] === "get-state").length, 2);
});
test("permanent offline times out; no install or shell mutation", async () => {
  const f = fixture({ states: [offline()] });
  await assert.rejects(initializeOwnedAdb(f.options), /ADB_HANDOFF_TIMEOUT/);
  assert(f.attempts.length > 1); assert(f.calls.every(c => ["start-server", "get-state"].includes(c.args[0])));
  assert(f.calls.every(c => c.timeoutMs > 0 && c.timeoutMs <= 100));
});
test("wrong boot ID stops immediately; never switches emulator", async () => {
  const f = fixture({ boots: [success("wrong-boot")] });
  await assert.rejects(initializeOwnedAdb(f.options), /COLD_BOOT_EVIDENCE_MISSING_OR_MISMATCHED/);
  assert.equal(f.sleeps.length, 0); assert.equal(f.calls.length, 3);
});
test("unauthorized device fails immediately", async () => {
  const f = fixture({ states: [{ status: 1, stdout: "", stderr: "adb.exe: device unauthorized" }] });
  await assert.rejects(initializeOwnedAdb(f.options), /unauthorized/);
  assert.equal(f.sleeps.length, 0); assert.equal(f.calls.length, 2);
});
test("server startup fails without claiming cleanup ownership", async () => {
  const f = fixture({ start: { status: 1, stdout: "", stderr: "cannot bind listener" } });
  await assert.rejects(initializeOwnedAdb(f.options), /cannot bind listener/);
  assert.equal(f.owned, false); assert.equal(f.calls.length, 1);
});
test("missing serial is transient but empty boot ID fails closed", async () => {
  const f = fixture({ states: [{ status: 1, stdout: "", stderr: "adb.exe: device 'emulator-5554' not found" }, success("device")],
    boots: [success("")] });
  await assert.rejects(initializeOwnedAdb(f.options), /COLD_BOOT_EVIDENCE_MISSING_OR_MISMATCHED/);
  assert.equal(f.sleeps.length, 1);
});
test("unknown command failure is not hidden by retries", async () => {
  const f = fixture({ states: [{ status: 1, stdout: "", stderr: "unknown host service" }] });
  await assert.rejects(initializeOwnedAdb(f.options), /unknown host service/);
  assert.equal(f.sleeps.length, 0); assert.equal(f.calls.length, 2);
});
(async () => {
  for (const { name, fn } of cases) {
    const row = { name, status: "RUNNING" }; report.cases.push(row);
    try { await fn(); row.status = "PASS"; }
    catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); }
  }
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report)); if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
