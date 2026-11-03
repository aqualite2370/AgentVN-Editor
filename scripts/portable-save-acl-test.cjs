"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),out=path.join(root,"output/portable-save-acl",new Date().toISOString().replace(/[:.]/g,"-"));
const target=path.join(out,"owned-save-directory"),receipt=path.join(out,"acl.json");
fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,"existing.json"),"original",{flag:"wx"});
const report={status:"RUNNING",target,steps:[]};
const env={...process.env,PSModulePath:[path.join(process.env.USERPROFILE,"Documents/WindowsPowerShell/Modules"),
  path.join(process.env.ProgramFiles,"WindowsPowerShell/Modules"),
  path.join(process.env.SystemRoot,"System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter)};
function acl(mode){
  const r=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(root,"scripts/portable-save-test-acl.ps1"),"-Mode",mode,"-Target",target,"-RunRoot",out,"-ReportPath",receipt],
    {env,windowsHide:true,encoding:"utf8"});
  report.steps.push({mode,exitCode:r.status,stdout:r.stdout,stderr:r.stderr});
  assert.equal(r.status,0,r.stderr||r.stdout);
}
try{
  acl("Block");
  assert.equal(fs.readFileSync(path.join(target,"existing.json"),"utf8"),"original");
  assert.throws(()=>fs.writeFileSync(path.join(target,"new.json"),"blocked",{flag:"wx"}));
  assert.throws(()=>fs.writeFileSync(path.join(target,"existing.json"),"blocked"));
  report.status="PASS";
}catch(error){report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;}
finally{
  if(fs.existsSync(receipt))try{
    acl("Restore");
    fs.writeFileSync(path.join(target,"new.json"),"restored",{flag:"wx"});
    assert.equal(fs.readFileSync(path.join(target,"existing.json"),"utf8"),"original");
    report.restoredWrite=true;
  }catch(error){report.status="FAILED";report.cleanupError=String(error.stack||error);process.exitCode=1;}
  fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));console.log(`Evidence: ${out}`);
}
