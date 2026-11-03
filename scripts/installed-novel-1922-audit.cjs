"use strict";
// Audit archived observations and actual bytes, independently of the runner.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const { assertFloatingMotion } = require("./lib/floating-motion-probe.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Installed-Novel-1922-20261022-01";
const sha = f => sha256(fs.readFileSync(f));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const stages = [
  "installed-task-recovery-and-real-project-entry",
  "installed-high-resolution-card-workspace-motion-and-focus-matrix",
  "installed-dismiss-card-keeps-refresh-and-toolbar-reveals-same-task",
  "installed-drag-threshold-project-position-and-real-process-restart",
  "installed-pointer-capture-cancel-and-nonmodal-workspace",
  "installed-slow-refresh-single-flight-and-task-controls",
  "installed-late-action-and-result-reject-A-B-A-ownership",
  "installed-results-failure-retry-real-navigation-idempotence-and-chapter-append",
  "installed-native-save-confirmation-priority-and-floating-focus",
];
function validate(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt); assert.equal(r.version, "1.9.22");
  assert.equal(r.productChanges, 0); assert.equal(r.realModelRequests, 0);
  assert.equal(r.sourceUnchanged, true); assert.deepEqual(r.errors, []); assert.deepEqual(r.forbiddenRequests, []);
  for (const k of ["cleanupError", "cacheRestoreError", "error"]) assert(!r[k]);
  assert.deepEqual(r.cases.map(c => c.name), stages); assert(r.cases.every(c => c.status === "PASS"));
  assert.equal(r.matrix.length, 12);
  const keys = new Set(r.matrix.map(m => `${m.width}:${m.height}:${m.dpr}:${m.reduced}`));
  assert.equal(keys.size, 12);
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) assert(keys.has(`${width}:${height}:${dpr}:${reduced}`));
  for (const m of r.matrix) {
    const expected = { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced };
    assert.equal(m.status, "PASS");
    validateNativeViewport(m.actualBefore, expected); validateNativeViewport(m.actualAfter, expected);
    for (const [key, duration, minOpacity] of [["entry", 240, 0], ["exit", 240, 0], ["redirect", 240, 0], ["token", 160, .65]]) {
      const summary = assertFloatingMotion(m[key], m, { reduced: m.reduced, duration: m.reduced ? 80 : duration, minOpacity });
      assert.deepEqual(summary, m[key + "Summary"]);
      for (const f of m[key].frames.filter(f => f.rendered)) validateNativeViewport({ ...f.viewport, reduced: m.reduced }, expected);
    }
    const g = m.geometry;
    assert(g.hit && g.progress === "50" && g.nestedButtons === 0 && g.overflow <= 1);
    assert(g.card.width >= 138 && g.card.width <= 142 && g.card.height >= 80 && g.card.height <= 96);
    assert(g.card.x >= 12 && g.card.y >= g.toolbar.bottom + 11 && g.card.right <= m.width - 12 && g.card.bottom <= g.status.top - 11);
    assert(m.footer.length > 0 && m.footer.every(b => b.hit && b.contained));
    assert(m.redirectInput.hit && m.redirectInput.previousInert);
  }
  assert(r.cases[2].continuedPanelReads > 0);
  const drag = r.cases[3], pointer = r.cases[4];
  assert(Math.abs(drag.initial.x - drag.small.x) < 1 && Math.abs(drag.initial.y - drag.small.y) < 1);
  assert(drag.initial.x - drag.moved.x > 100 && drag.initial.y - drag.moved.y > 40);
  assert(drag.saved.x >= 0 && drag.saved.x <= 1 && drag.saved.y >= 0 && drag.saved.y <= 1);
  for (const n of ["nativePositionBeforeRestart", "nativePositionAfterRestart"]) {
    assert.equal(r[n].data.schemaVersion, 1); assert.deepEqual(r[n].data.position, drag.saved);
  }
  assert.equal(r.nativePositionReset.data.position, null);
  assert.deepEqual(r.restartProbe.restored.saved, drag.saved);
  for (const k of ["x", "y", "width", "height"]) assert(Math.abs(drag.restored[k] - drag.moved[k]) < 2);
  assert.equal(pointer.captureLoss, "PASS"); assert.deepEqual(pointer.singlePointer, pointer.extraPointer);
  for (const track of ["palette", "flow", "inspector"]) for (const k of ["x", "y", "width", "height"])
    assert(Math.abs(pointer.before[track][k] - pointer.after[track][k]) < 1);
  const controls = r.cases[5], late = r.cases[6], result = r.cases[7], modal = r.cases[8];
  assert(controls.reads.length >= 3);
  for (const [i, p] of controls.reads.entries()) {
    assert(p.browserFinished && p.end - p.start >= 1100);
    assert(!controls.reads.slice(i + 1).some(n => n.start < p.end));
  }
  assert.deepEqual(controls.operations.map(o => o.operation), ["pause", "resume", "retry_failed_chunks", "cancel"]);
  assert(controls.operations.every(o => o.method === "POST" && o.browserFinished));
  assert.deepEqual(late.staleActionSuccessAndError.map(d => d.failure), [false, true]);
  assert(late.staleActionSuccessAndError.every(d => d.response.held && d.response.browserFinished));
  assert.equal(late.staleActionSuccessAndError[1].response.controlledFailure, "controlled-stale-action-error");
  assert.equal(late.staleAbaResult, "PASS");
  assert.deepEqual(result.first, result.repeated);
  assert.equal(result.appended.nodes.length, result.first.nodes.length + 1);
  assert.equal(result.appended.edges.length, result.first.edges.length + 1);
  assert(modal.priority.hit && modal.priority.focus); assert.equal(modal.exportedFiles.length, 1);
  assert.equal(r.importedNodes.length, 2);
  const launchCount = r.continuation ? 3 : 2;
  assert.equal(r.launches.length, launchCount); assert.equal(r.cleanup.length, launchCount);
  assert.equal(r.nativeSession.launches.length, launchCount); assert.equal(r.nativeSession.cleanups.length, launchCount);
  assert.deepEqual(r.nativeSession.errors, []); assert.equal(r.nativeSession.blockedModelRequests || 0, 0);
  assert.equal(r.normalWindowClose.status, "NOT_RUN");
  for (const launch of r.nativeSession.launches) {
    assert(launch.dataDirectoryOverride && launch.webviewDirectoryOverride && !launch.sourceServer && !launch.manualBackendSpawn);
    assert.equal(launch.executable.sha256, "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc");
    assert.equal(launch.backend.ParentProcessId, launch.pid);
    assert.equal(launch.listeners.length, 2);
  }
  for (const c of r.cleanup) assert(c.editor.exitCode === 0 && c.backend.exitCode === 0 && c.normalCloseClaimed === false);
  assert(r.nativeSession.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
  assert.equal(r.portCleanup.status, "PASS");
  assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]); assert(r.cache.every(c => c.exitCode === 0));
  assert.equal(r.screenshots.length, 14);
  return { cases: 9, matrices: 12, probes: 48 };
}
async function run(attempt, auditAttempt) {
  assert.match(attempt, /^\d{2}$/); assert.match(auditAttempt, /^\d{2}$/);
  const session = path.join(qa, `session-${attempt}`), out = path.join(qa, `audit-${auditAttempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(session, "report.json"), r = read(file);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), sourceReport: desc(file), checks: [],
    realModelRequests: 0, productChanges: 0, notProven: ["Real novel backend/model execution", "Native normal close/picker",
      "Standalone Windows/Android export/upgrade", "All story branches"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function check(name, fn) {
    const c = { name, status: "RUNNING" }; report.checks.push(c); save();
    try { c.detail = await fn(); c.status = "PASS"; save(); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  }
  try {
    await check("complete-nine-flows-12-displays-and-48-continuous-motion-probes", () => validate(r));
    await check("evidence-validator-rejects-incomplete-and-fabricated-success", () => {
      const tests = [
        ["empty cases", x => x.cases = []], ["empty matrix", x => x.matrix = []],
        ["duplicate display", x => x.matrix[1] = x.matrix[0]], ["DPR mismatch", x => x.matrix[0].actualBefore.dpr = 2],
        ["no intermediate frames", x => x.matrix[0].entry.frames = []],
        ["obsolete width", x => x.matrix[0].geometry.card.width = 280],
        ["wrong native position", x => x.nativePositionAfterRestart.data.position = null],
        ["overlap polling", x => x.cases[5].reads[1].start = x.cases[5].reads[0].start],
        ["missing late rejection", x => x.cases[6].staleAbaResult = "NOT_RUN"],
        ["duplicate imported chapter", x => x.importedNodes.push(x.importedNodes[0])],
        ["cleanup failed", x => x.nativeSession.cleanups[0].status = "FAILED"],
        ["cache not restored", x => x.cache.pop()], ["wrong owner executable", x => x.nativeSession.launches[0].executable.sha256 = "bad"],
        ["paid call", x => x.realModelRequests = 1], ["missing screenshot", x => x.screenshots.pop()],
      ];
      for (const [, mutate] of tests) { const bad = structuredClone(r); mutate(bad); assert.throws(() => validate(bad)); }
      return { rejected: tests.map(t => t[0]) };
    });
    await check("native-save-package-and-readonly-database-match-chapters-and-isolate-other-project", async () => {
      const last = r.cases[8], pack = path.join(last.exportDirectory, last.exportedFiles[0]);
      const zip = await JSZip.loadAsync(fs.readFileSync(pack));
      const project = JSON.parse(await zip.file("project.json").async("string"));
      const imported = project.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === "installed-floating-a");
      assert.equal(imported.length, 2); assert.deepEqual(imported, r.importedNodes);
      assert.deepEqual(project.nodes.map(n => n.id), r.cases[7].appended.nodes);
      assert.deepEqual(project.edges.map(e => e.id), r.cases[7].appended.edges);
      const dbFile = r.launches.at(-1).databasePath, original = desc(dbFile), copy = path.join(out, "vn_engine.readonly.db");
      fs.copyFileSync(dbFile, copy, fs.constants.COPYFILE_EXCL);
      const db = new DatabaseSync(copy, { readOnly: true });
      try {
        const all = db.prepare("SELECT project_json FROM editor_project_details").all().map(row => JSON.parse(row.project_json));
        assert.equal(all.length, 2);
        const a = all.find(p => p.project_id === project.project_id), b = all.find(p => p.project_id !== project.project_id);
        assert.deepEqual(a.nodes, project.nodes); assert.deepEqual(a.edges, project.edges);
        assert.equal(b.nodes.length, 2);
        for (const p of [a, b]) assert(p.nodes.some(n => n.data.editorMeta?.sourceProcessJobId === "unrelated-completed-task"));
        assert(!b.nodes.some(n => n.data.editorMeta?.sourceProcessJobId === "installed-floating-a"));
        const records = db.prepare("SELECT count(*) AS total FROM novel_processing_records").get();
        assert.equal(records.total, 0, "Controlled HTTP is not real backend task execution");
      } finally { db.close(); }
      assert.equal(sha(dbFile), original.sha256); assert.equal(sha(copy), original.sha256);
      const position = r.nativePositionReset; assert.equal(sha(position.path), position.sha256);
      assert.deepEqual(read(position.path), position.data);
      return { nativePackage: { ...desc(pack), modifiedAt: fs.statSync(pack).mtime.toISOString() }, database: original,
        readonlyCopy: desc(copy), nativePosition: desc(position.path), backendJobs: 0, chapterCount: 2 };
    });
    await check("actual-source-tools-protected-products-and-installation-bytes-unchanged", () => {
      for (const f of [...r.tools, ...r.protectedFiles]) assert.equal(sha(f.path), f.sha256, f.path);
      for (const f of r.executedTools) assert.equal(sha(f.copy), f.sha256, f.copy);
      for (const f of r.checkpoint) assert.equal(sha(path.resolve("D:/AgentVN", f.file)), f.sha256, f.file);
      const install = r.installation;
      for (const f of [install.executable, ...install.resources]) assert.equal(sha(f.path), f.sha256);
      if (r.continuation) {
        assert.equal(sha(r.continuation.path), r.continuation.sha256);
        const parent = read(r.continuation.path);
        assert.equal(parent.status, "FAILED"); assert.match(parent.error, /releasePointerCapture/);
        assert.deepEqual(parent.matrix, r.matrix);
        for (const f of parent.executedTools) assert.equal(sha(f.copy), f.sha256);
      }
      return { executedTools: r.tools.length, protectedFiles: r.protectedFiles.length, sources: r.checkpoint.length,
        editorPE: "1.9.22", playerPE: "1.9.1", compiledThisRun: false };
    });
    await check("14-native-png-dimensions-and-real-viewport-unchanged-by-capture", () => {
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        const m = r.matrix.find(m => m.width === s.before.width && m.height === s.before.height
          && Math.abs(m.dpr - s.before.dpr) <= 1e-6 && m.reduced === s.before.reduced);
        assert(m); validateNativeViewport(s.before, m); validateNativeViewport(s.after, m);
        const bytes = fs.readFileSync(s.path);
        assert.equal(bytes.readUInt32BE(16), m.width * m.dpr); assert.equal(bytes.readUInt32BE(20), m.height * m.dpr);
      }
      return { screenshots: r.screenshots.length, sideEffectFreeCDP: true, physical4KClaimed: false };
    });
    await check("cache-restored-and-every-owned-process-and-port-ended", () => {
      const restored = read(path.join(session, "native-cache-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      for (const f of restored.originalFiles) assert.equal(sha(path.join(restored.originalDirectory, f.relative)), f.sha256);
      const known = new Set([...(r.inheritedKnownProcesses || []), ...r.nativeSession.knownProcesses]
        .map(p => `${p.ProcessId}:${p.Created}`));
      const survivors = rows().filter(p => known.has(`${p.ProcessId}:${p.Created}`));
      const ports = [...new Set(r.nativeSession.launches.flatMap(l => l.ports))], live = listeners(ports);
      assert.equal(survivors.length, 0); assert.equal(live.length, 0);
      return { processIdentities: known.size, ports, survivors, listeners: live,
        restoredCacheFiles: restored.originalFiles.length, deletedUserFiles: 0 };
    });
    await check("both-original-qa-failures-retained-and-all-attempt-processes-cleaned", () => {
      const original = ["01", "02"].map(n => path.join(qa, `session-${n}`, "report.json"));
      const failures = original.map(read);
      assert.equal(failures[0].status, "FAILED"); assert.match(failures[0].error, /releasePointerCapture/);
      assert.equal(failures[1].status, "FAILED"); assert.match(failures[1].error, /PNG device width mismatch/);
      const all = [...failures, r], known = new Set(all.flatMap(t =>
        [...(t.inheritedKnownProcesses || []), ...t.nativeSession.knownProcesses]).map(p => `${p.ProcessId}:${p.Created}`));
      const ports = [...new Set(all.flatMap(t => t.nativeSession.launches.flatMap(l => l.ports)))];
      for (const t of all) {
        assert(t.finishedAt && !t.cleanupError && !t.cacheRestoreError);
        assert.equal(t.portCleanup.status, "PASS");
        assert.equal(t.cache.at(-1).action, "Restore"); assert(t.cache.every(c => c.exitCode === 0));
        assert.equal(read(path.join(path.dirname(t.environment.AGENTVN_TEST_PROJECT), "native-cache-restoration.json")).status, "PASS");
        for (const f of t.executedTools) assert.equal(sha(f.copy), f.sha256);
      }
      const survivors = rows().filter(p => known.has(`${p.ProcessId}:${p.Created}`)), live = listeners(ports);
      assert.equal(survivors.length, 0); assert.equal(live.length, 0);
      return { preserved: original.map(desc), ownedProcessIdentities: known.size, ports, survivors, listeners: live,
        reranPassedDisplayMatrix: false, paidRetry: false };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report)); }
}
if (require.main === module) run(process.argv[2], process.argv[3]);
module.exports = { validate, stages };
