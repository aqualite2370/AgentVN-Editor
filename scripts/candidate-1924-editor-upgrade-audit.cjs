"use strict";
// Re-read terminal native evidence independently. Never starts a product.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {DatabaseSync}=require("node:sqlite");
const {rows,listeners,ps}=require("./lib/current-native-editor-session.cjs");
const {sha256}=require("./lib/installed-acceptance.cjs");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,"")),sha=f=>sha256(fs.readFileSync(f));
const out="F:/AgentVN/QA/Editor-Upgrade-1924-20261025-05";
assert.deepEqual(process.argv.slice(2),["01"]);
const target=path.join(out,"audit-01.json");assert(!fs.existsSync(target));
const report={status:"RUNNING",at:new Date().toISOString(),scope:"INDEPENDENT_EDITOR_UPGRADE_AND_WINDOWS_CACHE_EVIDENCE_AUDIT",
  checks:[],modelRequests:0,productChanges:0};
function check(name,fn){
  try{report.checks.push({name,status:"PASS",detail:fn()});}
  catch(e){report.checks.push({name,status:"FAILED",error:String(e.stack||e)});}
}
const rawFile=path.join(out,"report.json"),r=read(rawFile);
report.source={path:rawFile,sha256:sha(rawFile)};
check("six-real-flows-and-no-model-or-product-changes",()=>{
  assert.equal(r.status,"PASS");assert.equal(r.cleanupStatus,"PASS");assert.equal(r.steps.length,6);
  assert(r.steps.every(s=>s.status==="PASS"));assert.deepEqual(r.errors,[]);
  assert.equal(r.modelRequests,0);assert.equal(r.productChanges,0);
  for(const name of ["InstallOld","InstallNew","Uninstall","Restore"]){
    const receipt=read(path.join(out,name+".json"));assert.equal(receipt.status,"PASS");
    if(name!=="Restore")assert.equal(receipt.exitCode,0);
  }
  assert.equal(read(path.join(out,"InstallOld.json")).actualVersion,"1.9.22");
  assert.equal(read(path.join(out,"InstallNew.json")).actualVersion,"1.9.24");
  assert(!fs.existsSync(path.join(out,"installed-editor/agentvn-editor.exe")));
  return {flows:6,old:"1.9.22",current:"1.9.24"};
});
check("real-default-path-launches-and-Computer-Use-normal-exit",()=>{
  assert.equal(r.launches.length,3);assert.equal(r.cleanups.length,3);
  for(const l of r.launches){
    assert.equal(l.defaultDataPath,true);assert.equal(l.defaultWebViewPath,true);
    assert.equal(l.backendPortOverride,false);assert.equal(l.manualBackendSpawn,false);
    const c=read(path.join(out,l.label+"-close-completed.json"));
    assert.equal(c.pid,l.pid);assert.equal(c.method,"Computer Use Alt+F4");
    assert(r.cleanups.some(c=>c.label===l.label&&c.normalClose&&c.status==="PASS"&&c.killed.length===0));
  }
  assert(!rows().some(p=>r.known.some(q=>q.ProcessId===p.ProcessId&&q.Created===p.Created)));
  assert.equal(listeners([...new Set(r.launches.flatMap(l=>l.ports))]).length,0);
  return {launches:3,normalExits:3,identities:r.known.length};
});
check("genuine-version-invalidated-cache-and-durable-reuse",()=>{
  const old=read(path.join(out,"old-first-cache.json")),next=read(path.join(out,"new-first-cache.json"));
  assert.equal(old.cacheEditorVersion,"1.9.22");assert.equal(next.cacheEditorVersion,"1.9.24");
  assert.notEqual(sha(path.join(out,"old-first-cache.json")),sha(path.join(out,"new-first-cache.json")));
  assert.notEqual(read(path.join(out,"new-first-native.json")).cacheHit,true);
  for(const name of ["old-repeat","new-repeat","new-restart"]){
    assert.equal(read(path.join(out,name+"-native.json")).cacheHit,true);
  }
  assert.equal(sha(path.join(out,"old-repeat-cache.json")),sha(path.join(out,"old-first-cache.json")));
  assert.equal(sha(path.join(out,"new-repeat-cache.json")),sha(path.join(out,"new-first-cache.json")));
  assert.equal(sha(path.join(out,"new-restart-cache.json")),sha(path.join(out,"new-first-cache.json")));
  return {nativeResults:5};
});
check("portable-packages-native-screenshots-and-original-profile-restoration",()=>{
  assert.equal(r.downloads.length,2);
  for(const d of r.downloads){assert.equal(sha(d.retained),d.sha256);assert.equal(d.removed,true);assert(!fs.existsSync(d.source));}
assert(r.screenshots.length>=7);
  for(const s of r.screenshots){
    const f=s.path||s.file;assert(f);const bytes=fs.readFileSync(f);
    assert.equal(bytes.readUInt32BE(16),1920);assert.equal(bytes.readUInt32BE(20),1080);
    assert.equal(sha(f),s.sha256);
  }
  const original=read(path.join(out,"protection.json")),restored=read(path.join(out,"Restore.json"));
  assert.equal(restored.status,"PASS");assert.equal(restored.deletedUserFiles,0);assert.equal(restored.profiles.length,3);
  for(const p of original.records.filter(p=>p.existed)){
    const text=ps(`fsutil.exe file queryfileid '${p.original}'`);assert(text.toLowerCase().includes(p.directoryId));
    if(p.byteInventory)for(const f of p.files)assert.equal(sha(path.join(p.original,f.relative)),f.sha256);
  }
  // Read-only SQLite sanity on the QA database, never the restored user DB.
  const profile=restored.profiles[0].retained,db=new DatabaseSync(path.join(profile,"backend/vn_engine.db"),{readOnly:true});
  try{assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");}finally{db.close();}
  return {screenshots:r.screenshots.length,packages:2,restoredProfiles:3};
});
report.status=report.checks.every(c=>c.status==="PASS")?"PASS":"FAILED";
report.finishedAt=new Date().toISOString();fs.writeFileSync(target,JSON.stringify(report,null,2),{flag:"wx"});
console.log(JSON.stringify({status:report.status,checks:report.checks.map(c=>({name:c.name,status:c.status,error:c.error})),target}));
if(report.status!=="PASS")process.exitCode=1;
