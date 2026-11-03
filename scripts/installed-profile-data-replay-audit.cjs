"use strict";
// Read-only independent terminal audit. Does not launch apps, alter profiles or call models.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function validateSafety(r) {
  assert(r.finishedAt);
  assert.equal(r.scope, "AUTHENTIC_OLD_QA_PROFILE_REPLAY_NOT_INSTALLER_UPGRADE_OR_DEFAULT_PATH_MIGRATION");
  assert.equal(r.version, "1.9.31"); assert.equal(r.normalCloseClaimed, false);
  assert.equal(r.realModelRequests, 0); assert.equal(r.blockedModelRequests, 0);
  assert.deepEqual(r.modelRequestsObserved, []); assert.equal(r.productChanges, 0);
  assert.deepEqual(r.errors, []); assert(!r.cleanupError && !r.finalEvidenceError);
  assert.equal(r.sourceRestoration, "UNCHANGED"); assert.equal(r.ownedCleanup, "PASS");
  assert.equal(r.cacheRestoration, "PASS");
  assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]);
  assert(r.cache.every(c => c.exitCode === 0));
}
function validateFlows(r, kinds) {
  const expected = kinds.flatMap(k =>
    ["old", "current", "restart"].map(p => k + "-" + p + "-real-installed-profile-consumption"));
  const cases = r.cases.filter(c => kinds.some(k => c.name.startsWith(k + "-")));
  assert.deepEqual(cases.map(c => c.name), expected);
  for (const [i, c] of cases.entries()) {
    assert.equal(c.status, "PASS"); assert(c.finishedAt && c.evidence.records >= 2);
    assert.equal(c.evidence.oldVersion, "1.9.30");
    assert.equal(c.evidence.currentVersion, i % 3 === 0 ? "1.9.30" : "1.9.31");
    assert.equal(c.evidence.baselineCompared, i % 3 !== 0);
    assert.equal(c.evidence.noModelRequests, true);
  }
  return cases.length;
}
function validate(r) {
  assert.equal(r.status, "PASS_LIMITED_PROFILE_REPLAY"); assert(!r.error);
  validateSafety(r);
  const kinds = r.executedScenarios || ["assistant", "components"];
  assert(kinds.length > 0);
  assert(kinds.join(",") === "assistant,components" || kinds.join(",") === "components");
  const count = validateFlows(r, kinds);
  assert.equal(r.cases.length, count);
  assert.equal(r.launches.length, count); assert.equal(r.cleanups.length, count);
  assert.equal(new Set(r.launches.map(l => `${l.pid}:${l.created}`)).size, count);
  assert.equal(new Set(r.launches.map(l => l.data)).size, kinds.length);
  assert.equal(new Set(r.launches.map(l => l.webview)).size, kinds.length);
  for (const l of r.launches) {
    assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
    assert(l.created && l.backend.Created); assert.equal(l.ports.length, 2);
    assert.equal(l.listeners.length, 2);
  }
  for (const c of r.cleanups) {
    assert.equal(c.status, "PASS"); assert.equal(c.normalCloseClaimed, false); assert(c.killed.length > 0);
  }
  const pictures = kinds.includes("assistant") ? 9 : 3;
  assert.equal(r.screenshots.length, pictures);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after);
    validateNativeViewport(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
    assert.equal(s.png.width, 1920); assert.equal(s.png.height, 1080);
  }
  assert.equal(r.componentResourceChecks.length, 3);
  assert.deepEqual(r.componentResourceChecks.map(c => c.launch),
    kinds.includes("assistant") ? [3, 4, 5] : [0, 1, 2]);
  return { flows: count, actualInstalledStarts: count, screenshots: pictures, realModelRequests: 0 };
}
const semantic = rows => rows.map(({ updatedAt, ...rest }) => rest);
function verifyInventory(root, expected) {
  const found = [];
  function visit(p) {
    const s = fs.lstatSync(p); assert(!s.isSymbolicLink());
    if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n));
    else { assert(s.isFile()); found.push({ relative: path.relative(root, p), bytes: s.size, sha256: sha(p) }); }
  }
  visit(root); assert.deepEqual(found, expected); return found.length;
}
function withDatabaseCopy(source, target, fn) {
  assert(!fs.existsSync(target)); fs.mkdirSync(target);
  for (const n of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
    const f = path.join(source, n); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(target, n), fs.constants.COPYFILE_EXCL);
  }
  const db = new DatabaseSync(path.join(target, "vn_engine.db"), { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    return fn(db);
  } finally { db.close(); }
}
function selfTest(r) {
  validate(r);
  const changes = [r => r.cases = [], r => r.cases[0].status = "NOT_RUN",
    r => r.cases[1].evidence.baselineCompared = false, r => r.modelRequestsObserved = [{ path: "/v1" }],
    r => r.normalCloseClaimed = true, r => r.scope = "INSTALLER_UPGRADE",
    r => r.launches[1] = r.launches[0], r => r.launches[2].data += "-other",
    r => r.screenshots.pop(), r => r.screenshots[0].png.width = 960,
    r => r.screenshots[0].after.dpr = 2, r => r.cleanups[0].normalCloseClaimed = true,
    r => r.cacheRestoration = "FAILED", r => r.sourceRestoration = "UNKNOWN",
    r => r.cases[0].evidence.records = 0, r => r.errors = ["unknown error"],
    r => r.componentResourceChecks = [], r => r.executedScenarios = []];
  for (const change of changes) { const bad = structuredClone(r); change(bad); assert.throws(() => validate(bad)); }
  return { invalidEvidenceRejected: changes.length };
}
function audit(run, number) {
  assert.match(number, /^\d{2}$/);
  const source = path.join(run, "report.json"), r = read(source), out = path.join(run, "audit-" + number);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const result = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(source),
    scope: "INDEPENDENT_PROFILE_REPLAY_AUDIT_NOT_INSTALLER_UPGRADE", groups: [], productChanges: 0, modelRequests: 0 };
  function group(name, fn) {
    try { const evidence = fn(); result.groups.push({ name, status: "PASS", evidence }); }
    catch (e) { result.groups.push({ name, status: "FAILED", error: String(e.stack || e) }); }
  }
  let prior, priorRun;
  if (r.continuation) {
    group("Separate original failed run retains its failure and three assistant passes", () => {
      assert.equal(sha(r.continuation.path), r.continuation.sha256);
      prior = read(r.continuation.path); priorRun = path.dirname(r.continuation.path);
      assert.equal(prior.status, "FAILED"); assert.match(prior.error, /53480/); assert.match(prior.error, /55298/);
      validateSafety(prior); assert.equal(validateFlows(prior, ["assistant"]), 3);
      assert.equal(prior.cases.length, 5); assert.equal(prior.launches.length, 5);
      assert.equal(prior.cleanups.length, 5); assert.equal(prior.cases[4].status, "FAILED");
      assert.equal(prior.cases[4].name, "components-current-real-installed-profile-consumption");
      assert.equal(r.continuation.scope, "SEPARATE_PRIOR_FAILED_RUN_NOT_REWRITTEN");
      return { originalStatus: "FAILED", assistantFlows: 3, assistantLaunches: 3,
        scope: "Prior assistant evidence only; not a six-case PASS in one run" };
    });
  }
  const runs = () => [{ r, run }, ...(prior ? [{ r: prior, run: priorRun }] : [])];
  group("Actual complete flows and rejection of bad evidence", () => ({ ...validate(r), ...selfTest(r) }));
  group("Authentic old/current installed sources and executed tool bytes", () => {
    for (const { r, run } of runs()) {
    for (const f of [r.config, ...r.installations]) assert.equal(sha(f.path), f.sha256);
    const c = read(r.config.path);
    for (const s of c.scenarios) for (const f of [s.report, s.audit]) assert.equal(sha(f.path), f.sha256);
    const old = read(r.installations[0].path), current = read(r.installations[1].path);
    assert.equal(old.version, "1.9.30"); assert.equal(current.version, "1.9.31");
    const actual = read(current.actualInstallation.path);
    assert.equal(sha(current.actualInstallation.path), current.actualInstallation.sha256);
    assert.equal(actual.status, "PASS"); assert.equal(actual.exitCode, 0); assert(actual.registryRestored);
    assert.equal(current.executable.sha256, actual.executable.sha256);
    for (const installation of [old, current])
      for (const f of [installation.executable, ...installation.resources]) assert.equal(sha(f.path), f.sha256);
    for (const f of r.tools) assert.equal(sha(path.join(run, "executed-tools", path.basename(f.path))), f.sha256);
    }
    return { genuineInstallations: 2, separateRuns: runs().length,
      archivedExecutedTools: runs().reduce((n, v) => n + v.r.tools.length, 0) };
  });
  group("Real conversation identities, deleted inquiry and component dependency bytes survive", () => {
    for (const kind of ["assistant", "components"]) {
      const sourceRun = kind === "assistant" && prior ? priorRun : run;
      const values = ["old", "current", "restart"].map(p => read(path.join(sourceRun, kind + "-" + p + "-records.json")));
      assert(values[0].length >= 2);
      if (kind === "assistant") {
        assert(values[0].every(v => v.mode === "creation"));
        assert.equal(new Set(values[0].map(v => v.projectId)).size, 2);
        assert(!values[0].some(v => v.title.includes("HISTORY_A")));
        assert.deepEqual(semantic(values[1]), semantic(values[0]));
        assert.deepEqual(semantic(values[2]), semantic(values[0]));
      } else {
        assert(values[0].some(v => v.assets.length >= 2));
        for (const v of values.flat()) for (const a of v.assets) {
          assert.match(a.sha256, /^[a-f0-9]{64}$/); assert(a.byteLength > 0);
        }
        assert.deepEqual(values[1], values[0]); assert.deepEqual(values[2], values[0]);
      }
    }
    return { projectsWithCreationHistory: 2, componentBytesCompared: true };
  });
  group("Copied final SQLite integrity, unchanged authored projects and no regenerated tasks", () => {
    const counts = {};
    for (const kind of ["assistant", "components"]) {
      const sourceRun = kind === "assistant" && prior ? priorRun : run;
      const sourceReport = kind === "assistant" && prior ? prior : r;
      withDatabaseCopy(path.join(sourceRun, kind, "data/backend"), path.join(out, kind + "-sqlite"), db => {
        const secret = db.prepare("SELECT value FROM editor_shared_state WHERE key='provider_secrets'").get();
        if (secret) assert.deepEqual(JSON.parse(secret.value), {});
        const projects = db.prepare("SELECT project_id, project_json FROM editor_project_details").all();
        assert(projects.length >= 1); counts[kind] = projects.length;
        if (kind === "assistant") {
          const original = read(sourceReport.inputs.find(i => i.kind === kind).sourceReport.path);
          for (const row of projects) {
            const actual = JSON.parse(row.project_json), baseline = original.baselineProjects[row.project_id]; assert(baseline);
            for (const k of ["editor_settings", "edges", "asset_manifest"]) assert.deepEqual(actual[k], baseline[k]);
            assert.deepEqual(actual.nodes.map(({ measured, ...n }) => n), baseline.nodes.map(({ measured, ...n }) => n));
          }
          const tasks = db.prepare("SELECT status FROM assistant_creation_processes ORDER BY sequence").all();
          assert.deepEqual(tasks.map(t => t.status), ["completed", "cancelled", "completed"]);
        } else {
          assert.equal(projects.length, 1);
          const actual = JSON.parse(projects[0].project_json);
          const last = r.componentResourceChecks.at(-1);
          for (const k of ["editor_settings", "edges"]) assert.deepEqual(actual[k], r.componentProjectBaseline[k]);
          assert.deepEqual(actual.asset_manifest, last.project.asset_manifest);
          assert.deepEqual(actual.nodes.map(({ measured, ...n }) => n), r.componentProjectBaseline.nodes);
        }
      });
    }
    return counts;
  });
  group("Original historical profile bytes and global cache are restored", () => {
    let files = 0;
    for (const { r, run } of runs()) {
    for (const input of r.inputs) {
      const original = read(input.sourceReport.path).launches[0];
      for (const key of ["data", "webview"])
        files += verifyInventory(original[key], read(path.join(run, input.kind + "-" + key + "-input.json")));
    }
    const cache = read(path.join(run, "native-cache-restoration.json")); assert.equal(cache.status, "PASS");
    assert.equal(cache.deletedUserFiles, 0);
    for (const f of cache.originalFiles) assert.equal(sha(path.join(cache.originalDirectory, f.relative)), f.sha256);
    }
    return { originalProfileFilesUnchanged: files, deletedUserFiles: 0 };
  });
  group("Actual PNG sampling and all owned process/port identities", () => {
    let pictures = 0, identities = 0, portCount = 0;
    for (const { r } of runs()) {
    for (const s of r.screenshots) {
      assert.deepEqual(s.before, s.after);
      validateNativeViewport(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
      assert.equal(sha(s.path), s.sha256); const b = fs.readFileSync(s.path);
      assert.equal(s.png.width, 1920); assert.equal(s.png.height, 1080);
      assert.equal(b.readUInt32BE(16), s.png.width); assert.equal(b.readUInt32BE(20), s.png.height);
    }
    const keys = new Set([...r.cleanups.flatMap(c => c.killed),
      ...(r.knownProcesses || []).map(p => `${p.ProcessId}:${p.Created}`)]);
    assert(keys.size > 0); assert(!rows().some(p => keys.has(`${p.ProcessId}:${p.Created}`)));
    const ports = [...new Set(r.launches.flatMap(l => l.ports))];
    const config = read(r.config.path);
    for (const s of config.scenarios) {
      const url = read(s.report.path).modelEndpoint; if (url) ports.push(+new URL(url).port);
    }
    assert.equal(listeners(ports).length, 0);
    pictures += r.screenshots.length; identities += keys.size; portCount += ports.length;
    }
    return { identitiesAbsent: identities, portsAbsent: portCount, screenshots: pictures };
  });
  group("Owned backend resources equal copied files and authentic library dependencies", () => {
    const library = read(path.join(run, "components-old-records.json")).flatMap(c => c.assets);
    let assets = 0;
    for (const check of r.componentResourceChecks) {
      const launch = r.launches[check.launch], origin = `http://127.0.0.1:${launch.ports[0]}`;
      const normalized = structuredClone(check.project);
      assert.equal(check.resources.length, normalized.asset_manifest.length);
      for (const a of normalized.asset_manifest) {
        const e = check.resources.find(e => e.assetId === a.asset_id); assert(e);
        const m = a.metadata;
        assert.equal(e.origin, origin); assert.equal(e.backendPath, m.backend_asset_path);
        assert.equal(e.url, origin + "/api/project/assets/" + m.backend_asset_path);
        assert.equal(m.url, e.url);
        assert(m.backend_asset_path.split("/").every(p => p && p !== "." && p !== ".." && !/[\\%?#:]/.test(p)));
        const file = path.resolve(launch.data, "backend/project_assets", m.backend_asset_path);
        assert.equal(path.resolve(e.projectFile.path), file);
        assert.equal(sha(file), e.sha256); assert.equal(e.projectFile.sha256, e.sha256);
        assert.equal(fs.statSync(file).size, e.byteLength); assert.equal(m.size_bytes, e.byteLength);
        assert(library.some(a => a.sha256 === e.sha256 && a.byteLength === e.byteLength &&
          a.filename === m.filename && a.mimeType === m.mime_type));
        m.url = "qa-verified-owned-backend:/api/project/assets/" + m.backend_asset_path; assets++;
      }
      assert.deepEqual(normalized, r.componentProjectBaseline);
    }
    assert(assets >= 12); return { verifiedAssets: assets, normalizedField: "only owned backend origin" };
  });
  assert.equal(sha(source), result.source.sha256);
  if (r.continuation) assert.equal(sha(r.continuation.path), r.continuation.sha256);
  result.status = result.groups.every(g => g.status === "PASS") ? "PASS_LIMITED_PROFILE_REPLAY" : "FAILED";
  result.finishedAt = new Date().toISOString();
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result)); if (result.status === "FAILED") process.exitCode = 1;
}
module.exports = { validate, selfTest };
if (require.main === module) audit(...process.argv.slice(2));
