"use strict";
// Read-only verification of this slice's raw artifacts; no product launches.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { qa, summary, exe, load, sha, desc } = require("./packaged-backend-continuation.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const names = [
  "actual-exe-asset-import-exact-bytes-and-invalid-update-rollback",
  "partial-failure-truthful-panel-and-manual-retry-only-failed-chapter",
  "pause-blocks-next-chapter-and-resume-continues-without-reprocessing",
  "cancel-discards-late-response-and-never-dispatches-queued-chapter",
  "actual-exe-restart-retains-job-results-project-graph-and-seven-asset-bytes",
];
function validate({ api, build, embedded }) {
  assert.equal(build.status, "CURRENT_PACKAGED_BACKEND_BUILD_SOURCE_MATCH_PASS");
  assert.deepEqual(build.tests, { tests: 120, errors: 0, failures: 0, skipped: 0 });
  assert.deepEqual(build.steps.map(s => s.label), ["source-regressions", "bounded-packaging",
    "official-sidecar-build", "embedded-current-source"]);
  for (const s of build.steps) {
    assert.equal(s.code, 0); assert.equal(s.status, "PASS"); assert(Number.isInteger(s.pid) && s.pid > 0);
    assert(Date.parse(s.finishedAt) >= Date.parse(s.startedAt));
  }
  assert.equal(build.built.sha256, build.dist.sha256);
  assert.equal(embedded.status, "PASS"); assert.equal(embedded.appModules, 71);
  assert.equal(embedded.launcherModules, 1); assert.equal(embedded.modules.length, 72);
  assert(embedded.modules.every(m => m.status === "PASS" && m.codeObjectEqual === true));
  assert.equal(embedded.sha256, build.built.sha256); assert.equal(embedded.afterSha256, embedded.sha256);
  assert.equal(embedded.applicationCodeExecuted, false);
  assert.equal(api.status, "CURRENT_PACKAGED_BACKEND_API_PASS"); assert(api.finishedAt);
  assert.equal(api.executable.sha256, embedded.sha256);
  assert.equal(api.scope, "COPIED_CURRENT_PACKAGED_BACKEND_REAL_HTTP_AND_SQLITE_NOT_INSTALLED_EDITOR");
  assert.equal(api.realModelRequests, 0); assert.equal(api.paidModelRequests, 0);
  assert.equal(api.protectedInputsUnchanged, true);
  for (const key of ["error", "cleanupError", "immutabilityError"]) assert(!api[key]);
  assert.deepEqual(api.cases.map(c => c.name), names);
  assert(api.cases.every(c => c.status === "PASS" && Date.parse(c.finishedAt) >= Date.parse(c.startedAt)));
  assert.equal(api.launches.length, 2); assert.equal(api.cleanups.length, 2);
  assert.notEqual(api.launches[0].pid, api.launches[1].pid);
  assert.equal(api.launches[0].database, api.database); assert.equal(api.launches[1].database, api.database);
  for (const launch of api.launches) {
    assert.equal(launch.cwd, path.dirname(api.executable.path));
    assert.equal(launch.executable.sha256, api.executable.sha256);
    assert.equal(launch.environment.AGENTVN_LEGACY_DATABASE_PATHS, "");
    assert(launch.environment.AGENTVN_BACKEND_DATA_DIR.startsWith(path.dirname(api.database)));
    assert.equal(launch.listeners.length, 1);
    const owner = api.known.find(p => p.ProcessId === launch.listeners[0].OwningProcess);
    assert(owner && path.resolve(owner.ExecutablePath) === api.executable.path);
  }
  for (const cleanup of api.cleanups) {
    assert.equal(cleanup.normalCloseClaimed, false); assert(cleanup.killed.length > 0);
    assert.deepEqual(cleanup.survivors, []); assert.deepEqual(cleanup.listeners, []);
  }
  assert.equal(api.providerCleanup.stopped, true); assert.equal(api.providerCleanup.held, 0);
  assert.equal(api.providerCleanup.requests, 6); assert.deepEqual(api.providerListenersAfterCleanup, []);
  assert.equal(api.controlledRequests.length, 6);
  assert.deepEqual(api.controlledRequests.map(m => m.input.chapterIndex), [0, 1, 1, 0, 1, 0]);
  assert.deepEqual(api.controlledRequests.map(m => m.input.bookId),
    ["packaged-partial", "packaged-partial", "packaged-partial", "packaged-pause", "packaged-pause", "packaged-cancel"]);
  assert.deepEqual(api.controlledRequests.map(m => m.outcome),
    ["completed", "failed", "completed", "completed", "completed", "completed"]);
  for (const m of api.controlledRequests) {
    assert(m.stream && m.released && m.finishedAt && !m.error && !m.disconnected);
    assert.equal(m.input.promptVersion, "novel-process-v3"); assert.equal(m.input.chunkIndex, 0);
  }
  assert.equal(api.completed.status, "completed"); assert.equal(api.completed.completedChunks, 2);
  assert.equal(api.completed.failedChunks, 0); assert.equal(api.completed.maxRetries, 0);
  assert.equal(api.completed.agentTasks.filter(t => t.chapterIndex === 0).length, 1);
  assert.equal(api.completed.agentTasks.filter(t => t.chapterIndex === 1).length, 2);
  assert.equal(api.pausedThenCompleted.status, "completed"); assert.equal(api.pausedThenCompleted.agentTasks.length, 2);
  assert.equal(api.cases[2].detail.paused.status, "paused"); assert.equal(api.cases[2].detail.paused.completedChunks, 1);
  assert.equal(api.cases[2].detail.paused.runningTasks, 0);
  assert.equal(api.cancelled.status, "cancelled"); assert.equal(api.cancelled.cancelledChunks, 2);
  assert.equal(api.cancelled.completedChunks, 0); assert.equal(api.cancelled.runningTasks, 0);
  assert.equal(api.cases[3].detail.result.completedResults.length, 0);
  assert.equal(api.cases[3].detail.result.completedChapterResults.length, 0);
  const phases = [
    ...api.cases[1].detail.failedPhases, ...api.cases[1].detail.finalPhases,
    ...api.cases[3].detail.phases, ...api.cases[4].detail.results.flatMap(j => j.phases),
  ];
  assert.equal(phases.length, 12);
  assert(phases.every(p => p.percent === 0 && ["waiting", "cancelled"].includes(p.status)));
  assert.equal(api.cases[4].detail.results.length, 3); assert.equal(api.cases[4].detail.graphUnchanged, true);
  const assets = api.cases[0].detail.consumed, restoredAssets = api.cases[4].detail.consumed;
  assert.equal(assets.length, 7); assert.equal(new Set(assets.map(a => a.id)).size, 7);
  assert.deepEqual(restoredAssets, assets);
  assert.equal(api.cases[0].detail.invalidUpdateStatus, 422);
  assert.equal(api.cases[0].detail.previousProjectPreserved, true);
  const mutations = api.http.filter(h => h.method !== "GET");
  assert.equal(mutations.filter(h => h.route === "/api/novel/processing/execute/jobs").length, 3);
  for (const action of ["retry_failed_chunks", "pause", "resume", "cancel"])
    assert.equal(mutations.filter(h => h.route.endsWith(`/${action}`)).length, 1);
  assert.equal(mutations.filter(h => h.status === 422).length, 1);
}
function negatives(data) {
  const mutations = [
    d => { d.api.cases = []; }, d => { d.api.cases[4].status = "NOT_RUN"; },
    d => { d.build.tests.skipped = 1; }, d => { d.build.steps[2].code = 1; },
    d => { d.build.steps = d.build.steps.slice(1); },
    d => { d.embedded.modules[0].codeObjectEqual = false; }, d => { d.embedded.modules.pop(); },
    d => { d.api.executable.sha256 = "unrelated-exe"; },
    d => { d.api.realModelRequests = 1; }, d => { d.api.cleanupError = "unproven"; },
    d => { d.api.controlledRequests.pop(); }, d => { d.api.controlledRequests[2].input.chapterIndex = 0; },
    d => { d.api.controlledRequests[5].error = "unknown-request"; },
    d => { d.api.cases[1].detail.finalPhases[0].percent = 100; },
    d => { d.api.cases[2].detail.paused.runningTasks = 1; },
    d => { d.api.cancelled.completedChunks = 1; },
    d => { d.api.cleanups[1].survivors.push({ pid: 1 }); },
    d => { d.api.cleanups[1].normalCloseClaimed = true; },
    d => { d.api.launches[1].database = "unrelated.db"; },
    d => { d.api.cases[4].detail.consumed[0].sha256 = "old-bytes"; },
    d => { d.api.cases[4].detail.results.pop(); },
    d => { d.api.cases[0].detail.previousProjectPreserved = false; },
    d => { d.api.providerListenersAfterCleanup.push({ OwningProcess: 1 }); },
    d => { d.api.http = d.api.http.filter(h => !h.route.endsWith("/cancel")); },
  ];
  for (const mutate of mutations) { const d = structuredClone(data); mutate(d); assert.throws(() => validate(d)); }
  return mutations.length;
}
function junit(file, tests, failures) {
  const suite = fs.readFileSync(file, "utf8").match(/<testsuite\s[^>]*>/)?.[0]; assert(suite);
  for (const [key, value] of Object.entries({ tests, errors: 0, failures, skipped: 0 }))
    assert.equal(Number(suite.match(new RegExp(`\\b${key}="(\\d+)"`))?.[1]), value);
  return desc(file);
}
function audit(apiName, buildName, auditName) {
  for (const [value, pattern] of [[apiName, /^api-\d{2}$/], [buildName, /^build-\d{2}$/], [auditName, /^audit-\d{2}$/]])
    assert(pattern.test(value));
  const out = path.join(qa, auditName); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const apiFile = path.join(qa, apiName, "report.json"), buildFile = path.join(qa, buildName, "report.json");
  const prep = load(path.join(summary, "preparation.json")), api = load(apiFile), build = load(buildFile);
  const embeddedFile = build.embeddedSource.path, embedded = load(embeddedFile);
  const data = { api, build, embedded }, r = { status: "RUNNING", at: new Date().toISOString(), checks: [] };
  function check(name, fn) { const detail = fn(); r.checks.push({ name, status: "PASS", detail }); }
  try {
    check("Nonempty business, provenance, failure, panel, restart and cleanup contracts", () => {
      validate(data); return { cases: 5, applicationModules: 71, launcher: 1, controlledRequests: 6 };
    });
    check("Bad evidence is rejected without relaxing behavior", () => ({ rejected: negatives(data) }));
    check("Exact raw artifacts, source hashes and protected frozen candidates remain unchanged", () => {
      const files = [desc(apiFile), desc(buildFile), build.embeddedSource, api.build, api.executable,
        api.input, api.testSource, api.finalDatabase, build.built, build.dist,
        ...build.steps.map(s => s.log), ...prep.frozen, ...prep.products, prep.original,
        ...prep.sources.filter(f => f.path.includes(`${path.sep}backend${path.sep}`) && f.path.endsWith(".py"))];
      for (const f of files) assert.equal(sha(f.path), f.sha256, f.path);
      assert.equal(sha(path.join(qa, apiName, "executed-test.cjs")), api.testSource.sha256);
      for (const item of prep.copied) assert.equal(sha(item.checkpoint.path), item.sha256);
      const original = load(path.join(qa, "embedded-before.json"));
      assert.equal(original.status, "FAILED");
      assert(original.modules.some(m => m.module === "app.api.routes_novel_process" && m.codeObjectEqual === false));
      for (const file of [exe, path.join(path.dirname(exe), "../../../backend/dist/creator-backend.exe")])
        assert.equal(sha(path.resolve(file)), build.built.sha256);
      return { verifiedFiles: files.length, frozen: prep.frozen, priorMismatchPreserved: true };
    });
    check("Original failure, reactivated regression and full no-skip source gate", () => ({
      red: junit(path.join(qa, "obsolete-test-red.xml"), 1, 1),
      green: junit(path.join(qa, "obsolete-test-green.xml"), 1, 0),
      complete: junit(path.join(qa, buildName, "source-regressions.xml"), 120, 0),
      oldGate: (() => {
        const old = load(path.join(qa, "build-01/report.json"));
        assert.equal(old.status, "FAILED"); assert.equal(old.tests.skipped, 1);
        return desc(path.join(qa, "build-01/report.json"));
      })(),
    }));
    check("SQLite read-only proof of persisted terminal jobs and original author graph", () => {
      const code = [
        "import json,sqlite3,sys,pathlib",
        "db=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
        "jobs=[json.loads(r[0]) for r in db.execute(\"SELECT value FROM novel_processing_records WHERE kind='executor_job' ORDER BY book_id\")]",
        "project=json.loads(db.execute('SELECT project_json FROM editor_project_details WHERE project_id=?',(sys.argv[2],)).fetchone()[0])",
        "counts={r[0]:r[1] for r in db.execute('SELECT kind,COUNT(*) FROM novel_processing_records GROUP BY kind')}",
        "print(json.dumps(dict(jobs=jobs,project=project,counts=counts),ensure_ascii=False));db.close()",
      ].join("\n");
      const fixture = load(prep.input.path), before = sha(api.database);
      const query = spawnSync("python", ["-c", code, api.database, fixture.project_id], {
        encoding: "utf8", timeout: 15000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      assert.equal(query.status, 0, query.stderr);
      const persisted = JSON.parse(query.stdout); assert.equal(persisted.jobs.length, 3);
      const jobs = [api.completed, api.pausedThenCompleted, api.cancelled];
      for (const job of jobs) {
        const actual = persisted.jobs.find(j => j.jobId === job.jobId); assert(actual);
        // Public API deliberately blanks the persisted test-only provider key.
        actual.providerSelection.api_key = ""; assert.deepEqual(actual, job);
      }
      assert.deepEqual(persisted.project.nodes, fixture.nodes); assert.deepEqual(persisted.project.edges, fixture.edges);
      assert.equal(sha(api.database), before, "Read-only verification must not mutate database bytes");
      const snapshot = path.join(out, "readonly-sqlite-proof.json");
      fs.writeFileSync(snapshot, JSON.stringify(persisted, null, 2), { flag: "wx" });
      return { snapshot: desc(snapshot), counts: persisted.counts };
    });
    check("Owned process identities and all backend/provider ports are now absent", () => {
      const now = rows(), identity = p => `${p.ProcessId}:${p.Created}`;
      assert(!api.known.some(p => now.some(n => identity(n) === identity(p))));
      const ports = [...api.launches.map(l => l.port), Number(new URL(api.controlledEndpoint).port)];
      assert.deepEqual(listeners(ports), []);
      return { processIdentities: api.known.length, ports };
    });
    assert.equal(r.checks.length, 6); r.status = "CURRENT_PACKAGED_BACKEND_LIMITED_ACCEPTANCE_AUDIT_PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    r.finishedAt = new Date().toISOString(); r.testSource = desc(__filename);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: r.status, out, checks: r.checks.length, error: r.error }));
  }
}
if (require.main === module) audit(...process.argv.slice(2));
module.exports = { validate };
