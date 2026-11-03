"use strict";
// Independent read-only check of real quick-save fault evidence and cleanup.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const quick = require("./current-runtime-quick-closure.cjs");
const closure = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/quick-installed-1935-01";
const out = root + "/independent-audit-02.json";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
const checked = file => { assert.equal(sha(file.path), file.sha256, file.path); return file; };
assert(!fs.existsSync(out));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  productChanges: 0, productStarts: 0, builds: 0, modelRequests: 0 };
function group(name, fn) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
try {
  const r = read(root + "/session.json"), raw = read(root + "/player-01.json");
  const prep = read(root + "/preparation.json"), bindings = read(root + "/sources.json");
  let validate;
  group("Current candidate, full real fault matrix and rejected incomplete evidence", () => {
    assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError && !r.observerError);
    for (const key of ["productChanges", "builds", "modelRequests"]) assert.equal(r[key], 0);
    checked(r.source); checked(r.predecessor); checked(r.preparation); checked(r.executable); checked(r.raw);
    const installed = closure.descriptor();
    assert.equal(r.executable.sha256, installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256);
    quick.validatePreparation(prep, root);
    const b = bindings.find(item => item.mode === "validator");
    const worker = new Module(b.original.path, module); worker.filename = b.original.path;
    worker.paths = Module._nodeModulePaths(path.dirname(worker.filename));
    worker._compile(fs.readFileSync(b.executed.path, "utf8"), worker.filename);
    validate = value => worker.exports.validateQuickReport(value, 12, { current1922: true });
    validate(raw);
    const mutations = [
      value => { value.cells = []; },
      value => { value.cells[0].checks.pop(); },
      value => { value.launches[0].executableSha256 = "wrong"; },
      value => { value.cells[0].viewport.dpr = 3; },
      value => { value.mockDelay = true; },
      value => { value.locks[0].cleanup = "FAILED"; },
      value => { value.faults[0].restoration = "FAILED"; },
      value => { value.cells[0].checks[2].detail.restored.command = 0; },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(raw); mutate(copy); assert.throws(() => validate(copy));
    }
    assert.deepEqual(r.commands.map(c => c.label), ["profile-prepare", "quick", "profile-restore"]);
    assert(r.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.finishedAt));
    return { cells: raw.cells.length, actualChecks: raw.cells.reduce((n, c) => n + c.checks.length, 0),
      rejectedIncompleteVariants: mutations.length, controlledFaults: true,
      noMockedPersistence: true, standaloneOrAndroidClaimed: false };
  });
  group("Exact deterministic sources, native lock boundaries and original business assertions", () => {
    assert.equal(bindings.length, 4);
    for (const b of bindings) {
      for (const file of [b.original, b.executed, b.adapter]) checked(file);
      assert.equal(sha(root + "/frozen-adapter.cjs"), b.adapter.sha256);
      const original = fs.readFileSync(b.original.path, "utf8"), result = quick.build(b.mode, original);
      assert.equal(fs.readFileSync(b.executed.path, "utf8"), result.source);
      assert.deepEqual(b.edits, result.edits);
    }
    const file = "F:/AgentVN/QA/Runtime-Story-1.9.35-20261101-01/quick-lock-preflight-01/report.json";
    const boundaries = read(file);
    assert.equal(boundaries.status, "PASS"); checked(boundaries.tool); checked(boundaries.lockHelper);
    assert.equal(boundaries.filesLocked, 0); assert.equal(boundaries.productStarts, 0);
    assert.equal(boundaries.boundaryCases.length, 6);
    return { sourceBindings: 4, boundaryTests: describe(file), oldScriptsOverwritten: false };
  });
  group("PNG pixels, native bytes, injected corruption and sharing-lock evidence", () => {
    for (const s of raw.screenshots) {
      checked(s); assert.deepEqual(s.before, s.after);
      const png = fs.readFileSync(s.path), dpr = Math.round(s.before.dpr);
      // WebView can report 1.0000000149 / 2.0000000298. Reject a genuinely
      // different DPR, then compare exact integer PNG pixels.
      assert([1, 2].includes(dpr) && Math.abs(s.before.dpr - dpr) <= 1e-6);
      assert.equal(png.readUInt32BE(16), s.before.width * dpr);
      assert.equal(png.readUInt32BE(20), s.before.height * dpr);
    }
    for (const s of raw.nativeSaves) {
      assert.equal(sha(s.retained), s.sha256);
      assert.deepEqual(read(s.retained), s.data);
    }
    for (const f of raw.faults) {
      assert.equal(f.restoration, "PASS"); assert.equal(sha(f.retained), f.originalSha256);
      const c = raw.cells.find(c => c.name === f.cell);
      assert.equal(read(f.retained).save_id, c.checks[2].detail.invalidLatest.save_id);
    }
    for (const lock of raw.locks) {
      assert.equal(lock.cleanup, "PASS");
      assert.equal(fs.readFileSync(lock.readyFile, "utf8"), "READ_SHARED_WRITE_DELETE_DENIED");
      assert.equal(fs.readFileSync(lock.releaseFile, "utf8"), "RELEASE");
      assert.equal(lock.exitCode, 0);
    }
    return { screenshots: raw.screenshots.length, nativeSaveSnapshots: raw.nativeSaves.length,
      realWriteLocks: raw.locks.length, controlledCorruptions: raw.faults.length };
  });
  group("Protected original directory identities and bytes restored; owned processes and ports absent", () => {
    checked(r.restoration); const restored = read(r.restoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const old of read(root + "/profile-protection.json").records) {
      const now = restored.restored.find(item => item.original === old.original); assert(now);
      assert.equal(now.directoryId, old.directoryId); assert.deepEqual(now.files, old.files);
      assert(!fs.existsSync(old.held));
      if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      if (old.existed) {
        assert(!fs.lstatSync(old.original).isSymbolicLink());
        const id = spawnSync("fsutil.exe", ["file", "queryfileid", old.original],
          { encoding: "utf8", windowsHide: true, timeout: 10000 });
        assert.equal(id.status, 0); assert(id.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
      }
      for (const f of old.files) assert.equal(sha(path.join(old.original, f.relative)), f.sha256);
    }
    const processes = rows();
    for (const p of r.knownProcesses)
      assert(!processes.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
    assert(!processes.some(p => p.Name === "agentvn-player.exe" ||
      p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(root)));
    assert.deepEqual(r.absentPorts, raw.launches.map(l => l.port));
    assert.deepEqual(listeners(r.absentPorts), []);
    return { originalProfiles: read(root + "/profile-protection.json").records.length,
      absentPorts: r.absentPorts.length, userFilesDeleted: 0, normalCloseClaimed: false };
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.tool = describe(__filename);
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, groups: report.groups.map(g => ({
    name: g.name, status: g.status })), error: report.error, out }));
}
