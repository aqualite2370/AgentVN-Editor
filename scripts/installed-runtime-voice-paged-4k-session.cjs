"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{sha256}=require("./lib/installed-acceptance.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-paged-4k-20261019-01";
const work="F:/AgentVN/QA/Runtime-Voice-Paged-4K-20261019-01";
assert(!fs.existsSync(base)&&!fs.existsSync(work),"Independent fresh 4K session required");
const report={status:"RUNNING",at:new Date().toISOString(),commands:[],error:null,cleanupError:null,
  productChanges:0,modelRequests:0,newBuilds:0,scope:"SUPPLEMENTAL_4K_ONLY_STRONGER_NVL_INPUT"};
const env={...process.env,AGENTVN_RUNTIME_ACCEPTANCE_RUN:base,AGENTVN_RUNTIME_ACCEPTANCE_WORK:work,
  AGENTVN_WORKSPACE_OUTPUT:base,AGENTVN_TEST_PROJECT:path.join(work,"4K有声分页重启隔离小工程.vnproj")};
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const save=()=>{if(fs.existsSync(base))fs.writeFileSync(path.join(base,"execution-01.json"),JSON.stringify(report,null,2))};
let protectedProfiles=false,launched=false;
function command(exe,args,label){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd:"D:/AgentVN",env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    const row={exe,args,label,pid:child.pid,startedAt:new Date().toISOString()};report.commands.push(row);save();
    const output=[];for(const stream of [child.stdout,child.stderr])stream.on("data",b=>{output.push(b);process.stdout.write(b)});
    child.once("error",reject);child.once("exit",(code,signal)=>{
      row.exitCode=code;row.signal=signal;row.finishedAt=new Date().toISOString();
      if(fs.existsSync(work)){
        row.log=path.join(work,`${label}-01.log`);
        fs.writeFileSync(row.log,Buffer.concat(output),{flag:"wx"});row.logSha256=sha256(fs.readFileSync(row.log));
      }save();resolve(code);
    });
  });
}
const ps=(file,args,label)=>command("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",`scripts/${file}`,...args],label);
const profile=(action,label)=>ps("installed-preview-session.ps1",["-Suite","runtime-voice-paged-4k","-Action",action],label);
const stop=label=>ps("installed-assistant-recovery-session.ps1",
  ["-Suite","runtime-voice-paged-4k","-Action","StopAll","-Evidence",`${label}-01`],label);
(async()=>{
  assert.equal(await profile("Prepare","prepare"),0);protectedProfiles=true;
  assert.equal(await command(process.execPath,["scripts/installed-runtime-voice-paged-4k-fixtures.cjs"],"fixtures"),0);
  // Mark attempted launch before waiting, so its failure still enters cleanup.
  launched=true;assert.equal(await profile("Launch","launch"),0);
  const deadline=Date.now()+60000;let healthy=false;
  while(Date.now()<deadline){
    try{healthy=(await fetch("http://127.0.0.1:8278/api/health",{signal:AbortSignal.timeout(1000)})).ok}catch{}
    if(healthy)break;await new Promise(r=>setTimeout(r,100));
  }
  assert(healthy,"Actual packaged backend must become ready");assert.equal(await profile("Observe","observe"),0);
  assert.equal(await command(process.execPath,["scripts/installed-runtime-abilities-export.cjs",
    path.join(base,"export-01"),path.join(base,"fixtures.json")],"export"),0);
  assert.equal(await stop("editor-stop"),0);launched=false;
  const runner="scripts/installed-runtime-voice-paged-4k-playwright.cjs";
  report.runner={path:path.resolve(runner),sha256:sha256(fs.readFileSync(runner))};save();
  const code=await command(process.execPath,[runner,"01"],"player");
  assert.equal(sha256(fs.readFileSync(runner)),report.runner.sha256,"Running runner must stay frozen");
  const raw=read(path.join(base,"player-01/report.json"));
  assert(raw.finishedAt&&["PASS","FAILED"].includes(raw.status));assert.equal(raw.cells.length,8);
  assert.equal(code,raw.status==="PASS"?0:1);report.status=raw.status;report.sourceConclusion=raw.status;
  if(code)process.exitCode=1;
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1})
.finally(async()=>{
  try{
    if(launched)assert.equal(await stop("failure-stop"),0);
    if(protectedProfiles){assert.equal(await profile("Restore","restore"),0);
      report.restorationFile=path.join(base,"profile-restoration.json");
      assert.equal(read(report.restorationFile).status,"PASS");report.profileRestoration="PASS"}
  }catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1}
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(report));
});
