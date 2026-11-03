"use strict";
// Evidence-only audit, including hostile evidence variants. No products start.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { validate } = require("./installed-runtime-state-current.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const attempt = process.argv[2] || "01", audit = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
const source = path.join(qa, `installed-state-current-${attempt}`);
const out = path.join(qa, `installed-state-current-${attempt}-audit-${audit}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const receipt = { status: "RUNNING", at: new Date().toISOString(), groups: [],
  scope: "INSTALLED_PLAYER_LIBRARY_EVIDENCE_ONLY_NOT_STANDALONE_SETUP_ANDROID",
  productChanges: 0, modelRequests: 0, launches: 0 };
function group(name, fn) {
  const c = { name, status: "RUNNING" }; receipt.groups.push(c);
  c.detail = fn(); c.status = "PASS";
}
try {
  const r = read(path.join(source, "report.json")), f = read(path.join(source, "flow/report.json"));
  const c = read(path.join(source, "cross-layout/report.json"));
  const d = validate(r, f, c);
  receipt.source = desc(path.join(source, "report.json"));
  group("Exact installed provenance, complete business checks and hostile evidence rejection", () => {
    for (const file of [r.installation, r.executable, r.originalExport, r.originalFixture, r.restoration,
      ...r.protectedFiles, ...r.cartridges]) assert.equal(sha(file.path), file.sha256, file.path);
    for (const s of r.snapshots) {
      assert.equal(sha(s.copy.path), s.copy.sha256); assert.equal(s.copy.sha256, s.source.sha256);
      if (s.source.path.endsWith(".cjs") || s.source.path.endsWith(".ps1"))
        assert.equal(sha(s.source.path), s.source.sha256);
    }
    for (const v of [f, c]) assert.equal(sha(v.runnerAtInvocation.path), v.runnerAtInvocation.sha256);
    const invalid = [
      a => { a[0].status = "RUNNING"; }, a => { a[0].finishedAt = null; },
      a => { a[0].version = "1.9.13"; }, a => { a[0].modelRequests = 1; },
      a => { a[0].productsChanged = 1; }, a => { a[0].builds = 1; },
      a => { a[0].commands.pop(); }, a => { a[0].cleanupError = "missing"; },
      a => { a[0].executable.sha256 = "wrong"; },
      a => { a[1].matrix = []; }, a => { a[1].matrix[1] = a[1].matrix[0]; },
      a => { a[1].checks.pop(); }, a => { a[1].pageErrors.push("runtime error"); },
      a => { a[1].launches[0].cleanup.status = "RUNNING"; },
      a => { a[1].screenshots.pop(); }, a => { a[2].matrix[0].dpr = 4; },
      a => { a[2].checks[0].detail.files.pop(); },
      a => { a[2].checks[0].detail.nativePickerClaim = true; },
      a => { a[2].checks[0].detail.standaloneExeSaveLocationClaim = true; },
      a => { a[2].checks[0].detail.realPlayerRestart = false; },
    ];
    for (const mutate of invalid) { const a = structuredClone([r, f, c]); mutate(a); assert.throws(() => validate(...a)); }
    return { source: receipt.source, businessChecks: f.checks.length + c.checks.length,
      displayCases: f.matrix.length, rejectedVariants: invalid.length,
      protectedDistinctPaths: new Set(r.protectedFiles.map(f => path.resolve(f.path))).size };
  });
  group("Actual controls, pagination, mode inheritance and quick save boundaries", () => {
    for (const row of f.matrix) {
      assert(row.dialog.overflow <= 1);
      assert.equal(row.controls.length, row.layout === "renpy" ? 8 : 1);
      for (const b of row.controls)
        assert(b.hit && b.x >= -1 && b.y >= -1 && b.right <= row.width + 1 && b.bottom <= row.height + 1);
      if (row.layout === "renpy") for (let i = 1; i < row.controls.length; i++) {
        assert(Math.abs(row.controls[i].y - row.controls[0].y) < 1);
        assert(row.controls[i - 1].right <= row.controls[i].x + 1);
      }
    }
    const q = f.checks.find(c => c.name.startsWith("Real quick-save")).detail;
    assert.equal(q.writes.length, 7); assert.equal(q.retained.length, 6);
    assert(q.manualUnchanged && q.sixSlotsPerPage); assert.equal(q.loadedCommand, 6);
    for (const k of ["invalidLatestFallback", "quickWriteFailure", "concurrentSubmission"]) assert.equal(q[k], "NOT_RUN");
    for (const mode of ["agentvn", "renpy"]) {
      const items = f.checks.filter(c => c.layout === mode);
      for (const name of ["Explicit ordinary", "Long ordinary", "Extreme ordinary", "NVL inheritance",
        "NVL explicit", "Bubble follows"]) assert.equal(items.filter(c => c.name.startsWith(name)).length, 1);
      const nvl = items.find(c => c.name.startsWith("NVL inheritance")).detail;
      assert(nvl.noAudioFixture && !nvl.voiceReplayClaim);
      assert.deepEqual(nvl.before.nvl, nvl.restored.nvl); assert.equal(nvl.before.nvl.length, 3);
    }
    return { displayCases: 24, loadedLatestQuickCommand: 6, quickFaultCases: "NOT_RUN",
      audio: "USER_PREVIOUS_CONFIRMATION_NOT_NEW_FIXTURE_OR_LISTENING" };
  });
  group("35 PNGs retain bytes and actual pre/post viewport DPR media", () => {
    const images = [...f.screenshots, ...c.screenshots];
    for (const s of images) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const dpr = Math.round(s.before.dpr), bytes = fs.readFileSync(s.path);
      assert([1, 2].includes(dpr) && Math.abs(s.before.dpr - dpr) <= 1e-6);
      assert.equal(bytes.readUInt32BE(16), s.before.width * dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * dpr);
      assert.equal(s.png.width, bytes.readUInt32BE(16)); assert.equal(s.png.height, bytes.readUInt32BE(20));
    }
    return { images: images.length, physical4kClaimed: false };
  });
  group("Native saves preserve exact bytes and identity after cross-layout process restart", () => {
    const archived = path.join(source, "player-roaming/saves", f.installId);
    const kinds = {};
    for (const item of d.files) {
      assert.equal(sha(item.retained), item.sha256); assert.equal(fs.statSync(item.retained).size, item.bytes);
      assert.deepEqual(read(item.retained), item.data);
      assert.equal(sha(path.join(archived, path.basename(item.path))), item.sha256);
      assert.equal(item.data.install_id, f.installId); assert.equal(item.data.game_id, f.installId);
      assert.equal(d.before.filter(v => v.save_id === item.data.save_id).length, 1);
      kinds[item.data.save_kind] = (kinds[item.data.save_kind] || 0) + 1;
    }
    assert.deepEqual(kinds, { auto: 2, quick: 6, manual: 2 });
    const latest = d.before.filter(s => s.save_kind === "quick").toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0];
    assert.equal(d.loadedLatestQuick, latest.save_id); assert.equal(d.restored.command, 6);
    return { kinds, portable: false, files: d.files.map(({ retained, sha256 }) => ({ retained, sha256 })) };
  });
  group("Original Player directories restored; recorded roots and owned WebViews/ports absent", () => {
    const journal = read(path.join(source, "profile-protection.json")), restored = read(r.restoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const old of journal.records) {
      const now = restored.restored.find(v => v.original === old.original); assert(now);
      assert.equal(now.directoryId, old.directoryId); assert.deepEqual(now.files, old.files);
      assert(!fs.existsSync(old.held)); if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      for (const file of old.files) assert.equal(sha(path.join(old.original, file.relative)), file.sha256);
      if (old.existed) {
        const res = spawnSync("fsutil.exe", ["file", "queryfileid", old.original], { encoding: "utf8", windowsHide: true });
        assert.equal(res.status, 0); assert(res.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
      }
    }
    const active = rows(), launches = [...f.launches, ...c.launches], ports = launches.map(l => l.cdpPort);
    for (const l of launches) {
      const ms = Number(l.identity.CreationDate.match(/\d+/)[0]);
      assert(!active.some(p => p.ProcessId === l.pid && Date.parse(p.Created) === ms));
      assert.equal(path.resolve(l.identity.ExecutablePath), r.executable.path);
    }
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
    assert.deepEqual(listeners(ports), []);
    return { recordedPlayerRootsAbsent: launches.length, portsAbsent: ports, originalDirectoryIdentitiesRestored: true,
      limitation: "Legacy business runner records root identities, not all descendants; no full historical tree claim.",
      normalCloseClaimed: false, userFilesDeleted: 0 };
  });
  receipt.status = "PASS";
} catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; }
finally {
  receipt.finishedAt = new Date().toISOString(); receipt.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: receipt.status, out, groups: receipt.groups.map(g => ({ name: g.name, status: g.status })),
    error: receipt.error }, null, 2));
}
