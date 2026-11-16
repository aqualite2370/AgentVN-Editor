"use strict";
// Verify retained evidence and exact lifecycle; never rerun product operations.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),
  assert=require("node:assert/strict"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"..");
const source="F:/testavn/Editor-Arrange-Idempotence-20261116-01";
const release="F:/testavn/Editor-Arrange-Release-1982-20261116-01";
const native="F:/testavn/Windows-Isolated-1982-20261116-01";
const output=path.join(native,"terminal-audit-01.json");
assert(!fs.existsSync(output),"Preserve original audit");
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report={status:"RUNNING",startedAt:new Date().toISOString(),groups:[],inputs:[],
  productLaunches:0,builds:0,modelRequests:0,deletedFiles:0,
  scope:"TARGETED_1982_EDITOR_RELEASE_NOT_ANDROID_PHYSICAL_PHONE_OR_FULL_INSTALLED_MATRIX"};
function input(file){report.inputs.push({path:file,sha256:sha(file)});return read(file);}
function verify(file){assert.equal(sha(file.path),file.sha256);}
function group(name,action){
  const row={name,status:"RUNNING"};report.groups.push(row);
  try{row.detail=action();row.status="PASS";}catch(error){row.status="FAILED";row.error=error.stack;throw error;}
}
try{
  const checkpoint=input(path.join(release,"checkpoint.json")),build=input(path.join(release,"release/build.json"));
  const run=input(path.join(native,"resource-01/report.json"));
  group("source-reproduction-fix-and-real-browser",()=>{
    const before=input(path.join(source,"before.json")),after=input(path.join(source,"after.json"));
    assert.equal(before.cases.filter(c=>c.status==="FAILED").length,6);
    assert.equal(after.status,"PASS");assert.equal(after.cases.length,8);
    assert(after.cases.every(c=>c.status==="PASS"&&c.repeatCount===5));
    const browser=input(path.join(source,"browser-03/report.json"));assert.equal(browser.status,"PASS");
    verify(browser.inheritedEvidence);assert.equal(browser.inheritedEvidence.cases.length,3);
    assert(browser.inheritedEvidence.cases.every(c=>c.status==="PASS"));assert.equal(browser.cases.length,1);
    assert(browser.cases.every(c=>c.status==="PASS"));
    const hover=input("F:/testavn/Editor-Hover-Underline-20261116-01/report-02.json");
    assert.equal(hover.status,"PASS");assert.equal(hover.cases.length,12);
    return{directCases:8,actualSourceAppGroups:4,hoverSourceCombinations:12,
      originalFailuresPreserved:true,sourceReopenNotNativeRestart:true};
  });
  group("unique-build-and-frozen-provenance",()=>{
    const stages=input(path.join(release,"build-stages.json"));
    assert.equal(stages.status,"PASS_BUILD_NOT_INSTALLED");assert.equal(stages.stages.length,4);
    assert(stages.stages.every(s=>s.status==="PASS"));
    assert.equal(build.version,"1.9.82");assert.equal(build.nativePlayerBuilds,0);
    for(const file of [build.installer,build.dev,build.player,build.backend,build.payloadReport])verify(file);
    assert.equal(build.player.sha256,checkpoint.frozen.player.sha256);
    const payload=input(build.payloadReport.path);
    assert.equal(payload.status,"PASS");
    assert.equal(run.stages[0].detail.executable.sha256,
      payload.deployments.find(d=>d.kind==="NSIS actual payload").executable.sha256);
    return{version:build.version,installer:build.installer,playerUnchanged:true,msiInstallers:build.msiInstallers};
  });
  group("actual-install-history-restart-and-native-files",()=>{
    assert.equal(run.status,"PASS");assert.equal(run.cleanupStatus,"PASS");
    assert.equal(run.stages.length,7);assert(run.stages.every(s=>s.status==="PASS"));
    assert.equal(run.launches.length,2);assert.equal(run.launches[0].database,run.launches[1].database);
    assert(run.launches.every(l=>!l.dataDirectoryOverride&&!l.webviewDirectoryOverride));
    assert.equal(run.cleanups.length,2);assert(run.cleanups.every(c=>c.status==="PASS"&&c.killed.length===0));
    assert.deepEqual(run.errors,[]);assert.equal(run.blockedModelRequests||0,0);
    assert(run.backupEvidence.length>0);
    for(const file of run.backupEvidence){verify(file);verify(file.metadata);}
    assert.equal(run.screenshots.length,2);
    for(const shot of run.screenshots)verify(shot);
    return{stages:7,sameDefaultProfile:true,nativeBackup:true,normalCloses:2,
      installedDisplayScope:"1920x1080_DPR1_NORMAL_NOT_FULL_MATRIX"};
  });
  group("retired-identity-and-exact-cleanup",()=>{
    const controller=input(path.join(native,"account-controller.json"));
    const failed=input(path.join(native,"account-retirement-01.json"));
    assert.equal(failed.status,"FAILED");
    const retired=input(path.join(native,"account-retirement-readonly-03.json"));
    const cleanup=input(path.join(native,"artifact-cleanup-03.json"));
    assert.equal(controller.status,"FINISHED");assert(controller.jobs.every(j=>j.status==="PASS"));
    assert.equal(retired.status,"PASS");assert.equal(retired.account.sid,controller.account.sid);
    assert(retired.cleanup.accountDeleted&&retired.cleanup.profileDeleted);
    assert(!fs.existsSync(retired.account.profile));verify(retired.databaseEvidence);
    assert.equal(cleanup.status,"PASS");assert.equal(cleanup.targets.length,3);
    assert(cleanup.targets.every(t=>t.removed&&!fs.existsSync(t.path)));
    assert.equal(cleanup.oldRejectedProfilesTouched,false);
    for(const file of cleanup.retained)verify(file);
    return{sid:retired.account.sid,originalRetirementFailurePreserved:true,
      qaSources:input(path.join(native,"qa-sources.json")).files.length,
      files:cleanup.files,logicalBytes:cleanup.logicalBytes,previousConfirmedRemoved:cleanup.previousConfirmedRemoved,
      partialPriorTempDeletionNotCounted:true,notPhysicalReleasedBytes:true};
  });
  group("protected-daily-user-scope-and-real-git-index",()=>{
    const git=args=>cp.execFileSync("git",args,{cwd:root,encoding:"utf8",windowsHide:true,
      env:{...process.env,GIT_OPTIONAL_LOCKS:"0"}}).trim();
    assert.equal(git(["rev-parse","HEAD"]),checkpoint.git.head);verify(checkpoint.git.index);
    verify(checkpoint.daily);verify(checkpoint.frozen.installer);verify(checkpoint.frozen.player);
    for(const file of checkpoint.sources)verify(file);
    return{dailyUnchanged:true,realHeadAndIndexUnchanged:true,frozenPreviousUnchanged:true,
      userDatabaseAndNovelNotUsed:true};
  });
  report.status="PASS";
}catch(error){report.status="FAILED";report.error=error.stack;process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();
  fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,groups:report.groups.map(g=>({name:g.name,status:g.status})),error:report.error}));
}
