"use strict";
// Independent, read-only audit. Historical old native-close failure stays FAILED.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {DatabaseSync}=require("node:sqlite");
const {rows,listeners,ps}=require("./lib/current-native-editor-session.cjs");
const {sha256}=require("./lib/installed-acceptance.cjs");
const root="F:/AgentVN/QA/Editor-Cross-1924-20261025-03";
const continuation="F:/AgentVN/QA/Editor-Cross-1924-20261025-continuation-02";
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const hash=f=>sha256(fs.readFileSync(f));
const file=path.join(root,"audit-01.json");assert(!fs.existsSync(file));
const rawFile=path.join(root,"report.json"),r=read(rawFile);
const follow=read(path.join(continuation,"report.json"));
const report={status:"RUNNING",at:new Date().toISOString(),
  scope:"CURRENT_CROSS_GENERATION_MIGRATION_WITH_EXPLICIT_OLD_FORCED_STOP_LIMITATION",
  source:{path:rawFile,sha256:hash(rawFile)},
  continuation:{path:path.join(continuation,"report.json"),sha256:hash(path.join(continuation,"report.json"))},
  checks:[],productChanges:0,modelRequests:0,
  oldNativeCloseStatus:"FAILED",fullRegressionStatus:"NOT_COMPLETE"};
function check(name,run){
  try{report.checks.push({name,status:"PASS",detail:run()});}
  catch(e){report.checks.push({name,status:"FAILED",error:String(e.stack||e)});}
}
check("actual-old-install-same-directory-upgrade-and-native-consent",()=>{
  assert.equal(r.status,"FAILED");assert.equal(r.cleanupStatus,"PASS");
  assert.equal(r.steps.length,5);assert(r.steps.slice(0,4).every(s=>s.status==="PASS"));
  assert.equal(r.steps[4].status,"FAILED");assert(r.steps[4].error.includes("data.description"));
  assert.equal(follow.status,"PASS");assert.equal(follow.cleanupStatus,"PASS");
  assert.equal(follow.steps.length,3);assert(follow.steps.every(s=>s.status==="PASS"));
  assert.equal(follow.source.sha256,hash(rawFile));
  assert.equal(r.modelRequests,0);assert.equal(r.productChanges,0);
  const old=read(path.join(root,"InstallOld.json")),next=read(path.join(root,"InstallNew.json"));
  assert.equal(old.actualVersion,"1.7.1");assert.equal(next.actualVersion,"1.9.24");
  assert.equal(old.installRoot,next.installRoot);
  assert.equal(old.exitCode,0);assert.equal(next.exitCode,0);
  assert.equal(hash(old.executable),old.sha256);assert.equal(hash(next.executable),next.sha256);
  assert.equal(next.actualSha256,"ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");
  const uninstall=read(path.join(root,"Uninstall.json"));
  assert(Date.parse(uninstall.at)>Date.parse(next.at));
  const decision=read(path.join(root,"actual-native-migration-decision.json"));
  assert.equal(decision.approved,true);
  assert(decision.sources.some(s=>path.resolve(s)===path.resolve(r.legacyDatabase.path)));
  assert.equal(r.migration.consent.method,"Computer Use native Yes");
  assert.equal(r.migration.consent.pid,r.launches.find(l=>l.label==="new").pid);
  assert.equal(r.migration.request.sourceSha256,r.legacyDatabase.sha256);
  return {old:"1.7.1",current:"1.9.24",nativeConsent:true,uninstallOnlyAfterUpgrade:true};
});
check("real-old-JSON-and-old-new-SQLite-with-authored-data-and-new-save",()=>{
  const legacy=JSON.parse(fs.readFileSync(r.legacyDownload.path,"utf8"));
  assert.equal(hash(r.legacyDownload.path),r.legacyDownload.sha256);
  assert.equal(hash(r.legacyDatabase.backup),r.legacyDatabase.sha256);
  const states=[];
  for(const database of [r.legacyDatabase.backup,follow.source.sources[0].source,
      path.join(continuation,"data/backend/vn_engine.db")]){
    const db=new DatabaseSync(database,{readOnly:true});
    try{
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
      const projects=db.prepare("SELECT project_id,project_json FROM editor_project_details").all();
      assert.equal(projects.length,1);
      states.push({id:projects[0].project_id,project:JSON.parse(projects[0].project_json)});
    }finally{db.close();}
  }
  assert.equal(states[0].id,legacy.project_id);assert.equal(states[1].id,states[0].id);assert.equal(states[2].id,states[0].id);
  for(const s of states){
    assert.equal(s.project.title,legacy.title);assert.equal(s.project.author,legacy.author);
    assert.deepEqual(s.project.edges,legacy.edges);
    assert.deepEqual(s.project.nodes.map(n=>n.id),legacy.nodes.map(n=>n.id));
    for(const n of legacy.nodes.filter(n=>n.data?.scene)){
      const actual=s.project.nodes.find(x=>x.id===n.id);
      assert.equal(actual.data.scene.scene_id,n.data.scene.scene_id);
      assert.deepEqual(actual.data.scene.commands,n.data.scene.commands);
    }
  }
  assert.equal(states[0].project.nodes.find(n=>n.id==="node_scene_opening").data.scene.summary,
    "真实旧版1.7.1跨代保留正文与场景");
  assert.equal(states[1].project.nodes.find(n=>n.id==="node_scene_opening").data.scene.summary,
    "真实旧版1.7.1跨代保留正文与场景");
  assert.equal(states[2].project.nodes.find(n=>n.id==="node_scene_opening").data.scene.summary,
    "实际跨代后新保存1.9.24");
  const early=read(path.join(root,"old-baseline.json")).project.graph.nodes.find(n=>n.id==="node_scene_opening");
  assert.notEqual(early.data.description,states[0].project.nodes.find(n=>n.id==="node_scene_opening").data.description);
  for(const f of follow.source.sources)assert.equal(hash(f.source),f.sha256);
  const saved=follow.download;assert.equal(hash(saved.retained),saved.sha256);
  assert.equal(saved.removed,true);assert(!fs.existsSync(saved.source));
  return {oldDatabaseIntegrity:"ok",newDatabaseIntegrity:"ok",projectId:states[0].id,newNativePackage:true};
});
check("two-current-native-normal-exits-and-explicit-old-close-failure",()=>{
  assert.equal(r.launches.length,2);assert.equal(follow.launches.length,2);
  for(const l of r.launches){
    assert.equal(l.defaultDataPath,true);assert.equal(l.defaultWebViewPath,true);
    assert.equal(l.manualBackendSpawn,false);assert.equal(l.backendPortOverride,false);
  }
  for(const [i,label] of ["saved","restart"].entries()){
    const l=follow.launches[i],c=read(path.join(continuation,label+"-close-completed.json"));
    assert.equal(c.pid,l.pid);assert.equal(c.method,"Computer Use Alt+F4");
    assert.equal(l.dataDirectoryOverride,true);assert.equal(l.webviewDirectoryOverride,true);
    assert(follow.cleanups.some(c=>c.reason==="NORMAL_CLOSE_VERIFIED_"+label&&c.killed.length===0));
  }
  const old=r.cleanups.find(c=>c.label==="old");
  assert.equal(old.normalClose,false);assert(old.killed.length>0);
  assert.equal(hash(r.oldNativeClose.prior),r.oldNativeClose.sha256);
  assert.equal(read(r.oldNativeClose.prior).status,"FAILED");
  const known=[...r.known,...follow.knownProcesses];
  assert(!rows().some(p=>known.some(q=>p.ProcessId===q.ProcessId&&p.Created===q.Created)));
  assert.equal(listeners([...new Set([...r.launches,...follow.launches].flatMap(l=>l.ports))]).length,0);
  return {currentNormalExits:2,oldCloseFailed:true,identities:known.length,
    currentFollowupUsesExactMigratedQAProfileReplay:true};
});
check("real-screenshots-original-directories-and-registration-restored",()=>{
  assert.equal(r.screenshots.length,1);assert.equal(follow.screenshots.length,3);
  for(const s of [...r.screenshots,...follow.screenshots]){
    const f=s.path||s.file,b=fs.readFileSync(f);
    assert.equal(hash(f),s.sha256);assert.equal(b.readUInt32BE(16),1920);assert.equal(b.readUInt32BE(20),1080);
  }
  const prep=read(path.join(root,"protection.json")),restored=read(path.join(root,"Restore.json"));
  assert.equal(restored.status,"PASS");assert.equal(restored.deletedUserFiles,0);
  for(const p of prep.records){
    assert(ps(`fsutil.exe file queryfileid '${p.original}'`).toLowerCase().includes(p.directoryId));
    if(p.byteInventory)for(const f of p.files)assert.equal(hash(path.join(p.original,f.relative)),f.sha256);
  }
  for(const f of prep.protectedFiles)assert.equal(hash(f.path),f.sha256);
  for(const l of prep.links)assert.equal(hash(l.path),l.sha256);
  assert(!fs.existsSync(path.join(root,"installed-editor/agentvn-editor.exe")));
  const registered=JSON.parse(ps("Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor' | Select-Object DisplayVersion | ConvertTo-Json -Compress"));
  assert.equal(registered.DisplayVersion,"1.9.9");
  return {screenshots:4,restoredProfiles:3,originalRegistration:"1.9.9",
    originalFailedReportsPreserved:true};
});
report.status=report.checks.every(c=>c.status==="PASS")?"PASS":"FAILED";
report.featureStatus=report.status==="PASS"?"PARTIAL_PASS":"FAILED";
report.finishedAt=new Date().toISOString();
fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify(report));
if(report.status!=="PASS")process.exitCode=1;
