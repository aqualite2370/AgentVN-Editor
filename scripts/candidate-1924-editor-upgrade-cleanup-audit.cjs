"use strict";
// Read-only verification after QA profiles were archived off the system disk.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {rows,listeners,ps}=require("./lib/current-native-editor-session.cjs");
const {sha256}=require("./lib/installed-acceptance.cjs");
const root="F:/AgentVN/QA/Editor-Upgrade-1924-20261025-05";
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const hash=f=>sha256(fs.readFileSync(f));
const target=path.join(root,"cleanup-audit-01.json");
assert(!fs.existsSync(target));
const report={status:"RUNNING",at:new Date().toISOString(),checks:[],deletedUserFiles:0};
function check(name,run){
  try{report.checks.push({name,status:"PASS",detail:run()});}
  catch(e){report.checks.push({name,status:"FAILED",error:String(e.stack||e)});}
}
const protection=read(path.join(root,"protection.json"));
check("all-twelve-QA-archives-and-absence-of-original-QA-siblings",()=>{
  const cleanup=read(path.join(root,"retained-cleanup-02.json"));
  assert.equal(cleanup.status,"PASS");assert.equal(cleanup.records.length,12);
  assert.equal(cleanup.deletedUserFiles,0);
  let files=0;
  for(const r of cleanup.records){
    assert.equal(r.removed,true);assert(!fs.existsSync(r.source));
    for(const f of r.files){const file=path.join(r.archive,f.relative);
      assert.equal(fs.statSync(file).size,f.bytes);assert.equal(hash(file),f.sha256);files++;}
  }
  return {directories:12,files,bytesRemovedFromC:cleanup.bytesRemovedFromC,
    originalFailedCleanupPreserved:read(path.join(root,"retained-cleanup-01.json")).status==="FAILED"};
});
check("original-profiles-shortcuts-and-frozen-artifacts-unchanged",()=>{
  let files=0;
  for(const r of protection.records){
    assert(ps(`fsutil.exe file queryfileid '${r.original}'`).toLowerCase().includes(r.directoryId));
    if(r.byteInventory)for(const f of r.files){assert.equal(hash(path.join(r.original,f.relative)),f.sha256);files++;}
  }
  for(const f of protection.protectedFiles)assert.equal(hash(f.path),f.sha256);
  for(const f of protection.links)assert.equal(hash(f.path),f.sha256);
  assert.equal(hash(protection.originalInstallation+"/agentvn-editor.exe"),
    protection.originalInstallationFiles.find(f=>f.relative==="agentvn-editor.exe").sha256);
  const values=JSON.parse(ps("Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor' | Select-Object DisplayVersion,InstallLocation | ConvertTo-Json -Compress"));
  assert.equal(values.DisplayVersion,"1.9.9");
  return {profileFiles:files,protectedArtifacts:protection.protectedFiles.length,shortcuts:protection.links.length,restoredRegistration:values};
});
check("all-owned-processes-and-listeners-absent",()=>{
  const raw=read(path.join(root,"report.json")),current=rows();
  assert(!current.some(p=>raw.known.some(q=>q.ProcessId===p.ProcessId&&q.Created===p.Created)));
  const ports=[...new Set(raw.launches.flatMap(l=>l.ports))];
  assert.equal(listeners(ports).length,0);
  assert.equal(raw.status,"PASS");assert.equal(read(path.join(root,"audit-01.json")).status,"PASS");
  return {identities:raw.known.length,ports};
});
report.status=report.checks.every(c=>c.status==="PASS")?"PASS":"FAILED";
report.finishedAt=new Date().toISOString();
fs.writeFileSync(target,JSON.stringify(report,null,2),{flag:"wx"});
console.log(JSON.stringify(report));
if(report.status!=="PASS")process.exitCode=1;
