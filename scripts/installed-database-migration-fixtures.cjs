"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")), sha = p => sha256(fs.readFileSync(p));
const run = "D:/AgentVN/output/installed-database-migration-20261018-01", work = "F:/AgentVN-QA-InstalledDatabaseMigration-20261018-01";
const action = process.argv[2] || "prepare";
assert(["prepare", "accept", "conflict", "retain-legacy"].includes(action));
const prep = read(path.join(run, "preparation.json")); assert.equal(prep.status, "PASS");
assert(prep.profiles.every(p => fs.existsSync(p.held)));
const idle = spawnSync("powershell.exe", ["-NoProfile", "-Command",
  "$qaLive=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe'});if($qaLive.Count){exit 1}"],
{ encoding: "utf8", windowsHide: true });
assert.equal(idle.status, 0, "Never move QA profiles or legacy inputs with AgentVN alive");
const roaming = "C:/Users/1/AppData/Roaming/com.agentvn.editor", legacyRoot = path.join(prep.installRoot, "data");
const legacy = path.join(legacyRoot, "backend/vn_engine.db");
assert.equal(path.resolve(prep.profiles.find(p => p.app === "editor" && p.kind === "Roaming").original), path.resolve(roaming));
assert.equal(path.resolve(legacyRoot), path.resolve("F:/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/data"));
function snapshot(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const rows = db.prepare("SELECT project_id,project_json FROM editor_project_details ORDER BY project_id").all();
    assert.equal(rows.length, 1);
    const j = JSON.parse(rows[0].project_json); assert.equal(j.project_id, "project_mvcm7xeq_0_83813e8b36");
    return { path: file, sha256: sha(file), bytes: fs.statSync(file).size, project: j };
  } finally { db.close(); }
}
function moveExact(source, target) {
  assert(!fs.existsSync(target)); assert(!fs.lstatSync(source).isSymbolicLink());
  const siblings = ["seed", "cancelled", "accepted"].map(n => path.resolve(`${roaming}.qa-case-database-migration-${n}`));
  assert(path.resolve(target).startsWith(path.resolve(work) + path.sep)
    || path.resolve(source) === path.resolve(roaming) && siblings.includes(path.resolve(target)));
  fs.renameSync(source, target);
}
const file = path.join(run, "fixtures.json");
if (action === "prepare") {
  assert(!fs.existsSync(file)); assert(!fs.existsSync(legacyRoot), "Never replace unknown installed legacy data");
  const source = "F:/AgentVN-QA-HostUpgrade-20261018-02/pre-upgrade-test-data-02/Roaming/backend/vn_engine.db";
  const old = snapshot(source); assert.equal(old.sha256, "1fc4acb108144f8b5168041d33aa660e3ad8772e8aa2efc50860cc3a4f747545");
  const seed = snapshot(path.join(roaming, "backend/vn_engine.db"));
  assert.notEqual(seed.project.nodes.find(n => n.data.scene)?.data.scene.summary, old.project.nodes.find(n => n.data.scene)?.data.scene.summary);
  assert(!fs.existsSync(path.join(roaming, "backend/database-migration-decision.json")));
  const savedRoaming = `${roaming}.qa-case-database-migration-seed`;
  // The default directory contains only this session's verified QA seed;
  // original user profiles are already separately held and never moved here.
  moveExact(roaming, savedRoaming); fs.mkdirSync(roaming);
  fs.mkdirSync(path.dirname(legacy), { recursive: true }); fs.copyFileSync(source, legacy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(legacy), old.sha256);
  const report = { status: "PASS", at: new Date().toISOString(), source: old, seed, savedRoaming,
    legacyRoot, legacy, defaultRoaming: roaming, projectId: old.project.project_id, title: old.project.title,
    input: path.join(work, "真实旧版数据库工程.vnproj"), productChanges: 0, realModelRequests: 0,
    boundary: "Real old-release database copied to current EXE-adjacent legacy path; no consent file or legacy-path environment override" };
  fs.writeFileSync(report.input, JSON.stringify(old.project), { flag: "wx" }); report.inputSha256 = sha(report.input);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
} else {
  const fixture = read(file); assert.equal(sha(legacy), fixture.source.sha256);
  const report = { status: "PASS", at: new Date().toISOString(), action, originalLegacySha256: sha(legacy), productChanges: 0 };
  if (action === "retain-legacy") {
    const destination = path.join(work, "retained-installed-legacy-data"); moveExact(legacyRoot, destination);
    report.retainedRoot = destination; assert(!fs.existsSync(legacyRoot));
  } else {
    const previous = `${roaming}.qa-case-database-migration-${action === "accept" ? "cancelled" : "accepted"}`;
    moveExact(roaming, previous); report.previous = previous;
    if (action === "conflict") fs.cpSync(fixture.savedRoaming, roaming, { recursive: true, errorOnExist: true, force: false });
    else fs.mkdirSync(roaming);
    assert(!fs.existsSync(path.join(roaming, "backend/database-migration-decision.json")));
    if (action === "conflict") assert.equal(sha(path.join(roaming, "backend/vn_engine.db")), fixture.seed.sha256);
  }
  fs.writeFileSync(path.join(run, `${action}-preparation.json`), JSON.stringify(report, null, 2), { flag: "wx" });
}
console.log(`PASS database migration fixture action=${action}; original user profiles remain held`);
