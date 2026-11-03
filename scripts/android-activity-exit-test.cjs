"use strict";
const assert = require("node:assert/strict");
const { activityState, validateActivityExit } = require("./lib/android-activity-exit.cjs");
const pkg = "com.agentvn.qa.exit";
const before = activityState(`ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)
  * Hist #0: ActivityRecord{abc u0 ${pkg}/.MainActivity t23}
  topResumedActivity=ActivityRecord{abc u0 ${pkg}/.MainActivity t23}`, pkg);
assert.equal(before.closed, false);
const ended = `ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)
  realActivity=${pkg}/.MainActivity
  mLastPausedActivity: ActivityRecord{abc u0 ${pkg}/.MainActivity t23 f}
  * Hist #0: ActivityRecord{def u0 com.google.android.apps.launcher/.Launcher t1}
  mResumedActivity: ActivityRecord{def u0 com.google.android.apps.launcher/.Launcher t1}`;
const after = activityState(ended, pkg);
assert.equal(after.closed, true);
assert.equal(activityState(ended + `\n * Hist #0: ActivityRecord{xyz u0 ${pkg}/.MainActivity t23 f}`, pkg).closed, false,
  "still-finishing Activity must not count as closed");
assert.equal(activityState("ACTIVITY MANAGER ACTIVITIES", pkg).closed, false,
  "empty ActivityManager state is not closure");
assert.equal(activityState(ended.replaceAll(pkg, pkg + "other"), pkg).closed, true);
assert.throws(() => activityState("", pkg));
const exit = { basis: "ACTIVITY_FINISH", confirmationClicks: 1, forcedBeforeExit: false, elapsedMs: 500,
  pid: "123", before, after, closedCommandIndex: 10, cachedPid: "123", fatalBeforeReclaim: [],
  reclaim: { kind: "OS_RECLAIM_SIMULATION_AFTER_ACTIVITY_FINISH", commandIndex: 12, pidBefore: "123", pidAfter: null } };
validateActivityExit(exit);
const mutations = [
  e => { e.before.live = []; }, e => { e.after.closed = false; }, e => { e.after.live = ["still alive"]; },
  e => { e.after.resumed = []; }, e => { e.fatalBeforeReclaim = ["SIGABRT"]; },
  e => { e.forcedBeforeExit = true; }, e => { e.reclaim.commandIndex = 9; },
  e => { e.reclaim.pidAfter = "123"; }, e => { delete e.reclaim; },
];
for (const mutate of mutations) {
  const invalid = structuredClone(exit); mutate(invalid); assert.throws(() => validateActivityExit(invalid));
}
console.log(JSON.stringify({ status: "PASS", rejectedInvalidExits: mutations.length,
  scope: "QA_ACTIVITY_CLASSIFIER_NOT_DEVICE_OR_PRODUCT_ACCEPTANCE" }));
