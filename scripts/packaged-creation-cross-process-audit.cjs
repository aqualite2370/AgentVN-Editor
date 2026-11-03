"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { qa, summary, exe, sha, desc, load } = require("./packaged-backend-continuation.cjs");
const { stages } = require("./packaged-creation-cross-process.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
function validate(r) {
  assert.equal(r.status, "CURRENT_PACKAGED_CREATION_CROSS_PROCESS_PASS");
  assert.equal(r.scope, "TWO_REAL_PACKAGED_BACKEND_EXES_SHARED_ISOLATED_DB_CONTROLLED_NATIVE_AGENT_NOT_EDITOR_OR_LIVE_MODEL");
  assert(r.finishedAt); assert.equal(r.realModelRequests, 0); assert.equal(r.paidModelRequests, 0);
  for (const k of ["error", "errorCause", "cleanupErrors", "immutabilityError"]) assert(!r[k]);
  assert.equal(r.protectedInputsUnchanged, true);
  assert.deepEqual(r.cases.map(c => c.name), stages);
  assert(r.cases.every(c => c.status === "PASS" && Date.parse(c.finishedAt) >= Date.parse(c.startedAt)));
  assert.equal(r.launches.length, 4); assert.equal(r.cleanups.length, 4);
  assert.equal(new Set(r.launches.map(l => `${l.pid}/${l.created}`)).size, 4);
  for (const l of r.launches) {
    assert.equal(l.database, r.database); assert.equal(l.executable.sha256, r.executable.sha256);
    assert.equal(l.cwd, path.dirname(r.executable.path)); assert.equal(l.listeners.length, 1);
    assert(r.known.some(p => p.ProcessId === l.listeners[0].OwningProcess &&
      path.resolve(p.ExecutablePath) === r.executable.path));
  }
  assert.notEqual(r.launches[0].listeners[0].OwningProcess, r.launches[1].listeners[0].OwningProcess);
  assert.equal(r.cases[0].detail.task.projectId, "packaged-cross-a");
  assert.equal(r.cases[0].detail.task.status, "running");
  for (const c of r.cleanups) {
    assert.equal(c.normalCloseClaimed, false); assert(c.killed.length > 0);
    assert.deepEqual(c.survivors, []); assert.deepEqual(c.listeners, []);
  }
  assert.equal(r.providerCleanup.stopped, true); assert.equal(r.providerCleanup.requests, 7);
  assert.equal(r.providerCleanup.maxConcurrentCreation, 1); assert.deepEqual(r.providerListenersAfterCleanup, []);
  const markers = ["QUEUE_A", "QUEUE_B", "QUEUE_D", "PEER_A", "PEER_B", "INTERRUPTED_A", "RESUME_A"];
  assert.deepEqual(r.controlledRequests.map(p => p.marker), markers);
  for (const p of r.controlledRequests) {
    assert(p.creation && !p.stream && p.tools.includes("submit_assistant_component_draft"));
    assert(p.finishedAt >= p.startedAt);
  }
  assert.equal(r.cases[1].detail.maxConcurrentCreation, 1);
  assert.deepEqual(r.cases[1].detail.order, ["QUEUE_A", "QUEUE_B", "QUEUE_D"]);
  assert.equal(r.cases[1].detail.cancelledQueued.status, "cancelled");
  assert.equal(r.cases[2].detail.result.status, "cancelled"); assert(!r.cases[2].detail.result.result);
  for (const key of ["runningFailure", "queuedFailure"]) {
    assert.equal(r.cases[3].detail[key].status, "failed");
    assert.equal(r.cases[3].detail[key].errorCode, "worker_lost");
    assert(!r.cases[3].detail[key].result);
  }
  assert.equal(r.cases[3].detail.survivor.status, "completed");
  assert.equal(r.cases[4].detail.result.status, "cancelled");
  assert.equal(r.cases[4].detail.result.errorCode, "worker_lost");
  assert(!r.cases[4].detail.result.result);
  assert.equal(r.cases[4].detail.recovered.status, "completed");
  assert.equal(r.cases[4].detail.noReplayedRequest, true);
  assert.equal(r.finalTasks.length, 9);
  assert.deepEqual(r.finalTasks.map(p => [p.id, p.status]), r.cases[5].detail.expected);
  assert.equal(r.cases[5].detail.projectsUnchanged, true);
  assert.equal(r.cases[5].detail.modelRequests, 7);
  assert.equal(r.initialProjects.length, 2);
  assert(r.snapshots.length >= 10);
  for (const s of r.snapshots) assert(s.processes.filter(p => ["running", "cancelling"].includes(p.status)).length <= 1);
  assert(r.http.length > 0 && r.http.every(h => [200, 202].includes(h.status)));
  const submits = r.http.filter(h => h.method === "POST" && h.route === "/api/assistant/creation/processes");
  assert.equal(submits.length, 9);
  assert.equal(r.http.filter(h => h.method === "POST" && h.route.endsWith("/cancel")).length, 3);
  assert(submits.some(h => h.label === "first") && submits.some(h => h.label === "second"));
}
function negative(r) {
  const mutations = [
    d => { d.cases = []; }, d => { d.cases[5].status = "NOT_RUN"; },
    d => { d.scope = "TWO_FRONTEND_WINDOWS"; }, d => { d.realModelRequests = 1; },
    d => { d.launches[1].listeners[0].OwningProcess = d.launches[0].listeners[0].OwningProcess; },
    d => { d.launches[1].database = "different.sqlite"; },
    d => { d.providerCleanup.maxConcurrentCreation = 2; },
    d => { d.controlledRequests[1].marker = "QUEUE_D"; },
    d => { d.controlledRequests.push(structuredClone(d.controlledRequests[0])); },
    d => { d.controlledRequests[0].tools = []; },
    d => { d.cases[3].detail.runningFailure.status = "completed"; },
    d => { d.cases[3].detail.queuedFailure.errorCode = "unknown"; },
    d => { d.cases[4].detail.result.status = "failed"; },
    d => { d.cases[2].detail.result.result = {}; },
    d => { d.finalTasks.pop(); }, d => { d.cases[5].detail.projectsUnchanged = false; },
    d => { d.cleanups[0].survivors = [{ pid: 1 }]; },
    d => { d.cleanups[0].normalCloseClaimed = true; },
    d => { d.snapshots[0].processes.push({ id: "impossible", status: "running" }); },
    d => { d.protectedInputsUnchanged = false; },
    d => { d.providerListenersAfterCleanup = [{ port: 1 }]; },
    d => { d.http = d.http.filter(h => !h.route.endsWith("/cancel")); },
  ];
  for (const mutate of mutations) { const copy = structuredClone(r); mutate(copy); assert.throws(() => validate(copy)); }
  return mutations.length;
}
function audit(name, auditName) {
  assert(/^creation-\d{2}$/.test(name)); assert(/^creation-audit-\d{2}$/.test(auditName));
  const out = path.join(qa, auditName); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(qa, name, "report.json"), r = load(file);
  const prep = load(path.join(summary, "preparation.json"));
  const result = { status: "RUNNING", at: new Date().toISOString(), report: desc(file), checks: [] };
  function check(name, fn) { const detail = fn(); result.checks.push({ name, status: "PASS", detail }); }
  try {
    check("Six nonempty cross-EXE behavior contracts and ordering", () => {
      validate(r); return { tasks: 9, controlledRequests: 7, independentBackendLaunches: 4 };
    });
    check("Invalid multi-process evidence is rejected", () => ({ rejected: negative(r) }));
    check("EXE, executed test, source and protected artifacts retain exact bytes", () => {
      const files = [r.executable, r.testSource, r.finalDatabase, ...prep.frozen, ...prep.products, prep.input,
        ...prep.sources.filter(f => f.path.includes(`${path.sep}backend${path.sep}`) && f.path.endsWith(".py"))];
      for (const f of files) assert.equal(sha(f.path), f.sha256, f.path);
      assert.equal(sha(exe), r.executable.sha256);
      assert.equal(sha(path.join(qa, name, "executed-test.cjs")), r.testSource.sha256);
      return { verifiedFiles: files.length };
    });
    check("Read-only SQLite proves nine final rows, cleared payloads and unchanged author data", () => {
      const before = sha(r.database);
      const code = [
        "import sqlite3,json,pathlib,sys",
        "db=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
        "tasks=[]",
        "for row in db.execute('SELECT sequence,id,project_id,status,payload_json,result_json,error_code FROM assistant_creation_processes ORDER BY sequence'):",
        " tasks.append(dict(sequence=row[0],id=row[1],projectId=row[2],status=row[3],payloadEmpty=json.loads(row[4])=={},result=json.loads(row[5]) if row[5] else None,errorCode=row[6]))",
        "projects=[json.loads(row[0]) for row in db.execute('SELECT project_json FROM editor_project_details ORDER BY project_id')]",
        "print(json.dumps(dict(tasks=tasks,projects=projects),ensure_ascii=False));db.close()",
      ].join("\n");
      const queried = spawnSync("python", ["-c", code, r.database], { encoding: "utf8", windowsHide: true,
        timeout: 15000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      assert.equal(queried.status, 0, queried.stderr);
      const actual = JSON.parse(queried.stdout);
      assert.equal(actual.tasks.length, 9); assert.equal(actual.projects.length, 2);
      assert.deepEqual(actual.tasks.map(t => [t.id, t.status]), r.cases[5].detail.expected);
      assert(actual.tasks.every(t => t.payloadEmpty));
      for (const t of actual.tasks) {
        if (t.status === "completed") {
          assert.equal(t.result.components.length, 1); assert.equal(t.result.edits.length, 0);
        } else assert.equal(t.result, null);
      }
      for (const p of actual.projects) {
        const initial = r.initialProjects.find(v => v.project_id === p.project_id); assert(initial);
        for (const k of ["nodes", "edges", "editor_settings"]) assert.deepEqual(p[k], initial[k]);
        const technical = assets => assets.map(a => ({ ...a, metadata: { ...a.metadata, url: undefined } }));
        assert.deepEqual(technical(p.asset_manifest), technical(initial.asset_manifest));
        for (const a of initial.asset_manifest) assert.equal(sha(a.metadata.filePath), sha(
          p.asset_manifest.find(item => item.asset_id === a.asset_id).metadata.filePath));
      }
      assert.equal(sha(r.database), before);
      const snapshot = path.join(out, "readonly-sqlite-proof.json");
      fs.writeFileSync(snapshot, JSON.stringify(actual, null, 2), { flag: "wx" });
      return { snapshot: desc(snapshot), finalStatuses: actual.tasks.map(t => t.status) };
    });
    check("All recorded worker identities and backend/model ports are absent", () => {
      const now = rows(), identity = p => `${p.ProcessId}:${p.Created}`;
      assert(!r.known.some(p => now.some(n => identity(n) === identity(p))));
      const ports = [...r.launches.map(l => l.port), Number(new URL(r.controlledEndpoint).port)];
      assert.deepEqual(listeners(ports), []);
      return { identities: r.known.length, ports };
    });
    assert.equal(result.checks.length, 5);
    result.status = "CURRENT_PACKAGED_CREATION_CROSS_PROCESS_AUDIT_PASS";
  } catch (e) { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    result.finishedAt = new Date().toISOString(); result.testSource = desc(__filename);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: result.status, out, checks: result.checks.length, error: result.error }));
  }
}
if (require.main === module) audit(...process.argv.slice(2));
module.exports = { validate };
