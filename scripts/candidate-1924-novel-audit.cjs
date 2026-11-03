"use strict";
// Fresh-flow audit. No historical continuation or default-port success is inherited.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { stages, modelStages } = require("./installed-novel-default-current.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const qa = "F:/AgentVN/QA/Installed-Novel-Default-1922-20261022-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function validate(r) {
  assert.equal(r.status, "PASS"); assert.equal(r.version, "1.9.24"); assert(r.finishedAt);
  assert.equal(r.scope, "ACTUAL_NSIS_PACKAGED_BACKEND_DEFAULT_NOVEL_WORKFLOW_LOOPBACK_MODEL");
  assert(!r.continuation); assert.equal(r.backendPortMode, "OWNED_DYNAMIC_PORT");
  assert.deepEqual(r.cases.map(c => c.name), stages);
  assert(r.cases.every(c => c.status === "PASS" && c.finishedAt >= c.startedAt));
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.modelRequests, 13);
  assert.deepEqual(r.modelBoundary.map(m => m.stage).sort(), [...modelStages].sort());
  for (const m of r.modelBoundary) {
    assert(!m.error && m.finishedAt); assert.equal(m.payload.model, "qa-default");
    assert.equal(m.payload.stream, true); assert(!m.payload.tools);
  }
  assert.deepEqual(r.errors, []); assert.deepEqual(r.blockedNovelWrites, []); assert.equal(r.blockedModelRequests, 0);
  const starts = r.sockets.filter(s => s.kind === "sent" && s.command === "start_novel_job");
  assert.deepEqual(starts.map(s => s.operation), ["scan_chunk", "build_outline", "plan_chapter", "adapt_scene"]);
  assert(starts.every(s => s.controlledSelection && s.endpoint === r.endpoint));
  const ports = new Set(r.launches.map(l => l.ports[0]));
  assert(r.sockets.some(s => s.kind === "created"));
  assert(r.sockets.filter(s => s.kind === "created").every(s => {
    const u = new URL(s.url); return u.hostname === "127.0.0.1" && ports.has(+u.port) && u.pathname === "/api/ws/novel";
  }));
  const p = r.completed.project, s = r.completed.session;
  assert.equal(s.ai_stage, "report"); assert.equal(r.completed.job.status, "completed");
  assert.equal(s.adapted_scenes.length, 1); assert.equal(s.scenes.length, 1);
  assert(s.validation_reports.length && s.validation_reports.every(v => !v.errors.length));
  assert(s.quality_report.score >= s.quality_report.threshold && !s.quality_report.blocking_issues.length);
  assert.deepEqual(r.outline.project.nodes, r.initial.project.nodes); assert.deepEqual(r.outline.project.edges, r.initial.project.edges);
  const added = p.nodes.filter(n => n.data.editorMeta?.importSessionId === s.session_id);
  assert.equal(added.length, 1); assert(added[0].data.scene.commands.some(c => c.type === "narration" && c.text.includes("屋内的时钟")));
  for (const n of r.initial.project.nodes) assert(p.nodes.some(v => v.id === n.id));
  for (const e of r.initial.project.edges) assert(p.edges.some(v => v.id === e.id));
  assert.equal(r.restored.session.session_id, s.session_id);
  assert.deepEqual(r.restored.project.nodes, p.nodes); assert.deepEqual(r.restored.project.edges, p.edges);
  assert.equal(r.launches.length, 2); assert.equal(r.cleanups.length, 2);
  assert.equal(r.bundles.length, 1); assert.equal(r.screenshots.length, 3);
}
const attempt = process.argv[2]; assert.equal(attempt, "07"); assert.equal(process.argv.length, 3);
const runRoot = path.join(qa, `session-${attempt}`);
const out = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/novel-audit-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const file = path.join(runRoot, "report.json"), r = read(file);
const report = { status: "RUNNING", featureStatus: r.status, source: desc(file), startedAt: new Date().toISOString(),
  scope: "FRESH_INSTALLED_NOVEL_EVIDENCE_AUDIT_NOT_REAL_MODEL_OR_FULL_ACCEPTANCE", checks: [], modelRequests: 0, launches: 0 };
async function check(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c);
  try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
(async () => {
  await check("Actual installed candidate and immutable tool/product/input checkpoints", () => {
    assert(["PASS", "FAILED"].includes(r.status)); assert(r.finishedAt); assert.equal(r.version, "1.9.24");
    const i = read(r.installation.path); assert.equal(sha(r.installation.path), r.installation.sha256);
    assert.equal(i.executable.sha256, "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");
    for (const f of [...r.sources, ...r.tools, ...r.inputs, ...r.protectedFiles, i.executable, ...i.resources])
      assert.equal(sha(f.path), f.sha256);
    for (const f of r.checkpoint) assert.equal(sha(f.copy), f.sha256);
    return { version: i.executable.version, rawStatus: r.status };
  });
  await check("Fresh workflow or preserved raw failure; no historical model call or step inheritance", () => {
    assert.equal(r.realModelRequests, 0); assert(!r.continuation);
    if (r.status === "PASS") {
      validate(r);
      const mutations = [
        q => { q.cases = []; }, q => { q.modelRequests = 0; }, q => { q.realModelRequests = 1; },
        q => { q.modelBoundary[0].stage = "fake"; }, q => { q.bundles = []; }, q => { q.launches.pop(); },
        q => { q.completed.project.nodes = q.initial.project.nodes; }, q => { q.restored.session.session_id = "wrong"; },
        q => { q.sockets.find(s => s.command === "start_novel_job").controlledSelection = false; },
      ];
      for (const m of mutations) { const q = structuredClone(r); m(q); assert.throws(() => validate(q)); }
      return { flows: 4, calls: 13, invalidEvidenceRejected: mutations.length, inheritedSteps: 0 };
    }
    assert(r.error && r.cases.some(c => c.status === "FAILED"));
    return { rawFailurePreserved: true, error: r.error, modelCalls: r.modelRequests, notAFunctionPass: true };
  });
  if (r.status === "PASS") await check("Actual native portable and independent read-only SQLite copy", async () => {
    const f = r.bundles[0]; assert.equal(sha(f.path), f.sha256);
    const z = await JSZip.loadAsync(fs.readFileSync(f.path), { checkCRC32: true });
    const p = JSON.parse(await z.file("project.json").async("string"));
    assert.deepEqual(p.nodes, r.completed.project.nodes); assert.deepEqual(p.edges, r.completed.project.edges);
    assert.equal(p.editor_settings.novelPersistence.sessionSnapshot.session_id, r.completed.session.session_id);
    const copy = path.join(out, "vn_engine.readonly.db");
    assert.equal(sha(r.finalDatabase.path), r.finalDatabase.sha256);
    fs.copyFileSync(r.finalDatabase.path, copy, fs.constants.COPYFILE_EXCL);
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      const all = db.prepare("SELECT project_json FROM editor_project_details").all(); assert.equal(all.length, 1);
      const persisted = JSON.parse(all[0].project_json);
      assert.deepEqual(persisted.nodes, p.nodes); assert.deepEqual(persisted.edges, p.edges);
      assert.equal(persisted.editor_settings.novelPersistence.sessionSnapshot.ai_stage, "report");
    } finally { db.close(); }
    assert.equal(sha(copy), r.finalDatabase.sha256);
    return { portable: f, databaseCopy: desc(copy) };
  });
  await check("Actual PNG sizes and complete finally/cache/credential/process cleanup", () => {
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      validateNativeViewport(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
      const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
    }
    for (const k of ["cleanupError", "cacheError", "finalizationError", "credentialCleanupError"]) assert(!r[k]);
    assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
    assert(!fs.readFileSync(r.finalDatabase.path).includes(Buffer.from("test-only-secret")));
    assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]);
    assert(r.cache.every(c => c.exitCode === 0));
    const cache = read(path.join(runRoot, "native-cache-restoration.json"));
    assert.equal(cache.status, "PASS"); assert.equal(cache.deletedUserFiles, 0);
    for (const f of cache.originalFiles) assert.equal(sha(path.join(cache.originalDirectory, f.relative)), f.sha256);
    assert(ps(`fsutil.exe file queryfileid '${cache.originalDirectory}'`).toLowerCase().includes(cache.originalDirectoryId));
    const ids = new Set(r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));
    for (const c of r.cleanups) { assert.equal(c.status, "PASS"); for (const id of c.killed) ids.add(id); }
    for (const l of r.launches) ids.add(`${l.backend.ProcessId}:${l.backend.Created}`);
    assert(!rows().some(p => ids.has(`${p.ProcessId}:${p.Created}`)));
    const ports = [...new Set([...r.launches.flatMap(l => l.ports), +new URL(r.endpoint).port])];
    assert.deepEqual(listeners(ports), []);
    return { screenshots: r.screenshots.length, identities: ids.size, ports, realModelCalls: 0 };
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, featureStatus: report.featureStatus, error: report.error, out }));
});
