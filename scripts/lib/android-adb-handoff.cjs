"use strict";
const assert = require("node:assert/strict");
const { verifyColdBoot } = require("../android-acceptance-evidence.cjs");

async function initializeOwnedAdb({ command, coldBoot, startedAt, onServerStarted,
  onAttempt = () => {}, timeoutMs = 45000, intervalMs = 200,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0);
  assert(Number.isFinite(intervalMs) && intervalMs > 0);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, Math.min(5000, deadline - now()));
  const start = await command(["start-server"], remaining());
  assert.equal(start.status, 0, String(start.error || start.stderr || start.stdout));
  onServerStarted();
  const transient = result => result.status === 0
    ? String(result.stdout).trim() === "offline"
    : !result.error && /^(?:adb(?:\.exe)?: |error: )?(?:device offline|device '[^'\r\n]+' not found|no devices\/emulators found)\s*$/
      .test(String(result.stderr).trim());
  let attempt = 0;
  while (now() < deadline) {
    const row = { attempt: ++attempt, startedAt: new Date().toISOString() };
    row.state = await command(["get-state"], remaining());
    if (row.state.status === 0 && row.state.stdout.trim() === "device") {
      row.boot = await command(["shell", "cat", "/proc/sys/kernel/random/boot_id"], remaining());
      onAttempt(row);
      if (row.boot.status === 0) {
        const verified = verifyColdBoot(coldBoot, row.boot.stdout.trim(), startedAt);
        assert.equal(verified.status, "PASS", verified.reason);
        return verified;
      }
      assert(transient(row.boot), String(row.boot.error || row.boot.stderr || row.boot.stdout));
    } else {
      onAttempt(row);
      assert(transient(row.state), String(row.state.error || row.state.stderr || row.state.stdout));
    }
    if (now() >= deadline) break;
    await sleep(Math.min(intervalMs, deadline - now()));
  }
  throw Error("ADB_HANDOFF_TIMEOUT: same cold-boot device never became verifiably ready");
}
module.exports = { initializeOwnedAdb };
