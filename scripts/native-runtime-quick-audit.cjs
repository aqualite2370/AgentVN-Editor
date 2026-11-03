"use strict";
// Read-only evidence verification for the current native Player, not installs.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const { validatePendingObservation } = require("./installed-runtime-quick-observation.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function validateQuickReport(r, count, options = {}) {
  const current1922 = options.current1922 === true;
  assert.equal(r.status, "PASS"); assert.equal(r.error, null); assert.equal(r.cleanupError, null);
  assert.equal(r.expectedCells, count); assert.equal(r.cells.length, count);
  assert.deepEqual(r.pageErrors, []); assert.equal(r.productChanges, 0);
  assert.equal(r.newBuilds, 0); assert.equal(r.modelRequests, 0); assert.equal(r.mockDelay, false);
  assert.equal(r.scope, current1922
    ? "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_QUICK_EXCEPTIONS_NOT_STANDALONE_ANDROID_OR_NATIVE_PICKER"
    : "CURRENT_NATIVE_PLAYER_LIBRARY_NOT_RELEASE_INSTALL_STANDALONE_ANDROID_OR_NATIVE_PICKER");
  const expected = (count === 1 ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]])
    .flatMap(([width, height]) => (count === 1 ? [1] : [1, 2])
      .flatMap(dpr => (count === 1 ? [false] : [false, true]).map(reduced => ({ width, height, dpr, reduced }))));
  assert.deepEqual(r.cells.map(c => c.viewport), expected);
  assert.equal(new Set(r.cells.map(c => c.installId)).size, count);
  assert.equal(r.launches.length, count * 2); assert.equal(r.locks.length, count);
  assert.equal(r.faults.length, count); assert.equal(r.screenshots.length, count * 3);
  assert.equal(r.nativeSaves.length, count * 12);
  for (const c of r.cells) {
    assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 3);
    assert(c.checks.every(t => t.status === "PASS"));
    const [pending, denied, semantic] = c.checks.map(t => t.detail);
    validatePendingObservation(pending.observed); assert.equal(pending.changed.length, 1);
    assert.equal(pending.after.filter(s => !pending.before.some(b => b.save_id === s.save_id)).length, 1);
    assert(!pending.after.some(s => s.save_id === pending.nextAcceptedAfterCompletion.save_id));
    assert.equal(denied.method, "REAL_WINDOWS_SHARING_DENIAL_NOT_ACL");
    assert(denied.failure.includes("快存失败") && denied.failure.includes("不会回退"));
    assert.equal(denied.before.length, 6); assert.equal(denied.after.length, 6);
    assert.equal(denied.after.filter(a => denied.before.find(b => b.name === a.name)?.sha256 !== a.sha256).length, 1);
    assert.equal(new Set([semantic.oldest.command_index, semantic.latestValid.command_index,
      semantic.invalidLatest.command_index]).size, 3);
    assert.equal(semantic.oldest.command_index, 0); assert.equal(semantic.latestValid.command_index, 1);
    assert.equal(semantic.invalidLatest.command_index, 2);
    assert(Date.parse(semantic.oldest.created_at) < Date.parse(semantic.latestValid.created_at)
      && Date.parse(semantic.latestValid.created_at) < Date.parse(semantic.invalidLatest.created_at));
    assert.equal(semantic.restored.command, semantic.latestValid.command_index);
    assert.equal(semantic.restored.scene, semantic.latestValid.scene_id);
    assert(semantic.restored.text.includes("MID_ADAPT"));
    assert.equal(semantic.listed.length, 6);
    assert(semantic.listed.some(s => s.save_id === semantic.invalidLatest.save_id
      && s.scene_id === "__qa_missing_scene_current_native__"));
    assert.equal(semantic.cancellationUnchanged, true); assert.equal(semantic.actualRestart, true);
    assert.equal(semantic.publicLibraryReseedOnRestart, true);
    assert.equal(c.seed.length, 6); assert.equal(c.finalNativeSaves.length, 6);
  }
  for (const l of r.launches) {
    assert.equal(l.scope, current1922 ? "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_NOT_STANDALONE_ANDROID"
      : "CURRENT_NATIVE_NOT_RELEASE_INSTALL");
    if (current1922) {
      assert.equal(l.executableSha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
      assert.equal(l.libraryStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
    }
    assert.equal(l.cleanup.status, "PASS");
    assert.equal(l.cleanup.method, "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");
  }
  assert(r.locks.every(l => l.exitCode === 0 && l.cleanup === "PASS"));
  assert(r.faults.every(f => f.restoration === "PASS"));
}
function main() {
  const out = path.join(base, "quick-audit-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
    scope: "CURRENT_NATIVE_QUICK_EXCEPTIONS_EVIDENCE_ONLY", fullAcceptance: false };
  const check = (name, fn) => {
    const c = { name, status: "RUNNING" }; report.checks.push(c);
    try { c.detail = fn(); c.status = "PASS"; }
    catch (error) { c.status = "FAILED"; c.error = String(error.stack || error); throw error; }
  };
  try {
    const runs = ["quick-01", "quick-02"].map((name, i) => {
      const dir = path.join(base, name), raw = read(path.join(dir, "player-01.json"));
      validateQuickReport(raw, i === 0 ? 1 : 12);
      return { name, dir, raw, session: read(path.join(dir, "session.json")),
        journal: read(path.join(dir, "profile-protection.json")) };
    });
    check("Current product, exact QA snapshots and all inputs match recorded identities", () => {
      for (const r of runs) {
        assert.equal(r.session.status, r.name === "quick-01" ? "CURRENT_NATIVE_QUICK_SMOKE_PASS"
          : "CURRENT_NATIVE_QUICK_EXCEPTIONS_PASS");
        assert.equal(r.session.commands.length, 3);
        assert(r.session.commands.every(c => c.status === "PASS" && c.exitCode === 0));
        for (const item of [...r.session.products, ...r.session.tools, r.session.originalExport,
          r.session.originalFixture, r.session.profileRestoration, ...r.raw.sources])
          assert.equal(sha(item.path), item.sha256, item.path);
        assert.equal(sha(r.raw.runner.path), r.raw.runner.sha256);
        assert(r.raw.launches.every(l => l.executableSha256 === r.session.products[2].sha256));
      }
      return { sessions: runs.map(r => describe(path.join(r.dir, "session.json"))),
        product: runs[1].session.products[2], productChanges: 0, newBuilds: 0 };
    });
    check("12 complete display workflows: actual pending input, denied write/retry and distinct latest-valid state", () => {
      const r = runs[1].raw, timings = r.cells.map(c => c.checks[0].detail.timing.pendingMs);
      return { combinations: r.cells.length, checks: r.cells.flatMap(c => c.checks).length,
        smokeChecksSeparately: runs[0].raw.cells[0].checks.length,
        realPlayerStarts: r.launches.length, sharingLocks: r.locks.length, restoredFaults: r.faults.length,
        pendingMs: { min: Math.min(...timings), max: Math.max(...timings) },
        notACLOrNormalExitAcceptance: true };
    });
    check("All screenshot bytes and actual viewport/DPR/media are consistent with each display case", () => {
      for (const r of runs) for (const s of r.raw.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        const c = r.raw.cells.find(c => path.basename(s.path).startsWith(`renpy-${c.name}-`)); assert(c);
        assert.equal(s.before.width, c.viewport.width); assert.equal(s.before.height, c.viewport.height);
        assert.equal(s.before.reduced, c.viewport.reduced);
        assert(Math.abs(s.before.dpr - c.viewport.dpr) <= 1e-6);
        const bytes = fs.readFileSync(s.path);
        assert.equal(bytes.readUInt32BE(16), c.viewport.width * c.viewport.dpr);
        assert.equal(bytes.readUInt32BE(20), c.viewport.height * c.viewport.dpr);
      }
      return { mainImages: runs[1].raw.screenshots.length, smokeImages: runs[0].raw.screenshots.length,
        physicalDisplayClaim: false };
    });
    check("Retained saves and deliberately corrupted files are restored to exact original bytes", () => {
      for (const r of runs) {
        const archive = r.journal.records.find(j => /\\Roaming\\/.test(j.original)).target;
        for (const item of r.raw.nativeSaves) {
          assert.equal(sha(item.retained), item.sha256); assert.equal(fs.statSync(item.retained).size, item.bytes);
          assert.deepEqual(read(item.retained), item.data);
        }
        for (const c of r.raw.cells) for (const item of c.finalNativeSaves) {
          const target = path.join(archive, "saves", c.installId, item.name);
          assert.equal(sha(target), item.sha256);
          assert.equal(read(target).install_id, c.installId);
        }
        for (const f of r.raw.faults) {
          assert.equal(sha(f.retained), f.originalSha256);
          const relative = path.relative(r.journal.records[0].original, f.file);
          assert(!relative.startsWith("..") && !path.isAbsolute(relative));
          assert.equal(sha(path.join(archive, relative)), f.originalSha256);
          const injected = { ...read(f.retained), scene_id: "__qa_missing_scene_current_native__" };
          assert.equal(crypto.createHash("sha256").update(JSON.stringify(injected)).digest("hex"), f.injectedSha256);
        }
      }
      return { mainSaveCopies: runs[1].raw.nativeSaves.length, smokeSaveCopies: runs[0].raw.nativeSaves.length,
        mainFinalSlots: 72, smokeFinalSlots: 6 };
    });
    check("Protected user directories restored and known Player/lock identities/ports absent", () => {
      for (const r of runs) {
        const restored = read(path.join(r.dir, "profile-restoration.json"));
        assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
        for (const j of r.journal.records) {
          assert(!fs.existsSync(j.held)); if (j.storage === "NativeRoaming") assert(!fs.existsSync(j.retained));
          const item = restored.restored.find(i => i.original === j.original); assert(item);
          assert.equal(item.directoryId, j.directoryId); assert.deepEqual(item.files, j.files);
          for (const f of j.files) assert.equal(sha(path.join(j.original, f.relative)), f.sha256);
        }
      }
      const identities = runs.flatMap(r => [...r.raw.launches, ...r.raw.locks].map(l => l.identity));
      const ports = [...new Set(runs.flatMap(r => r.raw.launches.map(l => l.port)))];
      const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command",
        "$all=@(Get-CimInstance Win32_Process);" +
        "$p=@($all|Select-Object ProcessId,@{n='CreatedMs';e={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}});" +
        "$w=@($all|Where-Object {$_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*Native-Runtime-State-20261020-01*'}|Select-Object ProcessId);" +
        `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
        "@{processes=$p;webviews=$w;listeners=$l}|ConvertTo-Json -Depth 4 -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 20000 });
      assert.equal(ps.status, 0, ps.stderr); const current = JSON.parse(ps.stdout.replace(/^\uFEFF/, ""));
      for (const id of identities)
        assert(!current.processes.some(p => p.ProcessId === id.ProcessId
          && p.CreatedMs === Number(id.CreationDate.match(/\d+/)[0])));
      assert.deepEqual(current.webviews, []); assert.deepEqual(current.listeners, []);
      return { identitiesChecked: identities.length, cdpPorts: ports, originalProfilesRestored: 4,
        descendantsNotIndividuallyRecorded: true };
    });
    const frozen = read("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-12/audit.json");
    for (const item of frozen.artifactChecks) assert.equal(sha(item.path), item.sha256);
    assert.deepEqual(frozen.historical.counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
    report.frozenInstallationCounts = frozen.historical.counts;
    report.status = "EVIDENCE_VERIFIED_CURRENT_NATIVE_QUICK_EXCEPTIONS_PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.source = describe(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks.map(c => ({ name: c.name,
      status: c.status })), error: report.error, out }, null, 2));
  }
}
module.exports = { validateQuickReport };
if (require.main === module) main();
