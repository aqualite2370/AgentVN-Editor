"use strict";
// One consolidated provenance, coverage, byte-level capture and cleanup check.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Assistant-Queue-1.9.35-20261102-01";
const firstPlayerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/assistant-queue-consumer-01";
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/assistant-queue-consumer-02";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const evidenceFile = path.join(qa, "queue-and-consumption-evidence.json");
assert(!fs.existsSync(evidenceFile));
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], modelRequests: 0, productChanges: 0, builds: 0 };
function check(name, fn) {
  const item = { name, status: "RUNNING" }; report.checks.push(item);
  try { item.detail = fn(); item.status = "PASS"; }
  catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
}
let queue, editor, player, fresh, firstPlayer;
try {
  const files = [path.join(qa, "session-01/report.json"), path.join(qa, "session-04/report.json"),
    path.join(playerRoot, "report.json"), path.join(qa, "session-05/report.json"),
    path.join(firstPlayerRoot, "report.json")];
  [queue, editor, player, fresh, firstPlayer] = files.map(read); report.inputs = files.map(desc);
  check("queue-six-actual-cases-twelve-unique-lock-combinations-and-exact-four-controlled-requests", () => {
    assert.equal(queue.status, "PASS"); assert.equal(queue.cases.length, 6);
    assert(queue.cases.every(c => c.status === "PASS")); assert.equal(queue.lockMatrix.length, 12);
    assert.equal(new Set(queue.lockMatrix.map(m => [m.width, m.height, m.dpr, m.reduced].join("/"))).size, 12);
    assert.equal(queue.submissions.length, 4);
    assert(queue.submissions.every(s => s.accepted.status === 202 && s.id === s.accepted.id));
    assert.equal(queue.modelBoundary.length, 4);
    assert.deepEqual(queue.modelBoundary.map(r => r.marker).sort(), ["HISTORY_A", "QUEUE_A", "QUEUE_C", "QUEUE_D"]);
    assert.equal(queue.providerCleanup.maxConcurrentCreation, 1); assert(queue.providerCleanup.stopped);
    assert.equal(queue.realModelRequests, 0); assert.equal(queue.blockedModelRequests, 0);
    assert.equal(queue.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
    assert.equal(queue.cacheRestoration, "PASS"); assert.deepEqual(queue.errors, []);
    assert(queue.cleanups.length === 2 && queue.cleanups.every(c => c.status === "PASS"));
    return { cases: 6, matrix: 12, controlledRequests: 4, paidRequests: 0, maxConcurrentCreation: 1 };
  });
  check("retained-source-binding-originals-and-executed-qa-sources", () => {
    const binding = read(path.join(qa, "binding.json"));
    for (const f of [binding.original, binding.adapter, binding.executed, binding.installation]) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(path.join(qa, "session-04/executed.cjs")), sha("scripts/current-assistant-draft-consumption.cjs"));
    assert.equal(sha(path.join(playerRoot, "executed.cjs")), sha("scripts/current-assistant-draft-player.cjs"));
    for (const source of [queue, editor, player, fresh])
      for (const f of [...(source.products || []), ...(source.sources || []), ...(source.tools || [])])
        assert.equal(sha(f.path), f.sha256);
    for (const f of [editor.source, editor.continuedFrom, editor.projectArtifact, editor.cartridge,
      player.source, player.cartridge, player.executable, fresh.source, fresh.input]) assert.equal(sha(f.path), f.sha256);
    return { bindings: desc(path.join(qa, "binding.json")), productEdits: 0 };
  });
  check("reviewed-merge-native-save-restart-export-and-player-navigation-completion", () => {
    assert.equal(editor.status, "PASS"); assert.equal(editor.cases.length, 5);
    assert(editor.cases.every(c => c.status === "PASS")); assert.equal(editor.matrix.length, 12);
    assert.equal(editor.modelRequests, 0); assert.equal(editor.blockedModelRequests, 0);
    assert(editor.downloadCleanup.removed && editor.downloadCleanup.userFilesDeleted === 0);
    assert(!fs.existsSync(editor.downloadCleanup.original));
    assert.deepEqual(editor.mergedProject.editor_settings.runtimeUILayoutProfiles,
      editor.reopenedProject.editor_settings.runtimeUILayoutProfiles);
    assert.deepEqual(editor.cartridge.layout, editor.reopenedProject.editor_settings.runtimeUILayout);
    assert.equal(player.status, "PASS"); assert.equal(player.cases.length, 12);
    assert(player.cases.every(c => c.status === "PASS" && c.focus && c.action.actualNavigation && c.action.returnedToTitle));
    assert.equal(player.realStoryStart.status, "PASS");
    assert.deepEqual(player.pageErrors, []);
    assert.deepEqual(player.defaultPlacement, editor.defaultRect);
    assert.equal(fresh.status, "PASS");
    assert(fresh.result.bothProfiles && fresh.result.graphAndEdges && fresh.result.mergedComponentRetained);
    assert.equal(fresh.blockedModelRequests, 0); assert.equal(fresh.modelRequests, 0);
    assert.equal(firstPlayer.status, "FAILED"); assert.equal(firstPlayer.cleanup.status, "PASS");
    assert(firstPlayer.cases.length === 12 && firstPlayer.cases.every(c => c.custom.hit
      && c.titleControls.length === 3 && c.titleControls.every(n => n.geometry.hit)));
    return { editorCases: 5, editorMatrix: 12, playerMatrix: 12, actualStoryStart: true,
      originalDefaultPlacement: editor.defaultRect, freshDatabasePortableReopen: true,
      combinedCoverage: "Initial completed title/forward checks plus separate actual shared-return checks; initial FAILED retained" };
  });
  check("every-capture-actual-viewport-dpr-and-png-bytes", () => {
    const captures = [queue, editor, player, firstPlayer, fresh].flatMap(r => r.screenshots);
    assert(captures.length >= 27);
    for (const c of captures) {
      assert.equal(sha(c.path), c.sha256); assert.deepEqual(c.before, c.after);
      const bytes = fs.readFileSync(c.path);
      assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a");
      assert.equal(bytes.readUInt32BE(16), c.png.width); assert.equal(bytes.readUInt32BE(20), c.png.height);
      assert(Math.abs(c.before.width * c.before.dpr - c.png.width) < 0.01);
      assert(Math.abs(c.before.height * c.before.dpr - c.png.height) < 0.01);
    }
    return { captures: captures.length, logicalViewportNotPhysicalDisplay: true };
  });
  check("stopped-process-port-and-original-profile-restoration", () => {
    assert(editor.cleanups.every(c => c.status === "PASS")); assert.equal(player.cleanup.status, "PASS");
    assert(fresh.cleanups.every(c => c.status === "PASS"));
    assert.equal(read(fresh.cacheRestoration.path).status, "PASS");
    assert.equal(read(editor.cacheRestoration.path).status, "PASS");
    const restoration = path.join(playerRoot, "profile-restoration.json");
    assert.equal(read(restoration).status, "PASS");
    const identities = [queue, editor, player, firstPlayer, fresh].flatMap(r => r.knownProcesses || []);
    const live = rows();
    assert(!live.some(p => identities.some(q => p.ProcessId === q.ProcessId && p.Created === q.Created)));
    const ports = [...queue.launches, ...editor.launches, ...fresh.launches].flatMap(l => l.ports)
      .concat(player.launch.port, firstPlayer.launch.port);
    assert.equal(listeners(ports).length, 0);
    return { knownProcessIdentities: identities.length, ports: [...new Set(ports)].length, remainingOwned: 0,
      playerRestoration: desc(restoration), userFilesDeleted: 0 };
  });
  check("original-and-resumed-native-databases-retain-only-test-credential-free-projects", () => {
    const results = [];
    for (const leaf of ["session-01", "session-02", "session-03", "session-04"]) {
      const file = path.join(qa, leaf, "data/backend/vn_engine.db");
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const details = db.prepare("SELECT project_id,project_json FROM editor_project_details").all();
        assert.equal(details.length, 2);
        assert(details.every(d => d.project_id.startsWith("qa-installed-lifecycle-")));
        const b = JSON.parse(details.find(d => d.project_id.includes("-b-")).project_json);
        const components = b.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title")
          .components.filter(c => c.component_type === "custom_component");
        assert.equal(components.length, leaf === "session-01" ? 0 : 1);
        if (components.length) assert.equal(components[0].label, "QUEUE_C组件");
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        for (const t of tables) {
          assert(/^[a-zA-Z0-9_]+$/.test(t.name));
          const records = db.prepare(`SELECT * FROM "${t.name}"`).all();
          assert(!records.some(r => JSON.stringify(r).includes("test-only-secret")), "Test credential was not cleared");
        }
        results.push({ leaf, projects: 2, mergedComponents: components.length, credentialFound: false });
      } finally { db.close(); }
    }
    return results;
  });
  assert.equal(report.checks.length, 6); report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, evidenceFile, error: report.error }));
