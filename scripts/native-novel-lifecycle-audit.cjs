"use strict";
// Independent read-only artifact and SQLite audit; no host/model requests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { qa, summary } = require("./native-novel-lifecycle.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const stages = ["real-entry-preflight-cancel-without-fake-task", "real-chapter-selection-submit-held-executor",
  "pause-resume-real-backend-without-duplicate-submission", "a-b-a-late-success-keeps-graph-and-task-ownership",
  "view-results-from-options-real-edit-focus-and-idempotence", "native-portable-save-real-backend-and-host-restart"];
function validate(r) {
  assert.equal(r.status, "CURRENT_NATIVE_NOVEL_LIFECYCLE_PASS"); assert(r.finishedAt);
  assert.equal(r.scope, "CURRENT_NATIVE_DEV_CONTROLLED_MODEL_REAL_EXECUTOR_NOT_RELEASE_OR_DEEPSEEK");
  assert.deepEqual(r.viewport, { width: 1920, height: 1080, dpr: 1, reduced: false });
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.deepEqual(r.cases.map(c => c.name), stages);
  assert(r.cases.every(c => c.status === "PASS" && Date.parse(c.finishedAt) >= Date.parse(c.startedAt)));
  assert.deepEqual(r.errors, []); assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  for (const k of ["error", "cleanupError", "credentialCleanupError", "immutabilityError"]) assert(!r[k]);
  assert.equal(r.inputs.length, 2); assert.notEqual(r.inputs[0].id, r.inputs[1].id);
  assert.match(r.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.equal(r.modelBoundary.length, 1); assert.equal(r.modelRequests, 1);
  const m = r.modelBoundary[0]; assert(m.stream && m.released && !m.error);
  assert.equal(m.input.promptVersion, "novel-process-v3");
  assert.equal(m.input.chapterIndex, 0); assert.equal(m.input.chunkIndex, 0);
  assert.equal(m.input.chunkText.includes("雨停了"), true); assert(m.finishedAt);
  assert.equal(r.providerCleanup.requests, 1); assert(r.providerCleanup.stopped); assert.equal(r.providerCleanup.held, 0);
  assert.equal(r.launches.length, 2); assert.equal(r.cleanups.length, 2);
  assert.notEqual(r.launches[0].pid, r.launches[1].pid);
  assert.equal(r.launches[0].data, r.launches[1].data); assert.equal(r.launches[0].webview, r.launches[1].webview);
  for (const c of r.cleanups) {
    assert.equal(c.normalExitClaimed, false); assert(c.killed.length > 0);
    assert.equal(c.survivors.length, 0); assert.equal(c.listeners.length, 0);
  }
  const posts = r.http.filter(q => q.event === "request" && q.method === "POST");
  assert.equal(posts.filter(q => q.path === "/api/novel/processing/execute/jobs").length, 1);
  for (const name of ["pause", "resume"])
    assert.equal(posts.filter(q => q.path === `/api/novel/processing/execute/jobs/${r.jobId}/${name}`).length, 1);
  assert.equal(posts.length, 3, "Unexpected model/novel API submission");
  assert(r.http.filter(q => q.event === "response").every(q => q.status >= 200 && q.status < 300));
  assert.equal(r.completedJob.jobId, r.jobId); assert.equal(r.completedJob.status, "completed");
  assert.equal(r.completedJob.chunks.length, 1); assert.equal(r.completedJob.completedChunks, 1);
  assert.equal(r.results.completedChapterResults.length, 1);
  const a = r.inputs[0].id, b = r.inputs[1].id;
  const observations = r.reads.map(r => r.state);
  assert(observations.some(s => s.projectId === a && s.card.some(c => c.status === "running")));
  assert(observations.filter(s => s.projectId === b).length >= 2);
  for (const s of observations.filter(s => s.projectId === b)) {
    assert.equal(s.processing.jobs.length, 0); assert.equal(s.card.length, 0);
    assert(!JSON.stringify(s.persistence || {}).includes(r.jobId));
  }
  const before = r.cases[3].detail.beforeGeneration, after = r.cases[3].detail.afterGeneration;
  assert(after > before);
  assert(r.located.hit && r.located.selected);
  const imported = r.imported.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === r.jobId);
  assert.equal(imported.length, 1);
  assert.equal(r.imported.selectedNodeId, imported[0].id);
  assert.equal(r.restored.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === r.jobId).length, 1);
  assert.equal(r.restored.selectedNodeId, imported[0].id);
  assert.deepEqual(r.restored.edges.map(e => e.id), r.imported.edges.map(e => e.id));
  assert.deepEqual(r.restored.nodes.map(n => n.id), r.imported.nodes.map(n => n.id));
  assert.equal(r.bundles.length, 1); assert.equal(r.screenshots.length, 3);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after);
    assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
    assert(Math.abs(s.before.dpr - 1) <= 1e-6); assert.equal(s.before.reduced, false);
    assert.deepEqual(s.png, { width: 1920, height: 1080 });
  }
}
function selfTest(r) {
  const bad = [
    r => { r.cases = []; }, r => { r.cases[5].status = "NOT_RUN"; },
    r => { r.scope = "RELEASE_PASS"; }, r => { r.realModelRequests = 1; },
    r => { r.modelBoundary.push(r.modelBoundary[0]); }, r => { r.modelBoundary[0].released = false; },
    r => { r.http = r.http.filter(v => !v.path.endsWith("/pause")); },
    r => { r.completedJob.status = "failed"; },
    r => { r.reads.find(v => v.state.projectId === r.inputs[1].id).state.processing.jobs.push({ jobId: r.jobId }); },
    r => { r.reads.find(v => v.state.projectId === r.inputs[1].id).state.persistence = { jobId: r.jobId }; },
    r => { r.cases[3].detail.afterGeneration = 0; }, r => { r.located.hit = false; },
    r => { r.restored.nodes.push(r.restored.nodes.find(n => n.data.editorMeta?.sourceProcessJobId === r.jobId)); },
    r => { r.restored.selectedNodeId = "wrong-task"; }, r => { r.bundles = []; },
    r => { r.screenshots[0].png.width = 960; }, r => { r.screenshots[0].after.dpr = 2; },
    r => { r.cleanups[0].normalExitClaimed = true; }, r => { r.cleanups[1].survivors.push({}); },
    r => { r.credentialCleanup = "UNKNOWN"; },
  ];
  for (const mutate of bad) { const copy = structuredClone(r); mutate(copy); assert.throws(() => validate(copy)); }
  return bad.length;
}
async function audit(name, iteration) {
  assert(/^audit-\d{2}$/.test(name)); assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(qa, `session-${iteration}/report.json`), r = load(file);
  const receipt = { status: "RUNNING", at: new Date().toISOString(), report: { path: file, sha256: sha(file) } };
  try {
    validate(r); receipt.invalidVariantsRejected = selfTest(r);
    for (const f of [...r.sources, ...r.products, ...r.inputs, ...r.bundles, ...r.screenshots])
      assert.equal(sha(f.path), f.sha256, f.path);
    for (const s of r.screenshots) {
      const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.png.width); assert.equal(bytes.readUInt32BE(20), s.png.height);
    }
    const zip = await JSZip.loadAsync(fs.readFileSync(r.bundles[0].path), { checkCRC32: true });
    const portable = JSON.parse(await zip.file("project.json").async("string"));
    const a = r.inputs[0], b = r.inputs[1];
    assert.equal(portable.project_id, a.id);
    assert.equal(portable.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === r.jobId).length, 1);
    assert(JSON.stringify(portable.editor_settings.novelPersistence).includes(r.jobId));
    assert(!JSON.stringify(portable).includes("projectExportDirectories"));
    assert(!JSON.stringify(portable).includes("test-only-secret"));
    const db = path.join(r.launches[0].data, "backend/vn_engine.db");
    const code = [
      "import json,sqlite3,sys,pathlib",
      "db=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
      "projects=[json.loads(db.execute('SELECT project_json FROM editor_project_details WHERE project_id=?',(i,)).fetchone()[0]) for i in json.loads(sys.argv[2])]",
      "records=[{'kind':r[0],'id':r[1],'value':json.loads(r[2])} for r in db.execute('SELECT kind,id,value FROM novel_processing_records WHERE job_id=?',(sys.argv[3],))]",
      "print(json.dumps(dict(projects=projects,records=records),ensure_ascii=False));db.close()",
    ].join("\n");
    const q = spawnSync("python", ["-c", code, db, JSON.stringify([a.id, b.id]), r.jobId], {
      encoding: "utf8", timeout: 20000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.equal(q.status, 0, q.stderr);
    const persisted = JSON.parse(q.stdout), [savedA, savedB] = persisted.projects;
    const authorNodes = ns => ns.map(({ measured, ...n }) => n);
    assert.deepEqual(authorNodes(savedA.nodes), authorNodes(portable.nodes));
    assert.deepEqual(savedA.edges, portable.edges);
    assert(JSON.stringify(savedA.editor_settings.novelPersistence).includes(r.jobId));
    const sourceB = load(b.path);
    assert.deepEqual(authorNodes(savedB.nodes), authorNodes(sourceB.nodes));
    assert.deepEqual(savedB.edges, sourceB.edges);
    assert(!JSON.stringify(savedB).includes(r.jobId));
    assert.equal(persisted.records.filter(q => q.kind === "executor_job").length, 1);
    const job = persisted.records.find(q => q.kind === "executor_job").value;
    assert.equal(job.jobId, r.jobId); assert.equal(job.status, "completed"); assert.equal(job.completedChunks, 1);
    assert(job.chunkResults.some(q => JSON.stringify(q.fragment).includes("受控章节正文_0_0")));
    const snapshot = path.join(out, "readonly-sqlite-projects-and-job.json");
    fs.writeFileSync(snapshot, JSON.stringify(persisted, null, 2), { flag: "wx" });
    receipt.persisted = { path: snapshot, sha256: sha(snapshot), projects: 2, records: persisted.records.length };
    receipt.portable = { ...r.bundles[0], entries: Object.keys(zip.files), project: a.id, importedNodes: 1 };
    const live = rows(), ports = [...new Set(r.launches.flatMap(l => l.ports))];
    assert(!r.known.some(p => live.some(v => v.ProcessId === p.ProcessId && v.Created === p.Created)));
    assert.equal(listeners(ports).length, 0);
    receipt.processIdentitiesAbsent = r.known.length; receipt.portsAbsent = ports;
    const prep = load(path.join(summary, "preparation.json"));
    for (const f of prep.copied) assert.equal(sha(f.path), f.sha256, "Checkpoint modified");
    receipt.status = "CURRENT_NATIVE_NOVEL_LIFECYCLE_EVIDENCE_VERIFIED";
    console.log(`PASS ${receipt.status}`);
  } catch (e) {
    receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; console.error(receipt.error);
  } finally {
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  }
}
audit(process.argv[2], process.argv[3]);
