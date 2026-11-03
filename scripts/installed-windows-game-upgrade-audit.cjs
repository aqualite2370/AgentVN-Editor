"use strict";
// Offline terminal audit. A missing old quick-save workflow stays BLOCKED.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Windows-Package-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function validate(r, options = {}) {
  const oldVersion = options.oldVersion || "1.0.0", newVersion = options.newVersion || "1.0.1";
  const oldMarker = options.oldEditorVersion === "1.9.24" ? "QA_WINDOWS_UPGRADE_NEW" : "QA_WINDOWS_SAVE";
  const newMarker = options.editorVersion ? "QA_WINDOWS_UPGRADE_CURRENT" : "QA_WINDOWS_UPGRADE_NEW";
  assert.equal(r.status, "PARTIAL_PASS"); assert.equal(r.cleanupStatus, "PASS");
  assert(r.finishedAt && !r.error && !r.cleanupError);
  assert.equal(r.scope, options.editorVersion
    ? `RETAINED_EDITOR_${options.oldEditorVersion.replaceAll(".", "_")}_TO_INSTALLED_EDITOR_${options.editorVersion.replaceAll(".", "_")}_SAME_GAME_WINDOWS_SETUP_UPGRADE`
    : "RETAINED_EDITOR_1_9_16_TO_INSTALLED_EDITOR_1_9_22_SAME_GAME_WINDOWS_SETUP_UPGRADE");
  if (options.editorVersion) {
    assert.equal(r.editorVersion, options.editorVersion);
    assert.deepEqual(r.nativeCandidateBinding, options.candidateBinding);
    assert.equal(r.oldVersion, oldVersion); assert.equal(r.newVersion, newVersion);
  }
  assert.equal(r.gameId, "qa_windows_pkg_20261021_01");
  for (const k of ["builds", "productChanges", "modelRequests", "copiedOrSeededSaves"]) assert.equal(r[k], 0);
  assert.equal(r.checks.length, 6); assert(r.checks.every(c => c.status === "PASS" && c.finishedAt && c.result));
  assert.equal(new Set(r.checks.map(c => c.name)).size, 6);
  assert.deepEqual(r.errors, []); assert(r.uninstalled && r.profilesRestored && r.setupCleanup);
  assert.equal(r.launches.length, 2);
  assert.deepEqual(r.launches.map(l => l.version), [oldVersion, newVersion]);
  assert.notEqual(r.launches[0].executable.sha256, r.launches[1].executable.sha256);
  assert.equal(r.launches[0].shortcut.target, r.launches[1].shortcut.target);
  assert.equal(r.cleanups.length, 2);
  assert(r.cleanups.every(c => c.method === "NATIVE_CONFIRMED_CLOSE" && c.remaining.length === 0
    && c.receipt.ownerPid === c.request.ownerPid && c.receipt.requestId === c.request.requestId
    && c.receipt.status === "INPUT_COMPLETED" && c.receipt.interaction.includes("Computer Use")));
  if (options.editorVersion) for (const c of r.cleanups) {
    assert.equal(c.receipt.created, c.request.created);
    assert.equal(c.receipt.method, "SKY_NATIVE_ALT_F4_AND_EXIT_CONFIRMATION");
  }
  assert.deepEqual(r.beforeUpgrade, r.afterUpgrade);
  assert.deepEqual(r.beforeUpgrade.map(f => f.name), ["auto-01.json", "slot-01.json"]);
  assert.equal(r.oldPreference.muteSfx, true); assert.equal(r.oldPreference.autoSaveEnabled, true);
  assert.deepEqual(r.newPreference, r.oldPreference);
  assert.deepEqual(r.actualLoads.map(l => [l.kind, l.slot, l.index]), [["manual", 1, 0], ["auto", 1, 1]]);
  r.actualLoads.forEach(l => {
    assert(l.restoredText.includes(l.savedText)); assert(l.savedText.includes(`${oldMarker}_${l.index}`));
    if (options.oldEditorVersion === "1.9.24") assert(l.savedText.includes("新版1.0.2"));
    assert.equal(l.nextIndex, l.index + 1);
    assert(l.actualText.includes(`${newMarker}_${l.nextIndex}`));
    if (options.editorVersion) assert(l.actualText.includes("新版1.0.3"));
  });
  assert.equal(r.blocked.length, 1); assert.equal(r.blocked[0].id, "WINDOWS-UPGRADE-OLD-QUICK-CREATE");
  assert.equal(r.blocked[0].status, "BLOCKED"); assert.equal(r.blocked[0].noSeedOrInternalStoreCall, true);
  assert(r.blocked[0].actualEvidence.quickCategorySaveDisabled); assert.equal(r.oldQuickMenu.length, 7);
  assert.equal(r.screenshots.length, 4);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after);
    assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
    assert(Math.abs(s.before.dpr - 1) < 1e-6); assert.equal(s.before.reduced, false);
    assert.deepEqual(s.png, { width: 1920, height: 1080 });
  }
}
async function main() {
  const run = path.join(qa, `runtime-${process.argv[2] || "13"}`), file = path.join(run, "report.json");
  assert.match(path.basename(run), /^runtime-\d{2}$/);
  const r = read(file); assert.notEqual(r.status, "RUNNING");
  const context = r.nativeCandidateBinding
    ? require("./lib/windows-current-native-source.cjs").loadNativeSource(r.sourceNew.path, r.newAudit.path) : undefined;
  const options = context ? {
    editorVersion: context.editorVersion, candidateBinding: context.candidateBinding,
    oldEditorVersion: r.oldEditorVersion, oldVersion: r.oldEditorVersion === "1.9.24" ? "1.0.2" : "1.0.0",
    newVersion: context.options.expectedUpgradeFixture.version,
  } : {};
  if (context) assert(["1.9.16", "1.9.24"].includes(options.oldEditorVersion));
  const out = path.join(qa, `upgrade-audit-${process.argv[3] || "01"}`); fs.mkdirSync(out);
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
  const report = { status: "RUNNING", source: { path: file, sha256: sha(file) }, at: new Date().toISOString(), groups: [] };
  const group = (name, fn) => {
    const row = { name, status: "RUNNING" }; report.groups.push(row);
    try { row.detail = fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  try {
    group("scoped-terminal-and-rejected-false-completion", () => {
      validate(r, options);
      const mutations = [
        x => { x.status = "PASS"; }, x => { x.blocked = []; }, x => { x.checks.pop(); },
        x => { x.copiedOrSeededSaves = 1; }, x => { x.beforeUpgrade[0].sha256 = "0".repeat(64); },
        x => { x.launches[1].version = "1.0.0"; }, x => { x.actualLoads[0].actualText = "old text"; },
        x => { x.cleanups[0].method = "FORCED"; }, x => { x.profilesRestored = false; },
        x => { x.newPreference.muteSfx = false; }, x => { x.screenshots[0].png.width = 2400; },
      ];
      for (const mutation of mutations) { const copy = structuredClone(r); mutation(copy); assert.throws(() => validate(copy, options)); }
      return { rejectedVariants: mutations.length, upgradeManualAuto: "PASS", oldQuickCreation: "BLOCKED" };
    });
    group("real-old-new-build-and-install-chain", () => {
      for (const f of [r.sourceOld, r.sourceNew, r.newAudit, r.newPayload]) assert.equal(sha(f.path), f.sha256);
      const old = read(r.sourceOld.path), current = read(r.sourceNew.path);
      if (options.oldEditorVersion === "1.9.24") require("./lib/windows-current-native-source.cjs").validateRetained1924Source(old);
      else require("./lib/windows-package-current-evidence.cjs").validateBuildEvidence(old);
      if (!context) require("./installed-windows-native-ui-current-audit.cjs").validate(current);
      assert.equal(read(r.newAudit.path).source.sha256, sha(r.sourceNew.path));
      const before = read(path.join(run, "installation.json")), after = read(path.join(run, "installation-upgrade.json"));
      assert.equal(before.status, "PASS"); assert.equal(after.status, "PASS");
      assert.equal(after.client, before.client); assert.deepEqual(after.beforeRegistry, before.registry);
      assert.equal(after.method, "ACTUAL_SAME_DIRECTORY_NSIS_NO_UNINSTALL_NO_DATA_CLEAR");
      for (const [label, setup, version] of [["install", options.oldEditorVersion === "1.9.24"
        ? old.windowsInstaller : old.artifacts.find(f => f.kind === "windows_nsis_installer"), options.oldVersion || "1.0.0"],
        ["upgrade", current.windowsInstaller, options.newVersion || "1.0.1"]]) {
        assert.equal(sha(setup.path), setup.sha256);
        const receipt = read(path.join(run, label + "-process.json"));
        assert.equal(receipt.file, setup.path); assert.deepEqual(receipt.arguments, ["/S", "/D=" + after.client]);
        const registration = label === "install" ? before.registry : after.registry;
        assert(registration.some(k => k.exists && k.values.some(v => v.name === "DisplayVersion" && v.value === version)));
      }
      assert(Date.parse(before.finishedAt) < Date.parse(after.startedAt));
      assert(Date.parse(after.finishedAt) < Date.parse(read(path.join(run, "uninstallation.json")).startedAt));
      const payload = read(r.newPayload.path);
      assert.equal(after.executable.sha256, payload.executable.sha256);
      assert.equal(after.uninstaller.sha256, read(path.join(run, "uninstallation.json")).sourceUninstaller.sha256);
      for (const f of after.resources) {
        const name = path.relative(path.join(after.client, "embedded-cartridge"), f.path).replaceAll("\\", "/");
        assert(payload.resources.some(p => p.name === name && p.sha256 === f.sha256));
      }
      return { oldCollectorOriginalStatus: old.status, version: `${options.oldVersion || "1.0.0"} -> ${options.newVersion || "1.0.1"}`, resources: after.resources.length };
    });
    group("actual-old-save-bytes-preserved-and-loaded-new-story", () => {
      for (const folder of ["before-upgrade", "after-upgrade"])
        for (const f of r.beforeUpgrade) assert.equal(sha(path.join(run, folder, f.name)), f.sha256);
      const manual = read(path.join(run, "before-upgrade/slot-01.json")), auto = read(path.join(run, "before-upgrade/auto-01.json"));
      assert.equal(manual.command_index, 0); assert.equal(auto.command_index, 1);
      assert.equal(manual.game_id, r.gameId); assert.equal(auto.game_id, r.gameId);
      const final = path.join(run, "installed-client/saves", r.gameId, "preview_gamecli");
      for (const f of r.finalSaves) assert.equal(sha(path.join(final, f.name)), f.sha256);
      if (context) {
        const current = read(r.sourceNew.path);
        for (const l of r.actualLoads) assert(l.actualText.includes(
          current.upgradeFixture.project.nodes[1].data.scene.commands[l.nextIndex].text));
      }
      return { originallyCreated: ["manual", "auto"], actuallyLoaded: r.actualLoads, quickNotTested: true };
    });
    group("png-profiles-protected-files-and-cleanup", () => {
      for (const s of r.screenshots) {
        const b = fs.readFileSync(s.path);
        assert.equal(b.subarray(1, 4).toString(), "PNG");
        assert.equal(b.readUInt32BE(16), s.png.width); assert.equal(b.readUInt32BE(20), s.png.height);
      }
      const restoration = read(path.join(run, "profile-restoration.json")); assert.equal(restoration.status, "PASS");
      if (context) {
        const protection = read(path.join(run, "profile-protection.json"));
        assert.equal(restoration.deletedUserFiles, 0); assert.equal(restoration.records.length, 2);
        for (const p of restoration.records) {
          assert(p.qaRemoved);
          assert(ps(`fsutil.exe file queryfileid '${p.original}'`).toLowerCase().includes(p.directoryId));
          const before = protection.records.find(n => n.original === p.original); assert(before);
          assert(!fs.existsSync(before.held) && !fs.existsSync(before.retained));
          if (before.byteInventory) for (const f of before.files)
            assert.equal(sha(path.join(before.original, f.relative)), f.sha256);
        }
        const cleanup = read(path.join(run, "setup-cleanup.json"));
        assert.equal(cleanup.deletedUserFiles, 0); assert.equal(cleanup.registry.length, 8);
        for (const k of cleanup.registry) {
          assert.equal(k.exists, false);
          const key = `${k.hive === "CurrentUser" ? "HKCU" : "HKLM"}\\${k.key}`;
          assert.equal(ps(`& reg.exe query '${key}' /reg:${k.view === "Registry32" ? 32 : 64} 2>$null;` +
            `if($LASTEXITCODE -eq 0){throw 'QA registry remains'};[Console]::Write('ABSENT')`), "ABSENT");
        }
      }
      assert.equal(read(path.join(run, "setup-cleanup.json")).status, "PASS");
      for (const f of read(r.sourceNew.path).protectedFiles) assert.equal(sha(f.path), f.sha256);
      for (const c of r.cleanups) assert.deepEqual(read(c.request.completion), c.receipt);
      const live = rows();
      assert(!r.known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
      assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
      assert(!fs.existsSync(path.join(run, "installed-client/agentvn-player.exe")));
      assert(!fs.existsSync(path.join(run, "installed-client/uninstall.exe")));
      return { screenshots: r.screenshots.length, identities: r.known.length, profiles: restoration };
    });
    report.status = "PASS"; report.featureStatus = "PARTIAL_PASS_QUICK_CREATION_BLOCKED";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, groups: report.groups, error: report.error }, null, 2));
}
module.exports = { validate };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
