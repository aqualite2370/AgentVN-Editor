"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { readStartupHostIdentity: identity } = require("./lib/android-startup-host-identity.cjs");
const expected = { boot: "boot-original", pid: "3939" };
const ok = pid => ({ status: 0, stdout: pid, stderr: "" });
const empty = { status: 1, stdout: "", stderr: "" };
function fixture(samples, boot = expected.boot) {
  let reads = 0, recovered = false, pauses = 0;
  const records = [];
  return { args: { expected, samplePid: async () => { reads++; return samples.shift(); },
    readBoot: async () => boot, allowRecovery: () => { if (recovered) return false; recovered = true; return true; },
    pause: async () => { pauses++; }, record: row => records.push(row) },
    result: () => ({ reads, pauses, records }) };
}
test("normal identity needs no retry", async () => {
  const f = fixture([ok("3939")]); assert.deepEqual(await identity(f.args), expected);
  assert.equal(f.result().reads, 1); assert.equal(f.result().pauses, 0);
});
test("one empty read recovers only the captured host and records both observations", async () => {
  const f = fixture([empty, ok("3939")]); assert.deepEqual(await identity(f.args), expected);
  assert.equal(f.result().reads, 2); assert.equal(f.result().records.length, 2);
});
test("persistent empty reads cannot loop or fabricate a live process", async () => {
  const f = fixture([empty, empty, ok("3939")]);
  await assert.rejects(identity(f.args), /did not recover/);
  assert.equal(f.result().reads, 2);
});
test("a changed PID or reboot cannot count as recovered identity", async () => {
  for (const [pid, boot] of [["3940", expected.boot], ["3939", "new-boot"]]) {
    const f = fixture([empty, ok(pid)], boot);
    await assert.rejects(identity(f.args), /Startup boot or host PID changed/);
  }
});
test("transport errors and an exhausted read budget do not retry", async () => {
  const f = fixture([{ status: 1, stdout: "", stderr: "device offline" }]);
  await assert.rejects(identity(f.args), /did not recover/); assert.equal(f.result().reads, 1);
  const g = fixture([empty]); g.args.allowRecovery = () => false;
  await assert.rejects(identity(g.args), /did not recover/); assert.equal(g.result().reads, 1);
});
