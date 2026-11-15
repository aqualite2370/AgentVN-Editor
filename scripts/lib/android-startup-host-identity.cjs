"use strict";
const assert = require("node:assert/strict");
// One empty pidof read is not proof of process death. A single read-only
// re-observation may recover only the already captured boot AND host PID.
async function readStartupHostIdentity({ expected, samplePid, readBoot, allowRecovery,
  pause, record = () => {} }) {
  assert(expected?.boot && /^\d+$/.test(expected.pid));
  let sample = await samplePid();
  if (sample.status === 1 && !sample.stdout.trim() && !sample.stderr.trim() && allowRecovery()) {
    record({ kind: "empty-pidof-read", code: sample.status, expected });
    await pause();
    sample = await samplePid();
    record({ kind: "pidof-read-reobservation", code: sample.status,
      observedPid: sample.stdout.trim(), expected });
  }
  assert.equal(sample.status, 0, "Owned host pidof read did not recover");
  const pid = sample.stdout.trim();
  assert.match(pid, /^\d+$/);
  const observed = { boot: await readBoot(), pid };
  assert.deepEqual(observed, expected, "Startup boot or host PID changed");
  return observed;
}
module.exports = { readStartupHostIdentity };
