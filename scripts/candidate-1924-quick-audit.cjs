"use strict";
// Read original bytes and traces independently after this matrix has restored profiles.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateCandidateQuickPreparation, validateCandidateQuickReport,
  adaptQuickFlow, adaptQuickSession, adaptQuickValidator, quickCandidate } = require("./lib/candidate-1924-quick-adapter.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const options = quickCandidate(process.argv.includes("--candidate=1.9.30")), current = options.current;
assert.deepEqual(process.argv.slice(2),!options.explicit&&current?[attempt,"--candidate=1.9.30"]:[attempt]);
const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/quick-installed-${options.stamp}-${attempt}`);
const out = path.join(options.base, `quick-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: `INSTALLED_${options.version.replaceAll(".", "_")}_QUICK_EXCEPTIONS_INDEPENDENT_AUDIT`, groups: [],
  modelRequests: 0, productStarts: 0, productChanges: 0, fullAcceptance: false };
function group(name, fn) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
try {
  report.input = desc(path.join(source, "session.json"));
  const session = read(report.input.path), prep = read(session.preparation.path), raw = read(session.raw.path);
  report.raw = desc(session.raw.path);
  assert.equal(session.status, "PASS"); assert(session.finishedAt && raw.finishedAt);
  assert(!session.error && !session.cleanupError && !session.observerError);
  assert.equal(session.scope, options.scope);
  if (options.explicit) {
    assert.equal(sha(options.bindingFile), session.candidateBinding.sha256);
    assert.deepEqual(session.candidateBinding.value, options.binding);
  }
  assert.equal(session.smoke, false); assert.equal(session.normalCloseClaimed, false);
  for (const key of ["productChanges", "builds", "modelRequests"]) assert.equal(session[key], 0);
  assert.deepEqual(session.commands.map(c => c.label), ["profile-prepare", "quick", "profile-restore"]);
  assert(session.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.finishedAt));
  assert.deepEqual(session.absentPorts, raw.launches.map(l => l.port));
  assert.equal(session.environment.AGENTVN_WORKSPACE_OUTPUT, source);
  assert.equal(session.environment.AGENTVN_TEST_PROJECT, session.fixture.input);
  validateCandidateQuickPreparation(prep, source); validateCandidateQuickReport(raw, prep);
  group("Exact installation, preserved historical business source, complete matrix and hostile receipts", () => {
    for (const item of [session.predecessor, session.installation, session.executable,
      session.originalExport, session.originalFixture, session.preparation, session.restoration,
      session.raw, ...session.cartridges, ...raw.sources, ...session.tools])
      assert.equal(sha(item.path), item.sha256, item.path);
    for (const item of session.tools) assert.equal(sha(item.copy), item.sha256, item.copy);
    assert.equal(sha(raw.runner.path), raw.runner.sha256);
    const mappings = read(path.join(source, "flow-adaptations.json"));
    assert.deepEqual(mappings.map(m => m.name), ["flow", "session", "validator"]);
    for (const [i, adapt] of [adaptQuickFlow, adaptQuickSession, adaptQuickValidator].entries()) {
      const mapping = mappings[i]; assert.equal(sha(mapping.original.path), mapping.original.sha256);
      assert.equal(sha(mapping.executed.path), mapping.executed.sha256);
      const actual = adapt(fs.readFileSync(mapping.original.path, "utf8"));
      assert.deepEqual(mapping.adaptations, actual.adaptations);
      assert.equal(fs.readFileSync(mapping.executed.path, "utf8"), actual.source);
    }
    const mutations = [
      r => { r.cells = []; }, r => { r.cells[0].checks.pop(); },
      r => { r.launches[0].executableSha256 = "wrong"; }, r => { r.scope = "CURRENT_DEV"; },
      r => { r.mockDelay = true; }, r => { r.screenshots.pop(); },
      r => { r.cells[0].checks[2].detail.restored.command = 0; },
      r => { r.cells[0].checks[1].detail.method = "ACL"; },
      r => { r.locks[0].cleanup = "FAILED"; }, r => { r.faults[0].restoration = "FAILED"; },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(raw); mutate(bad);
      assert.throws(() => validateCandidateQuickReport(bad, prep));
    }
    return { cells: raw.cells.length, businessChecks: raw.cells.length * 3, rejectedReceipts: mutations.length };
  });
  group("Real pending trusted input, sharing refusal/retry and newest distinct valid save", () => {
    const pendingMs = [];
    for (const cell of raw.cells) {
      const [pending, denied, semantic] = cell.checks.map(c => c.detail);
      assert.equal(pending.before.length, 6); assert.equal(pending.after.length, 6);
      pendingMs.push(pending.timing.pendingMs);
      assert(denied.failure.includes(path.dirname(denied.target)));
      assert.equal(denied.retried.slot, Number(path.basename(denied.target).match(/\d+/)[0]));
      assert(semantic.cancellationUnchanged && semantic.actualRestart);
      assert.equal(semantic.restored.command, 1);
    }
    return { pendingMs: { min: Math.min(...pendingMs), max: Math.max(...pendingMs) },
      sharingLocks: raw.locks.length, controlledSemanticFaults: raw.faults.length, aclClaimed: false };
  });
  group("Actual native slot bytes, fault restoration, viewport parameters and PNG pixels", () => {
    const journal = read(path.join(source, "profile-protection.json"));
    const archived = journal.records.find(p => p.storage === "NativeRoaming").target;
    for (const image of raw.screenshots) {
      assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
      const cell = raw.cells.find(c => path.basename(image.path).startsWith(`renpy-${c.name}-`)); assert(cell);
      const v = cell.viewport, png = fs.readFileSync(image.path);
      assert.equal(image.before.width, v.width); assert.equal(image.before.height, v.height);
      assert.equal(image.before.reduced, v.reduced); assert(Math.abs(image.before.dpr - v.dpr) <= 1e-6);
      assert.equal(png.readUInt32BE(16), v.width * v.dpr); assert.equal(png.readUInt32BE(20), v.height * v.dpr);
    }
    for (const file of raw.nativeSaves) {
      assert.equal(sha(file.retained), file.sha256); assert.deepEqual(read(file.retained), file.data);
    }
    for (const cell of raw.cells) for (const file of cell.finalNativeSaves) {
      const stored = path.join(archived, "saves", cell.installId, file.name);
      assert.equal(sha(stored), file.sha256); assert.equal(read(stored).install_id, cell.installId);
    }
    for (const fault of raw.faults) {
      assert.equal(sha(fault.retained), fault.originalSha256);
      assert.equal(sha(path.join(archived, "saves", path.basename(path.dirname(fault.file)),
        path.basename(fault.file))), fault.originalSha256);
    }
    return { screenshots: raw.screenshots.length, slotSnapshots: raw.nativeSaves.length,
      finalSlots: raw.cells.length * 6, faultsRestored: raw.faults.length };
  });
  group("Original user bytes restored; owned Player, lock helper, descendants and ports absent", () => {
    const journal = read(path.join(source, "profile-protection.json")), restored = read(session.restoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const original of journal.records) {
      assert(!fs.existsSync(original.held));
      const current = restored.restored.find(p => p.original === original.original); assert(current);
      assert.equal(current.directoryId, original.directoryId); assert.deepEqual(current.files, original.files);
      if (original.storage === "NativeRoaming") assert(!fs.existsSync(original.retained));
      for (const file of original.files) assert.equal(sha(path.join(original.original, file.relative)), file.sha256);
    }
    const all = rows();
    assert(session.knownProcesses.length > 0);
    for (const identity of session.knownProcesses)
      assert(!all.some(p => p.ProcessId === identity.ProcessId && p.Created === identity.Created));
    for (const lock of raw.locks)
      assert(!all.some(p => p.ProcessId === lock.pid &&
        Date.parse(p.Created) === Number(lock.identity.CreationDate.match(/\d+/)[0])));
    assert(!all.some(p => p.Name === "agentvn-player.exe" ||
      p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
    assert.deepEqual(listeners(session.absentPorts), []);
    return { restoredDirectories: journal.records.length, recordedIdentities: session.knownProcesses.length,
      absentPorts: session.absentPorts.length, normalCloseClaimed: false };
  });
  group("Every launch waits for its actual unique native document",()=>{
    assert(raw.launches.length>0);
    for(const launch of raw.launches) {
      const ready=launch.targetReadiness;
      assert(ready&&ready.readyAt&&ready.events.length>0);
      assert.equal(new URL(ready.readyURL).hostname,"tauri.localhost");
      assert.equal(ready.events.at(-1).candidates,1);
    }
    return {launches:raw.launches.length};
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, groups: report.groups,
    error: report.error }, null, 2));
}
