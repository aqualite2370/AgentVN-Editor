"use strict";
// Validate failed attempts and cleanup without turning them into product PASS.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { DatabaseSync } = require("node:sqlite");
const [base, output] = process.argv.slice(2);
assert(base && output && !fs.existsSync(output));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = {
  status: "RUNNING", productStatus: "BLOCKED", startedAt: new Date().toISOString(),
  productChanges: 0, builds: 0, paidModelRequests: 0, checks: [], attempts: [],
  blockers: ["Current candidate cross-generation migration consent not completed",
    "Legacy 1.7.1 host exits but Backend and port remain: observed product FAILED"],
};
for (const [name, configName] of [
  ["editor-cross-wm-close-01", "editor-cross-wm-close-config.json"],
  ["editor-cross-wm-close-02", "editor-cross-wm-close-config-02.json"],
  ["editor-cross-win32-03", "editor-cross-win32-config-03.json"],
]) {
  const root = path.join(base, name), source = path.join(root, "report.json");
  const raw = read(source), config = read(path.join(base, configName));
  const entry = { name, rawStatus: raw.status, source: { path: source, sha256: sha(source) }, checks: [] };
  report.attempts.push(entry);
  const check = (label, fn) => {
    try { entry.checks.push({ label, status: "PASS", detail: fn() }); }
    catch (error) { entry.checks.push({ label, status: "FAILED", error: String(error.stack || error) }); }
  };
  check("honest terminal state, real installation and preserved source attribution", () => {
    assert.equal(raw.status, "FAILED"); assert.equal(raw.cleanupStatus, "PASS");
    assert.equal(raw.productChanges, 0); assert.equal(raw.modelRequests, 0);
    assert.equal(raw.steps.length, 5); assert(raw.steps.slice(0, 4).every(s => s.status === "PASS"));
    assert.equal(raw.steps[4].status, "FAILED");
    assert.equal(raw.migration, undefined, "No successful consent or migration may be claimed");
    const before = read(path.join(root, "InstallOld.json")), after = read(path.join(root, "InstallNew.json"));
    assert.equal(before.actualVersion, "1.7.1"); assert.equal(after.actualVersion, "1.9.35");
    assert.equal(before.installRoot, after.installRoot);
    assert.equal(after.sha256, config.installerSHA256);
    assert.equal(after.actualSha256, "a1ece0a5d69cc0c319fd5d8fe6a9cdca8259f88fd7eeaeae1cc18e88c4fb5dd8");
    assert(!fs.existsSync(path.join(after.installRoot, "agentvn-editor.exe")));
    const binding = read(path.join(config.preparation, "binding.json"));
    let archivedSources = 0;
    for (const file of binding.files) {
      if (sha(file.path) === file.sha256) continue;
      const archived = path.join(root, "failed-qa-sources", path.basename(file.path));
      assert.equal(sha(archived), file.sha256, "Changed QA source must have an exact archived original");
      archivedSources++;
    }
    const copy = path.join(root, "old-install-local.db");
    assert.equal(sha(copy), raw.legacyDatabase.sha256);
    const database = new DatabaseSync(copy, { readOnly: true });
    try { assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); }
    finally { database.close(); }
    return { realOldAndNewInstalls: true, oldAuthorDatabase: "valid", archivedSources, migration: "NOT_COMPLETED" };
  });
  check("legacy normal-close defect recorded before owned cleanup", () => {
    const close = read(path.join(root, "old-close-observation.json")), launch = raw.launches[0];
    assert.equal(close.status, "FAILED"); assert.equal(close.normalClose, false);
    assert.equal(close.hostExited, true); assert.equal(close.pid, launch.pid); assert.equal(close.created, launch.created);
    assert.equal(close.remainingBackend.length, 1); assert(close.remainingPorts.some(p => p.LocalPort === 8278));
    assert.equal(sha(close.nativeEvidence.path), close.nativeEvidence.sha256);
    const sent = read(close.nativeEvidence.path);
    assert.equal(sent.ownerPid, launch.pid); assert.equal(sent.created, launch.created); assert.equal(sent.accepted, true);
    assert(raw.cleanups.some(c => c.label === "old" && c.normalClose === false && c.killed.length > 0));
    return { hostNaturallyExited: true, legacyBackendLeftRunning: true, explicitOwnedCleanup: true };
  });
  check("uninstall, original restoration, archived QA profiles and no live owned processes", () => {
    for (const action of ["Uninstall", "Restore"]) assert.equal(read(path.join(root, action + ".json")).status, "PASS");
    const cleanup = read(path.join(root, "retained-cleanup-01.json"));
    assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.deletedUserFiles, 0); assert.equal(cleanup.records.length, 3);
    for (const record of cleanup.records) {
      assert(record.removed && !fs.existsSync(record.source));
      for (const file of record.files) assert.equal(sha(path.join(record.archive, file.relative)), file.sha256);
    }
    const live = rows();
    assert(!live.some(p => raw.known.some(q => p.ProcessId === q.ProcessId && p.Created === q.Created)));
    assert.equal(listeners([...new Set(raw.launches.flatMap(l => l.ports))]).length, 0);
    return { profilesArchived: 3, bytesRemovedFromC: cleanup.bytesRemovedFromC, userFilesDeleted: 0, ownedProcesses: 0 };
  });
}
const third = read(path.join(base, "editor-cross-win32-03/migration-win32.json"));
assert.equal(third.status, "FAILED"); assert.equal(third.title, "迁移 AgentVN 项目数据");
assert.equal(third.inputAt, undefined, "No click after failing the text guard");
assert.match(third.error, /Exact old database path missing/);
report.nativeConfirmation = { lastAttempt: "BLOCKED", realDialogLocated: true,
  affirmativeButtonVisible: third.controls.some(c => c.id === 6 && /是|Yes/.test(c.name)),
  actualClick: false, reason: "Owned Win32 caption/button readable; body source path unavailable" };
report.status = report.attempts.every(a => a.checks.every(c => c.status === "PASS"))
  ? "PASS_EVIDENCE_ONLY_PRODUCT_BLOCKED" : "FAILED";
report.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report));
if (report.status === "FAILED") process.exitCode = 1;
