"use strict";
const assert = require("node:assert/strict");
function validateArtifactTerminal({ build, admin, task }) {
  assert.equal(build.status, "FAILED"); assert(build.finishedAt);
  assert.equal(build.stage, "WAIT_NATIVE_EDITOR_CLOSE");
  assert.match(build.error, /^Error: Timeout Computer Use normal Editor close: not ready\n/);
  assert.equal(build.steps.length, 4);
  assert(build.steps.slice(0, 3).every(s => s.status === "PASS"));
  assert.equal(build.steps[3].label, "Normal native elevated Editor close");
  assert.equal(build.steps[3].status, "FAILED");
  assert.equal(build.steps[3].error, build.error);
  assert.equal(build.builds, 1); assert.equal(build.featureStatus, "PASS");
  assert.equal(build.normalUIExportStatus, "PASS_NATIVE_UI");
  assert.equal(build.protectedUnchanged, true); assert.equal(build.cleanupError, undefined);
  assert.equal(build.cleanups.length, 1);
  assert.equal(build.cleanups[0].status, "PASS");
  assert.equal(build.cleanups[0].normalCloseClaimed, false);
  assert(build.cleanups[0].killed.length > 0);
  assert(admin.finishedAt && admin.isElevated && admin.probe?.isElevated && admin.probe.success);
  assert.equal(admin.exitCode, 1); assert.equal(admin.error, null);
  assert.equal(admin.policyRestoration, "PASS");
  assert.equal(admin.physicalProtectionRestoration, "PASS");
  assert.equal(task.status, "TERMINAL"); assert.equal(task.cleanup, "PASS"); assert(task.finishedAt);
  return { artifactBuildStatus: "PASS", normalCloseStatus: "FAILED",
    publishingWorkflowStatus: "FAILED", cleanupMode: "ATTRIBUTED_FORCED_CLEANUP" };
}
module.exports = { validateArtifactTerminal };
