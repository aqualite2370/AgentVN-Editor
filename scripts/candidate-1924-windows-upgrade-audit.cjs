"use strict";
// Independent, read-only verification; the missing old quick-save action stays blocked.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Windows-Package-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function validate(r, recent) {
  assert.equal(r.status, "PARTIAL_PASS"); assert.equal(r.cleanupStatus, "PASS");
  assert(r.finishedAt && !r.error && !r.cleanupError);
  assert.equal(r.scope, `RETAINED_EDITOR_${recent ? "1_9_22" : "1_9_16"}_TO_INSTALLED_EDITOR_1_9_24_SAME_GAME_WINDOWS_SETUP_UPGRADE`);
  assert.equal(r.gameId, "qa_windows_pkg_20261021_01");
  for (const k of ["builds", "productChanges", "modelRequests", "copiedOrSeededSaves"]) assert.equal(r[k], 0);
  assert.equal(r.checks.length, 6); assert(r.checks.every(c => c.status === "PASS" && c.result && c.finishedAt));
  assert.deepEqual(r.errors, []); assert(r.uninstalled && r.profilesRestored && r.setupCleanup);
  assert.deepEqual(r.launches.map(l => l.version), [recent ? "1.0.1" : "1.0.0", "1.0.2"]);
  assert.notEqual(r.launches[0].executable.sha256, r.launches[1].executable.sha256);
  assert.equal(r.launches[0].shortcut.target, r.launches[1].shortcut.target);
  assert.equal(r.cleanups.length, 2);
  for (const c of r.cleanups) {
    assert.equal(c.method, "NATIVE_CONFIRMED_CLOSE"); assert.deepEqual(c.remaining, []);
    assert.equal(c.receipt.requestId, c.request.requestId);
    assert.equal(c.receipt.ownerPid, c.request.ownerPid);
    assert.equal(c.receipt.created, c.request.created);
    assert.equal(c.receipt.status, "INPUT_COMPLETED");
    assert.equal(c.receipt.method, "SKY_NATIVE_ALT_F4_AND_EXIT_CONFIRMATION");
    assert(c.receipt.interaction.includes("Computer Use"));
  }
  assert.deepEqual(r.beforeUpgrade, r.afterUpgrade);
  assert.deepEqual(r.beforeUpgrade.map(f => f.name), ["auto-01.json", "slot-01.json"]);
  assert.equal(r.oldPreference.muteSfx, true); assert.equal(r.oldPreference.autoSaveEnabled, true);
  assert.deepEqual(r.newPreference, r.oldPreference);
  assert.deepEqual(r.actualLoads.map(l => [l.kind, l.slot, l.index]), [["manual", 1, 0], ["auto", 1, 1]]);
  for (const l of r.actualLoads) {
    assert(l.restoredText.includes(l.savedText));
    assert(l.savedText.includes(`${recent ? "QA_WINDOWS_UPGRADE_NEW" : "QA_WINDOWS_SAVE"}_${l.index}`));
    if (recent) assert(l.savedText.includes("1.0.1"));
    assert.equal(l.nextIndex, l.index + 1);
    assert(l.actualText.includes(`QA_WINDOWS_UPGRADE_NEW_${l.nextIndex}`));
    assert(l.actualText.includes("新版1.0.2"));
  }
  assert.equal(r.blocked.length, 1);
  assert.equal(r.blocked[0].id, "WINDOWS-UPGRADE-OLD-QUICK-CREATE");
  assert.equal(r.blocked[0].status, "BLOCKED");
  assert(r.blocked[0].noSeedOrInternalStoreCall && r.blocked[0].actualEvidence.quickCategorySaveDisabled);
  assert.equal(r.oldQuickMenu.length, 7);
  assert.equal(r.screenshots.length, 4);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after);
    assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
    assert(Math.abs(s.before.dpr - 1) < 1e-6); assert.equal(s.before.reduced, false);
    assert.deepEqual(s.png, { width: 1920, height: 1080 });
  }
}
function negativeTests(r, recent) {
  const changes = [
    x => x.status = "PASS", x => x.blocked = [], x => x.checks.pop(),
    x => x.copiedOrSeededSaves = 1, x => x.afterUpgrade[0].sha256 = "0".repeat(64),
    x => x.launches[1].version = "1.0.1", x => x.actualLoads[0].actualText = "QA_WINDOWS_UPGRADE_NEW_1 新版1.0.1",
    x => x.cleanups[0].method = "FORCED", x => x.profilesRestored = false,
    x => x.newPreference.muteSfx = false, x => x.screenshots[0].png.width = 2400,
    x => x.cleanups[0].receipt.ownerPid++, x => x.cleanups[1].receipt.created = "wrong",
    x => x.cleanupStatus = "FAILED", x => x.actualLoads.pop(),
  ];
  for (const mutate of changes) { const x = structuredClone(r); mutate(x); assert.throws(() => validate(x, recent)); }
  return changes.length;
}
async function main() {
  if (process.argv[2] === "--self-test") {
    const r = read(path.join(qa, "runtime-20/report.json")); validate(r, false);
    console.log(JSON.stringify({ status: "PASS", rejected: negativeTests(r, false), productLaunches: 0 })); return;
  }
  const sample = process.argv[2]; assert(["oldest", "recent"].includes(sample));
  const recent = sample === "recent", run = path.join(qa, recent ? "runtime-22" : "runtime-20");
  const file = path.join(run, "report.json"), r = read(file);
  const out = path.join(qa, `candidate-upgrade-${sample}-audit-01`); fs.mkdirSync(out);
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: { path: file, sha256: sha(file) },
    featureStatus: "PARTIAL_PASS_OLD_QUICK_CREATION_BLOCKED", groups: [], productLaunches: 0 };
  const group = (name, fn) => {
    const row = { name, status: "RUNNING" }; report.groups.push(row);
    try { row.detail = fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  try {
    group("scope-and-rejected-false-completion", () => {
      validate(r, recent); return { rejected: negativeTests(r, recent), quickCreation: "BLOCKED", viewport: "1920x1080 DPR1 normal" };
    });
    group("real-install-and-same-directory-upgrade", () => {
      for (const f of [r.sourceOld, r.sourceNew, r.newAudit, r.newPayload]) assert.equal(sha(f.path), f.sha256);
      const old = read(r.sourceOld.path), current = read(r.sourceNew.path);
      if (recent) require("./installed-windows-native-ui-current-audit.cjs").validate(old);
      else require("./lib/windows-package-current-evidence.cjs").validateBuildEvidence(old);
      require("./candidate-1924-windows-native-audit.cjs").validate(current);
      const payload = read(r.newPayload.path), audit = read(r.newAudit.path);
      assert.equal(payload.status, "PASS"); assert.equal(audit.status, "PASS");
      assert.equal(audit.source.sha256, sha(r.sourceNew.path));
      assert.equal(payload.source.sha256, sha(r.sourceNew.path)); assert.equal(payload.buildAudit.sha256, sha(r.newAudit.path));
      const before = read(path.join(run, "installation.json")), after = read(path.join(run, "installation-upgrade.json"));
      assert.equal(before.status, "PASS"); assert.equal(after.status, "PASS");
      assert.equal(before.isElevated, false); assert.equal(after.client, before.client);
      assert.deepEqual(after.beforeRegistry, before.registry);
      assert.equal(after.method, "ACTUAL_SAME_DIRECTORY_NSIS_NO_UNINSTALL_NO_DATA_CLEAR");
      const oldSetup = recent ? old.windowsInstaller : old.artifacts.find(f => f.kind === "windows_nsis_installer");
      for (const [label, setup, install, version] of [
        ["install", oldSetup, before, recent ? "1.0.1" : "1.0.0"],
        ["upgrade", current.windowsInstaller, after, "1.0.2"],
      ]) {
        assert.equal(sha(setup.path), setup.sha256);
        const receipt = read(path.join(run, `${label}-process.json`));
        assert.equal(receipt.file, setup.path); assert.deepEqual(receipt.arguments, ["/S", "/D=" + after.client]);
        assert.equal(install.process.exitCode, 0);
        assert(install.registry.some(k => k.exists && k.hive === "CurrentUser" &&
          k.values.some(v => v.name === "DisplayVersion" && v.value === version)));
        assert(install.shortcuts.every(s => s.exists && !s.arguments && s.target === before.executable.path));
      }
      assert(Date.parse(before.finishedAt) < Date.parse(after.startedAt));
      const uninstalled = read(path.join(run, "uninstallation.json"));
      assert.equal(uninstalled.status, "PASS"); assert.equal(uninstalled.process.exitCode, 0);
      assert.equal(uninstalled.method, "ACTUAL_INSTALLED_UNINSTALL_EXE_S");
      assert.deepEqual(read(path.join(run, "uninstall-process.json")).arguments, ["/S"]);
      assert(Date.parse(after.finishedAt) < Date.parse(uninstalled.startedAt));
      assert.equal(after.executable.sha256, payload.executable.sha256);
      assert.equal(after.uninstaller.sha256, uninstalled.sourceUninstaller.sha256);
      assert.equal(after.resources.length, payload.resources.length);
      for (const f of after.resources) {
        const name = path.relative(path.join(after.client, "embedded-cartridge"), f.path).replaceAll("\\", "/");
        assert(payload.resources.some(p => p.name === name && p.sha256 === f.sha256 && p.bytes === f.bytes));
        assert(!fs.existsSync(f.path));
      }
      assert(!fs.existsSync(after.executable.path) && !fs.existsSync(after.uninstaller.path));
      for (const s of after.shortcuts) assert(!fs.existsSync(s.path));
      return { versions: [recent ? "1.0.1" : "1.0.0", "1.0.2"], oldCollectorOriginalStatus: old.status,
        sameDirectory: true, actualNewResources: after.resources.length };
    });
    group("actual-save-creation-preservation-loading-and-png", () => {
      const current = read(r.sourceNew.path);
      for (const folder of ["before-upgrade", "after-upgrade"])
        for (const f of r.beforeUpgrade) assert.equal(sha(path.join(run, folder, f.name)), f.sha256);
      for (const [fileName, index] of [["slot-01.json", 0], ["auto-01.json", 1]]) {
        const saved = read(path.join(run, "before-upgrade", fileName));
        assert.equal(saved.game_id, r.gameId); assert.equal(saved.command_index, index);
        assert(r.actualLoads.some(l => l.index === index && l.savedText === saved.dialog.text));
      }
      for (const l of r.actualLoads) assert(l.actualText.includes(current.upgradeFixture.project.nodes[1].data.scene.commands[l.nextIndex].text));
      for (const f of r.finalSaves)
        assert.equal(sha(path.join(run, "installed-client/saves", r.gameId, "preview_gamecli", f.name)), f.sha256);
      for (const s of r.screenshots) {
        const bytes = fs.readFileSync(s.path);
        assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
        if (s.sha256) assert.equal(sha(s.path), s.sha256);
      }
      for (const c of r.cleanups) assert.deepEqual(read(c.request.completion), c.receipt);
      return { actualLoaded: ["manual", "auto"], nextSentenceFromNewBytes: true, screenshots: r.screenshots.length };
    });
    group("original-profiles-and-owned-process-registration-cleanup", () => {
      const restoration = read(path.join(run, "profile-restoration.json")), protection = read(path.join(run, "profile-protection.json"));
      assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
      for (const p of restoration.records) {
        assert(p.qaRemoved); const before = protection.records.find(x => x.original === p.original); assert(before);
        assert(ps(`fsutil.exe file queryfileid '${p.original}'`).toLowerCase().includes(p.directoryId));
        assert(!fs.existsSync(before.held) && !fs.existsSync(before.retained));
        if (before.byteInventory) for (const f of before.files) assert.equal(sha(path.join(before.original, f.relative)), f.sha256);
      }
      const cleanup = read(path.join(run, "setup-cleanup.json")); assert.equal(cleanup.status, "PASS");
      assert.equal(cleanup.deletedUserFiles, 0); assert.equal(cleanup.registry.length, 8);
      for (const row of cleanup.registry) {
        assert(!row.exists);
        const key = `${row.hive === "CurrentUser" ? "HKCU" : "HKLM"}\\${row.key}`;
        assert.equal(ps(`& reg.exe query '${key}' /reg:${row.view === "Registry32" ? 32 : 64} 2>$null;` +
          `if($LASTEXITCODE -eq 0){throw 'QA registration remains'};[Console]::Write('ABSENT')`), "ABSENT");
      }
      const live = rows();
      assert(!r.known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
      assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
      for (const f of read(r.sourceNew.path).protectedFiles) assert.equal(sha(f.path), f.sha256);
      return { exactIdentities: r.known.length, ports: r.launches.map(l => l.port), deletedUserFiles: 0 };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
