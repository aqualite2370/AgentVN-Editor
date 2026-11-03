"use strict";
// Independent evidence gate. Does not launch hosts or send model requests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { stages, readDb, qa, summary } = require("./native-assistant-recovery.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const id = p => `${p.ProcessId}:${p.Created}`;
function validate(r) {
  assert.equal(r.status, "CURRENT_NATIVE_CONTROLLED_RECOVERY_PASS"); assert(r.finishedAt);
  assert.equal(r.scope, "CURRENT_NATIVE_DEV_TWO_HOSTS_SOURCE_BACKEND_LOOPBACK_MODEL_AND_OWNED_KILL_FAULTS");
  assert.deepEqual(r.cases.map(c => c.name), stages); assert(r.cases.every(c => c.status === "PASS" && c.finishedAt >= c.startedAt));
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.deepEqual(r.errors, []); assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  assert.match(r.modelEndpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  for (const k of ["cleanupError", "peerCleanupError", "credentialCleanupError", "immutabilityError"]) assert(!r[k]);
  assert.equal(r.launches.length, 4); assert.equal(r.peerLaunches.length, 5);
  assert.equal(r.cleanups.length, 4); assert.equal(r.peerCleanups.length, 5);
  const primaries = new Set(r.launches.map(l => `${l.pid}:${l.created}`));
  assert.equal(primaries.size, 4);
  assert.equal(new Set(r.peerLaunches.map(l => `${l.pid}:${l.created}`)).size, 5);
  assert.equal(new Set(r.launches.map(l => l.data)).size, 1);
  assert.equal(new Set(r.launches.map(l => l.webview)).size, 1);
  assert.equal(new Set(r.peerLaunches.map(l => l.webview)).size, 1);
  for (const p of r.peerLaunches) {
    assert(!primaries.has(`${p.pid}:${p.created}`)); assert(p.created); assert.notEqual(p.webview, r.launches[0].webview);
    assert.equal(p.data, r.launches[0].data);
    assert(p.verified.sameBackend && p.verified.sameVite && p.verified.distinctProfile);
    assert.equal(p.verified.realNativePid, p.pid); assert(p.verified.sourceBackendNotPackaged);
    assert.equal(p.reusedServices.length, 3);
    const launch = r.launches.find(l => l.ports.includes(p.reusedServices.find(s => s.LocalPort !== 6767 &&
      r.launches.some(l => l.ports[0] === s.LocalPort))?.LocalPort));
    assert(launch, "Peer must share a known primary's backend");
    assert.deepEqual(p.reusedServices, launch.listeners);
  }
  for (const c of [...r.cleanups, ...r.peerCleanups]) {
    assert.equal(c.normalExitClaimed, false); assert.equal(c.survivors.length, 0); assert.equal(c.listeners.length, 0);
    assert(c.killed.length > 0);
  }
  assert.equal(r.submissions.length, 5); assert.equal(new Set(r.submissions.map(s => s.id)).size, 5);
  assert.deepEqual(r.submissions.map(s => s.userRequest.split(" ")[0]),
    ["RESUME_A", "PEER_A", "INTERRUPTED_A", "INTERRUPTED_B", "INTERRUPTED_C"]);
  const owner = r.submissions[0].projectId, other = r.submissions[3].projectId;
  assert.notEqual(owner, other);
  assert(r.submissions.filter((_, i) => i !== 3).every(s => s.projectId === owner && /^peer-/.test(s.hostLabel)));
  assert.match(r.submissions[3].hostLabel, /^primary-/);
  assert.equal(r.modelBoundary.length, 4);
  assert.deepEqual(r.modelBoundary.map(m => m.marker), ["RESUME_A", "PEER_A", "INTERRUPTED_A", "INTERRUPTED_C"]);
  assert(r.modelBoundary.every(m => m.creation && m.tools.includes("submit_assistant_component_draft") &&
    m.finishedAt >= m.startedAt));
  for (let i = 1; i < r.modelBoundary.length; i++) assert(r.modelBoundary[i].startedAt >= r.modelBoundary[i - 1].finishedAt);
  assert.equal(r.providerCleanup.requests, 4); assert.equal(r.providerCleanup.maxConcurrentCreation, 1); assert(r.providerCleanup.stopped);
  assert.equal(r.modelCheckpoints.length, 7);
  assert.deepEqual(r.modelCheckpoints.at(-1).counts, { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0, INTERRUPTED_C: 1 });
  assert.equal(r.faults.length, 2);
  assert.deepEqual(r.faults.map(f => f.name), ["running-and-queued-worker-death", "cancelling-worker-death"]);
  for (const f of r.faults) {
    assert.equal(f.naturalCrashClaimed, false); assert(f.backendIdentities.length >= 3);
    assert.deepEqual(f.missingIdentities, f.backendIdentities.map(id));
  }
  const pre = r.faults[0].preTasks, pid = pre.find(p => p.id === r.submissions[2].id).ownerPid;
  assert.equal(pre.find(p => p.id === r.submissions[2].id).status, "running");
  assert.equal(pre.find(p => p.id === r.submissions[3].id).status, "queued");
  assert.equal(pre.find(p => p.id === r.submissions[3].id).ownerPid, pid);
  assert(r.known.some(p => p.ProcessId === pid));
  assert.equal(r.faults[1].preTasks.find(p => p.id === r.submissions[4].id).status, "cancelling");
  assert.equal(r.cases[1].detail.requests, 1);
  assert.notEqual(r.cases[1].detail.oldPid, r.cases[1].detail.newPid);
  const g = r.cases[2].detail.geometry;
  assert(g.hit && g.focus && g.overflow <= 1 && g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= 1921 && g.rect.bottom <= 1081);
  assert.notEqual(r.cases[2].detail.submittingPid, r.cases[2].detail.cancellingPid);
  for (const p of r.cases[3].detail.finals) { assert.equal(p.status, "failed"); assert.equal(p.errorCode, "worker_lost"); }
  assert.equal(r.cases[3].detail.finals.length, 2); assert.equal(r.cases[3].detail.automaticResubmissions, 0);
  assert.equal(r.cases[4].detail.final.status, "cancelled"); assert.equal(r.cases[4].detail.final.errorCode, "worker_lost");
  assert(r.cases[5].detail.oldDraftRetained);
  assert.deepEqual(r.cases[5].detail.statuses.map(p => p.status), ["completed", "cancelled", "failed", "failed", "cancelled"]);
  assert.equal(r.dbSnapshots.length, 8); assert.equal(r.screenshots.length, 6);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after); assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
    assert(Math.abs(s.before.dpr - 1) <= 1e-6); assert.equal(s.before.reduced, false);
    assert.equal(s.png.width, 1920); assert.equal(s.png.height, 1080);
  }
  assert.equal(r.finalCleanup.normalExitClaimed, false); assert.equal(r.finalCleanup.survivors.length, 0);
  assert.equal(r.finalCleanup.listeners.length, 0);
  return { businessCases: 6, primaryStarts: 4, peerStarts: 5, controlledRequests: 4, paidRequests: 0,
    injectedWholeWorkerDeaths: 2, displayMatrix: "Not rerun; 1080p DPR1 normal lifecycle only",
    installationOrPhysicalInputClaimed: false, normalCloseClaimed: false };
}
function selfTest(r) {
  validate(r);
  const mutations = [
    a => { a.status = "PASS"; }, a => { a.cases = []; }, a => { delete a.finishedAt; },
    a => { a.modelEndpoint = "https://uncontrolled.invalid/v1"; },
    a => { a.peerLaunches[0].pid = a.launches[0].pid; a.peerLaunches[0].created = a.launches[0].created; },
    a => { a.peerLaunches[0].webview = a.launches[0].webview; },
    a => { a.peerLaunches[0].verified.sameBackend = false; },
    a => { a.peerLaunches[0].reusedServices[0].OwningProcess++; },
    a => { a.cleanups[0].normalExitClaimed = true; }, a => { a.peerCleanups[0].survivors.push({}); },
    a => { a.realModelRequests = 1; }, a => { a.modelBoundary.push(a.modelBoundary[0]); },
    a => { a.modelBoundary[0].tools = []; }, a => { a.modelCheckpoints.at(-1).counts.INTERRUPTED_B = 1; },
    a => { a.providerCleanup.maxConcurrentCreation = 2; },
    a => { a.faults[0].preTasks.find(p => p.status === "queued").status = "completed"; },
    a => { a.faults[1].naturalCrashClaimed = true; },
    a => { a.cases[3].detail.finals[0].errorCode = "provider_error"; },
    a => { a.cases[4].detail.final.status = "completed"; },
    a => { a.cases[2].detail.geometry.hit = false; },
    a => { a.screenshots[0].png.width /= 2; }, a => { a.dbSnapshots = []; },
    a => { a.credentialCleanup = "NOT_CLEARED"; }, a => { a.finalCleanup.listeners.push({}); },
  ];
  for (const mutate of mutations) { const bad = structuredClone(r); mutate(bad); assert.throws(() => validate(bad)); }
  console.log(`PASS ${mutations.length} invalid recovery-evidence variants rejected`);
  return mutations.length;
}
function audit(name, iteration) {
  assert(/^audit-\d{2}$/.test(name)); assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(qa, `session-${iteration}/report.json`), r = load(file);
  const receipt = { status: "RUNNING", at: new Date().toISOString(), report: { path: file, sha256: sha(file) } };
  try {
    receipt.coverage = validate(r); receipt.invalidVariantsRejected = selfTest(r);
    for (const f of [...r.products, ...r.sources, ...r.inputs, ...r.dbSnapshots]) assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(sha(path.join(root, "scripts/native-assistant-recovery.cjs")),
      sha(path.join(qa, `session-${iteration}/executed-test.cjs`)));
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256);
      const bytes = fs.readFileSync(s.path); assert.equal(bytes.readUInt32BE(16), s.png.width); assert.equal(bytes.readUInt32BE(20), s.png.height);
    }
    const final = readDb(path.join(r.launches[0].data, "backend/vn_engine.db"));
    assert.deepEqual(final, load(r.dbSnapshots.find(s => s.name === "final-terminal-durable").path));
    assert.equal(final.tasks.length, 5); assert(final.tasks.every(t => t.payloadEmpty));
    assert.deepEqual(final.tasks.map(t => t.status), ["completed", "cancelled", "failed", "failed", "cancelled"]);
    assert(final.tasks.slice(2).every(t => t.error_code === "worker_lost"));
    assert(final.tasks.slice(1).every(t => !t.hasResult)); assert(final.tasks[0].hasResult);
    const authored = nodes => nodes.map(({ measured, ...n }) => n);
    for (const p of final.projects) {
      const original = r.baseline[p.project_id]; assert(original);
      assert.deepEqual(p.editor_settings, original.editor_settings); assert.deepEqual(authored(p.nodes), authored(original.nodes));
      assert.deepEqual(p.edges, original.edges); assert.deepEqual(p.asset_manifest, original.asset_manifest);
    }
    const all = [...r.known, ...r.peerKnown], live = rows();
    assert(!all.some(p => live.some(a => id(a) === id(p))));
    assert.equal(listeners(r.finalCleanup.ports).length, 0);
    receipt.processIdentitiesAbsent = new Set(all.map(id)).size; receipt.portsAbsent = r.finalCleanup.ports;
    const snapshot = path.join(out, "final-readonly-sqlite.json");
    fs.writeFileSync(snapshot, JSON.stringify(final, null, 2), { flag: "wx" });
    receipt.persisted = { path: snapshot, sha256: sha(snapshot), noPayloadsRetained: true, authoredProjectsUnchanged: 2 };
    receipt.preparation = { path: path.join(summary, "preparation.json"), sha256: sha(path.join(summary, "preparation.json")) };
    const prep = load(receipt.preparation.path);
    for (const saved of prep.snapshots) assert.equal(sha(saved.path), saved.sha256);
    receipt.artifacts = r.products.map(p => ({ ...p, size: fs.statSync(p.path).size,
      generatedAt: fs.statSync(p.path).mtime.toISOString() }));
    receipt.environment = JSON.parse(ps("Get-CimInstance Win32_OperatingSystem|" +
      "Select-Object Caption,Version,BuildNumber,OSArchitecture|ConvertTo-Json -Compress"));
    receipt.status = "EVIDENCE_VERIFIED_CURRENT_NATIVE_CONTROLLED_RECOVERY_PASS";
    console.log(`PASS ${receipt.status}`);
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; console.error(receipt.error); }
  finally { receipt.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" }); }
}
if (process.argv[2] === "--test") selfTest(load(path.join(qa, `session-${process.argv[3] || "01"}/report.json`)));
else audit(process.argv[2], process.argv[3] || "01");
