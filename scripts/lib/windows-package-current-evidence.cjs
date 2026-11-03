"use strict";
const assert = require("node:assert/strict");
function validateBuildEvidence(r) {
  // Exact known collector failure only. This is not permission to promote
  // arbitrary FAILED reports or to mutate the original report.
  assert.equal(r.status, "FAILED");
  assert.equal(r.scope, "ACTUAL_INSTALLED_EDITOR_UI_VNCART_THEN_CONTROLLED_NATIVE_WINDOWS_BUILD_NOT_PICKER");
  assert.equal(r.featureStatus, "PASS");
  assert(r.error.includes("0 !== 1") && r.error.includes("installed-windows-package-current.cjs:192:12"));
  assert(!r.cleanupError && r.protectedUnchanged && r.packageCacheRestored && r.windowsCacheRestored);
  assert.equal(r.normalStandaloneUIExportStatus, "BLOCKED_NATIVE_PICKER_TOOL_UNAVAILABLE");
  assert.equal(r.productChanges, 0); assert.equal(r.modelRequests, 0); assert.equal(r.builds, 1);
  assert.equal(r.sourceBuilderInvocation, false); assert.deepEqual(r.errors, []);
  assert.deepEqual(r.steps.map(s => s.status), ["PASS", "PASS", "FAILED"]);
  assert(r.steps[2].error.includes("installed-windows-package-current.cjs:192:12"));
  assert.equal(r.nativeResult.status, "TERMINAL");
  assert.equal(r.nativeResult.result.status, "PASS"); assert.equal(r.nativeResult.result.ok, true);
  assert.equal(r.nativeResult.result.failureCode, null);
  assert.deepEqual(r.nativeResult.result.warnings, []);
  assert.equal(r.artifacts.length, 3);
  assert.deepEqual(r.artifacts.map(a => a.kind).sort(),
    ["release_optimization_report", "windows_nsis_installer", "windows_portable_exe"]);
  for (const a of r.artifacts) {
    assert(a.bytes > 0 && /^[a-f0-9]{64}$/.test(a.sha256));
    const native = r.nativeResult.result.artifacts.find(n => n.kind === a.kind);
    assert(native && native.bytes === a.bytes && native.path.replace(/^\\\\\?\\/, "") === a.path);
  }
  assert.equal(r.nativeResult.result.releaseIdentity.gameId, r.cartridge.manifest.game_id);
  assert.equal(r.nativeResult.result.releaseIdentity.versionName, "1.0.0");
  assert(r.buildKnownProcesses.some(p => p.Name === "cargo.exe"));
  assert(r.buildKnownProcesses.some(p => p.Name === "rustc.exe"));
  assert.equal(r.cleanups.length, 1);
  assert.equal(r.cleanups[0].status, "PASS");
  assert.equal(r.cleanups[0].normalCloseClaimed, false);
  assert(r.cleanups[0].killed.length > 0 && r.cleanups[0].ports.length === 2);
  return { nativeBuildStatus: "PASS", collectorStatus: "FAILED_PRESERVED",
    normalUIExportStatus: "BLOCKED_NATIVE_PICKER_TOOL_UNAVAILABLE",
    materializedWorkspaceHashStatus: "NOT_RECORDED_BEFORE_SUCCESS_CLEANUP" };
}
module.exports = { validateBuildEvidence };
