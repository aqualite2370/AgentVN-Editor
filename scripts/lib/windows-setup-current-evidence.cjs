"use strict";
const assert = require("node:assert/strict");
function validateSetupEvidence(r, { editorVersion = "1.9.16", candidateBinding, sourcePath, nativeAuditPath, payloadPath, gameId } = {}) {
  assert.equal(r.status, "PASS"); assert(!r.error && !r.cleanupError);
  assert.equal(r.scope, "ACTUAL_GENERATED_WINDOWS_NSIS_INSTALL_SHORTCUT_RUNTIME_UNINSTALL");
  if (candidateBinding) {
    assert.match(editorVersion, /^1\.\d+\.\d+$/);
    assert.deepEqual(r.nativeCandidateBinding, candidateBinding);
    assert.equal(r.source.path, sourcePath); assert.equal(r.sourceAudit.path, nativeAuditPath);
    assert.equal(r.payload.path, payloadPath); assert.equal(r.gameId, gameId);
  } else assert(["1.9.16", "1.9.22"].includes(editorVersion));
  assert.equal(r.editorVersion, editorVersion);
  const nativeUI = editorVersion === "1.9.22" || Boolean(candidateBinding);
  if (nativeUI) {
    assert.equal(r.nativeUIBuildSource, true);
    if (!candidateBinding) {
    assert(/editor-03[\\/]report\.json$/.test(r.source.path));
    assert(/native-ui-audit-02[\\/]report\.json$/.test(r.sourceAudit.path));
    assert(/setup-payload-audit-02[\\/]report\.json$/.test(r.payload.path));
    assert.equal(r.gameId, "qa_windows_native_1922_03");
    }
  }
  for (const key of ["productChanges", "builds", "modelRequests"]) assert.equal(r[key], 0);
  assert(r.uninstalled && r.setupCleanup && r.profilesRestored); assert.deepEqual(r.errors, []);
  assert.equal(r.references.length, 2); assert(r.references.every(f => !f.executed && /^[a-f0-9]{64}$/.test(f.sha256)));
  assert.equal(r.checks.length, 5); assert(r.checks.every(c => c.status === "PASS"));
  const install = r.checks[0].result;
  assert.equal(install.status, "PASS"); assert.equal(install.isElevated, false);
  assert.equal(install.installationMethod, "ACTUAL_NSIS_SILENT_WITH_DEFAULT_SHORTCUTS_NO_UPDATE_OR_NS");
  assert.equal(install.process.exitCode, 0); assert.equal(install.shortcuts.length, 2);
  assert(install.shortcuts.every(s => s.exists && s.target === install.executable.path && !s.arguments));
  assert.equal(install.executable.sha256, install.payloadEvidence.executable.sha256);
  const marker = install.payloadEvidence.marker;
  assert.equal(marker.nsisSha256, install.executable.sha256);
  assert(marker.allOtherBytesIdentical && !marker.mutatedInput && marker.differentBytes === 3);
  assert.equal(marker.portableKind, "UNK"); assert.equal(marker.nsisKind, "NSS");
  assert.equal(install.resources.length, nativeUI ? 6 : 5);
  assert(install.registry.some(k => k.exists && k.hive === "CurrentUser" && k.key.includes("Uninstall")));
  assert(!install.registry.some(k => k.exists && k.hive === "LocalMachine"));
  assert.equal(r.launches.length, 2); assert.equal(r.cleanups.length, 2);
  for (const l of r.launches) {
    assert.equal(l.shortcut.target, install.executable.path);
    assert.equal(l.identity.ExecutablePath, install.executable.path);
    assert.equal(l.executableSha256, install.executable.sha256);
    assert(l.storage.portable && l.storage.targetDirectory.includes("\\installed-client\\saves\\"));
  }
  assert(r.launches[0].pid !== r.launches[1].pid || r.launches[0].created !== r.launches[1].created);
  for (const [i, c] of r.cleanups.entries()) {
    assert.deepEqual(c.remaining, []);
    assert.equal(c.method, i === 1 && r.nativePhysicalClose ? "NATIVE_CONFIRMED_WINDOW_CLOSE"
      : "ATTRIBUTED_TERMINATION_NOT_PHYSICAL_CLOSE");
  }
  if (r.nativePhysicalClose) {
    assert(nativeUI && r.nativeCloseReceipt);
    assert.equal(r.nativeCloseReceipt.method, "SKY_NATIVE_ALT_F4_AND_EXIT_CONFIRMATION");
    assert.equal(r.nativeCloseReceipt.pid, r.launches[1].pid);
    assert.equal(r.nativeCloseReceipt.created, r.launches[1].created);
  }
  assert.equal(r.screenshots.length, 5);
  assert.deepEqual(r.checks[2].result.loaded, [
    { kind: "auto", slot: 1, command: 1 },
    { kind: "quick", slot: 6, command: 1 },
    { kind: "manual", slot: 1, command: 0 },
  ]);
  assert.equal(r.checks[3].result.loadedKind, "auto"); assert.equal(r.checks[3].result.command, 1);
  const uninstall = r.checks[4].result;
  assert.equal(uninstall.result.status, "PASS"); assert.equal(uninstall.result.method, "ACTUAL_INSTALLED_UNINSTALL_EXE_S");
  assert.equal(uninstall.result.process.exitCode, 0);
  assert(uninstall.result.shortcuts.every(s => !s.exists));
  assert(!uninstall.result.registry.some(k => k.exists && k.key.includes("Uninstall")));
  assert.deepEqual(uninstall.retainedSaves, r.finalSaves);
  assert.deepEqual(uninstall.retainedLegacy, r.finalLegacy);
  assert.deepEqual(r.finalSaves.map(f => f.name), ["auto-01.json", "quick-06.json", "slot-01.json"]);
  assert.deepEqual(r.finalLegacy.map(f => f.name), ["auto-01.json", "quick-06.json"]);
  for (const f of r.finalLegacy) assert.equal(r.finalSaves.find(s => s.name === f.name).sha256, f.sha256);
  return { installStatus: "PASS", shortcutLaunchStatus: "PASS", actualLoadedKinds: ["auto", "quick", "manual"],
    uninstallStatus: "PASS", upgradeStatus: "NOT_RUN", defaultInstallDirectoryStatus: "NOT_RUN_EXPLICIT_QA_DIRECTORY",
    nativeCloseStatus: r.nativePhysicalClose ? "PASS" : "NOT_RUN",
    viewportScope: "1920x1080_DPR1_ORDINARY_INSTALLED_SETUP_SMOKE_NOT_FULL_MATRIX" };
}
module.exports = { validateSetupEvidence };
