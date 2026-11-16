"use strict";
// Independent evidence review; never launches a product or repeats an accepted matrix.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Windows-Isolated-1985-20261116-03";
const prior = "F:/testavn/Windows-Isolated-1985-20261116-01";
const authorBase = "F:/testavn/Windows-Isolated-1985-20261116-02";
const release = "F:/testavn/Sprite-Animation-Release-1985-20261116-01";
const target = path.join(base, "functional-audit-02.json"); assert(!fs.existsSync(target));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", groups: [], inputs: [], productLaunches: 0, builds: 0, modelRequests: 0 };
function input(f) { report.inputs.push({ path: f, sha256: sha(f) }); return read(f); }
function verify(f) { assert.equal(sha(f.path), f.sha256, f.path); }
function group(name, fn) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; } catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
}
try {
  const build = input(path.join(release, "release/build.json")), checkpoint = input(path.join(release, "checkpoint.json"));
  const run = input(path.join(base, "resource-01/report.json"));
  group("real-stale1984-source-and-new-count-independent-matrices", () => {
    const provenance = input("F:/testavn/Sprite-Animation-Defaults-20261116-01/source-provenance.json");
    assert(provenance.status.startsWith("PASS_CONFIRMED_STALE_1984"));
    verify(provenance.files.payload1984); verify(provenance.files.dailySource);
    for (const [file, count] of [
      ["F:/testavn/Sprite-Animation-Defaults-20261116-01/direct01.json", 7],
      ["F:/testavn/Sprite-Animation-Defaults-20261116-matrix01/report.json", 12],
      ["F:/testavn/Sprite-Animation-Defaults-20261116-size-matrix01/report.json", 12],
    ]) {
      const data = input(file); assert.equal(data.status, "PASS"); assert.equal(data.cases.length, count);
      assert(data.cases.every(c => c.status === "PASS"));
    }
    return { direct: 7, sourceSaveMatrix: 12, sourceRasterMatrix: 12, staleInstallerSourceConfirmed: true };
  });
  group("one-editor-only-build-and-correct-bundled-runtime-source", () => {
    assert.equal(build.version, "1.9.85"); assert.equal(build.nativePlayerBuilds, 0);
    const stages = input(path.join(release, "build-stages.json"));
    assert.equal(stages.status, "PASS_BUILD_NOT_INSTALLED"); assert.equal(stages.stages.length, 4);
    assert(stages.stages.every(s => s.status === "PASS"));
    for (const f of [build.installer, build.dev, build.player, build.backend, build.payloadReport, ...checkpoint.sources]) verify(f);
    const payload = input(build.payloadReport.path); assert.equal(payload.status, "PASS");
    const actual = input(path.join(prior, "install-new.json")); assert.equal(actual.status, "PASS");
    verify(actual.executable); assert.equal(actual.executable.version, "1.9.85");
    assert.equal(actual.executable.sha256, payload.deployments.find(d => d.kind === "NSIS actual payload").executable.sha256);
    const extracted = path.join(path.dirname(build.payloadReport.path), "nsis-payload");
    const find = directory => {
      for (const e of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, e.name);
        if (e.isDirectory()) { const match = find(file); if (match) return match; }
        else if (e.name === "spriteStageLayout.ts" && file.includes("GameCli_framework")) return file;
      }
    };
    const source = find(extracted); assert(source);
    assert.equal(sha(source), sha(path.join(root, "GameCli_framework/src/engine/spriteStageLayout.ts")));
    const mod = { exports: {} };
    const compiled = require("../editor/node_modules/esbuild").transformSync(fs.readFileSync(source, "utf8"), { loader: "ts", format: "cjs" }).code;
    new Function("module", "exports", compiled)(mod, mod.exports);
    const widths = [1, 2, 5, 1].map(count => mod.exports.resolveSpriteSlotLayout({
      stage: { width: 1920, height: 1080, uiScale: 1 }, spriteCount: count, spriteIndex: 0, position: "left",
    }).width);
    assert.equal(new Set(widths).size, 1, "Actual payload sizing must be count-independent; station positions may depend on count");
    return { installedExecutable: actual.executable, actualPayloadSource: { path: source, sha256: sha(source) }, actualPayloadWidths: widths, nativePlayerReused: true };
  });
  group("actual-installed-global-save-restart-ui-export-and-native-raster", () => {
    assert.equal(run.status, "PASS"); assert.equal(run.cleanupStatus, "PASS");
    assert.equal(run.cases.length, 2); assert(run.cases.every(s => s.status === "PASS"));
    const original = input(path.join(prior, "resource-01/report.json"));
    assert.equal(original.status, "FAILED"); assert(original.stages.slice(0, 5).every(s => s.status === "PASS"));
    assert.match(original.error, /advanced\.tab\.layout/);
    const followup = input(path.join(authorBase, "resource-01/report.json"));
    assert.equal(followup.status, "FAILED"); assert(followup.stages.slice(0, 4).every(s => s.status === "PASS"));
    assert.match(followup.error, /Configured exit must render/);
    for (const f of run.inheritance) verify(f);
    assert.equal(followup.exports.length, 2); assert.deepEqual(followup.exports.map(e => e.type), ["agentvn", "renpy"]);
    for (const e of followup.exports) verify(e);
    assert.equal(followup.launches.filter(l => l.database).length, 1);
    const sessions = original.launches.filter(l => l.database);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].database, sessions[1].database);
    assert(sessions.every(l => !l.dataDirectoryOverride && !l.webviewDirectoryOverride && !l.sourceServer));
    const closed = [...followup.cleanups, ...original.cleanups].filter(c => c.method === "WM_CLOSE");
    assert.equal(closed.length, 2); assert(closed.every(c => !c.killed.length));
    for (const type of ["agentvn", "renpy"]) {
      const detail = run.cases.find(s => s.type === type);
      assert.deepEqual(detail.samples.map(s => s.count), [1, 2, 5, 1]);
      assert(detail.entryIntermediate > 0 && detail.exitIntermediate > 0); verify(detail.frames);
    }
    assert.deepEqual(run.errors, []); assert.equal(run.modelRequests, 0);
    for (const f of [...run.screenshots, ...followup.screenshots, ...original.screenshots]) verify(f);
    return { originalPassedStages: 5, authorFollowupPassedStages: 4, nativeConsumptionCases: 2,
      actualInstalls: 1, followupReinstalls: followup.installations,
      actualUiExports: 2, normalEditorCloses: 2, nativeThemes: 2, followupIsDifferentQaProfile: true,
      installationDisplayScope: "1080p/DPR1 normal only", androidClaim: false };
  });
  group("default-qa-database-retained-and-account-retired", () => {
    const retired = input(path.join(base, "account-retirement-01.json"));
    assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
    assert(!fs.existsSync(retired.account.profile));
    const authorRetired = input(path.join(authorBase, "account-retirement-01.json"));
    assert.equal(authorRetired.status, "PASS"); assert(authorRetired.cleanup.accountDeleted && authorRetired.cleanup.profileDeleted);
    assert(!fs.existsSync(authorRetired.account.profile)); verify(authorRetired.databaseEvidence);
    const db = new DatabaseSync(authorRetired.databaseEvidence.path, { readOnly: true });
    try {
      const row = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get("qa-sprite-animation-1985"); assert(row);
      const actual = JSON.parse(row.project_json), authored = input(path.join(authorBase, "resource-01/authored.vnproj"));
      assert.deepEqual(actual.editor_settings.spriteAnimationDefaults, authored.editor_settings.spriteAnimationDefaults);
      assert.deepEqual(actual.nodes, authored.nodes); assert.deepEqual(actual.edges, authored.edges);
    } finally { db.close(); }
    const priorRetired = input(path.join(prior, "account-retirement-01.json"));
    assert.equal(priorRetired.status, "PASS"); assert(priorRetired.cleanup.accountDeleted && priorRetired.cleanup.profileDeleted);
    assert(!fs.existsSync(priorRetired.account.profile)); verify(priorRetired.databaseEvidence);
    return { retiredQaAccounts: 3, defaultDatabaseReadback: true };
  });
  group("protected-daily-frozen-products-and-real-git-head-index", () => {
    for (const f of [checkpoint.daily, checkpoint.frozen.installer, checkpoint.frozen.player, checkpoint.git.index]) verify(f);
    assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), checkpoint.git.head);
    return { dailyDUnchanged: true, frozen1983Unchanged: true, actualGitHeadIndexPreserved: true };
  });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, groups: report.groups.map(g => ({ name: g.name, status: g.status })), error: report.error }));
}
