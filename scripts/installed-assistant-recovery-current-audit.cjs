"use strict";
// Read-only evidence audit after all exact-owned processes have exited.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { qa, stages, readDb } = require("./installed-assistant-recovery-current.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const currentCandidate = process.argv.includes("--candidate=1.9.22"), expectedVersion = currentCandidate ? "1.9.22" : "1.9.14";
const root = path.resolve(__dirname, ".."), id = p => `${p.ProcessId}:${p.Created}`;
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function validate(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt); assert.equal(r.version, expectedVersion);
  if (currentCandidate) {
    assert(r.cacheRestoration === "PASS" && !r.cacheError);
    assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]);
    assert(r.cache.every(c => c.exitCode === 0));
  }
  assert.equal(r.scope, "ACTUAL_NSIS_TWO_NATIVE_HOSTS_PACKAGED_BACKEND_CONTROLLED_MODEL_OWNED_DEATH_INJECTION");
  assert.deepEqual(r.cases.map(c => c.name), stages); assert(r.cases.every(c => c.status === "PASS" && c.finishedAt >= c.startedAt));
  for (const k of ["cleanupError", "peerCleanupError", "credentialCleanupError", "immutabilityError"]) assert(!r[k]);
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.equal(r.blockedModelRequests, 0); assert.deepEqual(r.errors, []); assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  assert.match(r.modelEndpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  const resumed = Boolean(r.continuation), primaryCount = resumed ? 5 : 4;
  if (resumed) {
    assert.deepEqual(r.continuation.completedCaseIndices, [0, 1, 2]);
    assert(r.continuation.originalFailedStatusPreserved);
    assert.equal(r.continuation.inheritedControlledRequests, 3);
    assert.equal(r.continuation.additionalControlledRequestBudget, 1);
    assert.equal(r.inheritedModelBoundary.length, 3); assert.equal(r.localModelBoundary.length, 1);
    assert.equal(r.localModelBoundary[0].marker, "INTERRUPTED_C");
    assert.deepEqual(r.modelBoundary, [...r.inheritedModelBoundary, ...r.localModelBoundary]);
    assert.equal(r.clones.length, 3); assert(r.originalDatabase.sha256);
    for (const [i, c] of r.cases.entries()) {
      if (i < 3) {
        assert.equal(c.inheritedFrom.path, r.continuation.path); assert.equal(c.inheritedFrom.sha256, r.continuation.sha256);
        assert.equal(c.inheritedFrom.caseIndex, i);
      } else assert(!c.inheritedFrom);
    }
  }
  assert.equal(r.launches.length, primaryCount); assert.equal(r.peerLaunches.length, 5);
  assert.equal(r.cleanups.length, primaryCount); assert.equal(r.peerCleanups.length, 5);
  assert.equal(new Set(r.launches.map(l => `${l.pid}:${l.created}`)).size, primaryCount);
  assert.equal(new Set(r.peerLaunches.map(l => `${l.pid}:${l.created}`)).size, 5);
  assert.equal(new Set(r.launches.map(l => l.data)).size, resumed ? 2 : 1);
  assert.equal(new Set(r.launches.map(l => l.webview)).size, resumed ? 2 : 1);
  assert.equal(new Set(r.peerLaunches.map(l => l.webview)).size, resumed ? 2 : 1);
  for (const l of r.launches) {
    assert(l.created && l.backend.sha256); assert.equal(l.ports.length, 2); assert.equal(l.listeners.length, 2);
    assert(!l.sourceServer && !l.manualBackendSpawn && l.dataDirectoryOverride && l.webviewDirectoryOverride);
    assert(l.isolation.AGENTVN_TEST_PROJECT.startsWith(path.resolve(qa)));
    assert(l.isolation.AGENTVN_WORKSPACE_OUTPUT.startsWith(path.resolve(qa)));
  }
  for (const p of r.peerLaunches) {
    assert(p.created); assert(!r.launches.some(l => `${l.pid}:${l.created}` === `${p.pid}:${p.created}`));
    assert(p.verified.sameBackend && p.verified.distinctProfile && p.verified.packagedBackend && p.verified.noPeerBackendChild);
    assert.equal(p.verified.realNativePid, p.pid); assert.equal(p.reusedServices.length, 2);
    const l = r.launches.find(l => l.ports[0] === p.backendPort); assert(l);
    assert.notEqual(p.webview, l.webview); assert.equal(p.data, l.data);
    assert.deepEqual(p.reusedServices, l.listeners);
    const u = new URL(p.verified.observation.url);
    assert.equal(u.origin, `http://127.0.0.1:${p.backendPort}`); assert.equal(u.pathname, "/api/project/state");
    assert(p.verified.observation.ok);
  }
  for (const c of r.cleanups) assert(c.status === "PASS" && !c.normalCloseClaimed && c.killed.length > 0);
  for (const c of r.peerCleanups) {
    assert(!c.normalExitClaimed && c.killed.length > 0); assert.equal(c.survivors.length, 0); assert.equal(c.listeners.length, 0);
  }
  assert.equal(r.submissions.length, 5); assert.equal(new Set(r.submissions.map(s => s.id)).size, 5);
  assert.deepEqual(r.submissions.map(s => s.userRequest.split(" ")[0]), ["RESUME_A", "PEER_A", "INTERRUPTED_A", "INTERRUPTED_B", "INTERRUPTED_C"]);
  const owner = r.submissions[0].projectId, other = r.submissions[3].projectId; assert.notEqual(owner, other);
  assert(r.submissions.filter((_, i) => i !== 3).every(s => s.projectId === owner && /^peer-/.test(s.hostLabel)));
  assert.match(r.submissions[3].hostLabel, /^primary-/);
  assert.equal(r.controlledWrites.length, resumed ? 2 : 7); assert(r.controlledWrites.every(w => w.endpoint === r.modelEndpoint));
  assert.equal(r.controlledWrites.filter(w => w.path === "/api/assistant/creation/processes").length, resumed ? 1 : 5);
  const cancelIds = r.controlledWrites.filter(w => w.path.endsWith("/cancel")).map(w => w.path.split("/").at(-2));
  assert.deepEqual(cancelIds, resumed ? [r.submissions[4].id] : [r.submissions[1].id, r.submissions[4].id]);
  assert.equal(r.modelBoundary.length, 4);
  assert.deepEqual(r.modelBoundary.map(m => m.marker), ["RESUME_A", "PEER_A", "INTERRUPTED_A", "INTERRUPTED_C"]);
  assert(r.modelBoundary.every(m => m.creation && m.tools.includes("submit_assistant_component_draft") && m.finishedAt >= m.startedAt));
  for (let i = 1; i < r.modelBoundary.length; i++) assert(r.modelBoundary[i].startedAt >= r.modelBoundary[i - 1].finishedAt);
  assert(r.providerCleanup.stopped); assert.equal(r.providerCleanup.requests, resumed ? 1 : 4);
  assert.equal(r.providerCleanup.maxConcurrentCreation, 1);
  assert.equal(r.modelCheckpoints.length, 7);
  assert.deepEqual(r.modelCheckpoints.at(-1).counts, { RESUME_A: 1, PEER_A: 1, INTERRUPTED_A: 1, INTERRUPTED_B: 0, INTERRUPTED_C: 1 });
  assert.equal(r.faults.length, 2);
  assert.deepEqual(r.faults.map(f => f.name), ["running-and-queued-worker-death", "cancelling-worker-death"]);
  for (const f of r.faults) {
    assert(!f.naturalCrashClaimed && f.backendIdentities.length > 0); assert(f.backendIdentities.every(p => p.Name === "creator-backend.exe"));
    assert.deepEqual(f.missingIdentities, f.backendIdentities.map(id));
  }
  const pre = r.faults[0].preTasks;
  const running = pre.find(t => t.id === r.submissions[2].id), queued = pre.find(t => t.id === r.submissions[3].id);
  assert.equal(running.status, "running"); assert.equal(queued.status, "queued"); assert.equal(running.ownerPid, queued.ownerPid);
  assert(r.faults[0].backendIdentities.some(p => p.ProcessId === running.ownerPid));
  assert.equal(r.faults[1].preTasks.find(t => t.id === r.submissions[4].id).status, "cancelling");
  assert.equal(r.cases[1].detail.requests, 1); assert.notEqual(r.cases[1].detail.oldPid, r.cases[1].detail.newPid);
  const g = r.cases[2].detail.geometry; assert(g.hit && g.focus && g.overflow <= 1 &&
    g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= 1921 && g.rect.bottom <= 1081);
  assert.notEqual(r.cases[2].detail.submittingPid, r.cases[2].detail.cancellingPid);
  assert.equal(r.cases[3].detail.finals.length, 2);
  assert(r.cases[3].detail.finals.every(f => f.status === "failed" && f.errorCode === "worker_lost"));
  assert.equal(r.cases[3].detail.automaticResubmissions, 0);
  assert.equal(r.cases[4].detail.final.status, "cancelled"); assert.equal(r.cases[4].detail.final.errorCode, "worker_lost");
  assert(r.cases[5].detail.oldDraftRetained);
  assert.deepEqual(r.cases[5].detail.statuses.map(t => t.status), ["completed", "cancelled", "failed", "failed", "cancelled"]);
  assert.equal(r.dbSnapshots.length, 8); assert.equal(r.screenshots.length, 6); assert.equal(r.errorMatrix.length, 12);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after); validateNativeViewport(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
    assert.equal(s.png.width, 1920); assert.equal(s.png.height, 1080);
  }
  const keys = new Set();
  for (const m of r.errorMatrix) {
    assert([1920, 2560, 3840].includes(m.width)); assert.equal(m.height, m.width * 9 / 16);
    assert([1, 2].includes(m.dpr)); assert.equal(typeof m.reduced, "boolean"); validateNativeViewport(m.viewport, m);
    const key = `${m.width}/${m.dpr}/${m.reduced}`; assert(!keys.has(key)); keys.add(key);
    const g = m.geometry, rect = g.rect; assert(g.hit && g.focus && g.enabled && g.overflow <= 1 &&
      rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= m.width + 1 && rect.bottom <= m.height + 1);
  }
  for (const w of [1920, 2560, 3840]) for (const d of [1, 2]) for (const reduced of [false, true]) assert(keys.has(`${w}/${d}/${reduced}`));
  assert(!r.finalCleanup.normalExitClaimed); assert.equal(r.finalCleanup.survivors.length, 0); assert.equal(r.finalCleanup.listeners.length, 0);
  return { cases: 6, inheritedCases: resumed ? 3 : 0, newlyExecutedCases: resumed ? 3 : 6,
    primaryStarts: primaryCount, peerStarts: 5, errorDisplayCases: 12, controlledRequestsCombined: 4,
    controlledRequestsThisContinuation: resumed ? 1 : 4, realModelRequests: 0 };
}
async function main() {
  const [attempt = "03", audit = "01"] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const runRoot = path.join(qa, `session-${attempt}`), out = path.join(qa, `audit-${audit}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(runRoot, "report.json"), r = read(file), prep = read(path.join(qa, "preparation.json"));
  const receipt = { status: "RUNNING", at: new Date().toISOString(), report: desc(file), groups: [] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(receipt, null, 2));
  async function check(name, fn) {
    const row = { name, status: "RUNNING" }; receipt.groups.push(row); save();
    try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
  }
  try {
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    await check("Complete installed recovery semantics and invalid-evidence controls", () => {
      const coverage = validate(r), mutations = [
        x => { x.cases = []; }, x => { delete x.finishedAt; }, x => { x.realModelRequests = 1; },
        x => { x.launches[0].sourceServer = true; }, x => { x.peerLaunches[0].verified.packagedBackend = false; },
        x => { x.peerLaunches[0].webview = x.launches[0].webview; },
        x => { x.peerLaunches[0].verified.observation.url = "http://127.0.0.1:1/api/project/state"; },
        x => { x.peerLaunches[0].reusedServices[0].OwningProcess++; },
        x => { x.cleanups[0].normalCloseClaimed = true; }, x => { x.peerCleanups[0].survivors.push({}); },
        x => { x.modelBoundary[0].tools = []; }, x => { x.modelBoundary.push(x.modelBoundary[0]); },
        x => { x.modelCheckpoints.at(-1).counts.INTERRUPTED_B = 1; }, x => { x.providerCleanup.maxConcurrentCreation = 2; },
        x => { x.faults[0].preTasks.find(t => t.status === "queued").status = "completed"; },
        x => { x.faults[1].naturalCrashClaimed = true; }, x => { x.cases[3].detail.finals[0].errorCode = "provider_error"; },
        x => { x.cases[4].detail.final.status = "completed"; }, x => { x.cases[2].detail.geometry.hit = false; },
        x => { x.errorMatrix = []; }, x => { x.errorMatrix[0] = x.errorMatrix[1]; },
        x => { x.errorMatrix[0].geometry.enabled = false; }, x => { x.errorMatrix[0].viewport.dpr = 1.5; },
        x => { x.screenshots[0].png.width /= 2; }, x => { x.dbSnapshots = []; },
        x => { x.credentialCleanup = "NOT_CLEARED"; }, x => { x.finalCleanup.listeners.push({}); },
      ];
      for (const mutate of mutations) { const bad = structuredClone(r); mutate(bad); assert.throws(() => validate(bad)); }
      return { ...coverage, invalidEvidenceVariantsRejected: mutations.length };
    });
    await check("Actual NSIS receipt, installed host/backend and exact protected bytes", () => {
      assert.equal(sha(r.installation.path), r.installation.sha256);
      const install = read(r.installation.path); assert(install.status === "PASS" && install.metadataRestoration === "PASS");
      for (const l of [...r.launches, ...r.peerLaunches]) assert.equal(l.executable.sha256, install.executable.sha256);
      for (const l of r.launches) {
        assert.equal(path.resolve(l.backend.ExecutablePath), path.resolve(install.installRoot, "creator-backend.exe"));
        assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
      }
      for (const f of [...r.products, ...r.sources, ...r.inputs, ...r.tools, ...r.dbSnapshots]) assert.equal(sha(f.path), f.sha256, f.path);
      for (const f of r.tools) assert.equal(sha(path.join(runRoot, path.basename(f.path))), f.sha256);
      const originalPath = path.join(qa, "session-01/report.json");
      if (!currentCandidate) {
        const original = read(originalPath);
        assert.equal(original.status, "FAILED"); assert.match(original.error, /waitForResponse.*Timeout/);
        assert.equal(original.modelBoundary.length, 0); assert.equal(original.finalCleanup.survivors.length, 0);
        assert.equal(original.finalCleanup.listeners.length, 0);
      } else {
        const restoration = read(path.join(runRoot, "native-cache-restoration.json"));
        assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
        for (const f of restoration.originalFiles)
          assert.equal(sha(path.join(restoration.originalDirectory, f.relative)), f.sha256);
      }
      if (r.continuation) {
        assert.equal(sha(r.continuation.path), r.continuation.sha256);
        const p = read(r.continuation.path); assert.equal(p.status, "FAILED");
        assert.equal(p.blockedModelRequests, 0); assert.equal(p.realModelRequests, 0);
        assert.deepEqual(p.errors, []); assert.match(p.error, /errorVisible/);
        for (const [i, c] of r.cases.slice(0, 3).entries()) {
          const { inheritedFrom, ...originalCase } = c; assert.deepEqual(originalCase, p.cases[i]);
        }
        for (const key of ["launches", "cleanups", "peerLaunches", "peerCleanups", "faults", "dbSnapshots",
          "screenshots", "submissions", "modelCheckpoints"]) assert.deepEqual(r[key].slice(0, p[key].length), p[key]);
        assert.deepEqual(r.inheritedModelBoundary, p.modelBoundary);
        assert.deepEqual(r.inheritedProcesses, [...p.knownProcesses, ...p.peerKnown]);
        assert.equal(p.providerCleanup.requests, 3); assert.equal(p.providerCleanup.maxConcurrentCreation, 1); assert(p.providerCleanup.stopped);
        assert.equal(p.controlledWrites.length, 5);
        assert(p.controlledWrites.every(w => w.endpoint === p.modelEndpoint));
        assert.equal(sha(r.originalDatabase.path), r.originalDatabase.sha256);
        for (const f of p.tools) {
          // Parent runner revision is intentionally preserved, not rewritten to current bytes.
          assert.equal(sha(path.join(path.dirname(r.continuation.path), path.basename(f.path))), f.sha256);
        }
      }
      const diagnostics = (currentCandidate ? [] : ["01", "02"]).map(n => {
        const file = path.join(qa, `diagnostic-${n}`, "report.json"), d = read(file);
        assert.equal(d.status, "FAILED"); assert.equal(d.modelRequests, 0);
        assert.equal(d.residue.processes.length, 0); assert.equal(d.residue.listeners.length, 0);
        assert.equal(sha(d.parent.path), d.parent.sha256);
        assert.equal(sha(d.originalDatabase.path), d.originalDatabase.sha256);
        if (n === "01") assert.match(d.error, /worker_lost/);
        else {
          assert.match(d.error, /assert\(conversation\)/); assert.equal(d.cases.length, 1);
          assert.equal(d.cases[0].status, "PASS"); assert.equal(d.cases[0].apiErrorCode, "worker_lost");
          assert.match(d.cases[0].actualFailureDetails, /停止.*重复调用模型/);
          assert.match(d.cases[0].savedConversation.lastAssistant, /无法连接后端服务/);
        }
        return desc(file);
      });
      return { originalFailure: currentCandidate ? undefined : desc(originalPath), diagnosticsPreserved: diagnostics,
        qualification: currentCandidate ?
          "Current per-task failure details match the actual worker_lost API state; no legacy diagnostic claim." :
          "Saved chat retains old transport error; explicit task failure details provide correct current worker_lost cause.",
        protectedDistinctPaths: new Set(r.products.map(f => path.resolve(f.path))).size };
    });
    await check("Real SQLite copy proves durable terminal states, scrubbed payloads and untouched projects", () => {
      // Continuations intentionally keep the failed original profile untouched.
      // Inspect the final clone, never the inherited first launch's database.
      const source = path.join(r.launches.at(-1).data, "backend"), sqlite = path.join(out, "sqlite"); fs.mkdirSync(sqlite);
      for (const n of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
        const original = path.join(source, n); if (!fs.existsSync(original)) continue;
        const copy = path.join(sqlite, n); fs.copyFileSync(original, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(copy), sha(original));
      }
      const final = readDb(path.join(sqlite, "vn_engine.db"));
      assert.deepEqual(final, read(r.dbSnapshots.find(s => s.name === "final-terminal-durable").path));
      assert.equal(final.tasks.length, 5); assert(final.tasks.every(t => t.payloadEmpty));
      assert.deepEqual(final.tasks.map(t => t.status), ["completed", "cancelled", "failed", "failed", "cancelled"]);
      assert(final.tasks.slice(2).every(t => t.error_code === "worker_lost"));
      assert(final.tasks[0].hasResult && final.tasks.slice(1).every(t => !t.hasResult));
      for (const p of final.projects) {
        const original = r.baseline[p.project_id]; assert(original);
        for (const k of ["editor_settings", "edges", "asset_manifest"]) assert.deepEqual(p[k], original[k]);
        const authored = nodes => nodes.map(({ measured, ...n }) => n); assert.deepEqual(authored(p.nodes), authored(original.nodes));
      }
      const db = new DatabaseSync(path.join(sqlite, "vn_engine.db"), { readOnly: true });
      try { assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM editor_shared_state WHERE key=?").get("provider_secrets").value), {}); }
      finally { db.close(); }
      const f = path.join(out, "persisted-projects-and-tasks.json"); fs.writeFileSync(f, JSON.stringify(final, null, 2), { flag: "wx" });
      return { persisted: desc(f), projectsUnchanged: 2, taskStatuses: final.tasks.map(t => ({ status: t.status, errorCode: t.error_code })),
        payloadsEmpty: true, syntheticSecretEmpty: true };
    });
    await check("PNG bytes and actual screenshot viewport/DPR/media are consistent", () => {
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256); const b = fs.readFileSync(s.path);
        assert.equal(b.readUInt32BE(16), s.png.width); assert.equal(b.readUInt32BE(20), s.png.height);
      }
      return { screenshots: r.screenshots.length, physicalInputOrPhysical4kClaimed: false };
    });
    await check("Every primary, peer, worker identity and host/provider port is absent", () => {
      const supplements = (currentCandidate ? [] : ["session-01", "diagnostic-01", "diagnostic-02"])
        .map(n => read(path.join(qa, n, "report.json")));
      const all = [...(r.inheritedProcesses || []), ...r.knownProcesses, ...r.peerKnown,
        ...supplements.flatMap(s => [...(s.knownProcesses || []), ...(s.peerKnown || [])])];
      const ports = [...new Set([...r.finalCleanup.ports, ...supplements.flatMap(s =>
        s.finalCleanup?.ports || s.launches.flatMap(l => l.ports))])];
      const live = rows(), keys = new Set(all.map(id));
      assert(!live.some(p => keys.has(id(p)))); assert.equal(listeners(ports).length, 0);
      assert(!live.some(p => p.Name === "msedgewebview2.exe" && p.CommandLine?.includes(runRoot)));
      return { processIdentitiesAbsent: keys.size, portsAbsent: ports, userFilesDeleted: 0,
        includedPriorFailuresAndZeroModelDiagnostics: !currentCandidate };
    });
    await check("Recoverable checkpoints and unchanged Git HEAD/index", () => {
      for (const f of prep.snapshots) assert.equal(sha(f.path), f.sha256);
      const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }); assert.equal(git.status, 0);
      assert.equal(git.stdout.trim(), prep.git.head); assert.equal(sha(prep.git.index.path), prep.git.index.sha256);
      return { snapshots: prep.snapshots.length, head: prep.git.head, indexUnchanged: true, pushed: false };
    });
    assert.equal(receipt.groups.length, 6); receipt.status = "PASS";
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; }
  finally { receipt.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: receipt.status, out, error: receipt.error })); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
