"use strict";
// QA receipt validation only; no product, credentials, build or device access.
const assert = require("node:assert/strict");
const qa = require("./android-default-controlled.cjs");
const selection = {
  status: "CONTROLLED_DIRECTORY_INJECTED", nativePickerTested: false,
  productModified: false, persistedHook: false, ownerPid: 42,
  command: "select_package_output_dir", selectedPath: "F:\\AgentVN\\QA\\Android-Package-20261021-01\\editor-32\\Android 输出",
  result: { calls: 1, restored: true }, cleanup: { restored: true },
};
const build = {
  nativePickerStatus: "NOT_RUN_CONTROLLED_INPUT", normalUIExportStatus: "PASS_UI_CONTROLLED_DIRECTORY",
  controlledOutput: selection, launches: [{ pid: 42 }],
  normalClose: { method: "NATIVE_IPC_CLOSE", command: "plugin:window|close", label: "main",
    physicalInput: false, ownerPid: 42, observedHostAndPortsGone: true,
    response: "RESOLVED_OR_WINDOW_DISCONNECTED" },
  cleanups: [{ status: "PASS", killed: [] }],
};
qa.validateSelection(build, "F:/AgentVN/QA/Android-Package-20261021-01/editor-32");
qa.validateClose(build);
let rejected = 0;
for (const change of [
  b => { b.controlledOutput.result.calls = 0; },
  b => { b.controlledOutput.result.calls = 2; },
  b => { b.controlledOutput.cleanup.restored = false; },
  b => { b.controlledOutput.persistedHook = true; },
  b => { b.controlledOutput.productModified = true; },
  b => { b.controlledOutput.nativePickerTested = true; },
  b => { b.controlledOutput.ownerPid++; },
  b => { b.controlledOutput.selectedPath = "D:\\AgentVN"; },
  b => { b.nativeOutput = {}; },
  b => { b.normalUIExportStatus = "PASS_NATIVE_UI"; },
]) {
  const bad = structuredClone(build); change(bad);
  assert.throws(() => qa.validateSelection(bad, "F:/AgentVN/QA/Android-Package-20261021-01/editor-32")); rejected++;
}
for (const change of [
  b => { b.normalClose.physicalInput = true; },
  b => { b.normalClose.method = "COMPUTER_USE"; },
  b => { b.normalClose.command = "plugin:window|destroy"; },
  b => { b.normalClose.label = ""; },
  b => { b.normalClose.ownerPid++; },
  b => { b.normalClose.observedHostAndPortsGone = false; },
  b => { b.cleanups[0].killed.push("owned-but-forced"); },
  b => { b.cleanups[0].status = "FAILED"; },
]) {
  const bad = structuredClone(build); change(bad);
  assert.throws(() => qa.validateClose(bad)); rejected++;
}
console.log(JSON.stringify({ status: "PASS", validControlledSelectionAndNativeClose: 2,
  rejected, productStarts: 0, modelRequests: 0, physicalInputClaims: 0 }));
