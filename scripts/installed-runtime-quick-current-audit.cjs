"use strict";
// Read-only current installed quick-save evidence audit. No process launch,
// model, product mutation or acceptance re-execution.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { validate } = require("./installed-runtime-quick-current.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validatePendingObservation } = require("./installed-runtime-quick-observation.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const attempt = process.argv[2] || "03", audit = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
const source = path.join(base, `quick-${attempt}`), out = path.join(base, `installed-quick-${attempt}-audit-${audit}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), groups: [],
  scope: "ACTUAL_NSIS_INSTALLED_LIBRARY_QUICK_EVIDENCE_NOT_STANDALONE_OR_ANDROID",
  productChanges: 0, modelRequests: 0, newPlayerStarts: 0 };
function group(name, fn) {
  const g = { name, status: "RUNNING" }; report.groups.push(g); g.detail = fn(); g.status = "PASS";
}
try {
  const sessionPath = path.join(source, "installed-session.json"), rawPath = path.join(source, "player-01.json");
  const s = read(sessionPath), r = read(rawPath); validate(s, r);
  report.session = desc(sessionPath); report.raw = desc(rawPath);
  const journal = read(path.join(source, "profile-protection.json"));
  group("Complete installed provenance and rejection of incomplete or overstated evidence", () => {
    for (const file of [s.installation, s.executable, s.originalExport, s.originalFixture, s.restoration,
      ...s.protectedFiles, ...s.cartridges, ...r.sources]) assert.equal(sha(file.path), file.sha256, file.path);
    for (const snapshot of s.snapshots) {
      assert.equal(sha(snapshot.copy.path), snapshot.copy.sha256);
      assert.equal(snapshot.source.sha256, snapshot.copy.sha256);
      if (/\.(cjs|ps1)$/.test(snapshot.source.path)) assert.equal(sha(snapshot.source.path), snapshot.source.sha256);
    }
    assert.equal(sha(r.runner.path), r.runner.sha256);
    const mutations = [
      a => { a[0].status = "RUNNING"; }, a => { a[0].version = "1.9.13"; },
      a => { a[0].commands[1].status = "FAILED"; }, a => { a[0].executable.sha256 = "other"; },
      a => { a[0].modelRequests = 1; }, a => { a[0].productChanges = 1; },
      a => { a[0].builds = 1; }, a => { a[0].gitAfter.index = "modified"; },
      a => { a[1].cells = []; }, a => { a[1].cells[1].viewport = a[1].cells[0].viewport; },
      a => { a[1].cells[0].checks.pop(); }, a => { a[1].nativeSaves.pop(); },
      a => { a[1].launches[0].executableSha256 = "other"; },
      a => { a[1].launches[0].identity.ExecutablePath = "D:\\AgentVN\\agentvn-player.exe"; },
      a => { a[1].launches[0].cleanup.status = "RUNNING"; },
      a => { a[1].locks[0].cleanup = "RUNNING"; }, a => { a[1].faults[0].restoration = "RUNNING"; },
      a => { a[1].mockDelay = true; },
      a => { a[1].cells[0].checks[0].detail.observed.pointers.filter(p => p.type === "pointerdown")[1].busy = false; },
      a => { a[1].cells[0].checks[1].detail.method = "ACL"; },
      a => { a[1].cells[0].checks[2].detail.restored.command = 0; },
      a => { a[1].cells[0].checks[2].detail.cancellationUnchanged = false; },
    ];
    for (const mutate of mutations) { const a = structuredClone([s, r]); mutate(a); assert.throws(() => validate(...a)); }
    return { version: s.version, executable: s.executable, matrix: r.cells.length,
      invalidEvidenceVariantsRejected: mutations.length,
      protectedDistinctPaths: new Set(s.protectedFiles.map(f => path.resolve(f.path))).size,
      gitHead: s.gitAfter.head, indexUnchanged: s.gitAfter.index === s.gitBefore.index };
  });
  group("Each of twelve combinations executes pending, real denied write/retry and distinct fallback", () => {
    const timings = [];
    for (const cell of r.cells) {
      const [pending, denied, fallback] = cell.checks.map(c => c.detail);
      timings.push(validatePendingObservation(pending.observed).pendingMs);
      assert.equal(pending.changed.length, 1);
      assert(denied.failure.includes("快存失败") && denied.failure.includes("不会回退"));
      assert(denied.failure.includes(path.dirname(denied.target)));
      assert.equal(denied.after.filter(a => denied.before.find(b => b.name === a.name)?.sha256 !== a.sha256).length, 1);
      const snapshots = [fallback.oldest, fallback.latestValid, fallback.invalidLatest];
      assert.deepEqual(snapshots.map(s => s.command_index), [0, 1, 2]);
      assert.equal(fallback.restored.command, 1); assert(fallback.restored.text.includes("MID_ADAPT"));
      assert(fallback.cancellationUnchanged && fallback.actualRestart && fallback.publicLibraryReseedOnRestart);
    }
    return { combinations: 12, businessChecks: 36, PlayerStarts: 24, locks: 12, restoredFaults: 12,
      pendingMs: { min: Math.min(...timings), max: Math.max(...timings) },
      scope: "Renpy quick actions; cross-layout access separately proven, real sharing lock is not ACL" };
  });
  group("All screenshot bytes agree with actual viewport/DPR/media before and after capture", () => {
    for (const s of r.screenshots) {
      const cell = r.cells.find(c => path.basename(s.path).startsWith(`renpy-${c.name}-`)); assert(cell);
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const v = cell.viewport, b = fs.readFileSync(s.path);
      assert.equal(s.before.width, v.width); assert.equal(s.before.height, v.height);
      assert.equal(s.before.reduced, v.reduced); assert(Math.abs(s.before.dpr - v.dpr) <= 1e-6);
      assert.equal(b.readUInt32BE(16), v.width * v.dpr); assert.equal(b.readUInt32BE(20), v.height * v.dpr);
      assert.equal(s.png.width, b.readUInt32BE(16)); assert.equal(s.png.height, b.readUInt32BE(20));
    }
    return { screenshots: r.screenshots.length, physical4kClaimed: false };
  });
  group("Real save bytes, identity and semantic-fault rollback preserved", () => {
    const archive = journal.records.find(j => /\\Roaming\\/.test(j.original)).target;
    for (const item of r.nativeSaves) {
      assert.equal(sha(item.retained), item.sha256); assert.equal(fs.statSync(item.retained).size, item.bytes);
      assert.deepEqual(read(item.retained), item.data);
    }
    for (const cell of r.cells) for (const item of cell.finalNativeSaves) {
      const file = path.join(archive, "saves", cell.installId, item.name);
      assert.equal(sha(file), item.sha256); assert.equal(read(file).install_id, cell.installId);
      assert.equal(read(file).game_id, cell.installId);
    }
    for (const fault of r.faults) {
      assert.equal(sha(fault.retained), fault.originalSha256);
      const relative = path.relative(journal.records[0].original, fault.file);
      assert(!relative.startsWith("..") && !path.isAbsolute(relative));
      assert.equal(sha(path.join(archive, relative)), fault.originalSha256);
      const injected = { ...read(fault.retained), scene_id: "__qa_missing_scene_current_native__" };
      assert.equal(crypto.createHash("sha256").update(JSON.stringify(injected)).digest("hex"), fault.injectedSha256);
    }
    return { retainedSaveCopies: r.nativeSaves.length, finalSlots: 72, restoredSemanticFaults: r.faults.length };
  });
  group("Original directories/bytes restored and recorded roots, lock helpers and ports absent", () => {
    const restored = read(s.restoration.path); assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const old of journal.records) {
      const actual = restored.restored.find(v => v.original === old.original); assert(actual);
      assert.equal(actual.directoryId, old.directoryId); assert.deepEqual(actual.files, old.files);
      assert(!fs.existsSync(old.held)); if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      for (const file of old.files) assert.equal(sha(path.join(old.original, file.relative)), file.sha256);
      if (old.existed) {
        const p = spawnSync("fsutil.exe", ["file", "queryfileid", old.original], { windowsHide: true, encoding: "utf8" });
        assert.equal(p.status, 0); assert(p.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
      }
    }
    const active = rows(), identities = [...r.launches, ...r.locks].map(l => l.identity), ports = r.launches.map(l => l.port);
    for (const old of identities) {
      const created = Number(old.CreationDate.match(/\d+/)[0]);
      assert(!active.some(p => p.ProcessId === old.ProcessId && Date.parse(p.Created) === created));
    }
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
    assert.deepEqual(listeners(ports), []);
    return { identitiesAbsent: identities.length, distinctPortsAbsent: [...new Set(ports)].length,
      userFilesDeleted: 0, originalDirectoriesRestored: true, descendantsNotIndividuallyRecorded: true,
      normalCloseClaimed: false };
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out,
    groups: report.groups.map(g => ({ name: g.name, status: g.status })), error: report.error }, null, 2));
}
