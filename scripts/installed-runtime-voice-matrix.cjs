"use strict";
// Session owner: always restore original default profiles after Player cleanup.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {sha256}=require("./lib/installed-acceptance.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-20261019-01";
const work="F:/AgentVN/QA/Runtime-Voice-20261019-01";
const attempt=process.argv[2]||"01";assert(/^\d{2}$/.test(attempt));
const destination=path.join(base,`execution-${attempt}.json`);assert(!fs.existsSync(destination));
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const fixture=read(path.join(base,"fixtures.json"));
const env={...process.env,AGENTVN_TEST_PROJECT:fixture.input,AGENTVN_WORKSPACE_OUTPUT:base};
const runner="D:/AgentVN/scripts/installed-runtime-voice-playwright.cjs";
const report={status:"RUNNING",at:new Date().toISOString(),commands:[],error:null,cleanupError:null,
  runner:{path:runner,sha256:sha256(fs.readFileSync(runner))},
  environment:{AGENTVN_TEST_PROJECT:env.AGENTVN_TEST_PROJECT,AGENTVN_WORKSPACE_OUTPUT:base},
  productChanges:0,modelRequests:0,newBuilds:0};
const save=()=>fs.writeFileSync(destination,JSON.stringify(report,null,2));
function command(exe,args,label){
  return new Promise((resolve,reject)=>{
    const log=path.join(work,`${label}-${attempt}.log`);assert(!fs.existsSync(log));
    fs.writeFileSync(log,"",{flag:"wx"});
    const child=spawn(exe,args,{cwd:"D:/AgentVN",env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    const row={exe,args,pid:child.pid,log,startedAt:new Date().toISOString()};report.commands.push(row);save();
    for(const s of [child.stdout,child.stderr])s.on("data",b=>{fs.appendFileSync(log,b);process.stdout.write(b)});
    child.once("error",reject);child.once("exit",(code,signal)=>{
      row.exitCode=code;row.signal=signal;row.finishedAt=new Date().toISOString();save();resolve(code);
    });
  });
}
(async()=>{
  assert.equal(await command("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    "D:/AgentVN/scripts/installed-assistant-recovery-session.ps1","-Suite","runtime-voice","-Action","StopAll",
    "-Evidence",`editor-stop-${attempt}`],"editor-stop"),0);
  const code=await command(process.execPath,[runner,attempt],"player-matrix");
  assert.equal(sha256(fs.readFileSync(runner)),report.runner.sha256,"Running test must remain unchanged");
  const raw=read(path.join(base,`player-${attempt}/report.json`));
  assert.equal(code,raw.status==="PASS"?0:1);
  report.sourceConclusion=raw.status;report.status=raw.status;
  if(raw.status!=="PASS")process.exitCode=1;
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1})
.finally(async()=>{
  try{
    assert.equal(await command("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
      "D:/AgentVN/scripts/installed-preview-session.ps1","-Suite","runtime-voice","-Action","Restore"],"profile-restore"),0);
    const restored=read(path.join(base,"profile-restoration.json"));assert.equal(restored.status,"PASS");
    report.profileRestoration="PASS";
  }catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1}
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(report));
});
