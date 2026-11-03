"use strict";
// Read-only independent checks; no native picker or application inputs.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const current1930=process.argv.includes("--candidate=1.9.30");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const configArgs=process.argv.slice(2).filter(a=>a.startsWith("--candidate-config="));
assert(configArgs.length<=1);
const config=configArgs.length?validateCandidateConfig(read(configArgs[0].slice(19))):null;
assert(!config||!current1930);
const selfTest=process.argv.includes("--self-test");
const positional=process.argv.slice(2).filter(a=>!a.startsWith("--"));
const authorAttempt=config?positional[0]:current1930?"65":"58";
const auditAttempt=config?positional[1]:"01";
if(config){
  assert.match(authorAttempt??"",/^\d{2}$/);
  if(!selfTest)assert.match(auditAttempt??"",/^\d{2}$/);
  assert.deepEqual(process.argv.slice(2),selfTest
    ?[authorAttempt,"--self-test",configArgs[0]]
    :[authorAttempt,auditAttempt,configArgs[0]]);
}else{
  assert.deepEqual(process.argv.slice(2),[
    ...(selfTest?["--self-test"]:["01"]),
    ...(current1930?["--candidate=1.9.30"]:[]),
  ]);
}
const version=config?.version??(current1930?"1.9.30":"1.9.24");
const root = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-"+authorAttempt;
const base = config?.qa??(current1930?"F:/AgentVN/QA/Editor-1.9.30-20261026-01":"F:/AgentVN/QA/Editor-1.9.24-20261024-01");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const raw = path.join(root, "report.json"), r = read(raw);
function viewport(s) {
  assert.deepEqual(s.before, s.after);
  assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
  assert.equal(s.before.reduced, false);
  assert(Number.isFinite(s.before.dpr) && Math.abs(s.before.dpr - 1) <= 0.001);
}
function business(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError);
  assert.equal(r.version,version);
  assert.equal(r.scope,`INSTALLED_${version}_REAL_NATIVE_GUI_DIRECTORY_CANCEL_SCAN_PREVIEW_CANCEL_NOT_APPLICATION_OR_ALL_LINK_ATTACKS`);
  if(config)assert.deepEqual(read(r.installation.path),deriveActual(config.actual,version));
  assert.deepEqual(r.errors, []); assert.equal(r.modelRequests + r.productChanges + r.builds, 0);
  assert.equal(r.cases.length, 2); assert(r.cases.every(c => c.status === "PASS" && c.finishedAt));
  assert.equal(r.requests.length, 2); assert.equal(r.launches.length, 1);
  assert.deepEqual(r.requests.map(q => q.kind), ["CANCEL", "SELECT"]);
  const receipts = [r.cases[0].detail, r.cases[1].detail.receipt];
  for (let i = 0; i < 2; i++) {
    const q = r.requests[i], a = receipts[i];
    assert.equal(a.requestId, q.id); assert.equal(a.ownerPid, r.launches[0].pid);
    assert.equal(a.kind, q.kind); assert.equal(a.selectedPath, q.selectedPath);
    assert.equal(a.interaction, "COMPUTER_USE_SKY_NATIVE_DIALOG");
  }
  assert.equal(r.directoryFiles.length, 30);
  const d = r.cases[1].detail;
  assert.equal(d.resources, 25); assert.equal(d.decodedThumbnailImages.length, 24);
  assert.equal(new Set(d.decodedThumbnailImages.map(a => a.name)).size, 24);
  assert(d.decodedThumbnailImages.every(a => a.width > 0 && a.height > 0 && /^[a-f0-9]{64}$/.test(a.sha256)));
  assert(d.stagedZipRemovedByProduct && d.projectAndLibraryUnchanged);
  assert.deepEqual(r.stagingAfter, r.stagingBefore);
  assert.equal(r.nativeCacheRestoration, "PASS"); assert.equal(r.cleanups.length, 1);
  assert.equal(r.cleanups[0].status, "PASS"); assert.equal(r.screenshots.length, 1);
  viewport(r.screenshots[0]);
  return { nativePickerActions: 2, officialEntries: 30, resources: 25, decodedImages: 24 };
}
if (selfTest) {
  business(r);
  const bad = [
    x => { x.cases = []; }, x => { x.requests[1].kind = "CANCEL"; },
    x => { x.cases[1].detail.receipt.ownerPid++; }, x => { x.cases[1].detail.receipt.selectedPath = "unrelated"; },
    x => { x.cases[1].detail.decodedThumbnailImages.pop(); }, x => { x.stagingAfter.push({ path: "leaked.zip" }); },
    x => { x.cleanups[0].status = "FAILED"; }, x => { x.nativeCacheRestoration = "FAILED"; },
    x => { x.screenshots[0].before.dpr = 2; x.screenshots[0].after.dpr = 2; },
    x => { x.screenshots[0].after.height++; },
    x => { x.screenshots[0].before.reduced = true; x.screenshots[0].after.reduced = true; },
    x => { x.version="0.0.0"; }, x => { x.scope="OTHER_TEST"; },
    x => { x.installation={...x.installation,path:__filename}; },
  ];
  for (const mutation of bad) { const x = structuredClone(r); mutation(x); assert.throws(() => business(x)); }
  console.log(JSON.stringify({ status: "PASS", rejectedBadReceipts: bad.length, scope: "AUDIT_ONLY",
    version, authorAttempt, report:desc(raw), actualInstalledBinding:!!config }));
} else {
  const out = path.join(base, `gui-directory-audit-${auditAttempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), input: desc(raw), groups: [],
    scope: "CURRENT_INSTALLED_NATIVE_GUI_DIRECTORY_CANCEL_SCAN_CANCEL_ONLY", modelRequests: 0, productChanges: 0, builds: 0 };
  async function group(name, fn) { const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = await fn(); g.status = "PASS"; } catch (e) { g.status = "FAILED"; throw e; } }
  (async () => {
    await group("Two actual Computer Use directory actions and nonempty scan evidence", () => business(r));
    await group("Frozen installation, complete official source and 24 real thumbnail hashes", async () => {
      for (const f of [r.installation, r.officialArchive, r.input, r.tool]) assert.equal(sha(f.path), f.sha256);
      assert.equal(sha(path.join(root, "executed-test.cjs")), r.tool.sha256);
      const installed = read(r.installation.path);
      assert.equal(config||current1930?installed.version:installed.executable.version,version);
      assert.equal(r.launches[0].executable.sha256, installed.executable.sha256);
      assert.equal(installed.executable.sha256,config?deriveActual(config.actual,version).executable.sha256:current1930
        ?"a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577"
        :"ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");
      if(config||current1930) {
        assert.equal(sha(installed.actualInstallation.path),installed.actualInstallation.sha256);
        const actual=read(installed.actualInstallation.path);
        assert(actual.status==="PASS"&&actual.exitCode===0&&actual.registryRestored);
      }
      for (const f of [installed.executable, ...installed.resources, ...(installed.protectedFiles||[])]) assert.equal(sha(f.path), f.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(r.officialArchive.path), { checkCRC32: true });
      for (const f of r.directoryFiles) {
        assert.equal(sha(f.path), f.sha256);
        const relative = path.relative(r.requests[1].selectedPath, f.path).replace(/\\/g, "/");
        assert(!relative.startsWith("..")); const bytes = await zip.file("官方模板 中文/game/" + relative).async("nodebuffer");
        assert.equal(require("node:crypto").createHash("sha256").update(bytes).digest("hex"), f.sha256);
        const image = r.cases[1].detail.decodedThumbnailImages.find(a => a.name === relative);
        if (relative.endsWith(".png")) { assert(image, relative); assert.equal(image.sha256, f.sha256); }
      }
      for (const q of r.requests) assert.deepEqual(read(q.completion),
        r.cases[q.kind === "CANCEL" ? 0 : 1].detail.receipt || r.cases[0].detail);
      return { officialBytesVerified: 30, imageBytesVerified: 24 };
    });
    await group("Actual PNG parameters, cache identity restoration and no owned process/port residue", () => {
      const s = r.screenshots[0]; assert.equal(sha(s.path), s.sha256); viewport(s);
      const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
      const l = r.launches[0]; assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
      const cache = read(path.join(root, "native-cache-protection.json"));
      const restored = read(path.join(root, "native-cache-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert(ps(`fsutil file queryfileid '${cache.original}'`).includes(cache.directoryId)); assert(!fs.existsSync(cache.held));
      for (const f of cache.files) assert.equal(sha(path.join(cache.original, f.relative)), f.sha256);
      const current = rows(); assert(r.knownProcesses.length > 0);
      for (const p of r.knownProcesses) assert(!current.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      assert.deepEqual(listeners(l.ports), []);
      return { png: 1, cacheFiles: cache.files.length, processIdentities: r.knownProcesses.length, ports: l.ports };
    });
    report.status = "PASS";
  })().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
    .finally(() => { report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
      fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
      fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
      console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
}
