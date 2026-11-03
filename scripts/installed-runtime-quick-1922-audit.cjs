"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateQuickReport } = require("./native-runtime-quick-audit.cjs");
const { validateQuickPreparation } = require("./lib/installed-runtime-quick-1922-preparation.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function validateTerminal(s, r) {
  assert.equal(s.status, "PASS"); assert(s.finishedAt && r.finishedAt);
  assert(!s.cleanupError && !s.error && !s.observerError);
  assert.equal(s.scope, "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_QUICK_EXCEPTIONS");
  assert.equal(s.normalCloseClaimed, false);
  for (const key of ["productChanges", "builds", "modelRequests"]) assert.equal(s[key], 0);
  assert.equal(s.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  assert.deepEqual(s.commands.map(c => c.label), ["profile-prepare", "quick", "profile-restore"]);
  assert(s.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.finishedAt));
  assert.deepEqual(s.absentPorts, r.launches.map(l => l.port));
  assert.equal(s.environment.AGENTVN_WORKSPACE_OUTPUT, s.out);
  assert.equal(path.resolve(s.environment.AGENTVN_TEST_PROJECT), path.resolve(s.fixture.input));
  validateQuickReport(r, s.smoke ? 1 : 12, { current1922: true });
  assert(r.launches.every(l => path.resolve(l.identity.ExecutablePath) === path.resolve(s.executable.path)));
}
function main() {
  const [attempt, audit = "01"] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const source = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-quick-1922-${attempt}`;
  const out = `${source}-audit-${audit}`; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
    scope: "CURRENT_INSTALLED_QUICK_EVIDENCE_AUDIT_NOT_NEW_BUSINESS_EXECUTION",
    productChanges: 0, modelRequests: 0, productStarts: 0 };
  const group = (name, fn) => {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = fn(); g.status = "PASS"; }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
  };
  try {
    report.session = desc(path.join(source, "session.json"));
    const s = read(report.session.path), r = read(s.raw.path);
    report.raw = desc(s.raw.path); validateTerminal(s, r);
    group("Exact installed provenance, complete matrix and hostile evidence rejection", () => {
      for (const f of [s.checkpoint, s.installation, s.executable, s.originalExport, s.originalFixture,
        s.preparation, s.restoration, s.raw, ...s.protectedProducts, ...s.cartridges, ...r.sources])
        assert.equal(sha(f.path), f.sha256, f.path);
      for (const f of s.tools) {
        assert.equal(sha(f.path), f.sha256, f.path);
        assert.equal(sha(f.copy), f.sha256, f.copy);
      }
      assert.equal(sha(r.runner.path), r.runner.sha256);
      validateQuickPreparation(read(s.preparation.path), s.out);
      const mutations = [
        a => { a[0].status = "RUNNING"; }, a => { a[0].finishedAt = null; },
        a => { a[0].normalCloseClaimed = true; }, a => { a[0].modelRequests = 1; },
        a => { a[0].executable.sha256 = "wrong"; }, a => { a[0].commands.pop(); },
        a => { a[0].absentPorts = []; }, a => { a[1].cells = []; },
        a => { a[1].cells[0].checks.pop(); }, a => { a[1].cells[0].viewport.dpr = 4; },
        a => { a[1].launches[0].identity.ExecutablePath = "D:/other.exe"; },
        a => { a[1].launches[0].cleanup.status = "RUNNING"; },
        a => { a[1].cells[0].checks[0].detail.observed.clicks.push({ trusted: true }); },
        a => { a[1].cells[0].checks[0].detail.observed.pointers.filter(e => e.type === "pointerdown")[1].busy = false; },
        a => { a[1].cells[0].checks[1].detail.method = "ACL"; },
        a => { a[1].cells[0].checks[2].detail.restored.command = 0; },
        a => { a[1].faults[0].restoration = "FAILED"; },
        a => { a[1].locks[0].cleanup = "FAILED"; },
        a => { a[1].mockDelay = true; }, a => { a[1].screenshots.pop(); },
        a => { a[1].nativeSaves.pop(); }, a => { a[1].pageErrors.push("error"); },
      ];
      for (const mutate of mutations) {
        const args = structuredClone([s, r]); mutate(args); assert.throws(() => validateTerminal(...args));
      }
      return { cells: r.cells.length, businessChecks: r.cells.flatMap(c => c.checks).length,
        rejectedVariants: mutations.length, smoke: s.smoke };
    });
    group("Trusted pending input, real sharing failure/retry and distinct latest-valid read", () => {
      const values = r.cells.map(c => c.checks[0].detail.timing.pendingMs);
      for (const c of r.cells) {
        const [pending, denied, semantic] = c.checks.map(c => c.detail);
        assert.equal(pending.before.length, 6); assert.equal(pending.after.length, 6);
        assert(denied.failure.includes(path.dirname(denied.target)));
        assert.equal(denied.retried.slot, Number(path.basename(denied.target).match(/\d+/)[0]));
        assert(semantic.cancellationUnchanged && semantic.actualRestart);
        assert.equal(semantic.restored.command, 1);
      }
      return { checks: r.cells.length * 3, pendingMs: { min: Math.min(...values), max: Math.max(...values) },
        sharingLocks: r.locks.length, restarts: r.cells.length,
        caveat: "Controlled scene corruption and sharing denial; no fake timing or ACL claim" };
    });
    group("Raw PNG actual viewport/DPR/media and native slot/fault bytes", () => {
      const journal = read(path.join(source, "profile-protection.json"));
      const archived = journal.records.find(j => j.storage === "NativeRoaming").target;
      for (const image of r.screenshots) {
        assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
        const c = r.cells.find(c => path.basename(image.path).startsWith(`renpy-${c.name}-`)); assert(c);
        const v = c.viewport, bytes = fs.readFileSync(image.path);
        assert.equal(image.before.width, v.width); assert.equal(image.before.height, v.height);
        assert.equal(image.before.reduced, v.reduced); assert(Math.abs(image.before.dpr - v.dpr) <= 1e-6);
        assert.equal(bytes.readUInt32BE(16), v.width * v.dpr); assert.equal(bytes.readUInt32BE(20), v.height * v.dpr);
      }
      for (const f of r.nativeSaves) {
        assert.equal(sha(f.retained), f.sha256); assert.deepEqual(read(f.retained), f.data);
      }
      for (const c of r.cells) for (const f of c.finalNativeSaves) {
        const actual = path.join(archived, "saves", c.installId, f.name);
        assert.equal(sha(actual), f.sha256); assert.equal(read(actual).install_id, c.installId);
      }
      for (const f of r.faults) {
        assert.equal(sha(f.retained), f.originalSha256);
        const installId = path.basename(path.dirname(f.file));
        assert.equal(sha(path.join(archived, "saves", installId, path.basename(f.file))), f.originalSha256);
      }
      return { screenshots: r.screenshots.length, savedSnapshots: r.nativeSaves.length,
        finalSlots: r.cells.length * 6, restoredFaults: r.faults.length, physical4kClaimed: false };
    });
    group("Original directory IDs and bytes restored; Player, locks, descendants and ports absent", () => {
      const journal = read(path.join(source, "profile-protection.json")), restored = read(s.restoration.path);
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      for (const old of journal.records) {
        assert(!fs.existsSync(old.held));
        const now = restored.restored.find(v => v.original === old.original); assert(now);
        assert.equal(now.directoryId, old.directoryId); assert.deepEqual(now.files, old.files);
        if (old.existed) {
          const id = spawnSync("fsutil.exe", ["file", "queryfileid", old.original],
            { encoding: "utf8", windowsHide: true, timeout: 10000 });
          assert.equal(id.status, 0); assert(id.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
        }
        if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
        for (const f of old.files) assert.equal(sha(path.join(old.original, f.relative)), f.sha256);
      }
      const current = rows();
      for (const p of s.knownProcesses)
        assert(!current.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      for (const l of r.locks) assert(!current.some(p => p.ProcessId === l.pid &&
        Date.parse(p.Created) === Number(l.identity.CreationDate.match(/\d+/)[0])));
      assert(!current.some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
      assert.deepEqual(listeners(s.absentPorts), []);
      return { directories: journal.records.length, ownedIdentities: s.knownProcesses.length,
        locksAbsent: r.locks.length, portsAbsent: s.absentPorts, normalCloseClaimed: false, deletedUserFiles: 0 };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out, groups: report.groups.map(g =>
      ({ name: g.name, status: g.status })), error: report.error }));
  }
}
module.exports = { validateTerminal };
if (require.main === module) main();
