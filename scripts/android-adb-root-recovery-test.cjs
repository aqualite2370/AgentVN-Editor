"use strict";
const assert = require("node:assert/strict");
const { recoverOwnedRootTransport } = require("./lib/android-adb-root-recovery.cjs");
async function test() {
  const calls = [];
  const result = await recoverOwnedRootTransport({
    status: 1, stdout: "restarting adbd as root\n", stderr: "timeout expired while waiting for device\r\n",
  }, async () => calls.push("restart-owned-server"), async () => calls.push("verify-same-boot-and-root"));
  assert.deepEqual(calls, ["restart-owned-server", "verify-same-boot-and-root"]);
  assert.equal(result, "RECOVERED_OWNED_SERVER_AFTER_ROOT_RESTART_TIMEOUT");
  assert.equal(await recoverOwnedRootTransport({
    status: 1, stdout: "", stderr: "timeout expired while waiting for device\r\n",
  }, async () => {}, async () => {}), "RECOVERED_OWNED_SERVER_AFTER_ROOT_RESTART_TIMEOUT");
  const closedCalls = [];
  assert.equal(await recoverOwnedRootTransport({
    status: 1, stdout: "", stderr: "adb: unable to connect for root: closed\r\n",
  }, async () => closedCalls.push("restart-owned-server"),
  async () => closedCalls.push("verify-same-boot-and-root")),
  "RECOVERED_OWNED_SERVER_AFTER_ROOT_TRANSPORT_CLOSED");
  assert.deepEqual(closedCalls, ["restart-owned-server", "verify-same-boot-and-root"]);
  for (const failure of [
    { status: 1, stdout: "", stderr: "device unauthorized" },
    { status: 1, stdout: "adbd cannot run as root in production builds", stderr: "" },
    { status: 1, stdout: "", stderr: "adb: unable to connect for root: permission denied" },
    { status: 1, stdout: "", stderr: "adb: unable to connect for root: closed\nfatal: unauthorized" },
  ]) {
    await assert.rejects(() => recoverOwnedRootTransport(failure,
      async () => assert.fail("must not restart"), async () => assert.fail("must not continue")));
  }
  await assert.rejects(() => recoverOwnedRootTransport({ status: 0, stdout: "already running as root", stderr: "" },
    async () => {}, async () => { throw Error("boot identity changed"); }), /boot identity changed/);
  await assert.rejects(() => recoverOwnedRootTransport({
    status: 1, stdout: "", stderr: "adb: unable to connect for root: closed\r\n",
  }, async () => {}, async () => { throw Error("boot identity changed or uid is not root"); }),
  /boot identity changed or uid is not root/);
  console.log(JSON.stringify({ status: "PASS", timeoutRecovery: 2, closedRecovery: 1, rejected: 6, adbOperations: 0 }));
}
test().catch(e => { console.error(e); process.exitCode = 1; });
