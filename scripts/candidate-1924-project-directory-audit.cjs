"use strict";
// Independently read the original native run plus the narrowly scoped ACL
// supplement. Never rewrite the preserved FAILED native-run report.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const sha = p => A.sha256(fs.readFileSync(p));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const nativeRoot = "F:/AgentVN/QA/Project-Directory-Installed-20261022-01/editor-06";
const aclRoot = "F:/AgentVN/QA/Project-Directory-Write-20261024-01/installed-1924/green-01";
const nativeFile = path.join(nativeRoot, "report.json"), aclFile = path.join(aclRoot, "report.json");
const n = read(nativeFile), a = read(aclFile);
const out = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/project-directory-audit-01";
const describe = p => ({ path: path.resolve(p), sha256: sha(p) });
const file = f => assert.equal(sha(f.path), f.sha256, f.path);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.24",
  scope: "CURRENT_INSTALLED_NATIVE_DIRECTORY_FLOWS_PLUS_SEPARATE_ACTUAL_ACL_SUPPLEMENT",
  sources: [describe(nativeFile), describe(aclFile)], checks: [], negativeCases: [],
  boundaries: ["Native run retains its original FAILED status",
    "ACL supplement uses an explicitly preseeded local preference, not a second native picker",
    "Real WebView simulated viewport, not physical 4K", "Not standalone/setup/Android/upgrade or final project"],
  modelRequests: 0, productChanges: 0, builds: 0 };
function row(name) {
  const c = n.cases.find(c => c.name === name);
  assert.equal(c?.status, "PASS", name); return c.detail;
}
function matrix(cells, supplement) {
  assert.equal(cells.length, 12);
  const keys = new Set();
  for (const c of cells) {
    assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h]) => c.width===w && c.height===h));
    assert([1,2].includes(c.dpr) && typeof c.reduced === "boolean");
    const key = [c.width,c.height,c.dpr,c.reduced].join("/");
    assert(!keys.has(key)); keys.add(key);
    assert(c.geometry.overflow <= 1);
    if (supplement) {
      assert.equal(c.status, "PASS"); assert(c.noFallbackNoPartialNoOverwrite);
      assert(c.summary.includes("PROJECT_EXPORT_DIRECTORY_WRITE_FAILED"));
      assert(c.summary.includes(a.restoration.directory));
      assert(/权限|空间/.test(c.summary) && /重新选择|重选/.test(c.summary));
      assert(!c.summary.includes("请确认素材仍可在素材库中预览"));
      assert(c.geometry.hit);
    } else {
      assert.equal(c.geometry.controls.length, 2);
      for (const b of c.geometry.controls)
        assert(b.hit && !b.clipped && !b.disabled && b.rect.left>=0 && b.rect.top>=0
          && b.rect.right<=c.width && b.rect.bottom<=c.height);
      const [x,y] = c.geometry.controls.map(b => b.rect);
      assert.equal(Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left)) *
        Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)), 0);
    }
  }
}
function terminal() {
  assert.equal(n.status, "FAILED"); assert(!n.cleanupError && !n.error);
  assert.equal(n.version, "1.9.24");
  assert.equal(n.cases.length, 14);
  const failed = n.cases.filter(c => c.status !== "PASS");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].name, "actual-write-denial-no-fallback-actionable-error-and-retry");
  assert(failed[0].error.includes("PROJECT_EXPORT_DIRECTORY_WRITE_FAILED"));
  assert(failed[0].error.includes("at failedSave"));
  assert.equal(a.status, "PASS"); assert(!a.cleanupError);
  assert.equal(a.restoration.status, "RESTORED");
  assert.deepEqual(a.errors, []); assert.deepEqual(n.errors, []);
  assert.equal(a.modelRequests, 0); assert.equal(n.modelRequests, 0);
  assert.equal(n.productChanges, 0); assert.equal(n.builds, 0);
  assert.equal(n.cacheRestoration, "PASS");
  matrix(row("directory-controls-real-12-combination-matrix"), false);
  matrix(a.cases, true);
}
async function check(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c);
  try { c.detail = await fn(); c.status = "PASS"; console.log("PASS " + name); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
(async () => {
  terminal();
  if (process.argv[2] !== "--self-test") {
    assert.equal(process.argv.length, 2); assert(!fs.existsSync(out)); fs.mkdirSync(out);
    fs.copyFileSync(__filename, path.join(out,"executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  }
  await check("fourteen-behaviors-with-preserved-known-QA-failure-and-twelve-ACL-cells", () => {
    const samples = row("directory-controls-real-12-combination-matrix");
    for (const [name, mutate] of [
      ["empty", x => x.splice(0)], ["missing", x => x.pop()],
      ["duplicate", x => x[1]=structuredClone(x[0])],
      ["wrong-dpr", x => x[0].dpr=3],
      ["wrong-resolution", x => x[0].width=1280],
      ["overflow", x => x[0].geometry.overflow=2],
      ["missed-hit", x => x[0].geometry.controls[0].hit=false],
      ["clipped", x => x[0].geometry.controls[0].clipped=true],
      ["disabled", x => x[0].geometry.controls[0].disabled=true],
      ["outside", x => x[0].geometry.controls[0].rect.left=-1],
    ]) {
      const copy=structuredClone(samples); mutate(copy);
      assert.throws(() => matrix(copy,false), name); report.negativeCases.push(name);
    }
    for (const [name, mutate] of [
      ["ACL-cell-failed", x => x[0].status="FAILED"],
      ["ACL-misclassified", x => x[0].summary="无法读取素材"],
      ["ACL-old-file-not-preserved", x => x[0].noFallbackNoPartialNoOverwrite=false],
    ]) {
      const copy=structuredClone(a.cases); mutate(copy);
      assert.throws(() => matrix(copy,true), name); report.negativeCases.push(name);
    }
    return {nativePassed:13,nativeKnownQaFailures:1,aclSupplementCells:12,badEvidenceRejected:13};
  });
  if (process.argv[2] === "--self-test") return;
  await check("frozen-installed-host-backend-and-original-protected-artifacts", () => {
    file(n.originalInstallationReport); file(a.installation);
    assert.equal(n.originalInstallationReport.sha256,a.installation.sha256);
    const i=read(n.originalInstallationReport.path);
    assert.equal(i.executable.version,"1.9.24"); file(i.executable);
    for (const f of [...i.resources,...i.protectedFiles,...n.protected,...a.sources]) file(f);
    for (const r of [n,a]) for (const l of r.launches) {
      assert.equal(l.executable.sha256,i.executable.sha256); file(l.executable);
      assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
      assert(l.data.startsWith(path.dirname(r===n?nativeFile:aclFile)));
      assert(l.webview.startsWith(path.dirname(r===n?nativeFile:aclFile)));
      assert.equal(sha(l.backend.ExecutablePath),l.backend.sha256);
    }
    return {nativeLaunches:n.launches.length,supplementLaunches:a.launches.length,sourceServer:false};
  });
  await check("seven-actual-native-inputs-and-three-unforced-normal-closes", () => {
    const selected=["native-cancel-does-not-set-directory","native-project-a-chinese-space-directory",
      "native-project-b-independent-directory","fresh-profile-native-package-open-does-not-carry-machine-path"];
    for (const name of selected) {
      const d=row(name); A.validateNativeResult(d.input.request,d.input.result);
      assert(d.input.result.interaction.includes("Computer Use"));
      assert(d.input.result.window.app.toLowerCase().includes("installed-editor\\agentvn-editor.exe"));
    }
    const closes=[row("first-native-close-and-real-restart").close,row("primary-final-normal-close"),
      row("portable-profile-final-normal-close")];
    for (const d of closes) {
      assert(d.editorExitedNaturally && d.backendExitedNaturally && d.portsClosed);
      assert.deepEqual(d.forcedCleanup,[]);
      assert.equal(d.request.requestId,d.result.requestId);
      assert.equal(d.request.ownerPid,d.result.ownerPid);
      assert(d.result.interaction.includes("Computer Use"));
    }
    assert.equal(n.cleanups.length,3); assert(n.cleanups.every(c=>c.status==="PASS" && c.killed.length===0));
    assert.deepEqual(row("fresh-profile-native-package-open-does-not-carry-machine-path").mapping,{});
    return {nativePickerOperations:4,normalNativeCloses:3,forcedNativeCleanup:0};
  });
  await check("portable-ZIP-graph-and-project-isolation-collisions-real-error-and-retry-bytes", async () => {
    const sequence=row("a-b-a-save-and-no-overwrite").artifacts.map(f=>f.projectId);
    assert.deepEqual(sequence,[n.projects[0].projectId,n.projects[1].projectId,n.projects[0].projectId]);
    for (const f of n.artifacts) {
      const actual=fs.existsSync(f.path)?f.path:f.archivedPath;
      assert(actual); assert.equal(sha(actual),f.sha256);
      const z=await JSZip.loadAsync(fs.readFileSync(actual),{checkCRC32:true});
      const p=JSON.parse(await z.file("project.json").async("string"));
      assert(n.projects.some(x=>x.projectId===p.project_id));
      assert.equal(p.nodes.length,2); assert.equal(p.edges.length,1);
      const text=JSON.stringify(p); assert(!text.includes("projectExportDirectories"));
      for (const d of n.projects) assert(!text.includes(d.directory) && !text.includes(d.directory.replaceAll("\\","/")));
    }
    assert.equal(n.collision.reserved.length,91);
    for (const f of n.collision.reserved) file(f);
    const reset=row("reset-only-current-project-and-default-download").saved;
    assert(!fs.existsSync(reset.path)); assert.equal(sha(reset.archivedPath),reset.sha256);
    for (const f of [a.input,a.old,a.retryPackage]) file(f);
    for (const c of a.cases) {
      file(c.error);
      assert.equal(fs.readFileSync(c.error.path,"utf8").split("== Developer Diagnosis ==")[0],c.summary);
    }
    const z=await JSZip.loadAsync(fs.readFileSync(a.retryPackage.path),{checkCRC32:true});
    const p=JSON.parse(await z.file("project.json").async("string"));
    assert.equal(p.project_id,"directory-write-green-01");
    assert(!JSON.stringify(p).includes("projectExportDirectories"));
    assert(a.sourceFailure.error.includes("无法读取素材") && !a.sourceFailure.error.includes("PROJECT_EXPORT_DIRECTORY_"));
    return {nativePackages:n.artifacts.length,collisionBytesPreserved:91,realAclErrors:a.cases.length,actualRetry:true};
  });
  await check("actual-WebView-metrics-and-PNG-device-pixels", () => {
    for (const r of [n,a]) for (const s of r.screenshots) {
      file(s); assert.deepEqual(s.before,s.after);
      const b=fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16),Math.round(s.before.width*s.before.dpr));
      assert.equal(b.readUInt32BE(20),Math.round(s.before.height*s.before.dpr));
    }
    return {nativePNGs:n.screenshots.length,aclPNGs:a.screenshots.length};
  });
  await check("ACL-cache-downloads-process-and-port-restoration", () => {
    const normalize=s=>s.replace(/D:AI(?=\(|$)/,"D:");
    for (const [base,restored] of [[nativeRoot,n.aclRestoration],[aclRoot,a.restoration]]) {
      const proof=read(path.join(base,"acl-before.json"));
      assert.equal(restored.status,"RESTORED"); assert.equal(proof.before,restored.before);
      assert.equal(normalize(restored.sddl),normalize(proof.before));
      const actual=ps(`[IO.Directory]::GetAccessControl('${proof.directory.replaceAll("'","''")}').GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)`);
      assert.equal(actual,restored.sddl);
    }
    const cache=read(path.join(nativeRoot,"native-cache-restoration.json"));
    assert.equal(cache.status,"PASS"); assert.equal(cache.deletedUserFiles,0);
    for (const f of cache.originalFiles) assert.equal(sha(path.join(cache.originalDirectory,f.relative)),f.sha256);
    const downloads=fs.readdirSync(path.join(process.env.USERPROFILE,"Downloads"));
    for (const p of n.projects) assert(!downloads.some(x=>x.startsWith(p.title)));
    const now=rows(),identities=new Set(),ports=new Set();
    for (const r of [n,a]) {
      for (const p of [...r.knownProcesses||[],...r.allKnownProcesses||[]]) identities.add(`${p.ProcessId}:${p.Created}`);
      for (const c of r.cleanups) {
        assert.equal(c.status,"PASS"); for (const p of c.killed||[]) identities.add(p);
      }
      for (const l of r.launches) {
        identities.add(`${l.pid}:${l.created}`); identities.add(`${l.backend.ProcessId}:${l.backend.Created}`);
        for (const p of l.ports) ports.add(p);
      }
    }
    for (const p of now) assert(!identities.has(`${p.ProcessId}:${p.Created}`));
    assert.equal(listeners([...ports]).length,0);
    for (const f of report.sources) file(f);
    return {aclRestored:2,cacheFiles:cache.originalFiles.length,identities:identities.size,ports:ports.size,downloadsResidual:0};
  });
  report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
  .finally(()=>{
    report.finishedAt=new Date().toISOString();
    if (process.argv[2]!=="--self-test" && fs.existsSync(out))
      fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
    console.log(JSON.stringify({status:report.status==="RUNNING"?"SELF_TEST_PASS":report.status,
      checks:report.checks.length,negativeCases:report.negativeCases.length,out,error:report.error}));
  });
