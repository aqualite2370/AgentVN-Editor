"use strict";
// Read-only independent audit of the completed 03/04/05 evidence chain.
// Historical FAILED reports stay FAILED; assess each required behavior itself.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const JSZip=require("../editor/node_modules/jszip");
const A=require("./lib/installed-acceptance.cjs");
const {rows,listeners,ps}=require("./lib/current-native-editor-session.cjs");
const root="F:/AgentVN/QA/Project-Directory-Installed-20261022-01";
const out=path.resolve(process.argv[2]||"");
assert.equal(out,path.resolve(root,"native-terminal-audit-01.json"));assert(!fs.existsSync(out));
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>A.sha256(fs.readFileSync(f));
const sources=["03","04","05"].map(n=>({run:path.join(root,`editor-${n}`),
  file:path.join(root,`editor-${n}`,"report.json")}));
for(const s of sources){s.value=read(s.file);s.sha256=sha(s.file);}
const [original,resume,finish]=sources.map(s=>s.value);
const supplementRoot=path.join(root,"editor-05","acl-supplement-01");
const recoveryRoot=path.join(root,"editor-05","acl-recovery-01");
const supplement=read(path.join(supplementRoot,"report.json")),recovery=read(path.join(recoveryRoot,"report.json"));
const result={status:"RUNNING",featureStatus:"FAILED",at:new Date().toISOString(),
  scope:"ACTUAL_INSTALLED_1_9_22_NATIVE_DIRECTORY_EVIDENCE_AUDIT_ONLY",
  sources:sources.map(({file,sha256})=>({file,sha256})),checks:[],negativeEvidenceChecks:0,
  productChanges:0,modelRequests:0,builds:0,notClaimed:["full project-directory PASS","Dev rebuild",
    "independent Windows game","Android","cover-upgrade","final user project"]};
const caseOf=(r,name)=>{const c=r.cases.find(c=>c.name===name);assert.equal(c?.status,"PASS",name);return c.detail;};
async function check(name,fn){const c={name,status:"RUNNING"};result.checks.push(c);
  try{c.detail=await fn();c.status="PASS";}catch(e){c.status="FAILED";c.error=String(e.stack||e);throw e;}}
function reject(fn){assert.throws(fn);result.negativeEvidenceChecks++;}
function matrix(samples,files=true){
  assert.equal(samples.length,12);const keys=new Set();
  for(const s of samples){
    const key=`${s.width}/${s.height}/${s.dpr}/${s.reduced}`;assert(!keys.has(key));keys.add(key);
    assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h])=>s.width===w&&s.height===h));
    assert([1,2].includes(s.dpr)&&typeof s.reduced==="boolean");
    const image=s.screenshot;assert.deepEqual(image.before,image.after);
    assert.equal(image.before.width,s.width);assert.equal(image.before.height,s.height);
    assert(Math.abs(image.before.dpr-s.dpr)<1e-6);assert.equal(image.before.reduced,s.reduced);
    if(files){assert.equal(sha(image.path),image.sha256);const png=fs.readFileSync(image.path);
      assert.equal(png.readUInt32BE(16),s.width*s.dpr);assert.equal(png.readUInt32BE(20),s.height*s.dpr);}
    assert(s.geometry.overflow<=1);assert.equal(s.geometry.controls.length,2);
    for(const b of s.geometry.controls)assert(b.hit&&!b.clipped&&!b.disabled&&b.rect.left>=0&&b.rect.top>=0&&
      b.rect.right<=s.width&&b.rect.bottom<=s.height);
    const [a,b]=s.geometry.controls.map(c=>c.rect);
    assert.equal(Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
      Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)),0);
  }
}
(async()=>{
  await check("Frozen candidate, failed originals, exact continuation references and six actual host launches",()=>{
    for(const s of sources){
      const r=s.value;assert.equal(r.status,"FAILED");assert(r.finishedAt&&!r.cleanupError);
      assert.equal(r.version,"1.9.22");assert.equal(r.modelRequests,0);assert.equal(r.productChanges,0);assert.equal(r.builds,0);
      const install=read(path.join(s.run,"sealed-installation-receipt.json"));
      assert.equal(sha(install.executable.path),install.executable.sha256);
      assert.equal(install.executable.sha256,"189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc");
      for(const f of install.resources)assert.equal(sha(f.path),f.sha256);
      for(const l of r.launches){
        assert.equal(l.executable.sha256,install.executable.sha256);
        assert(l.dataDirectoryOverride&&l.webviewDirectoryOverride&&!l.manualBackendSpawn&&!l.sourceServer);
        assert.equal(sha(l.backend.ExecutablePath),l.backend.sha256);
      }
    }
    assert.equal(resume.priorEvidence.sha256,sources[0].sha256);
    assert.equal(finish.priorEvidence.sha256,sources[1].sha256);
    assert.equal(finish.originalNativeEvidence.sha256,sources[0].sha256);
    return {hosts:sources.reduce((n,s)=>n+s.value.launches.length,0),
      historicalFailedReportsPreserved:3,installationVersion:"1.9.22"};
  });
  await check("Required fourteen behaviors mapped individually; permission guidance remains a product failure",()=>{
    const old=original.cases.slice(0,7);assert(old.every(c=>c.status==="PASS"));
    const newer=["unavailable-directory-no-fallback-and-real-retry","directory-controls-real-12-combination-matrix",
      "reset-only-current-project-and-default-download","primary-final-normal-close"].map(name=>({name,detail:caseOf(resume,name)}));
    const last=["fresh-profile-native-package-open-does-not-carry-machine-path",
      "portable-profile-final-normal-close"].map(name=>({name,detail:caseOf(finish,name)}));
    assert.equal(old.length+newer.length+last.length,13);
    assert.equal(supplement.checks.find(c=>c.name==="real-denial-no-partial-file-no-fallback-no-success")?.status,"PASS");
    assert.equal(supplement.checks.find(c=>c.name==="denial-identifies-selected-path-and-directory-recovery")?.status,"FAILED");
    assert.equal(recovery.status,"PASS");
    result.features=[...old.map(c=>({name:c.name,status:"PASS",source:sources[0].file})),
      ...newer.map(c=>({name:c.name,status:"PASS",source:sources[1].file})),
      ...last.map(c=>({name:c.name,status:"PASS",source:sources[2].file})),
      {name:"actual-write-denial-no-fallback-actionable-error-and-retry",status:"FAILED",
        source:path.join(supplementRoot,"report.json"),retrySource:path.join(recoveryRoot,"report.json"),
        reason:"Actual native refusal is correct but omits the output directory and wrongly suggests checking assets."}];
    return {required:14,pass:13,failed:1,permissionDenial:true,noFallback:true,retry:true};
  });
  await check("Actual package bytes, references, A-B-A, no overwrite and no machine path in portable project",async()=>{
    const reset=caseOf(resume,"reset-only-current-project-and-default-download").saved;
    const artifacts=[...original.artifacts,...resume.artifacts,...finish.artifacts,recovery.retryPackage];
    const checked=new Set();
    for(const a of artifacts){
      const file=fs.existsSync(a.path)?a.path:a.archivedPath;assert(file);
      assert.equal(sha(file),a.sha256);if(checked.has(file))continue;checked.add(file);
      const zip=await JSZip.loadAsync(fs.readFileSync(file));
      const project=JSON.parse(await zip.file("project.json").async("string"));
      assert(original.projects.some(p=>p.projectId===project.project_id));
      assert.equal(project.nodes.length,2);assert.equal(project.edges.length,1);
      const json=JSON.stringify(project);assert(!json.includes("projectExportDirectories"));
      for(const p of original.projects)assert(!json.includes(p.directory)&&!json.includes(p.directory.replaceAll("\\","/")));
    }
    const sequence=caseOf(original,"a-b-a-save-and-no-overwrite").artifacts.map(a=>a.projectId);
    assert.deepEqual(sequence,[original.projects[0].projectId,original.projects[1].projectId,original.projects[0].projectId]);
    for(const a of original.collision.reserved)assert.equal(sha(a.path),a.sha256);
    assert.equal(original.collision.reserved.length,91);
    assert(!fs.existsSync(reset.path));assert.equal(sha(reset.archivedPath),reset.sha256);
    assert.deepEqual(caseOf(finish,"fresh-profile-native-package-open-does-not-carry-machine-path").mapping,{});
    return {uniquePackages:checked.size,collisionFilesPreserved:91,defaultDownloadArchivedAndRemoved:true};
  });
  await check("Twelve real WebView combinations, raw PNG pixels and hit/overlap assertions; bad matrices rejected",()=>{
    const samples=caseOf(resume,"directory-controls-real-12-combination-matrix");matrix(samples);
    reject(()=>matrix([]));reject(()=>matrix([...samples.slice(0,11),samples[0]],false));
    for(const edit of [
      s=>s[0].screenshot.before.dpr=2,
      s=>s[0].geometry.controls[0].hit=false,
      s=>s[0].geometry.controls[0].rect.left=-1,
      s=>s[0].geometry.overflow=2,
      s=>s[0].geometry.controls[0].clipped=true]){
      const copy=structuredClone(samples);edit(copy);reject(()=>matrix(copy,false));
    }
    return {combinations:12,source:sources[1].file};
  });
  await check("Real native picker/cancel/normal-close receipts and preserved failed native save report",()=>{
    for(const name of ["native-cancel-does-not-set-directory","native-project-a-chinese-space-directory",
      "native-project-b-independent-directory"]){
      const d=caseOf(original,name);A.validateNativeResult(d.input.request,d.input.result);
      assert(d.input.result.interaction.includes("Computer Use"));
    }
    const imported=caseOf(finish,"fresh-profile-native-package-open-does-not-carry-machine-path");
    A.validateNativeResult(imported.input.request,imported.input.result);assert(imported.input.result.interaction.includes("Computer Use"));
    const closed=[caseOf(original,"first-native-close-and-real-restart").close,
      caseOf(resume,"primary-final-normal-close"),caseOf(finish,"primary-final-normal-close"),
      caseOf(finish,"portable-profile-final-normal-close")];
    for(const d of closed){
      assert(d.editorExitedNaturally&&d.backendExitedNaturally&&d.portsClosed);
      assert.deepEqual(d.forcedCleanup,[]);assert(d.result.interaction.includes("Computer Use"));
      assert.equal(d.request.requestId,d.result.requestId);assert.equal(d.request.ownerPid,d.result.ownerPid);
    }
    assert.equal(sha(supplement.errorReport.path),supplement.errorReport.sha256);
    const text=fs.readFileSync(supplement.errorReport.path,"utf8");
    assert(text.includes(supplement.summary)&&/os error 5/.test(supplement.summary));
    assert(!supplement.summary.includes(original.projects[1].directory));
    return {nativeOperations:4,normalCloses:4,incorrectGuidance:supplement.summary};
  });
  await check("Original ACL permissions restored, no temporary files or owned Downloads left",()=>{
    const proof=read(path.join(supplementRoot,"acl-before.json")),restored=recovery.restoration;
    assert.equal(restored.status,"RESTORED");assert.equal(proof.before,restored.before);
    const normalize=s=>s.replace(/D:AI(?=\(|$)/,"D:");
    assert.equal(normalize(restored.sddl),normalize(proof.before));
    const actual=ps(`[IO.Directory]::GetAccessControl('${proof.directory.replaceAll("'","''")}').GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)`);
    assert.equal(actual,restored.sddl);
    const downloads=path.join(process.env.USERPROFILE,"Downloads");
    for(const p of original.projects){
      assert(!fs.readdirSync(downloads).some(n=>n.startsWith(p.title)));
      assert(!fs.readdirSync(p.directory).some(n=>n.endsWith(".vnproj.tmp")));
    }
    return {denialRemoved:true,ownerGroupAndAllPermissionEntriesPreserved:true,
      autoInheritedMarkerNormalized:restored.autoInheritedMarkerNormalized,downloadsResidual:0};
  });
  await check("Processes/ports, cache, protected artifacts, historical source reports and cleanup",()=>{
    const now=rows(),ports=new Set(),identities=new Set();
    for(const s of sources){
      for(const p of s.value.allKnownProcesses||[]){
        const id=`${p.ProcessId}:${p.Created}`;identities.add(id);
        assert(!now.some(n=>n.ProcessId===p.ProcessId&&n.Created===p.Created));
      }
      for(const l of s.value.launches)for(const port of l.ports)ports.add(port);
      assert(s.value.cleanups.length>0&&s.value.cleanups.every(c=>c.status==="PASS"));
      const cache=read(path.join(s.run,"native-cache-restoration.json"));assert.equal(cache.status,"PASS");assert.equal(cache.deletedUserFiles,0);
      for(const f of s.value.protected)assert.equal(sha(f.path),f.sha256);
      assert.equal(sha(s.file),s.sha256);
    }
    assert.equal(listeners([...ports]).length,0);
    return {identities:identities.size,ports:ports.size,cacheRestorations:3,
      userFilesDeleted:0,productOrDevModified:false,independentAuditOnly:true};
  });
  result.status="PASS";
})().catch(e=>{result.status="FAILED";result.error=String(e.stack||e);})
  .finally(()=>{result.finishedAt=new Date().toISOString();fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:"wx"});
    console.log(JSON.stringify({status:result.status,featureStatus:result.featureStatus,
      checks:result.checks.length,negativeEvidenceChecks:result.negativeEvidenceChecks,out,error:result.error}));
    if(result.status!=="PASS")process.exitCode=1;});
