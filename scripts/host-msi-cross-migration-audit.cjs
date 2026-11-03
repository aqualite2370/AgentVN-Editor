"use strict";
// Read only: actual databases created by the installed 1.7.1 and 1.9.9 backends.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const [phaseRoot, destination, explicitSnapshot] = process.argv.slice(2);
assert(phaseRoot && destination && !fs.existsSync(destination), "Fresh migration audit required");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_171_INSTALL_LOCAL_DATABASE_TO_199_SHARED_DATABASE_AFTER_NATIVE_USER_CONSENT_AND_RESTART",
  checks: [], sources: [], error: null };
function source(file) { result.sources.push({ path: file, sha256: sha(file) }); return read(file); }
function database(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    return { path: file, sha256: sha(file),
      summaries: db.prepare("SELECT project_id,title,author FROM editor_project_summaries ORDER BY project_id").all(),
      projects: db.prepare("SELECT project_id,project_json FROM editor_project_details ORDER BY project_id").all()
        .map(row => ({ id: row.project_id, project: JSON.parse(row.project_json) })) };
  } finally { db.close(); }
}
try {
  const baseline = source(path.join(phaseRoot, "old-ui-data-created.json"));
  const first = source(path.join(phaseRoot, "new-ui-01/report.json"));
  const restart = source(path.join(phaseRoot, "restart-ui-01/report.json"));
  // English evidence has a chain02 subdirectory; Chinese evidence lives directly
  // in its language directory. Accept an explicit existing snapshot rather than
  // guessing a different baseline or modifying the original evidence tree.
  const snapshot = source(explicitSnapshot ||
    path.join(path.dirname(phaseRoot), "before-upgrade-snapshot.json"));
  for (const row of [baseline, first, restart, snapshot]) assert.equal(row.status, "PASS");
  const oldPath = path.join(baseline.launch.installRoot, "data/backend/vn_engine.db");
  const original = snapshot.files.find(file => path.resolve(file.source) === path.resolve(oldPath));
  assert(original, "Actual old database snapshot missing");
  assert.equal(sha(oldPath), original.sha256); assert.equal(sha(original.backup), original.sha256);
  result.checks.push("Original real 1.7.1 database bytes match pre-upgrade backup after migration and restart");
  const targetPath = restart.version === "1.9.9" ?
    "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db" : null;
  assert(targetPath);
  const decisionPath = path.join(path.dirname(targetPath), "database-migration-decision.json");
  const decision = source(decisionPath);
  assert.equal(decision.approved, true); assert.equal(decision.sources.length, 1);
  assert.equal(path.resolve(decision.sources[0]), path.resolve(oldPath));
  result.nativeConsent = { path: decisionPath, ...decision };
  result.checks.push("Real native approval records exact old installed database source; not injected");
  const old = database(oldPath), current = database(targetPath);
  const id = baseline.project.metadata.projectId;
  for (const state of [old, current]) {
    assert.equal(state.summaries.length, 1); assert.equal(state.projects.length, 1);
    assert.equal(state.summaries[0].project_id, id); assert.equal(state.projects[0].id, id);
    assert.equal(state.summaries[0].title, baseline.project.metadata.title);
    assert.equal(state.summaries[0].author, baseline.project.metadata.author);
  }
  const before = old.projects[0].project, after = current.projects[0].project;
  assert.deepEqual(before.nodes.map(node => node.id).sort(), after.nodes.map(node => node.id).sort());
  assert.deepEqual(before.edges, after.edges);
  for (const node of before.nodes.filter(node => node.data?.scene)) {
    const migrated = after.nodes.find(item => item.id === node.id);
    assert.equal(migrated.data.scene.scene_id, node.data.scene.scene_id);
    assert.deepEqual(migrated.data.scene.commands, node.data.scene.commands);
  }
  assert.equal(after.nodes.find(node => node.id === "node_scene_opening").data.scene.summary,
    "覆盖升级后实际编辑保存_1.9.9_20261018");
  result.checks.push("Actual old/new SQLite integrity, project count/identity, nodes, edges and scene commands preserved");
  result.checks.push("Actual shared SQLite contains the newly saved 1.9.9 edit after a new-process restart");
  const initial = source(path.join(phaseRoot, "new-capture-audit.json"));
  const again = source(path.join(phaseRoot, "restart-capture-audit.json"));
  assert.notEqual(initial.processes.find(p => p.Name === "agentvn-editor.exe").ProcessId,
    again.processes.find(p => p.Name === "agentvn-editor.exe").ProcessId);
  assert.equal(initial.defaultDatabase.path, again.defaultDatabase.path);
  result.databases = { old, current };
  result.checks.push("Different actual installed Editor processes use the same default shared database");
  result.limitations = ["Controlled attributed termination for restart; physical close not verified in this slice",
    "No old-version AI-session/component UI existed; not evidence of migrating newer features",
    "Actual recorded viewport only, not a full UI matrix"];
  result.status = "PASS";
} catch (error) { result.status = "FAILED"; result.error = String(error.stack || error); process.exitCode = 1; }
finally {
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, checks: result.checks, error: result.error }, null, 2));
}
