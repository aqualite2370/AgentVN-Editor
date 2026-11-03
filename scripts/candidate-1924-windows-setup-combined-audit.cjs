"use strict";
// Read-only audit of four completed save flows plus a separate native-close supplement.
// The failed full run stays FAILED. No synthetic report is written as business evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validate } = require("./candidate-1924-windows-native-audit.cjs");
const base = "F:/AgentVN/QA/Windows-Package-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function validatePair(save, close) {
  assert.equal(save.status, "FAILED");
  assert(save.error.includes("Timeout Computer Use native Player close receipt"));
  assert.equal(save.scope, "ACTUAL_GENERATED_WINDOWS_NSIS_INSTALL_SHORTCUT_RUNTIME_UNINSTALL");
  assert.equal(save.checks.length, 4);
  assert.deepEqual(save.checks[2].result.loaded, [
    { kind: "auto", slot: 1, command: 1 }, { kind: "quick", slot: 6, command: 1 },
    { kind: "manual", slot: 1, command: 0 },
  ]);
  assert.equal(save.checks[3].result.loadedKind, "auto");
  assert.equal(close.status, "PASS");
  assert.equal(close.scope, "ACTUAL_NSIS_NATIVE_CLOSE_AND_UNINSTALL_SUPPLEMENT_NOT_SAVE_MATRIX");
  assert.equal(close.checks.length, 3); assert(close.nativePhysicalClose);
  assert.equal(close.nativeCloseReceipt.method, "SKY_NATIVE_ALT_F4_AND_EXIT_CONFIRMATION");
  assert(close.nativeCloseReceipt.interaction.includes("Computer Use"));
  assert.equal(close.nativeCloseReceipt.pid, close.launches[0].pid);
  assert.equal(close.nativeCloseReceipt.created, close.launches[0].created);
  assert.equal(close.launches.length, 1); assert.equal(close.cleanups.length, 1);
  assert.equal(close.cleanups[0].method, "NATIVE_CONFIRMED_WINDOW_CLOSE");
  assert.deepEqual(close.cleanups[0].remaining, []);
  assert.equal(save.launches.length, 2); assert.equal(save.screenshots.length, 6);
  assert.equal(close.screenshots.length, 1);
  assert.deepEqual(save.finalSaves.map(f => f.name), ["auto-01.json", "quick-06.json", "slot-01.json"]);
  assert.deepEqual(save.finalLegacy.map(f => f.name), ["auto-01.json", "quick-06.json"]);
  for (const r of [save, close]) {
    assert.equal(r.editorVersion, "1.9.24");
    assert.equal(r.gameId, "qa_windows_pkg_20261021_01"); assert.equal(r.nativeUIBuildSource, true);
    assert(r.finishedAt && !r.cleanupError && r.uninstalled && r.setupCleanup && r.profilesRestored);
    assert.deepEqual(r.errors, []);
    for (const key of ["builds", "productChanges", "modelRequests"]) assert.equal(r[key], 0);
    assert(r.checks.every(c => c.status === "PASS" && c.finishedAt));
    assert.equal(r.checks[0].result.installationMethod, "ACTUAL_NSIS_SILENT_WITH_DEFAULT_SHORTCUTS_NO_UPDATE_OR_NS");
    assert.equal(r.checks[0].result.isElevated, false);
    assert(r.checks[0].result.shortcuts.every(s => s.exists && !s.arguments
      && s.target === r.checks[0].result.executable.path));
    assert.equal(r.checks[0].result.resources.length, 6);
    assert(r.checks[0].result.registry.some(k => k.exists && k.hive === "CurrentUser"
      && k.values.some(v => v.name === "DisplayVersion" && v.value === "1.0.2")));
    assert(!r.checks[0].result.registry.some(k => k.exists && k.hive === "LocalMachine"));
    assert.equal(r.checks[0].result.process.exitCode, 0);
    for (const s of r.screenshots) {
      assert.deepEqual(s.before, s.after);
      assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
      assert(Math.abs(s.before.dpr - 1) < 1e-6); assert.equal(s.before.reduced, false);
      assert.deepEqual(s.png, { width: 1920, height: 1080 });
    }
  }
  assert.equal(save.source.sha256, close.source.sha256);
  assert.equal(save.sourceAudit.sha256, close.sourceAudit.sha256);
  assert.equal(save.payload.sha256, close.payload.sha256);
  const uninstall = close.checks[2].result;
  assert.equal(uninstall.result.status, "PASS");
  assert.equal(uninstall.result.method, "ACTUAL_INSTALLED_UNINSTALL_EXE_S");
  assert.equal(uninstall.result.process.exitCode, 0);
  assert.deepEqual(uninstall.retainedSaves, close.finalSaves);
  assert.deepEqual(uninstall.retainedLegacy, close.finalLegacy);
}
function negativeTests(save, close) {
  const changes = [
    (s, c) => s.status = "PASS", (s, c) => s.error = "unrelated error",
    (s, c) => s.checks.pop(), (s, c) => s.checks[2].result.loaded.pop(),
    (s, c) => s.profilesRestored = false, (s, c) => c.status = "FAILED",
    (s, c) => c.nativePhysicalClose = false, (s, c) => c.nativeCloseReceipt.pid++,
    (s, c) => c.nativeCloseReceipt.method = "FORCED",
    (s, c) => c.cleanups[0].method = "ATTRIBUTED_TERMINATION_NOT_PHYSICAL_CLOSE",
    (s, c) => c.source.sha256 = "0".repeat(64), (s, c) => c.payload.sha256 = "0".repeat(64),
    (s, c) => c.checks[0].result.isElevated = true,
    (s, c) => c.checks[0].result.registry = [],
    (s, c) => c.screenshots[0].before.dpr = 2,
    (s, c) => c.checks[2].result.result.process.exitCode = 1,
  ];
  for (const change of changes) {
    const s = structuredClone(save), c = structuredClone(close); change(s, c);
    assert.throws(() => validatePair(s, c));
  }
  return changes.length;
}
async function main() {
  const saveFile = path.join(base, "runtime-18/report.json"), closeFile = path.join(base, "runtime-19/report.json");
  const save = read(saveFile), close = read(closeFile);
  validatePair(save, close);
  const rejected = negativeTests(save, close);
  if (process.argv[2] === "--self-test") {
    console.log(JSON.stringify({ status: "PASS", rejectedEvidenceVariants: rejected, productLaunches: 0 })); return;
  }
  assert.equal(process.argv[2], "01");
  const out = path.join(base, "setup-combined-audit-01"); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
    scope: "COMPLEMENTARY_SETUP_EVIDENCE_NOT_REWRITING_FAILED_RUNTIME18",
    sources: [saveFile, closeFile].map(file => ({ path: file, sha256: sha(file) })),
    originalFullRunStatus: save.status, modelRequests: 0, productChanges: 0 };
  const group = (name, fn) => {
    const row = { name, status: "RUNNING" }; report.groups.push(row);
    try { row.detail = fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  try {
    group("scope-and-negative-evidence", () => ({ rejected, actualLoaded: ["manual", "auto", "quick"],
      naturalNativeClose: true, originalRuntime18: "FAILED_TOOL_TIMEOUT_PRESERVED",
      notRun: ["Coverage upgrade", "Clean machine/default install path", "Ren'Py", "Android"] }));
    group("frozen-source-and-installation-payload", () => {
      const build = read(save.source.path); validate(build);
      const payload = read(save.payload.path);
      assert.equal(payload.status, "PASS"); assert.equal(payload.source.sha256, sha(save.source.path));
      for (const r of [save, close]) {
        for (const f of [r.source, r.prior, r.sourceAudit, r.payload, ...r.references, ...build.protectedFiles])
          assert.equal(sha(f.path), f.sha256, f.path);
        const run = path.dirname(r.source === save.source ? saveFile : closeFile);
        const install = read(path.join(run, "installation.json"));
        assert.deepEqual(install, r.checks[0].result);
        assert.equal(install.executable.sha256, payload.executable.sha256);
        assert.equal(sha(install.installer.path), install.installer.sha256);
        assert(!fs.existsSync(install.executable.path) && !fs.existsSync(install.uninstaller.path));
        const args = read(path.join(run, "install-process.json"));
        assert.deepEqual(args.arguments, ["/S", "/D=" + install.client]);
        assert.equal(args.file, install.installer.path);
        const uninstall = read(path.join(run, "uninstallation.json"));
        assert.equal(uninstall.status, "PASS");
        assert.equal(uninstall.sourceUninstaller.sha256, install.uninstaller.sha256);
        assert.deepEqual(read(path.join(run, "uninstall-process.json")).arguments, ["/S"]);
        for (const resource of install.resources) {
          assert(payload.resources.some(p => p.sha256 === resource.sha256 && p.bytes === resource.bytes));
          assert(!fs.existsSync(resource.path));
        }
        for (const link of install.shortcuts) assert(!fs.existsSync(link.path));
      }
      return { editorVersion: "1.9.24", gameVersion: "1.0.2", installedCopies: 2, normalUninstalls: 2 };
    });
    group("real-save-bytes-and-capture-parameters", () => {
      for (const [r, run] of [[save, path.dirname(saveFile)], [close, path.dirname(closeFile)]]) {
        for (const s of r.screenshots) {
          const b = fs.readFileSync(s.path); assert.equal(sha(s.path), s.sha256);
          assert.equal(b.subarray(1, 4).toString(), "PNG");
          assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
        }
        for (const f of r.finalSaves)
          assert.equal(sha(path.join(r.launches[0].storage.targetDirectory, f.name)), f.sha256);
        for (const f of r.finalLegacy)
          assert.equal(sha(path.join(run, "profile-roaming/saves/preview_gamecli", f.name)), f.sha256);
      }
      assert.deepEqual(read(close.nativeCloseReceipt.path), {
        method: close.nativeCloseReceipt.method, pid: close.nativeCloseReceipt.pid,
        created: close.nativeCloseReceipt.created, interaction: close.nativeCloseReceipt.interaction,
      });
      assert.equal(sha(close.nativeCloseReceipt.path), close.nativeCloseReceipt.sha256);
      return { screenshots: 7, saveFlows: 4, nativeCloseFlows: 1 };
    });
    group("profiles-registration-and-owned-process-cleanup", () => {
      const live = rows();
      for (const [r, run] of [[save, path.dirname(saveFile)], [close, path.dirname(closeFile)]]) {
        const protection = read(path.join(run, "profile-protection.json"));
        const restoration = read(path.join(run, "profile-restoration.json"));
        assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
        for (const p of restoration.records) {
          assert(p.qaRemoved);
          assert(ps(`fsutil.exe file queryfileid '${p.original}'`).toLowerCase().includes(p.directoryId));
          const prior = protection.records.find(n => n.original === p.original); assert(prior);
          assert(!fs.existsSync(prior.held) && !fs.existsSync(prior.retained));
          if (prior.byteInventory) for (const f of prior.files)
            assert.equal(sha(path.join(prior.original, f.relative)), f.sha256);
        }
        const cleanup = read(path.join(run, "setup-cleanup.json"));
        assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.deletedUserFiles, 0);
        assert.equal(cleanup.registry.length, 8); assert(cleanup.registry.every(k => !k.exists));
        assert(!r.known.some(p => live.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
        assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
      }
      for (const row of read(path.join(path.dirname(closeFile), "setup-cleanup.json")).registry) {
        const key = `${row.hive === "CurrentUser" ? "HKCU" : "HKLM"}\\${row.key}`;
        assert.equal(ps(`& reg.exe query '${key}' /reg:${row.view === "Registry32" ? 32 : 64} 2>$null;` +
          `if($LASTEXITCODE -eq 0){throw 'QA registration remains'};[Console]::Write('ABSENT')`), "ABSENT");
      }
      return { originalDirectoriesRestored: true, userFilesDeleted: 0,
        identities: save.known.length + close.known.length, ports: [...save.launches, ...close.launches].map(l => l.port) };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
