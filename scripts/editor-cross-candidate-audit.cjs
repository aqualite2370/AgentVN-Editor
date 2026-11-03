"use strict";
// Audit real installed upgrade evidence; SQLite inspection uses scratch copies.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeCloseReceipt } = require("./editor-cross-candidate.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f) });
function terminal(r) {
  const oldPassed = r.oldNativeClose?.status === "PASS";
  assert.equal(r.status, oldPassed ? "PASS" : "PARTIAL_PASS_OLD_CLOSE_FAILED");
  assert.equal(r.cleanupStatus, "PASS");
  assert.equal(r.steps.length, 6); assert(r.steps.every(s => s.status === "PASS"));
  assert.equal(r.productChanges, 0); assert.equal(r.modelRequests, 0); assert.deepEqual(r.errors, []);
  assert.equal(r.launches.length, 3);
  assert.deepEqual(r.launches.map(l => l.label), ["old", "new", "restart"]);
  if (!oldPassed) {
    assert.equal(r.oldNativeClose.status, "FAILED");
    assert.equal(r.oldNativeClose.normalClose, false);
  }
}
function preserve(actual, expected, at = "project") {
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual) && actual.length === expected.length, at);
    expected.forEach((v, i) => preserve(actual[i], v, `${at}[${i}]`)); return;
  }
  if (expected && typeof expected === "object") {
    assert(actual && typeof actual === "object", at);
    for (const [k, v] of Object.entries(expected)) {
      if (k === "measured") {
        assert(v && Object.entries(v).every(([a, n]) => ["width", "height"].includes(a) && Number.isFinite(n) && n >= 0));
      } else preserve(actual[k], v, `${at}.${k}`);
    }
    return;
  }
  assert.deepEqual(actual, expected, at);
}
async function main() {
  const [configFile, id] = process.argv.slice(2); assert(configFile && /^\d+$/.test(id));
  const config = read(configFile), root = path.resolve(config.out);
  assert(root.startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
  const out = path.join(root, "audit-" + id); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const raw = path.join(root, "report.json"), r = read(raw);
  const audit = { status: "RUNNING", source: describe(raw), config: describe(configFile),
    scope: "REAL_NSIS_CROSS_GENERATION_PROJECT_THEME_MIGRATION_AND_CURRENT_PHYSICAL_CLOSE",
    checks: [], productChanges: 0, modelRequests: 0,
    limitations: ["Development host, not a clean Windows install", "1080p DPR1 only",
      "No old AI/component authorship or full game export matrix", "No Android evidence"] };
  const check = async (name, run) => {
    try { audit.checks.push({ name, status: "PASS", detail: await run() }); }
    catch (e) { audit.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
  };
  await check("terminal-and-rejected-incomplete-evidence", () => {
    terminal(r);
    const mutations = [
      x => x.status = "FAILED", x => x.cleanupStatus = "FAILED", x => x.steps.pop(),
      x => x.steps[4].status = "FAILED", x => x.modelRequests = 1, x => x.errors.push("hidden"),
      x => x.launches.pop(), x => x.launches[0].label = "restart",
      x => x.oldNativeClose.status = x.oldNativeClose.status === "PASS" ? "FAILED" : "PASS",
    ];
    for (const mutate of mutations) { const bad = structuredClone(r); mutate(bad); assert.throws(() => terminal(bad)); }
    return { steps: 6, rejectedEvidence: mutations.length };
  });
  await check("bound-real-installers-same-directory-and-native-consent", () => {
    const binding = read(path.join(config.preparation, "binding.json"));
    for (const f of binding.files) assert.equal(sha(f.path), f.sha256);
    const old = read(path.join(root, "InstallOld.json")), next = read(path.join(root, "InstallNew.json"));
    assert.equal(old.actualVersion, config.oldVersion); assert.equal(next.actualVersion, config.version);
    for (const receipt of [old, next]) {
      assert.equal(receipt.status, "PASS"); assert.equal(receipt.exitCode, 0);
      assert.equal(sha(receipt.executable), receipt.sha256);
    }
    assert.equal(old.installRoot, next.installRoot);
    assert.equal(next.sha256, config.installerSHA256);
    assert.equal(next.actualSha256, r.launches[1].sha256);
    assert(Date.parse(read(path.join(root, "Uninstall.json")).at) > Date.parse(next.at));
    const decision = read(path.join(root, "actual-native-migration-decision.json"));
    const req = r.migration.request, receipt = r.migration.consent;
    assert.equal(decision.approved, true);
    assert.deepEqual(decision, r.migration.decision);
    assert(decision.sources.some(s => path.resolve(s) === path.resolve(req.source)));
    assert.equal(req.sourceSha256, r.legacyDatabase.sha256);
    assert.equal(receipt.method, "Computer Use native Yes"); assert.equal(receipt.physicalInput, true);
    assert.equal(receipt.pid, r.launches[1].pid); assert.equal(receipt.created, r.launches[1].created);
    return { old: old.actualVersion, current: next.actualVersion, sameDirectory: true, nativeConsent: true };
  });
  await check("sqlite-authored-data-native-package-and-restart", async () => {
    const baseline = read(path.join(root, "old-baseline.json")).project;
    assert.equal(sha(r.legacyDownload.path), r.legacyDownload.sha256);
    const legacy = read(r.legacyDownload.path);
    assert.equal(legacy.project_id, baseline.metadata.projectId);
    assert.equal(sha(r.legacyDatabase.backup), r.legacyDatabase.sha256);
    const databases = [r.legacyDatabase.backup, path.join(root, "new-shared.db"),
      path.join(root, "archived-profile-0/backend/vn_engine.db")];
    const hashes = [];
    for (const [i, database] of databases.entries()) {
      const hash = sha(database), copy = path.join(out, `database-${i}.db`);
      fs.copyFileSync(database, copy, fs.constants.COPYFILE_EXCL);
      const db = new DatabaseSync(copy, { readOnly: true });
      try {
        assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
        const projects = db.prepare("SELECT project_id,project_json FROM editor_project_details").all();
        assert.equal(projects.length, 1); assert.equal(projects[0].project_id, baseline.metadata.projectId);
        const project = JSON.parse(projects[0].project_json);
        assert.equal(project.title, baseline.metadata.title); assert.equal(project.author, baseline.metadata.author);
        const expected = structuredClone(baseline.graph);
        if (i) {
          const node = expected.nodes.find(n => n.id === "node_scene_opening");
          node.data.description = node.data.scene.summary = "实际跨代后新保存1.9.31";
        }
        preserve(project.nodes, expected.nodes); preserve(project.edges, expected.edges);
        hashes.push(describe(database));
      } finally { db.close(); assert.equal(sha(database), hash); }
    }
    assert.equal(r.downloads.length, 1);
    const saved = r.downloads[0]; assert(saved.removed && !fs.existsSync(saved.source));
    assert.equal(sha(saved.retained), saved.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(saved.retained));
    const project = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(project.project_id, baseline.metadata.projectId);
    const expected = structuredClone(legacy);
    const node = expected.nodes.find(n => n.id === "node_scene_opening");
    node.data.description = node.data.scene.summary = "实际跨代后新保存1.9.31";
    preserve(project.nodes, expected.nodes); preserve(project.edges, expected.edges);
    return { databases: hashes, savedPackage: describe(saved.retained), restartUIAsserted: true };
  });
  await check("current-physical-closes-old-limitation-and-zero-residual", () => {
    for (const launch of r.launches) {
      assert.equal(launch.defaultDataPath, true); assert.equal(launch.defaultWebViewPath, true);
      assert.equal(launch.backendPortOverride, false); assert.equal(launch.manualBackendSpawn, false);
      if (launch.label === "old" && r.oldNativeClose.status === "FAILED") {
        const observation = read(path.join(root, "physical-old-close-observation.json"));
        assert.equal(observation.status, "FAILED"); assert.equal(observation.normalClose, false);
        assert.equal(observation.pid, launch.pid); assert.equal(observation.created, launch.created);
        assert.equal(observation.physicalInput, true);
        assert(r.cleanups.some(c => c.label === "old" && !c.normalClose && c.killed.length > 0));
        continue;
      }
      const request = read(path.join(root, `computer-use-close-${launch.label}-request.json`));
      const result = read(path.join(root, `${launch.label}-close-native.json`));
      validateNativeCloseReceipt(request, result);
      assert.equal(result.pid, launch.pid); assert.equal(result.created, launch.created);
      assert(r.cleanups.some(c => c.label === launch.label && c.normalClose && c.killed.length === 0));
    }
    assert(!rows().some(p => r.known.some(q => p.ProcessId === q.ProcessId && p.Created === q.Created)));
    assert.equal(listeners([...new Set(r.launches.flatMap(l => l.ports))]).length, 0);
    return { currentNormalPhysicalCloses: 2, oldNativeClose: r.oldNativeClose.status,
      knownProcesses: r.known.length, ports: r.launches.flatMap(l => l.ports) };
  });
  await check("screenshots-restoration-and-retained-cleanup", () => {
    assert.equal(r.screenshots.length, 3);
    for (const shot of r.screenshots) {
      const file = shot.path || shot.file, png = fs.readFileSync(file);
      assert.equal(sha(file), shot.sha256);
      assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
    }
    const restore = read(path.join(root, "Restore.json")), cleanup = read(path.join(root, "retained-cleanup-01.json"));
    assert.equal(restore.status, "PASS"); assert.equal(restore.deletedUserFiles, 0);
    assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.deletedUserFiles, 0);
    assert.equal(cleanup.records.length, 3);
    for (const record of cleanup.records) {
      assert(record.removed && !fs.existsSync(record.source));
      for (const f of record.files) assert.equal(sha(path.join(record.archive, f.relative)), f.sha256);
    }
    return { screenshots: 3, originalRestoration: "PASS", archivedProfiles: 3, deletedUserFiles: 0 };
  });
  audit.status = audit.checks.every(c => c.status === "PASS")
    ? (r.oldNativeClose.status === "PASS" ? "PASS_LIMITED_REAL_UPGRADE"
      : "EVIDENCE_AUDIT_PASS_UPGRADE_PARTIAL_OLD_CLOSE_FAILED") : "FAILED";
  audit.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(audit, null, 2), { flag: "wx" });
  console.log(JSON.stringify(audit)); if (audit.status === "FAILED") process.exitCode = 1;
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
