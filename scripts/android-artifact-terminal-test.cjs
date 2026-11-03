"use strict";
// QA-only: a usable signed artifact never erases a failed native close.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { validateArtifactTerminal } = require("./lib/android-artifact-terminal.cjs");
const root = "F:/AgentVN/QA/Android-Package-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const input = {
  build: read(root + "/editor-12/report.json"),
  admin: read(root + "/administrator-12/result.json"),
  task: read(root + "/administrator-12/task-engine.json"),
};
assert.deepEqual(validateArtifactTerminal(input), {
  artifactBuildStatus: "PASS", normalCloseStatus: "FAILED",
  publishingWorkflowStatus: "FAILED", cleanupMode: "ATTRIBUTED_FORCED_CLEANUP",
});
const invalid = [
  x => { x.build.steps[2].status = "FAILED"; },
  x => { x.build.builds = 2; },
  x => { x.build.steps[3].status = "PASS"; },
  x => { x.build.error = "APK build failed"; },
  x => { x.build.protectedUnchanged = false; },
  x => { x.admin.physicalProtectionRestoration = "FAILED"; },
  x => { x.admin.policyRestoration = "FAILED"; },
  x => { x.task.cleanup = "NOT_RUN"; },
  x => { x.build.cleanups[0].normalCloseClaimed = true; },
];
for (const change of invalid) {
  const value = structuredClone(input); change(value);
  assert.throws(() => validateArtifactTerminal(value));
}
console.log(JSON.stringify({ status: "PASS", rejected: invalid.length,
  scope: "QA_ARTIFACT_ELIGIBILITY_ONLY_NORMAL_CLOSE_REMAINS_FAILED" }));
