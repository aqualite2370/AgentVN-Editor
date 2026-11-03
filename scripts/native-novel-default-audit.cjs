"use strict";
// Independent artifact/SQLite verifier. Does not launch products or call models.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { qa, summary } = require("./native-novel-default.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const business = ["top-entry-direct-import-no-implicit-executor-job",
  "real-scan-and-outline-stop-before-author-confirmation",
  "author-confirms-plan-adapt-validate-and-write-current-graph",
  "native-save-restart-restores-default-chain-without-model-replay"];
const modelStages = ["scan-summary", "scan-entities", "scan-timeline", "outline-mainline",
  "outline-structure", "outline-index", "scene-plan", "planning-conflicts", "planning-branches",
  "public-notes", "scene-beat", "adaptation-conflicts", "adaptation-branches"];
const importedNodes = s => s.nodes.filter(n => n.data.editorMeta?.importSessionId === s.session.session_id);
const authorNodes = nodes => nodes.map(({ measured, ...n }) => n);
function validate(r) {
  assert.equal(r.status, "CURRENT_NATIVE_NOVEL_DEFAULT_PASS"); assert(r.finishedAt);
  assert.equal(r.scope, "CURRENT_NATIVE_DEV_REAL_DEFAULT_WORKFLOW_LOOPBACK_MODEL_NOT_RELEASE_OR_PHYSICAL_INPUT");
  assert.deepEqual(r.viewport, { width: 1920, height: 1080, dpr: 1, reduced: false });
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0);
  assert.deepEqual(r.cases.map(c => c.name), business);
  assert(r.cases.every(c => c.status === "PASS" && Date.parse(c.finishedAt) >= Date.parse(c.startedAt)));
  assert.deepEqual(r.errors, []); assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  for (const field of ["error", "cleanupError", "credentialCleanupError", "immutabilityError"]) assert(!r[field], field);
  assert.match(r.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.equal(r.modelRequests, 13); assert.equal(r.modelBoundary.length, 13);
  assert.deepEqual(r.modelBoundary.map(m => m.stage).sort(), [...modelStages].sort());
  for (const m of r.modelBoundary) {
    assert(!m.error && m.finishedAt); assert.equal(m.payload.model, "qa-default");
    assert.equal(m.payload.stream, true); assert(!m.payload.tools);
    if (m.stage !== "public-notes") assert.equal(m.payload.response_format.type, "json_object");
  }
  assert.equal(r.providerCleanup.stopped, true); assert.equal(r.providerCleanup.requests, 13);
  assert.equal(r.launches.length, 2); assert.equal(r.cleanups.length, 2);
  assert.notEqual(r.launches[0].pid, r.launches[1].pid);
  assert.equal(r.launches[0].data, r.launches[1].data);
  assert.equal(r.launches[0].webview, r.launches[1].webview);
  for (const c of r.cleanups) {
    assert.equal(c.normalExitClaimed, false); assert(c.killed.length > 0);
    assert.equal(c.survivors.length, 0); assert.equal(c.listeners.length, 0);
  }
  assert(!r.http.some(q => q.method === "POST" && /\/processing\/execute\/jobs/.test(q.path)));
  for (const s of [r.initial, r.outline, r.completed, r.restored]) assert.equal(s.projectId, r.inputs[0].id);
  assert.deepEqual(r.outline.nodes, r.initial.nodes); assert.deepEqual(r.outline.edges, r.initial.edges);
  assert.equal(r.outline.session.ai_stage, "outline"); assert.equal(r.outline.busy, false);
  assert.equal(r.outline.session.ai_chunk_analyses.length, 1); assert.equal(r.outline.session.chapters.length, 1);
  assert.equal(r.outline.session.adapted_scenes.length, 0); assert.equal(r.outline.processing.jobs.length, 0);
  const s = r.completed;
  assert.equal(s.session.ai_stage, "report"); assert.equal(s.job.status, "completed"); assert.equal(s.busy, false);
  assert.equal(s.session.scenes.length, 1); assert.equal(s.session.adapted_scenes.length, 1);
  assert(s.session.validation_reports.length > 0);
  assert(s.session.validation_reports.every(v => v.errors.length === 0));
  assert(s.session.quality_report.score >= s.session.quality_report.threshold);
  assert.equal(s.session.quality_report.blocking_issues.length, 0);
  const nodes = importedNodes(s); assert.equal(nodes.length, 1);
  assert(nodes[0].data.scene.commands.some(c => c.text?.includes("屋内的时钟")));
  for (const c of nodes[0].data.scene.commands) for (const key of [
    "presentation_mode", "clear_nvl_page_before", "bubble_position", "dialog_style_mode", "narration_style",
  ]) assert.notEqual(c[key], null, `Invalid optional null at ${key}`);
  for (const n of r.initial.nodes) assert(s.nodes.some(v => v.id === n.id));
  for (const e of r.initial.edges) assert(s.edges.some(v => v.id === e.id));
  assert.equal(r.restored.session.session_id, s.session.session_id);
  assert.equal(importedNodes(r.restored).length, 1);
  assert.deepEqual(r.restored.nodes.map(n => n.id), s.nodes.map(n => n.id));
  assert.deepEqual(r.restored.edges.map(e => e.id), s.edges.map(e => e.id));
  assert.deepEqual(r.restored.nodes.map(n => n.data.scene), s.nodes.map(n => n.data.scene));
  assert.equal(r.bundles.length, 1); assert.equal(r.screenshots.length, 3);
  for (const p of r.screenshots) {
    assert.deepEqual(p.before, p.after); assert.equal(p.before.width, 1920); assert.equal(p.before.height, 1080);
    assert(Math.abs(p.before.dpr - 1) < 1e-6); assert.equal(p.before.reduced, false);
    assert.deepEqual(p.png, { width: 1920, height: 1080 });
  }
}
function selfTest(r) {
  const bad = [
    q => { q.cases = []; }, q => { q.cases[3].status = "NOT_RUN"; }, q => { q.finishedAt = null; },
    q => { q.scope = "RELEASE_PASS"; }, q => { q.realModelRequests = 1; },
    q => { q.modelBoundary.pop(); }, q => { q.modelBoundary[0].error = "provider failed"; },
    q => { q.modelBoundary[0].stage = "unknown"; }, q => { q.modelRequests = 0; },
    q => { q.cleanups[0].normalExitClaimed = true; }, q => { q.cleanups[1].survivors.push({}); },
    q => { q.credentialCleanup = "UNKNOWN"; }, q => { q.outline.nodes.push(q.completed.nodes.at(-1)); },
    q => { q.outline.session.adapted_scenes.push({}); }, q => { q.completed.session.validation_reports = []; },
    q => { q.completed.session.validation_reports[0].errors.push("invalid command"); },
    q => { q.completed.job.status = "paused"; }, q => { q.completed.session.quality_report.blocking_issues.push({}); },
    q => { q.restored.nodes.pop(); }, q => { q.restored.session.session_id = "other-session"; },
    q => { q.bundles = []; }, q => { q.screenshots[0].png.width = 960; }, q => { q.screenshots[0].after.dpr = 2; },
  ];
  for (const mutate of bad) { const copy = structuredClone(r); mutate(copy); assert.throws(() => validate(copy)); }
  return bad.length;
}
async function main() {
  const [name, iteration, gates] = process.argv.slice(2);
  assert(/^audit-\d{2}$/.test(name) && /^\d{2}$/.test(iteration));
  assert(!gates || /^gates-\d{2}$/.test(gates));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(qa, `session-${iteration}/report.json`), r = load(file);
  const receipt = { at: new Date().toISOString(), status: "RUNNING", report: { path: file, sha256: sha(file) } };
  try {
    validate(r); receipt.invalidVariantsRejected = selfTest(r);
    for (const f of [...r.inputs, ...r.sources, ...r.products, ...r.bundles, ...r.screenshots]) assert.equal(sha(f.path), f.sha256, f.path);
    for (const p of r.screenshots) {
      const bytes = fs.readFileSync(p.path); assert.equal(bytes.readUInt32BE(16), p.png.width);
      assert.equal(bytes.readUInt32BE(20), p.png.height);
    }
    const zip = await JSZip.loadAsync(fs.readFileSync(r.bundles[0].path), { checkCRC32: true });
    const portable = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(portable.project_id, r.inputs[0].id);
    assert.deepEqual(authorNodes(portable.nodes), authorNodes(r.persisted.nodes));
    assert.deepEqual(portable.edges, r.persisted.edges);
    const metadata = JSON.stringify(portable.editor_settings.novelPersistence);
    assert(metadata.includes(r.completed.session.session_id)); assert(metadata.includes("qa_default_scene"));
    assert(!JSON.stringify(portable).includes("test-only-secret"));
    assert(!JSON.stringify(portable).includes("projectExportDirectories"));
    const db = path.join(r.launches[0].data, "backend/vn_engine.db");
    const code = [
      "import json,sqlite3,sys,pathlib",
      "db=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
      "project=json.loads(db.execute('SELECT project_json FROM editor_project_details WHERE project_id=?',(sys.argv[2],)).fetchone()[0])",
      "records=[{'kind':r[0],'id':r[1]} for r in db.execute('SELECT kind,id FROM novel_processing_records')]",
      "print(json.dumps(dict(project=project,records=records),ensure_ascii=False));db.close()",
    ].join("\n");
    const q = spawnSync("python", ["-c", code, db, r.inputs[0].id], {
      encoding: "utf8", windowsHide: true, timeout: 20000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.equal(q.status, 0, q.stderr); const stored = JSON.parse(q.stdout);
    assert.deepEqual(authorNodes(stored.project.nodes), authorNodes(portable.nodes));
    assert.deepEqual(stored.project.edges, portable.edges);
    assert.equal(stored.records.filter(v => v.kind === "executor_job").length, 0);
    const snapshot = path.join(out, "readonly-sqlite-project.json");
    fs.writeFileSync(snapshot, JSON.stringify(stored, null, 2), { flag: "wx" });
    receipt.persisted = { path: snapshot, sha256: sha(snapshot), project: portable.project_id, importedNodes: 1 };
    receipt.portable = { ...r.bundles[0], entries: Object.keys(zip.files) };
    const live = rows(), ports = [...new Set(r.launches.flatMap(l => l.ports))];
    assert(!r.known.some(p => live.some(v => v.ProcessId === p.ProcessId && v.Created === p.Created)));
    assert.equal(listeners(ports).length, 0); receipt.processIdentitiesAbsent = r.known.length; receipt.portsAbsent = ports;
    const prep = load(path.join(summary, "preparation.json"));
    for (const f of prep.copied) assert.equal(sha(f.path), f.sha256, "Checkpoint modified");
    if (gates) {
      const gateFile = path.join(qa, gates, "report.json"), g = load(gateFile);
      assert.equal(g.status, "NOVEL_DEFAULT_GATES_AND_ACTUAL_DEV_COPY_PASS");
      assert.equal(g.steps.length, 10); assert(g.steps.every(s => s.status === "PASS" && s.code === 0));
      for (const step of g.steps) assert.equal(sha(step.log.path), step.log.sha256);
      assert.equal(sha(g.behavior.path), g.behavior.sha256); assert.equal(sha(g.audit.path), g.audit.sha256);
      assert.equal(sha(g.dev.path), g.dev.sha256); assert.equal(sha(g.built.path), g.dev.sha256);
      assert(Date.parse(g.dev.modifiedAt) >= Date.parse(g.steps.find(s => s.label === "dev-build").startedAt));
      assert(Date.parse(r.at) >= Date.parse(g.finishedAt), "Verification must launch after the actual publication");
      assert.equal(r.products.find(f => /AgentVN Dev\.exe$/.test(f.path)).sha256, g.dev.sha256);
      for (const f of [...g.resourceChecks, g.player]) assert.equal(sha(f.path), f.sha256);
      receipt.publication = { path: gateFile, sha256: sha(gateFile), dev: g.dev, player: g.player };
    }
    receipt.status = "CURRENT_NATIVE_NOVEL_DEFAULT_EVIDENCE_VERIFIED";
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: receipt.status, out, error: receipt.error }));
  }
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
