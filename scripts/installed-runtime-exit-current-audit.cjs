"use strict";
// Independent evidence audit; does not launch Player or mutate its ACLs.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { validate } = require("./installed-runtime-exit-current.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const attempt = process.argv[2] || "05", audit = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
const source = path.join(base, `exit-${attempt}`), out = path.join(base, `installed-exit-${attempt}-audit-${audit}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), groups: [],
  scope: "ACTUAL_NSIS_INSTALLED_PLAYER_LIBRARY_EXIT_NOT_ALT_F4_STANDALONE_ANDROID",
  productChanges: 0, modelRequests: 0, newPlayerStarts: 0 };
function group(name, fn) {
  const g = { name, status: "RUNNING" }; report.groups.push(g);
  try { g.detail = fn(); g.status = "PASS"; }
  catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
}
try {
  const sessionPath = path.join(source, "installed-session.json"), rawPath = path.join(source, "exit.json");
  const s = read(sessionPath), r = read(rawPath); validate(s, r);
  report.session = desc(sessionPath); report.raw = desc(rawPath);
  const journal = read(path.join(source, "profile-protection.json"));
  group("Exact installed provenance and rejection of incomplete or overstated evidence", () => {
    assert.equal(s.snapshots.length, 14);
    assert.equal(new Set(s.protectedFiles.map(f => path.resolve(f.path))).size, 17);
    for (const f of [s.installation, s.executable, s.originalExport, s.originalFixture, s.restoration,
      ...s.protectedFiles, ...s.cartridges, ...r.sources, ...r.acls]) assert.equal(sha(f.path), f.sha256, f.path);
    for (const f of s.snapshots) {
      assert.equal(sha(f.copy.path), f.copy.sha256); assert.equal(f.source.sha256, f.copy.sha256);
      if (/\.(cjs|ps1)$/.test(f.source.path)) assert.equal(sha(f.source.path), f.source.sha256);
    }
    const mutations = [
      a => { a[0].status = "RUNNING"; }, a => { a[0].version = "1.9.13"; },
      a => { a[0].executable.sha256 = "other"; }, a => { a[0].commands[5].status = "FAILED"; },
      a => { a[0].gitAfter.index = "modified"; }, a => { a[0].modelRequests = 1; },
      a => { a[1].cases = []; }, a => { a[1].checks = []; }, a => { a[1].matrix = []; },
      a => { a[1].matrix[1] = a[1].matrix[0]; }, a => { a[1].matrix[0].second.focusInside = false; },
      a => { a[1].matrix[0].failure.controls[0].hit = false; },
      a => { a[1].launches[0].executableSha256 = "other"; },
      a => { a[1].launches[0].identity.ExecutablePath = "D:\\AgentVN\\agentvn-player.exe"; },
      a => { a[1].launches[0].cleanup.method = "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE"; },
      a => { a[1].launches[0].cleanup.status = "RUNNING"; }, a => { a[1].screenshots.pop(); },
      a => { a[1].retained.pop(); }, a => { a[1].acls[0].data.isElevated = true; },
      a => { a[1].acls[1].data.comparison.daclBytesMatch = false; },
      a => { a[1].checks.find(c => c.name.startsWith("Restore exact")).detail.events = []; },
      a => { a[1].checks.find(c => c.case === "auto_off" && c.name.startsWith("Explicit")).detail.changed.push({}); },
      a => { a[1].checks.find(c => c.name.startsWith("Actual new")).detail.restored.command = 9; },
      a => { a[1].notRun = a[1].notRun.filter(n => n !==
        "Exit while autosave-disabled existing write demonstrably remains in flight"); },
    ];
    for (const mutate of mutations) { const a = structuredClone([s, r]); mutate(a); assert.throws(() => validate(...a)); }
    return { version: s.version, executable: s.executable, invalidEvidenceVariantsRejected: mutations.length,
      protectedDistinctPaths: new Set(s.protectedFiles.map(f => path.resolve(f.path))).size,
      snapshots: s.snapshots.length };
  });
  group("Eight complete real UI exits and new-process durable save recovery", () => {
    for (const c of r.cases) {
      const checks = r.checks.filter(t => t.layout === c.layout && t.case === c.kind),
        exit = checks.at(-2).detail, restart = checks.at(-1).detail;
      assert.equal(exit.exitCode, 0); assert.equal(exit.signalCode, null);
      assert.equal(restart.restored.command, ["retry", "auto_on"].includes(c.kind) ? 1 : 0);
      if (c.kind === "retry") assert(exit.restored.probe.allowed && exit.restored.comparison.permissionsMatch);
      if (c.kind === "discard") assert(exit.restored.probe.allowed && exit.restored.comparison.permissionsMatch);
    }
    return { cases: r.cases.length, businessChecks: r.checks.length, modalDisplays: r.matrix.length,
      starts: r.launches.length, realMenuNativeExits: 8, attributedRestartsCleanup: 8,
      scope: "Real menu-confirmed native destruction, not physical window-close/Alt+F4 or Android back" };
  });
  group("Ordinary-token real ACL denial and exact restored permissions for four isolated save leaves", () => {
    const deny = r.acls.filter(a => a.action === "Block"), restored = r.acls.filter(a => a.action === "Restore");
    assert.equal(deny.length, 4); assert.equal(restored.length, 4);
    for (const a of r.acls) assert.deepEqual(read(a.path), a.data);
    for (const a of deny) {
      assert.equal(a.data.probe.hresult, -2147024891);
      const recovery = restored.find(b => b.data.target === a.data.target); assert(recovery);
      assert(recovery.data.comparison.daclBytesMatch && recovery.data.comparison.ownerGroupMatch
        && recovery.data.comparison.allOtherFlagsMatch && recovery.data.probe.allowed);
      const journalFile = a.path.replace(/\.block\.json$/, "");
      assert.equal(read(journalFile).status, "JOURNALED"); assert.equal(read(journalFile).target, a.data.target);
      const target = path.resolve(a.data.target);
      assert.equal(path.dirname(target), "C:\\Users\\1\\AppData\\Roaming\\com.agentvn.player\\saves");
      assert(path.basename(target).startsWith(`qa_native_exit_20261020_${attempt}_`));
    }
    return { deniedLeaves: deny.length, permissionRestorations: restored.length,
      isElevated: false, noFallbackConfirmed: true, userSaveAclTouched: false };
  });
  group("Archived native bytes preserve manual saves and only create intended atomic snapshots", () => {
    const archive = journal.records.find(j => j.storage === "NativeRoaming").target;
    for (const f of r.retained) {
      assert.equal(sha(f.retained), f.sha256); assert.equal(fs.statSync(f.retained).size, f.bytes);
      assert.equal(sha(path.join(archive, "saves", f.installId, f.name)), f.sha256);
      assert.equal(read(f.retained).install_id, f.installId);
    }
    let automatic = 0;
    for (const c of r.cases) {
      const detail = r.checks.filter(t => t.layout === c.layout && t.case === c.kind).at(-2).detail;
      for (const f of detail.after) assert.equal(sha(path.join(archive, "saves", c.installId, f.name)), f.sha256);
      for (const f of detail.changed) {
        const data = read(path.join(archive, "saves", c.installId, f.name));
        assert.equal(data.save_kind, "auto"); assert.equal(data.command_index, 1); automatic++;
      }
      assert(!fs.readdirSync(path.join(archive, "saves", c.installId)).some(n => n.endsWith(".tmp")));
    }
    assert.equal(automatic, 4);
    return { retained: r.retained.length, manualPreserved: 8, newAutomatic: automatic, tmpRemaining: 0,
      portableExeSaveLocationClaimed: false };
  });
  group("Modal PNG parameters and physical pixels match the actual sampled WebView", () => {
    for (const shot of r.screenshots) {
      assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
      const b = fs.readFileSync(shot.path), v = shot.before;
      assert.equal(b.readUInt32BE(16), Math.round(v.width * v.dpr));
      assert.equal(b.readUInt32BE(20), Math.round(v.height * v.dpr));
      assert([1920, 2560, 3840].includes(v.width));
      assert(Math.min(Math.abs(v.dpr - 1), Math.abs(v.dpr - 2)) <= 1e-6);
      const m = r.matrix.find(m => path.basename(shot.path) ===
        `${m.layout}-retry-discard-${m.width}-${m.dpr}-${m.reduced}.png`);
      if (m) {
        assert.equal(v.width, m.width); assert.equal(v.height, m.height);
        assert(Math.abs(v.dpr - m.dpr) <= 1e-6); assert.equal(v.reduced, m.reduced);
      }
    }
    for (const m of r.matrix) assert.equal(r.screenshots.filter(s => path.basename(s.path) ===
      `${m.layout}-retry-discard-${m.width}-${m.dpr}-${m.reduced}.png`).length, 1);
    return { screenshots: r.screenshots.length, fullMotionClaimed: false, physical4kClaimed: false };
  });
  group("User directory identities/bytes restored and recorded Player roots, ports and WebViews absent", () => {
    const restored = read(s.restoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const old of journal.records) {
      const actual = restored.restored.find(j => j.original === old.original); assert(actual);
      assert.equal(actual.directoryId, old.directoryId); assert.deepEqual(actual.files, old.files);
      assert(!fs.existsSync(old.held)); if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      for (const f of old.files) assert.equal(sha(path.join(old.original, f.relative)), f.sha256);
      if (old.existed) {
        const p = spawnSync("fsutil.exe", ["file", "queryfileid", old.original],
          { encoding: "utf8", windowsHide: true });
        assert.equal(p.status, 0); assert(p.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
      }
    }
    const active = rows(), ports = r.launches.map(l => l.port);
    for (const l of r.launches) {
      const created = Number(l.identity.CreationDate.match(/\d+/)[0]);
      assert(!active.some(p => p.ProcessId === l.identity.ProcessId && Date.parse(p.Created) === created));
    }
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
    assert.deepEqual(listeners(ports), []);
    assert.equal(sha(path.resolve(__dirname, "../.git/index")), s.gitBefore.index);
    const currentHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(__dirname, ".."),
      encoding: "utf8", windowsHide: true });
    assert.equal(currentHead.status, 0); assert.equal(currentHead.stdout.trim(), s.gitBefore.head);
    return { recordedRootsAbsent: r.launches.length, portsAbsent: new Set(ports).size,
      originalDirectoriesRestored: true, userFilesDeleted: 0, gitHeadAndIndexUnchanged: true,
      descendantsNotIndividuallyRecorded: true };
  });
  const availabilityFile = path.join(source, "computer-use-availability.json"), availability = read(availabilityFile);
  assert.equal(availability.status, "BLOCKED"); assert.equal(availability.inputSent, false);
  assert(availability.error.includes("native pipe") && availability.error.includes("os error 2"));
  report.computerUse = { ...desc(availabilityFile), observation: availability };
  report.remaining = {
    physicalWindowClose: "BLOCKED_NATIVE_INPUT_TOOL", android: "NOT_RUN",
    autosaveOffExistingInflightWrite: "NOT_RUN", standaloneSavesSetupAndUpgrade: "NOT_RUN",
    completeMotion: "NOT_RUN", fullRegression: "NOT_COMPLETE",
  };
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out,
    groups: report.groups.map(g => ({ name: g.name, status: g.status })), error: report.error }, null, 2));
}
