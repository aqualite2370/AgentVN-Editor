"use strict";
const assert = require("node:assert/strict");

// ActivityManager histories are live Activities; a last-paused pointer or a
// recent-task component alone does not mean the Activity still exists.
function activityState(dump, packageName) {
  assert.match(packageName, /^[a-zA-Z][\w]*(?:\.[\w]+)+$/);
  assert.match(dump, /ACTIVITY MANAGER ACTIVITIES/);
  const component = new RegExp(`(?:^|\\s)${packageName.replaceAll(".", "\\.")}/[^\\s}]+`);
  const records = dump.split(/\r?\n/).filter(line =>
    /(?:Hist #\d+:|(?:topResumedActivity|mResumedActivity)\s*[:=])\s*ActivityRecord\{/.test(line));
  const live = records.filter(line => component.test(line));
  const resumed = records.filter(line => /(?:topResumedActivity|mResumedActivity)\s*[:=]/.test(line));
  return { live, resumed, closed: live.length === 0 && resumed.some(line => !component.test(line)) };
}

function validateActivityExit(exit) {
  assert.equal(exit.basis, "ACTIVITY_FINISH");
  assert.equal(exit.confirmationClicks, 1);
  assert.equal(exit.forcedBeforeExit, false);
  assert(exit.elapsedMs >= 0 && exit.elapsedMs < 15000);
  assert(exit.before.live.length > 0);
  assert.equal(exit.after.closed, true);
  assert.equal(exit.after.live.length, 0);
  assert(exit.after.resumed.length > 0);
  assert.deepEqual(exit.fatalBeforeReclaim, []);
  assert(Number.isInteger(exit.closedCommandIndex));
  if (exit.reclaim) {
    assert.equal(exit.reclaim.kind, "OS_RECLAIM_SIMULATION_AFTER_ACTIVITY_FINISH");
    assert(exit.reclaim.commandIndex > exit.closedCommandIndex);
    assert.equal(exit.reclaim.pidBefore, exit.pid);
    assert.equal(exit.reclaim.pidAfter, null);
  } else assert.equal(exit.cachedPid, null);
}
module.exports = { activityState, validateActivityExit };
