"use strict";
// Exercise the same command gate used by the real runner; no ADB or model calls.
const assert = require("node:assert/strict");
const { assertPreservedUpgradeData, runningPackagePid } = require("./android-native-upgrade-device.cjs");
assert.equal(runningPackagePid({ status: 1, stdout: "", stderr: "" }), null);
assert.equal(runningPackagePid({ status: 0, stdout: "3335\n", stderr: "" }), "3335");
assert.throws(() => runningPackagePid({ status: 1, stdout: "", stderr: "device offline" }));
const pkg = "com.agentvn.qa.androidcurrent20261021";
for (const args of [["uninstall", pkg], ["shell", "pm", "clear", pkg]]) {
  assert.throws(() => assertPreservedUpgradeData(args, true, false), /preserve the old data/);
  assert.doesNotThrow(() => assertPreservedUpgradeData(args, false, false));
  assert.doesNotThrow(() => assertPreservedUpgradeData(args, true, true));
}
for (const args of [["install", "-r", "current-staging.apk"], ["shell", "am", "force-stop", pkg],
  ["shell", "input", "tap", "100", "200"], ["exec-out", "cat", "/owned/save.json"]])
  assert.doesNotThrow(() => assertPreservedUpgradeData(args, true, false));
console.log(JSON.stringify({ status: "PASS", prohibitedDuringUpgrade: 2, permittedDuringUpgrade: 4,
  scope: "QA_DATA_PRESERVATION_GATE_ONLY_NOT_DEVICE_ACCEPTANCE", adbOperations: 0, modelRequests: 0 }));
