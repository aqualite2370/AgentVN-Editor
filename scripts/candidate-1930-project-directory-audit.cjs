"use strict";
// Read-only independent audit of the complete current-candidate native run.
// Original reports, receipts and payloads are immutable inputs.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const configArgs=process.argv.slice(2).filter(a=>a.startsWith("--candidate-config="));assert(configArgs.length<=1);
const config=configArgs.length?validateCandidateConfig(read(configArgs[0].slice(19))):null;
const authorAttempt=config?process.argv[2]:"10",auditAttempt=config?process.argv[3]:"01";
assert.match(authorAttempt??"",/^\d{2}$/);assert.match(auditAttempt??"",/^\d{2}$/);
assert.deepEqual(process.argv.slice(2),config?[authorAttempt,auditAttempt,configArgs[0]]:[]);
const version=config?.version??"1.9.30";
const base = "F:/AgentVN/QA/Project-Directory-Installed-20261022-01/editor-"+authorAttempt;
const out = path.join(base, "terminal-audit-"+auditAttempt);
const sha = p => A.sha256(fs.readFileSync(p));
const file = f => assert.equal(sha(f.path), f.sha256, f.path);
const source = path.join(base, "report.json");
const report = { status: "RUNNING", version, at: new Date().toISOString(),
  scope: "COMPLETE_INSTALLED_NATIVE_PROJECT_DIRECTORY_RUN_INDEPENDENT_READ_ONLY_AUDIT",
  checks: [], negativeCases: [], modelRequests: 0, productChanges: 0, builds: 0,
  boundaries: ["Explicitly isolated database and WebView, not default-profile acceptance",
    "Actual WebView simulated logical sizes, not physical 4K hardware",
    "No Editor coverage upgrade, game setup, Android or final user project claim"] };
const names = [
  "two-controlled-fixtures-and-defaults", "native-cancel-does-not-set-directory",
  "native-project-a-chinese-space-directory", "native-project-b-independent-directory",
  "a-b-a-save-and-no-overwrite", "actual-filename-collision", "first-native-close-and-real-restart",
  "unavailable-directory-no-fallback-and-real-retry",
  "actual-write-denial-no-fallback-actionable-error-and-retry",
  "directory-controls-real-12-combination-matrix", "reset-only-current-project-and-default-download",
  "primary-final-normal-close", "fresh-profile-native-package-open-does-not-carry-machine-path",
  "portable-profile-final-normal-close",
];
function matrix(cells) {
  assert.equal(cells.length, 12);
  const keys = new Set();
  for (const c of cells) {
    assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h]) => w===c.width && h===c.height));
    assert([1,2].includes(c.dpr) && typeof c.reduced === "boolean");
    const key = [c.width,c.height,c.dpr,c.reduced].join("/");
    assert(!keys.has(key)); keys.add(key);
    assert(c.geometry.overflow <= 1);
    assert.equal(c.geometry.controls.length, 2);
    for (const b of c.geometry.controls)
      assert(b.hit && !b.disabled && !b.clipped && b.rect.left>=0 && b.rect.top>=0 &&
        b.rect.right<=c.width && b.rect.bottom<=c.height);
    const [a,b] = c.geometry.controls.map(x=>x.rect);
    assert.equal(Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)) *
      Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)), 0);
  }
}
async function check(name, action) {
  const c = {name, status:"RUNNING"}; report.checks.push(c);
  try { c.detail=await action(); c.status="PASS"; console.log("PASS "+name); }
  catch(e) { c.status="FAILED"; c.error=String(e.stack||e); throw e; }
}
(async()=>{
  assert(!fs.existsSync(out), "Never overwrite an audit");
  fs.mkdirSync(out);
  fs.copyFileSync(__filename,path.join(out,"executed-audit.cjs"),fs.constants.COPYFILE_EXCL);
  const n=read(source);
  report.source={path:source,sha256:sha(source)};
  const detail=name=>{const c=n.cases.find(c=>c.name===name);assert.equal(c?.status,"PASS",name);return c.detail;};
  await check("fourteen-complete-behaviors-and-nonempty-twelve-display-matrix",()=>{
    assert.equal(n.status,"PASS"); assert.equal(n.version,version);
    assert.equal(n.scope,`ACTUAL_INSTALLED_${version.replaceAll(".","_")}_PROJECT_DIRECTORY_NATIVE_CHOOSER_AND_CLOSE`);
    assert(!n.error && !n.cleanupError); assert.deepEqual(n.errors,[]);
    assert.deepEqual(n.cases.map(c=>c.name),names); assert(n.cases.every(c=>c.status==="PASS"&&c.finishedAt));
    assert.equal(n.modelRequests,0); assert.equal(n.productChanges,0); assert.equal(n.builds,0);
    const cells=detail(names[9]);matrix(cells);
    for(const [name,mutate] of [
      ["empty",x=>x.splice(0)],["missing",x=>x.pop()],["duplicate",x=>x[1]=structuredClone(x[0])],
      ["wrong-dpr",x=>x[0].dpr=3],["wrong-resolution",x=>x[0].width=1280],
      ["overflow",x=>x[0].geometry.overflow=2],["hit",x=>x[0].geometry.controls[0].hit=false],
      ["clip",x=>x[0].geometry.controls[0].clipped=true],["disabled",x=>x[0].geometry.controls[0].disabled=true],
      ["outside",x=>x[0].geometry.controls[0].rect.left=-1],
      ["overlap",x=>x[0].geometry.controls[1].rect=structuredClone(x[0].geometry.controls[0].rect)]
    ]) {const copy=structuredClone(cells);mutate(copy);assert.throws(()=>matrix(copy),name);report.negativeCases.push(name);}
    return {behaviors:n.cases.length,displays:cells.length,rejectedBadEvidence:report.negativeCases.length};
  });
  await check("actual-installed-product-bytes-and-three-host-owned-backends",()=>{
    file(n.originalInstallationReport);
    const i=read(n.originalInstallationReport.path);
    assert.equal(i.version,version);file(i.executable);file(i.actualInstallation);
    if(config){
      const {protectedFiles,protectedAbsent,protectionScope,...binding}=i;
      assert.deepEqual(binding,deriveActual(config.actual,version));
      assert(protectedFiles.length>0&&Array.isArray(protectedAbsent));
      assert.equal(protectionScope,"Fresh current hashes and absent-file boundaries, not preservation since historical 1.9.24");
      assert.deepEqual(n.protectedAbsent,protectedAbsent);
    }
    const actual=read(i.actualInstallation.path);
    assert(actual.status==="PASS"&&actual.exitCode===0&&actual.registryRestored);
    assert.equal(actual.executable.sha256,i.executable.sha256);
    for(const f of [...i.resources,...i.protectedFiles,...n.protected])file(f);
    assert.equal(n.launches.length,3);
    for(const l of n.launches) {
      file(l.executable);assert.equal(l.executable.sha256,i.executable.sha256);
      assert(l.dataDirectoryOverride&&l.webviewDirectoryOverride&&!l.manualBackendSpawn&&!l.sourceServer);
      assert(l.data.startsWith(base.replaceAll("/","\\"))&&l.webview.startsWith(base.replaceAll("/","\\")));
      assert.equal(sha(l.backend.ExecutablePath),l.backend.sha256);
    }
    return {actualNsisReceipt:true,hostStarts:n.launches.length,backendAutoStart:true};
  });
  await check("four-real-pickers-three-normal-closes-and-local-map-isolation",()=>{
    for(const name of [names[1],names[2],names[3],names[12]]) {
      const d=detail(name);A.validateNativeResult(d.input.request,d.input.result);
      assert(d.input.result.interaction.includes("Computer Use") ||
        d.input.result.interaction === "COMPUTER_USE_SKY_NATIVE_DIALOG");
      const saved=read(d.input.request.completion);
      assert.deepEqual(saved,d.input.result);
    }
    const closes=[detail(names[6]).close,detail(names[11]),detail(names[13])];
    for(const c of closes) {
      assert(c.editorExitedNaturally&&c.backendExitedNaturally&&c.portsClosed);
      assert.deepEqual(c.forcedCleanup,[]);
      assert.equal(c.request.requestId,c.result.requestId);assert.equal(c.request.ownerPid,c.result.ownerPid);
      assert(c.result.interaction.includes("Computer Use"));assert.deepEqual(read(c.request.completion),c.result);
    }
    const [a,b]=n.projects;
    assert.deepEqual(detail(names[1]).before,detail(names[1]).after);
    assert.equal(detail(names[2]).after[a.projectId],a.directory);
    assert.equal(detail(names[3]).after[a.projectId],a.directory);
    assert.equal(detail(names[3]).after[b.projectId],b.directory);
    const restart=detail(names[6]);
    assert.notEqual(restart.before.editorPid,restart.after.editorPid);
    assert.notEqual(restart.before.backendPid,restart.after.backendPid);
    assert.equal(restart.before.databasePath,restart.after.databasePath);
    assert.equal(restart.mapping[a.projectId],a.directory);assert.equal(restart.mapping[b.projectId],b.directory);
    assert.equal(detail(names[10]).mapping[a.projectId],undefined);
    assert.equal(detail(names[10]).mapping[b.projectId],b.directory);
    assert.deepEqual(detail(names[12]).mapping,{});
    return {pickerInputs:4,normalCloses:3,forcedCloses:0,projectIsolation:true,portableNoMachineMap:true};
  });
  await check("portable-real-ZIP-bytes-collision-and-actual-failure-retries",async()=>{
    assert.deepEqual(detail(names[4]).artifacts.map(f=>f.projectId),
      [n.projects[0].projectId,n.projects[1].projectId,n.projects[0].projectId]);
    for(const f of n.artifacts) {
      const actual=fs.existsSync(f.path)?f.path:f.archivedPath;
      assert(actual);assert.equal(sha(actual),f.sha256);
      const z=await JSZip.loadAsync(fs.readFileSync(actual),{checkCRC32:true});
      const p=JSON.parse(await z.file("project.json").async("string"));
      assert.equal(p.project_id,f.projectId);assert.equal(p.nodes.length,2);assert.equal(p.edges.length,1);
      const json=JSON.stringify(p);
      assert(!json.includes("projectExportDirectories"));
      for(const project of n.projects)
        assert(!json.includes(JSON.stringify(project.directory).slice(1,-1))&&!json.includes(project.directory.replaceAll("\\","/")));
    }
    assert.equal(n.collision.reserved.length,91);for(const f of n.collision.reserved)file(f);
    assert(/-\d+\.vnproj$/.test(detail(names[5]).saved.path));
    for(const [name,category] of [[names[7],"PROJECT_EXPORT_DIRECTORY_INVALID"],[names[8],"PROJECT_EXPORT_DIRECTORY_WRITE_FAILED"]]) {
      const d=detail(name),f=d.failure||d;file(f.fullReport);file(d.retry);
      assert(f.noFallback);assert(f.messages.join("\n").includes(f.expectedDirectory));
      assert(fs.readFileSync(f.fullReport.path,"utf8").includes(category));
      assert(/重新选择|保存目录/.test(f.messages.join("\n")));
    }
    const reset=detail(names[10]).saved;
    assert(!fs.existsSync(reset.path));assert.equal(sha(reset.archivedPath),reset.sha256);
    return {packages:n.artifacts.length,occupiedNames:91,realFailures:2,retries:2,downloadArchivedAndRemoved:true};
  });
  await check("actual-DPR-preserving-native-PNG-and-complete-matrix-evidence",()=>{
    assert.equal(n.screenshots.length,13);
    for(const s of n.screenshots) {
      file(s);assert.deepEqual(s.before,s.after);
      const b=fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16),Math.round(s.before.width*s.before.dpr));
      assert.equal(b.readUInt32BE(20),Math.round(s.before.height*s.before.dpr));
    }
    for(const c of detail(names[9])) {
      assert.equal(c.screenshot.before.width,c.width);assert.equal(c.screenshot.before.height,c.height);
      assert(Math.abs(c.screenshot.before.dpr-c.dpr)<=1e-6);assert.equal(c.screenshot.before.reduced,c.reduced);
    }
    return {nativePNGs:n.screenshots.length,matrixCells:12};
  });
  await check("actual-ACL-cache-protected-files-processes-and-ports-restored",()=>{
    const proof=read(path.join(base,"acl-before.json")),restored=n.aclRestoration;
    assert.equal(proof.status,"DENIED");assert.notEqual(proof.before,proof.after);
    assert.equal(restored.status,"RESTORED");assert.equal(proof.before,restored.before);
    const normalize=s=>s.replace(/D:AI(?=\(|$)/,"D:");
    assert.equal(normalize(restored.sddl),normalize(proof.before));
    assert.equal(ps(`[IO.Directory]::GetAccessControl('${proof.directory.replaceAll("'","''")}').GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)`),restored.sddl);
    assert.equal(n.cacheRestoration,"PASS");
    const cache=read(path.join(base,"native-cache-restoration.json"));
    assert.equal(cache.status,"PASS");assert.equal(cache.deletedUserFiles,0);
    for(const f of cache.originalFiles)assert.equal(sha(path.join(cache.originalDirectory,f.relative)),f.sha256);
    assert.equal(n.cleanups.length,3);assert(n.cleanups.every(c=>c.status==="PASS"&&c.killed.length===0));
    const identities=new Set((n.allKnownProcesses||[]).map(p=>`${p.ProcessId}:${p.Created}`));
    for(const l of n.launches) {
      identities.add(`${l.pid}:${l.created}`);identities.add(`${l.backend.ProcessId}:${l.backend.Created}`);
    }
    for(const p of rows())assert(!identities.has(`${p.ProcessId}:${p.Created}`));
    assert.equal(listeners(n.launches.flatMap(l=>l.ports)).length,0);
    const downloads=fs.readdirSync(path.join(process.env.USERPROFILE,"Downloads"));
    for(const p of n.projects)assert(!downloads.some(x=>x.startsWith(p.title)));
    for(const f of n.protected)file(f);file(report.source);
    if(config)for(const absent of n.protectedAbsent)assert(!fs.existsSync(absent),absent);
    return {aclRestored:true,cacheRestored:true,naturalCleanups:3,remainingOwnedProcesses:0,ports:0,downloads:0};
  });
  report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
  .finally(()=>{
    report.finishedAt=new Date().toISOString();
    if(fs.existsSync(out))fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
    console.log(JSON.stringify({status:report.status,checks:report.checks.length,negativeCases:report.negativeCases.length,error:report.error,out}));
  });
