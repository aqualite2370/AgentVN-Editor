"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const configArgs=process.argv.filter(a=>a.startsWith("--candidate-config="));assert(configArgs.length<=1);
const config=configArgs.length?validateCandidateConfig(JSON.parse(fs.readFileSync(configArgs[0].slice(19),"utf8"))):null;
const sourceArgs=process.argv.filter(a=>a.startsWith("--negative="));assert(sourceArgs.length<=1);
const sourceAttempt=sourceArgs[0]?.slice(11);if(config)assert.match(sourceAttempt??"",/^\d{2}$/);
const current1930=process.argv.includes("--candidate=1.9.30");
assert(!config||!current1930);
const root = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-"+(config?sourceAttempt:current1930?"64":"59");
const base = config?.qa??(current1930?"F:/AgentVN/QA/Editor-1.9.30-20261026-01":"F:/AgentVN/QA/Editor-1.9.24-20261024-01");
const version=config?.version??(current1930?"1.9.30":"1.9.24");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const r = read(path.join(root, "report.json"));
function viewport(s) {
  assert.deepEqual(s.before, s.after);
  assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
  assert.equal(s.before.reduced, false);
  assert(Number.isFinite(s.before.dpr) && Math.abs(s.before.dpr - 1) <= 0.001);
}
const names = ["traversal", "case-duplicate", "symlink", "compression-limit", "missing-gui",
  "ambiguous-gui", "unsupported-expression", "damaged-image"];
function validate(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError);
  assert.equal(r.modelRequests + r.productChanges + r.builds, 0); assert.deepEqual(r.errors, []);
  if(config)assert.equal(r.version,version);
  assert.deepEqual(r.cases.map(c => c.name), names); assert(r.cases.every(c => c.status === "PASS" && c.finishedAt));
  for (const c of r.cases) {
    assert(c.issues.includes(c.expectedIssue));
    assert.equal(c.wholeArchiveBlocked, !["unsupported-expression", "damaged-image"].includes(c.name));
  }
  assert.equal(r.checks.length, 1); assert.equal(r.checks[0].status, "PASS");
  assert(r.conflictError.includes("BINDING_CONFLICT:title_background"));
  assert.equal(r.assetProofs.length, 26); assert.equal(new Set(r.assetProofs.map(a => a.id)).size, 26);
  assert.deepEqual(r.libraryAfter, r.libraryBefore);
  assert(r.sourceEvidenceUnchanged); assert.equal(r.nativeCacheRestoration, "PASS");
  assert.equal(r.launches.length, 1); assert.equal(r.cleanups.length, 1); assert.equal(r.cleanups[0].status, "PASS");
  assert.equal(r.screenshots.length, 1);
  viewport(r.screenshots[0]);
  return { scannerCases: 8, failedApplications: 1, originalAssets: 26, libraryRecords: r.libraryBefore.length };
}
if (process.argv.includes("--self-test")) {
  validate(r);
  const mutations = [
    x => { x.cases = []; }, x => { x.cases[1] = x.cases[0]; }, x => { x.cases[0].issues = ""; },
    x => { x.cases[0].wholeArchiveBlocked = false; }, x => { x.conflictError = ""; },
    x => { x.assetProofs.pop(); }, x => { x.libraryAfter = []; }, x => { x.sourceEvidenceUnchanged = false; },
    x => { x.nativeCacheRestoration = "FAILED"; }, x => { x.cleanups[0].status = "FAILED"; },
    x => { x.screenshots[0].before.dpr = 2; x.screenshots[0].after.dpr = 2; },
    x => { x.screenshots[0].after.width++; },
    x => { x.screenshots[0].before.reduced = true; x.screenshots[0].after.reduced = true; },
    x => { x.screenshots[0].before.width = 1280; x.screenshots[0].after.width = 1280; },
  ];
  for (const change of mutations) { const x = structuredClone(r); change(x); assert.throws(() => validate(x)); }
  console.log(JSON.stringify({ status: "PASS", badEvidenceRejected: mutations.length, scope: "AUDIT_ONLY" }));
} else {
  assert(/^\d{2}$/.test(process.argv[2])); const out = path.join(base, "gui-negative-audit-"+process.argv[2]);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), input: desc(path.join(root, "report.json")),
    groups: [], productChanges: 0, builds: 0, modelRequests: 0,
    scope: `INSTALLED_${current1930?"1930":"1924"}_EIGHT_SCANNER_NEGATIVES_AND_CONFLICT_ROLLBACK_NOT_ALL_DIRECTORY_LINK_ATTACKS` };
  function group(name, fn) { const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = fn(); g.status = "PASS"; } catch (e) { g.status = "FAILED"; throw e; } }
  try {
    group("Nonempty current-candidate error and failed-application matrix", () => validate(r));
    group("Frozen source evidence and all retained real bytes", () => {
      for (const f of [r.installation, r.source, r.tool, r.officialArchive, ...r.protectedSource,
        ...r.libraryBefore, ...r.cases.map(c => c.artifact)]) assert.equal(sha(f.path), f.sha256);
      assert.equal(sha(path.join(root, "executed-test.cjs")), r.tool.sha256);
      const source = read(r.source.path), installed = read(r.installation.path);
      assert.equal(config||current1930?installed.version:installed.executable.version,version);
      if(config)assert.deepEqual(installed,deriveActual(config.actual,version));
      assert.equal(installed.executable.sha256,config?deriveActual(config.actual,version).executable.sha256:current1930
        ?"a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577"
        :"ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");
      if(current1930||config) {
        assert.equal(sha(installed.actualInstallation.path),installed.actualInstallation.sha256);
        const actual=read(installed.actualInstallation.path);
        assert(actual.status==="PASS"&&actual.exitCode===0&&actual.registryRestored);
      }
      for (const f of [installed.executable, ...installed.resources, ...(installed.protectedFiles??[])]) assert.equal(sha(f.path), f.sha256);
      for (const a of r.assetProofs) assert.equal(a.sha256, source.assetProofs.find(f => f.id === a.id)?.sha256);
      return { preservedSourceFiles: r.protectedSource.length, actualResources: 26, attackArchives: 8 };
    });
    group("Native viewport PNG and original cache identity; exact owned cleanup", () => {
      const s = r.screenshots[0]; assert.equal(sha(s.path), s.sha256); viewport(s);
      const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
      const cache = read(path.join(root, "native-cache-protection.json"));
      assert.equal(read(path.join(root, "native-cache-restoration.json")).status, "PASS");
      assert(!fs.existsSync(cache.held)); assert(ps(`fsutil file queryfileid '${cache.original}'`).includes(cache.directoryId));
      for (const f of cache.files) assert.equal(sha(path.join(cache.original, f.relative)), f.sha256);
      const current = rows(); assert(r.knownProcesses.length > 0);
      for (const p of r.knownProcesses) assert(!current.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      const l = r.launches[0]; assert.deepEqual(listeners(l.ports), []);
      assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.manualBackendSpawn && !l.sourceServer);
      return { png: 1, cachedFiles: cache.files.length, processIdentities: r.knownProcesses.length, ports: l.ports };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
}
