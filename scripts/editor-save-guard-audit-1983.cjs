"use strict";
// Independent retained-evidence checks. No product reruns, build or account mutation.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), release = "F:/testavn/Editor-Save-Guard-Release-1983-20261116-01";
const base = "F:/testavn/Windows-Isolated-1983-20261116-02", prior = "F:/testavn/Windows-Isolated-1983-20261116-01";
const output = path.join(base, "functional-audit.json"); assert(!fs.existsSync(output));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [], inputs: [],
  builds: 0, productLaunches: 0, scope: "CURRENT1983_SAVE_GUARD_INSTALL_PLUS_RETAINED_T01_T08_EVIDENCE_NOT_NEW_ANDROID_MATRIX" };
function input(file) { report.inputs.push({ path: file, sha256: sha(file) }); return read(file); }
function verify(file) { assert.equal(sha(file.path), file.sha256); }
function group(name, fn) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; } catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
}
const graph = project => ({ nodes: project.nodes.map(node => ({ id: node.id, data: node.data, position: node.position })),
  edges: project.edges.map(({ selected, ...edge }) => edge) });
try {
  const build = input(path.join(release, "release/build.json")), checkpoint = input(path.join(release, "checkpoint.json"));
  const run = input(path.join(base, "resource-01/report.json"));
  group("direct-browser-persistence-and-actual-project-source-layout", () => {
    for (const [folder, count] of [["after", 21], ["browser", 8], ["persistence", 22], ["project-layout", 18]]) {
      const evidence = input(`F:/testavn/Editor-Save-Guard-20261116-01/${folder}/report.json`);
      assert.equal(evidence.status, "PASS"); assert.equal(evidence.cases.length, count);
      assert(evidence.cases.every(row => row.status === "PASS"));
      if (folder === "project-layout") assert.equal(sha(evidence.source.path), evidence.source.sha256);
    }
    return { direct: 21, sourceBrowser: 8, persistence: 22, suppliedLayout: 18, originalNaturalLossReproduced: false };
  });
  group("unique-native-build-runtime-unchanged-and-actual-install", () => {
    const stages = input(path.join(release, "build-stages.json"));
    assert.equal(stages.status, "PASS_BUILD_NOT_INSTALLED"); assert.equal(stages.stages.length, 4);
    assert(stages.stages.every(row => row.status === "PASS")); assert.equal(build.version, "1.9.83");
    assert.equal(build.nativePlayerBuilds, 0);
    for (const file of [build.installer, build.dev, build.player, build.backend, build.payloadReport]) verify(file);
    assert.equal(build.player.sha256, checkpoint.frozen.player.sha256);
    const actual = input(path.join(prior, "install-new.json"));
    assert.equal(actual.status, "PASS"); assert.equal(actual.executable.version, "1.9.83"); verify(actual.executable);
    const payload = input(build.payloadReport.path); assert.equal(payload.status, "PASS");
    assert.equal(actual.executable.sha256, payload.deployments.find(item => item.kind === "NSIS actual payload").executable.sha256);
    return { version: "1.9.83", actualInstalls: 1, rebuilds: 0, followupReinstalls: run.installations, runtime: "0.32.0" };
  });
  group("installed-continuous-save-rejected-navigation-history-and-restart", () => {
    assert.equal(run.status, "PASS"); assert.equal(run.cleanupStatus, "PASS"); assert.equal(run.stages.length, 9);
    assert(run.stages.every(row => row.status === "PASS")); assert.deepEqual(run.errors, []);
    assert.equal(run.launches.length, 2); assert.equal(run.launches[0].database, run.launches[1].database);
    assert(run.launches.every(row => !row.dataDirectoryOverride && !row.webviewDirectoryOverride && !row.sourceServer));
    assert.equal(run.cleanups.length, 2); assert(run.cleanups.every(row => row.method === "WM_CLOSE" && row.killed.length === 0));
    assert.equal(run.modelRequests, 0); assert.equal(run.blockedModelRequests || 0, 0);
    assert.equal(run.backupEvidence.length, 4);
    for (const file of run.backupEvidence) { verify(file); verify(file.metadata); }
    assert.equal(run.screenshots.length, 4); for (const file of run.screenshots) verify(file);
    const before = input(path.join(base, "resource-01/before-restore-native-backup.vnproj"));
    const target = input(path.join(base, "resource-01/timeline-target.vnproj"));
    assert.deepEqual(before.nodes.find(n => n.id === "scene").data.scene.commands.map(c => c.duration_ms), [500, 200, 300]);
    assert.deepEqual(target.nodes.find(n => n.id === "scene").data.scene.commands.map(c => c.duration_ms), [400, 200, 300]);
    return { stages: 9, sameDefaultQaProfile: true, nativeBackupFiles: 4, normalCloses: 2,
      faultInjection: run.faultInjection, display: "1920x1080_DPR1_NORMAL_ONLY", notPhysicalCloseInput: true };
  });
  group("qa-accounts-retired-and-retained-database-content", () => {
    for (const [directory, receipt] of [[prior, "aborted-qa-retirement-02.json"], [base, "account-retirement-01.json"]]) {
      const retired = input(path.join(directory, receipt));
      assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
      assert(!fs.existsSync(retired.account.profile));
    }
    const retired = input(path.join(base, "account-retirement-01.json")); verify(retired.databaseEvidence);
    const db = new DatabaseSync(retired.databaseEvidence.path, { readOnly: true });
    try {
      const project = JSON.parse(db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?")
        .get("qa-editor-save-guard-1983").project_json);
      assert.equal(project.title, "安装版失败后保留修改1983");
      assert.deepEqual(graph(project), input(path.join(base, "resource-01/expected-graph.json")));
    } finally { db.close(); }
    return { retiredAccounts: 2, retiredProfiles: 2, finalGraphReadback: true, priorQaAbortPreserved: true };
  });
  group("retained-full-goal-evidence-and-protected-user-scope", () => {
    const old = input("F:/testavn/Goal-Scope-Audit-20261116-01/report.json");
    assert.equal(old.rows.length, 8); assert.equal(old.inputs.length, 12);
    for (const file of old.inputs) { verify(file); report.inputs.push(file); }
    const organize = input("F:/testavn/Windows-Isolated-1982-20261116-01/terminal-audit-01.json");
    assert.equal(organize.status, "PASS"); assert.equal(organize.groups.length, 5);
    for (const file of [checkpoint.daily, checkpoint.frozen.installer, checkpoint.frozen.player, checkpoint.git.index, ...checkpoint.sources]) verify(file);
    const head = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true, encoding: "utf8" }).trim();
    assert.equal(head, checkpoint.git.head);
    return { retainedTasks: old.rows.map(row => row.id), dailyUserProjectsAndNovelUntouched: true,
      realGitHeadIndexPreserved: true, userWaivedForensicItemsNotMarkedPass: true,
      nativeAndroidEvidenceInheritedNotRerun: true };
  });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, groups: report.groups.map(row => ({ name: row.name, status: row.status })), error: report.error }));
}
