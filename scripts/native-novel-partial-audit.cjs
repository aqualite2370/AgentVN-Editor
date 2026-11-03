"use strict";
// No host launches, model requests or database writes. Independent evidence gate.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { qa, summary, stages } = require("./native-novel-partial.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function imported(s, id) { return s.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === id); }
function validate(r) {
  assert.equal(r.status, "CURRENT_NATIVE_NOVEL_PARTIAL_PASS"); assert(r.finishedAt);
  assert.equal(r.scope, "CURRENT_NATIVE_DEV_CONTROLLED_FAILURE_REAL_EXECUTOR_NOT_RELEASE_OR_DEEPSEEK");
  assert.deepEqual(r.viewport, { width: 1920, height: 1080, dpr: 1, reduced: false });
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.deepEqual(r.cases.map(c => c.name), stages);
  assert(r.cases.every(c => c.status === "PASS" && Date.parse(c.finishedAt) >= Date.parse(c.startedAt)));
  assert.deepEqual(r.errors, []); assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  for (const k of ["error", "cleanupError", "credentialCleanupError", "immutabilityError"]) assert(!r[k]);
  assert.equal(r.inputs.length, 2); assert.notEqual(r.inputs[0].id, r.inputs[1].id);
  assert.notEqual(r.jobA, r.jobB); assert.match(r.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.equal(r.modelRequests, 5); assert.equal(r.modelBoundary.length, 5);
  assert.deepEqual(r.modelBoundary.map(m => m.input.chapterIndex), [0, 1, 1, 1, 0]);
  assert.deepEqual(r.modelBoundary.map(m => m.outcome), ["completed", "failed", "failed", "completed", "completed"]);
  for (const m of r.modelBoundary) {
    assert(m.stream && m.released && !m.error && !m.disconnected && m.finishedAt);
    assert.equal(m.input.promptVersion, "novel-process-v3");
    assert.equal(m.input.chunkIndex, 0);
  }
  assert.equal(new Set(r.modelBoundary.slice(0, 4).map(m => m.input.bookId)).size, 1);
  assert.notEqual(r.modelBoundary[4].input.bookId, r.modelBoundary[0].input.bookId);
  assert.equal(r.providerCleanup.requests, 5); assert(r.providerCleanup.stopped); assert.equal(r.providerCleanup.held, 0);
  const posts = r.http.filter(h => h.event === "request" && h.method === "POST");
  assert.equal(posts.filter(h => h.path === "/api/novel/processing/execute/jobs").length, 2);
  assert.equal(posts.filter(h => h.path === `/api/novel/processing/execute/jobs/${r.jobA}/retry_failed_chunks`).length, 2);
  assert.equal(posts.filter(h => h.path === `/api/novel/processing/execute/jobs/${r.jobB}/cancel`).length, 1);
  assert.equal(posts.length, 5);
  assert(r.http.filter(h => h.event === "response").every(h => h.status >= 200 && h.status < 300));
  assert.equal(r.partial.status, "failed_partial"); assert.equal(r.partial.maxRetries, 0);
  assert.equal(r.partial.completedChunks, 1); assert.equal(r.partial.failedChunks, 1);
  assert.equal(imported(r.firstImport, r.jobA).length, 1);
  const first = imported(r.firstImport, r.jobA)[0];
  assert.equal(first.data.editorMeta.sourceProcessChapterIndex, 0); assert.equal(r.firstImport.selected, first.id);
  assert.equal(r.lateFailure.status, "failed_partial");
  assert(JSON.stringify(r.lateFailure).includes("CONTROLLED_CHAPTER_FAILURE_2"));
  assert.equal(r.lateFailureB.id, r.inputs[1].id); assert.equal(r.lateFailureB.processing.jobs.length, 0);
  assert.equal(r.lateFailureB.cards.length, 0); assert(!JSON.stringify(r.lateFailureB.persistence || {}).includes(r.jobA));
  assert.equal(r.cases[1].detail.bUnchanged, true);
  assert(r.cases[1].detail.generation[1] > r.cases[1].detail.generation[0]);
  assert.equal(r.completed.status, "completed"); assert.equal(r.completed.completedChunks, 2);
  const nodes = imported(r.appended, r.jobA);
  assert.deepEqual(nodes.map(n => n.data.editorMeta.sourceProcessChapterIndex), [0, 1]);
  assert.equal(nodes[0].id, first.id); assert.deepEqual(nodes[0].data.scene, first.data.scene);
  assert.equal(nodes[0].data.editorMeta.importLineId, nodes[1].data.editorMeta.importLineId);
  for (const edge of r.firstImport.edges) assert(r.appended.edges.some(e => e.id === edge.id));
  assert(r.appended.edges.some(e => e.source === nodes[0].id && e.target === nodes[1].id));
  assert.equal(r.appended.selected, nodes[1].id);
  assert.equal(r.cancelled.status, "cancelled"); assert.equal(r.cancelled.completedChunks, 0);
  assert.equal(r.cancelled.cancelledChunks, 2); assert.equal(r.cancelled.runningTasks, 0);
  assert.equal(r.cancelledResults.completedResults.length, 0);
  assert.equal(r.emptyView.graphUnchanged, true); assert.match(r.emptyView.message, /暂无可定位的本任务已完成节点/);
  assert.deepEqual(imported(r.restartedA, r.jobA).map(n => n.id), nodes.map(n => n.id));
  assert.equal(imported(r.restartedB, r.jobB).length, 0);
  assert(r.restartedA.cards.some(c => c.id === r.inputs[0].id && c.status === "completed"));
  assert(r.restartedB.cards.some(c => c.id === r.inputs[1].id && c.status === "cancelled"));
  assert.equal(r.launches.length, 2); assert.equal(r.cleanups.length, 2);
  assert.notEqual(r.launches[0].pid, r.launches[1].pid);
  assert.equal(r.launches[0].data, r.launches[1].data); assert.equal(r.launches[0].webview, r.launches[1].webview);
  for (const c of r.cleanups) {
    assert.equal(c.normalExitClaimed, false); assert(c.killed.length > 0);
    assert.equal(c.survivors.length, 0); assert.equal(c.listeners.length, 0);
  }
  assert.equal(r.bundles.length, 2); assert.equal(r.screenshots.length, 3);
  if (r.verifyGraphPhases) {
    const expectations = [
      ["failed-partial-before-any-import", 0, "blocked", 0, 0, "blocked"],
      ["first-of-two-chapters-written-and-validated", 50, "blocked", 1, 50, "blocked"],
      ["completed-generation-before-recovered-chapter-import", 50, "waiting", 1, 50, "waiting"],
      ["both-chapters-really-written-and-validated", 100, "completed", 2, 100, "completed"],
      ["cancelled-with-no-current-graph-nodes", 0, "cancelled", 0, 0, "cancelled"],
      ["restarted-completed-project-recomputes-actual-graph", 100, "completed", 2, 100, "completed"],
      ["restarted-cancelled-project-does-not-inherit-a", 0, "cancelled", 0, 0, "cancelled"],
    ];
    assert.equal(r.phaseFacts?.length, expectations.length);
    for (const [index, [label, percent, status, nodes, validationPercent, validationStatus]] of expectations.entries()) {
      const fact = r.phaseFacts[index];
      assert.equal(fact.label, label);
      const jobId = label.includes("cancelled") ? r.jobB : r.jobA;
      assert.equal(imported(fact.state, jobId).length, nodes);
      for (const id of ["import_write", "validation"]) {
        const row = fact.phases.find(p => p.id === id);
        assert.equal(row.percent, id === "validation" ? validationPercent : percent);
        assert.equal(row.status, id === "validation" ? validationStatus : status);
        assert.equal(row.basis, id === "import_write" ? "current_project_graph" : "current_project_structure_validation");
      }
      if (nodes > 0) {
        const text = fact.phases.find(p => p.id === "validation").text;
        assert.match(text, /不代表全工程/);
        const actual = imported(fact.state, jobId);
        assert(actual.every(n => n.data.scene.commands.filter(c => c.type === "narration")
          .every(c => c.presentation_mode !== null && c.bubble_position !== null && c.clear_nvl_page_before !== null)));
      }
    }
  }
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after); assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
    assert(Math.abs(s.before.dpr - 1) <= 1e-6); assert.equal(s.before.reduced, false);
    assert.deepEqual(s.png, { width: 1920, height: 1080 });
  }
}
function badEvidence(r) {
  const changes = [
    r => { r.cases = []; }, r => { r.cases[4].status = "NOT_RUN"; }, r => { r.realModelRequests = 1; },
    r => { r.modelBoundary.pop(); }, r => { r.modelBoundary[2].input.chapterIndex = 0; },
    r => { r.modelBoundary[1].outcome = "completed"; },
    r => { r.http = r.http.filter(h => !h.path.endsWith("/cancel")); },
    r => { r.partial.completedChunks = 2; }, r => { r.firstImport.nodes = []; },
    r => { r.lateFailureB.persistence = { jobId: r.jobA }; },
    r => { r.cases[1].detail.generation[1] = 0; },
    r => { r.appended.nodes.find(n => n.data.editorMeta?.sourceProcessChapterIndex === 0).id = "new-unrelated-node"; },
    r => { r.appended.edges = []; },
    r => { r.cancelled.status = "completed"; }, r => { r.cancelled.cancelledChunks = 1; },
    r => { r.cancelledResults.completedResults.push({}); },
    r => { r.emptyView.graphUnchanged = false; }, r => { r.emptyView.message = "导入成功"; },
    r => { r.restartedA.nodes = []; }, r => { r.launches.pop(); },
    r => { r.bundles.pop(); }, r => { r.screenshots[1].png.width = 960; },
    r => { r.cleanups[1].survivors.push({}); }, r => { r.credentialCleanup = "UNKNOWN"; },
  ];
  if (r.verifyGraphPhases) changes.push(
    r => { r.phaseFacts = []; },
    r => { r.phaseFacts[0].phases.find(p => p.id === "import_write").percent = 100; },
    r => { r.phaseFacts[2].phases.find(p => p.id === "validation").status = "completed"; },
    r => { r.phaseFacts[3].state.nodes = []; },
    r => { r.phaseFacts[5].phases.find(p => p.id === "validation").basis = "terminal_status"; },
  );
  for (const change of changes) { const copy = structuredClone(r); change(copy); assert.throws(() => validate(copy)); }
  return changes.length;
}
async function audit(name, iteration) {
  assert(/^audit-\d{2}$/.test(name)); assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const file = path.join(qa, `session-${iteration}/report.json`), r = load(file);
  const receipt = { status: "RUNNING", at: new Date().toISOString(), report: { path: file, sha256: sha(file) } };
  try {
    validate(r); receipt.invalidVariantsRejected = badEvidence(r);
    for (const f of [...r.inputs, ...r.sources, ...r.products, ...r.bundles, ...r.screenshots])
      assert.equal(sha(f.path), f.sha256, f.path);
    const portable = [];
    for (const f of r.bundles) {
      const zip = await JSZip.loadAsync(fs.readFileSync(f.path), { checkCRC32: true });
      const p = JSON.parse(await zip.file("project.json").async("string"));
      assert(!JSON.stringify(p).includes("projectExportDirectories")); assert(!JSON.stringify(p).includes("test-only-secret"));
      portable.push(p);
    }
    const a = portable.find(p => p.project_id === r.inputs[0].id), b = portable.find(p => p.project_id === r.inputs[1].id);
    assert(a && b); assert.equal(imported(a, r.jobA).length, 2); assert.equal(imported(b, r.jobB).length, 0);
    assert(JSON.stringify(a.editor_settings.novelPersistence).includes(r.jobA));
    assert(!JSON.stringify(a.editor_settings.novelPersistence).includes(r.jobB));
    assert(JSON.stringify(b.editor_settings.novelPersistence).includes(r.jobB));
    assert(!JSON.stringify(b.editor_settings.novelPersistence).includes(r.jobA));
    const db = path.join(r.launches[0].data, "backend/vn_engine.db");
    const code = [
      "import sqlite3,json,sys,pathlib",
      "db=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
      "projects=[json.loads(db.execute('SELECT project_json FROM editor_project_details WHERE project_id=?',(i,)).fetchone()[0]) for i in json.loads(sys.argv[2])]",
      "records=[{'kind':r[0],'id':r[1],'jobId':r[2],'value':json.loads(r[3])} for r in db.execute('SELECT kind,id,job_id,value FROM novel_processing_records WHERE job_id IN (?,?)',json.loads(sys.argv[3]))]",
      "print(json.dumps(dict(projects=projects,records=records),ensure_ascii=False));db.close()",
    ].join("\n");
    const query = spawnSync("python", ["-c", code, db, JSON.stringify(r.inputs.map(f => f.id)), JSON.stringify([r.jobA, r.jobB])], {
      encoding: "utf8", timeout: 20000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.equal(query.status, 0, query.stderr);
    const persisted = JSON.parse(query.stdout);
    const authored = ns => ns.map(({ measured, ...n }) => n);
    for (const p of persisted.projects) {
      const packageProject = portable.find(v => v.project_id === p.project_id);
      assert.deepEqual(authored(p.nodes), authored(packageProject.nodes)); assert.deepEqual(p.edges, packageProject.edges);
    }
    const jobs = persisted.records.filter(q => q.kind === "executor_job").map(q => q.value);
    assert.equal(jobs.length, 2);
    const ja = jobs.find(j => j.jobId === r.jobA), jb = jobs.find(j => j.jobId === r.jobB);
    assert.equal(ja.status, "completed"); assert.equal(ja.completedChunks, 2);
    assert.equal(jb.status, "cancelled"); assert.equal(jb.completedChunks, 0); assert.equal(jb.cancelledChunks, 2);
    assert(ja.eventLogs.some(e => JSON.stringify(e).includes("CONTROLLED_CHAPTER_FAILURE_1")));
    assert(ja.eventLogs.some(e => JSON.stringify(e).includes("CONTROLLED_CHAPTER_FAILURE_2")));
    assert(!jb.chunkResults.some(q => q.status === "completed"));
    const sourceA = load(r.inputs[0].path), sourceB = load(r.inputs[1].path);
    for (const [p, source] of [[a, sourceA], [b, sourceB]]) {
      for (const node of source.nodes) assert(p.nodes.some(n => n.id === node.id));
      for (const edge of source.edges) assert(p.edges.some(e => e.id === edge.id));
    }
    const snapshot = path.join(out, "readonly-sqlite-projects-and-jobs.json");
    fs.writeFileSync(snapshot, JSON.stringify(persisted, null, 2), { flag: "wx" });
    receipt.persisted = { path: snapshot, sha256: sha(snapshot), projects: 2, jobs: 2, records: persisted.records.length };
    for (const s of r.screenshots) {
      const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.png.width); assert.equal(bytes.readUInt32BE(20), s.png.height);
    }
    const now = rows(), ports = [...new Set(r.launches.flatMap(l => l.ports))];
    assert(!r.known.some(p => now.some(v => v.ProcessId === p.ProcessId && v.Created === p.Created)));
    assert.equal(listeners(ports).length, 0);
    receipt.processIdentitiesAbsent = r.known.length; receipt.portsAbsent = ports;
    const prep = load(path.join(summary, "preparation.json"));
    for (const f of prep.copied) assert.equal(sha(f.path), f.sha256, "Checkpoint changed");
    const failedFile = path.join(qa, "session-01/report.json"), failed = load(failedFile);
    assert.equal(failed.status, "FAILED"); assert.equal(failed.cases[3].status, "FAILED");
    assert.match(failed.error, /1 !== 0/); assert.equal(failed.modelRequests, 5);
    receipt.previousFailure = { path: failedFile, sha256: sha(failedFile), retained: true,
      classification: "QA wrongly required hiding cancelled result button; product not changed" };
    receipt.status = "CURRENT_NATIVE_NOVEL_PARTIAL_EVIDENCE_VERIFIED";
    console.log(`PASS ${receipt.status}`);
  } catch (e) {
    receipt.status = "FAILED"; receipt.error = String(e.stack || e); console.error(receipt.error); process.exitCode = 1;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  }
}
audit(process.argv[2], process.argv[3]);
