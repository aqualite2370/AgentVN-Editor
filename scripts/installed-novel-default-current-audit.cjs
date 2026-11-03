"use strict";
// Read-only audit: an evidence PASS does not convert the dynamic-port product failure.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { qa, stages, modelStages } = require("./installed-novel-default-current.cjs");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => sha256(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function validate(r) {
  assert.equal(r.status, "PASS"); assert.equal(r.version, "1.9.22"); assert(r.finishedAt);
  assert.equal(r.backendPortMode, "EXPLICIT_8278_DIFFERENTIAL_NOT_PRODUCT_FIX");
  assert.equal(r.scope, "ACTUAL_NSIS_PACKAGED_BACKEND_DEFAULT_NOVEL_WORKFLOW_LOOPBACK_MODEL");
  assert.deepEqual(r.cases.map(c => c.name), stages); assert(r.cases.every(c => c.status === "PASS" && c.finishedAt >= c.startedAt));
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.modelRequests, 13);
  assert.equal(r.additionalModelCalls, 0); assert.equal(r.continuation.additionalModelCalls, 0);
  assert.equal(r.continuation.originalFailurePreserved, true); assert.equal(r.providerCleanup.inheritedClosedProvider, true);
  assert.equal(r.modelBoundary.length, 13);
  assert.deepEqual(r.modelBoundary.map(m => m.stage).sort(), [...modelStages].sort());
  for (const m of r.modelBoundary) {
    assert(!m.error && m.finishedAt); assert.equal(m.payload.model, "qa-default"); assert.equal(m.payload.stream, true);
    assert(!m.payload.tools); if (m.stage !== "public-notes") assert.equal(m.payload.response_format.type, "json_object");
  }
  const starts = r.sockets.filter(s => s.kind === "sent" && s.command === "start_novel_job");
  assert.deepEqual(starts.map(s => s.operation), ["scan_chunk", "build_outline", "plan_chapter", "adapt_scene"]);
  assert(starts.every(s => s.controlledSelection === true && s.endpoint === r.endpoint));
  assert(r.network.some(q => q.url === "http://127.0.0.1:8278/openapi.json" && q.method === "GET"));
  assert(r.sockets.filter(s => s.kind === "created").every(s => s.url === "ws://127.0.0.1:8278/api/ws/novel"));
  assert.deepEqual(r.errors, []); assert.deepEqual(r.blockedNovelWrites, []); assert.equal(r.blockedModelRequests, 0);
  for (const k of ["error", "cleanupError", "cacheError", "finalizationError", "credentialCleanupError"]) assert(!r[k]);
  assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  const p = r.completed.project, s = r.completed.session;
  assert.equal(s.ai_stage, "report"); assert.equal(r.completed.job.status, "completed");
  assert.equal(s.adapted_scenes.length, 1); assert.equal(s.scenes.length, 1);
  assert(s.validation_reports.length > 0 && s.validation_reports.every(v => v.errors.length === 0));
  assert(s.quality_report.score >= s.quality_report.threshold && s.quality_report.blocking_issues.length === 0);
  assert.deepEqual(r.outline.project.nodes, r.initial.project.nodes); assert.deepEqual(r.outline.project.edges, r.initial.project.edges);
  const imported = p.nodes.filter(n => n.data.editorMeta?.importSessionId === s.session_id);
  assert.equal(imported.length, 1); assert(imported[0].data.scene.commands.some(c => c.type === "narration" && c.text.includes("屋内的时钟")));
  for (const n of r.initial.project.nodes) assert(p.nodes.some(v => v.id === n.id));
  for (const e of r.initial.project.edges) assert(p.edges.some(v => v.id === e.id));
  assert.equal(r.restored.session.session_id, s.session_id);
  assert.deepEqual(r.restored.project.nodes, p.nodes); assert.deepEqual(r.restored.project.edges, p.edges);
  assert.equal(r.launches.length, 3); assert.equal(r.cleanups.length, 3);
  assert(r.launches.every(l => l.ports[0] === 8278 && !l.sourceServer && !l.manualBackendSpawn));
  assert(r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
  assert.equal(r.bundles.length, 1); assert.equal(r.screenshots.length, 3);
  assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]); assert(r.cache.every(c => c.exitCode === 0));
}
async function run(attempt, auditId) {
  assert.match(attempt, /^\d{2}$/); assert.match(auditId, /^\d{2}$/);
  const out = path.join(qa, `audit-${auditId}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(qa, `session-${attempt}`, "report.json"), r = read(file);
  const report = { status: "RUNNING", evidenceStatus: "RUNNING", featureResults: {
    dynamicPortNovelAnalysis: "FAILED", defaultPortControlledBackendChain: "NOT_EVALUATED",
    realModelQuality: "NOT_RUN", standaloneExportAndUpgrade: "NOT_RUN" }, source: desc(file),
    startedAt: new Date().toISOString(), checks: [], realModelRequests: 0, productChanges: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function check(name, fn) {
    const c = { name, status: "RUNNING" }; report.checks.push(c); save();
    try { c.detail = await fn(); c.status = "PASS"; save(); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  }
  try {
    await check("two-dynamic-port-failures-retained-and-actual-packaged-code-identifies-static-port", () => {
      const files = ["01", "02"].map(n => path.join(qa, `session-${n}`, "report.json")), failed = files.map(read);
      for (const f of failed) {
        assert.equal(f.status, "FAILED"); assert.equal(f.cases[0].status, "PASS"); assert.equal(f.cases[1].status, "FAILED");
        assert.equal(f.modelRequests, 0); assert.equal(f.realModelRequests, 0);
        assert(f.launches.every(l => l.ports[0] !== 8278 && !l.sourceServer && !l.manualBackendSpawn));
      }
      assert(failed[1].failureState.errors.some(s => s.includes("后端连接失败")));
      const findings = failed[1].packagedScriptFindings;
      assert(findings.some(f => f.marker === "http://127.0.0.1:8278" && /const \w+="http:\/\/127\.0\.0\.1:8278"/.test(f.excerpt)));
      assert(findings.some(f => f.marker === "/api/ws/novel"));
      assert(findings.some(f => f.marker === "backend-base-url="));
      return { originalReports: files.map(desc), dynamicPorts: failed.flatMap(f => f.launches.map(l => l.ports[0])),
        failureIsNotReclassifiedAsPass: true, diagnosis: "Novel preflight/realtime client uses static8278 while project API follows host port.",
        defaultPortComparisonIsNotAProductFix: true };
    });
    await check("default-port-four-flow-chain-13-actual-controlled-model-requests-no-replay", () => {
      validate(r); report.featureResults.defaultPortControlledBackendChain = "PASS_CONTROLLED_MODEL_ONLY";
      const parent = read(r.continuation.path);
      assert.equal(sha(r.continuation.path), r.continuation.sha256);
      assert.equal(parent.status, "FAILED"); assert.match(parent.error, /0 !== 1/);
      assert.deepEqual(parent.modelBoundary, r.modelBoundary);
      assert.deepEqual(parent.sockets, r.sockets);
      return { businessFlows: 4, backendModelRequests: 13, newRequestsDuringContinuation: 0,
        originalQaEarlyPersistenceReadFailureRetained: desc(r.continuation.path) };
    });
    await check("validator-rejects-empty-incomplete-wrong-owner-and-fabricated-success", () => {
      const tests = [
        ["empty cases", x => x.cases = []], ["zero model requests", x => x.modelRequests = 0],
        ["wrong model stage", x => x.modelBoundary[0].stage = "fake"], ["paid request", x => x.realModelRequests = 1],
        ["unapproved endpoint", x => x.sockets.find(s => s.controlledSelection).controlledSelection = false],
        ["replay", x => x.additionalModelCalls = 1], ["not persisted", x => x.completed.project.nodes = x.initial.project.nodes],
        ["missing save", x => x.bundles = []], ["missing restart", x => x.launches.pop()],
        ["wrong backend port", x => x.launches[0].ports[0] = 9999], ["cleanup failed", x => x.cleanups[0].status = "FAILED"],
        ["cache un-restored", x => x.cache.pop()], ["bad input", x => x.blockedNovelWrites.push({ path: "bad" })],
      ];
      for (const [, mutate] of tests) { const bad = structuredClone(r); mutate(bad); assert.throws(() => validate(bad)); }
      return { rejected: tests.map(t => t[0]) };
    });
    await check("actual-native-vnproj-and-readonly-sqlite-contain-same-imported-node-and-session", async () => {
      const artifact = r.bundles[0]; assert.equal(sha(artifact.path), artifact.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(artifact.path), { checkCRC32: true });
      const project = JSON.parse(await zip.file("project.json").async("string"));
      assert.deepEqual(project.nodes, r.completed.project.nodes); assert.deepEqual(project.edges, r.completed.project.edges);
      assert.equal(project.editor_settings.novelPersistence.sessionSnapshot.session_id, r.completed.session.session_id);
      assert(!JSON.stringify(project).includes("test-only-secret"));
      const dbFile = r.finalDatabase.path, copy = path.join(out, "vn_engine.readonly.db");
      assert.equal(sha(dbFile), r.finalDatabase.sha256); fs.copyFileSync(dbFile, copy, fs.constants.COPYFILE_EXCL);
      const db = new DatabaseSync(copy, { readOnly: true });
      let p;
      try {
        const all = db.prepare("SELECT project_json FROM editor_project_details").all(); assert.equal(all.length, 1);
        p = JSON.parse(all[0].project_json);
      } finally { db.close(); }
      assert.equal(p.project_id, project.project_id); assert.deepEqual(p.nodes, project.nodes); assert.deepEqual(p.edges, project.edges);
      assert.equal(p.editor_settings.novelPersistence.sessionSnapshot.ai_stage, "report");
      assert.equal(sha(copy), r.finalDatabase.sha256); assert(!fs.readFileSync(copy).includes(Buffer.from("test-only-secret")));
      return { nativeBundle: artifact, database: r.finalDatabase, readOnlyCopy: desc(copy),
        assets: project.asset_manifest.map(a => ({ id: a.asset_id, kind: a.kind, filename: a.filename })),
        fullExportOrPlayerConsumptionClaim: false };
    });
    await check("three-native-pngs-and-product-tool-copies-provenance", () => {
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        validateNativeViewport(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
        const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
      }
      for (const f of [...r.sources, ...r.tools, ...r.inputs, ...r.protectedFiles]) assert.equal(sha(f.path), f.sha256);
      for (const f of r.checkpoint) assert.equal(sha(f.copy), f.sha256);
      const install = read(r.installation.path); assert.equal(sha(r.installation.path), r.installation.sha256);
      for (const f of [install.executable, ...install.resources]) assert.equal(sha(f.path), f.sha256);
      return { screenshots: 3, protectedProducts: r.protectedFiles.length, actualEditor: "1.9.22", newProductBuilds: 0 };
    });
    await check("all-four-attempts-secrets-cache-processes-and-ports-finally-clean", () => {
      const all = ["01", "02", "03", attempt].map(n => read(path.join(qa, `session-${n}`, "report.json")));
      const known = new Set(all.flatMap(t => [...(t.inheritedKnownProcesses || []), ...t.knownProcesses])
        .map(p => `${p.ProcessId}:${p.Created}`));
      const ports = [...new Set(all.flatMap(t => [...t.launches.flatMap(l => l.ports), +new URL(t.endpoint).port]))];
      for (const t of all) {
        for (const k of ["cleanupError", "cacheError", "finalizationError", "credentialCleanupError"]) assert(!t[k]);
        assert.equal(t.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
        assert.equal(t.cache.at(-1).action, "Restore"); assert(t.cache.every(c => c.exitCode === 0));
        assert(!fs.readFileSync(t.finalDatabase.path).includes(Buffer.from("test-only-secret")));
        for (const f of t.checkpoint) assert.equal(sha(f.copy), f.sha256);
        const cache = read(path.join(t.environment.AGENTVN_WORKSPACE_OUTPUT, "native-cache-restoration.json"));
        assert.equal(cache.status, "PASS"); assert.equal(cache.deletedUserFiles, 0);
        for (const f of cache.originalFiles) assert.equal(sha(path.join(cache.originalDirectory, f.relative)), f.sha256);
      }
      const survivors = rows().filter(p => known.has(`${p.ProcessId}:${p.Created}`)), live = listeners(ports);
      assert.equal(survivors.length, 0); assert.equal(live.length, 0);
      return { ownedProcessIdentities: known.size, ports, survivors, listeners: live, paidRequests: 0, userFilesDeleted: 0 };
    });
    report.status = report.evidenceStatus = "PASS";
  } catch (e) { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, featureResults: report.featureResults, checks: report.checks.length,
      out, error: report.error })); }
}
if (require.main === module) run(process.argv[2], process.argv[3]);
module.exports = { validate };
