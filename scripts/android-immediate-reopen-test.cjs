"use strict";
const assert = require("node:assert/strict");
const { validateImmediateActivityReopen } = require("./android-exit-device.cjs");
const result = { basis: "ACTIVITY_FINISH", nextLaunchPolicy: "IMMEDIATE_ACTIVITY_REOPEN",
  forcedBeforeExit: false, confirmationClicks: 1, before: { live: ["activity"] },
  after: { closed: true, live: [] }, elapsedMs: 500, fatalBeforeReclaim: [], pid: "123", closedCommandIndex: 10,
  reopened: { activity: { live: ["new Activity"] }, pid: "123", commandIndex: 12, titleReady: true, processRetained: true } };
validateImmediateActivityReopen(result);
const reclaimedByOS = structuredClone(result);
reclaimedByOS.reopened.pid = "456"; reclaimedByOS.reopened.processRetained = false;
validateImmediateActivityReopen(reclaimedByOS);
const cached = structuredClone(result);
cached.activityRestoration = "CACHED_RUNTIME_RECREATION";
cached.reopened.nativeRestoreCount = 1;
cached.reopened.nativeRestoreLine = "[123456] Android Runtime window restored for Activity -123.";
cached.reopened.nativeLog = { path: "native.log", sha256: "abcd" };
cached.reopened.targetId = "new";
cached.reopened.priorTargetId = "old";
cached.reopened.liveTargetIds = ["new"];
cached.reopened.targetSnapshot = { path: "targets.json", sha256: "abcd" };
validateImmediateActivityReopen(cached);
for (const mutate of [
  e => { e.reopened.pid = "456"; e.reopened.processRetained = false; },
  e => { e.reopened.nativeRestoreCount = 0; },
  e => { delete e.reopened.nativeLog; },
  e => { e.reopened.nativeRestoreLine = "Activity Displayed"; },
  e => { e.reopened.targetId = e.reopened.priorTargetId; },
  e => { e.reopened.liveTargetIds.push("old"); },
  e => { e.reopened.liveTargetIds = []; },
  e => { delete e.reopened.targetSnapshot; },
]) {
  const bad = structuredClone(cached); mutate(bad); assert.throws(() => validateImmediateActivityReopen(bad));
}
const mutations = [e => { e.reclaim = {}; }, e => { e.reopened.titleReady = false; },
  e => { e.reopened.activity.live = []; }, e => { e.reopened.processRetained = false; },
  e => { e.reopened.commandIndex = 9; }, e => { e.fatalBeforeReclaim = ["SIGABRT"]; }];
for (const mutate of mutations) {
  const invalid = structuredClone(result); mutate(invalid); assert.throws(() => validateImmediateActivityReopen(invalid));
}
console.log(JSON.stringify({ status: "PASS", rejectedInvalidReopens: mutations.length,
  scope: "QA_REOPEN_VALIDATOR_NOT_DEVICE_ACCEPTANCE" }));
