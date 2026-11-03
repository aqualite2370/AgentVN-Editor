"use strict";
// Supplement only: retain failed diagnostic, independently prove restoration
// and the successful single observation without claiming its absent repro fixed.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const out = path.join(base, "installed-quick-capture-audit-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const r = { status: "RUNNING", at: new Date().toISOString(), groups: [],
  scope: "DIAGNOSTIC_AND_RESTORATION_AUDIT_NOT_ORIGINAL_DARK_FRAME_ROOT_CAUSE", productChanges: 0 };
const group = (name, fn) => { const g = { name, status: "RUNNING" }; r.groups.push(g); g.detail = fn(); g.status = "PASS"; };
try {
  const dirs = ["quick-04", "quick-05"].map(n => path.join(base, n));
  const reports = dirs.map(d => read(path.join(d, "capture-diagnostic.json")));
  r.sources = dirs.map(d => desc(path.join(d, "capture-diagnostic.json")));
  assert.equal(reports[0].status, "FAILED"); assert.match(reports[0].error, /confirm-quick-load/);
  assert(reports[0].cleanupError);
  assert.equal(reports[1].status, "OBSERVATION_PASS_NOT_COMPLETE_MOTION_ACCEPTANCE");
  group("Original failed diagnostic retained; both QA faults and original directories restored", () => {
    for (let i = 0; i < dirs.length; i++) {
      const p = reports[i], journal = read(path.join(dirs[i], "profile-protection.json"));
      const restorationPath = path.join(dirs[i], "profile-restoration.json"), restored = read(restorationPath);
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert.equal(p.fault.restoration, "PASS");
      const archive = journal.records[0].target, relative = path.relative(journal.records[0].original, p.fault.file);
      assert(!relative.startsWith("..") && !path.isAbsolute(relative));
      assert.equal(sha(path.join(archive, relative)), p.fault.originalSha256);
      for (const j of journal.records) {
        assert(!fs.existsSync(j.held)); if (j.storage === "NativeRoaming") assert(!fs.existsSync(j.retained));
        const actual = restored.restored.find(v => v.original === j.original);
        assert.equal(actual.directoryId, j.directoryId); assert.deepEqual(actual.files, j.files);
        for (const f of j.files) assert.equal(sha(path.join(j.original, f.relative)), f.sha256);
      }
      const snapshot = path.join(dirs[i], "executed-diagnostic.cjs");
      assert.equal(sha(snapshot), p.tool.sha256);
      for (const f of p.protectedFiles) assert.equal(sha(f.path), f.sha256);
      assert.equal(sha(p.source.path), p.source.sha256); assert.equal(sha(p.prior.path), p.prior.sha256);
      if (i === 0) {
        assert(restored.at > p.finishedAt, "Recovery was separate and later, not silently included in the failed run");
        r.separateRestoration = desc(restorationPath);
      }
    }
    return { failurePreserved: true, laterIndependentRestoration: true, userFilesDeleted: 0 };
  });
  group("One actual 1080p normal quick-load observed to stable unobscured interactive state", () => {
    const p = reports[1]; assert(!p.error && !p.cleanupError);
    assert.equal(p.frames.length, 128);
    assert(p.frames.some(f => f.overlays.length > 0));
    assert(p.frames.some(f => f.overlays.some(n => n.opacity > 0 && n.opacity < 1)));
    for (const f of p.frames.slice(-3)) {
      assert.equal(f.command, 1); assert.equal(f.screen, "idle"); assert.equal(f.overlays.length, 0);
      assert(!f.animations.some(a => ["running", "pending"].includes(a.state)));
    }
    for (const k of ["stableCapture", "afterStableCapture"]) {
      assert.equal(p[k].command, 1); assert.equal(p[k].overlays.length, 0);
      assert(p[k].ancestors.every(n => n.opacity === "1" && n.filter === "none"));
    }
    assert.equal(p.controls.length, 8); assert(p.controls.every(c => c.hit));
    assert.equal(p.screenshots.length, 2);
    for (const image of p.screenshots) {
      assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
      assert.equal(image.before.width, 1920); assert.equal(image.before.height, 1080);
      assert(Math.abs(image.before.dpr - 1) <= 1e-6); assert.equal(image.before.reduced, false);
      const b = fs.readFileSync(image.path);
      assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
    }
    return { frames: p.frames.length, screenshots: p.screenshots.length, actualRestoredCommand: 1,
      originalDarkFrameCause: "UNRESOLVED_NOT_REPRODUCED_IN_INSTRUMENTED_OBSERVATION",
      noProductFixOrFullMotionAcceptanceClaim: true };
  });
  group("Diagnostic Player roots and ports, owned WebViews absent", () => {
    const all = rows(), launches = reports.flatMap(p => p.launches), ports = launches.map(l => l.port);
    for (const l of launches) {
      assert.equal(l.cleanup.status, "PASS");
      const created = Number(l.identity.CreationDate.match(/\d+/)[0]);
      assert(!all.some(p => p.ProcessId === l.pid && Date.parse(p.Created) === created));
    }
    assert(!all.some(p => p.Name === "msedgewebview2.exe" && dirs.some(d => (p.CommandLine || "").includes(d))));
    assert.deepEqual(listeners(ports), []);
    return { recordedRootsAbsent: launches.length, portsAbsent: ports, normalCloseClaimed: false };
  });
  r.status = "PASS_WITH_ORIGINAL_CAPTURE_CAUSE_UNRESOLVED";
} catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
finally {
  r.finishedAt = new Date().toISOString(); r.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, out, groups: r.groups.map(g => ({ name: g.name, status: g.status })),
    error: r.error }, null, 2));
}
