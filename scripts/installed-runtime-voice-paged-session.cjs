"use strict";
// Own preparation, real UI export, Player run and guaranteed profile restore
// in one process; no gap leaves user profiles held after a completed session.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{sha256}=require("./lib/installed-acceptance.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-paged-20261019-01";
const work="F:/AgentVN/QA/Runtime-Voice-Paged-20261019-01";
const resume=process.argv.includes("--resume-active");
const resumeRestored=process.argv.find(s=>s.startsWith("--resume-restored="))?.split("=")[1];
if(resumeRestored)assert(/^[0][3-9]$/.test(resumeRestored));
const attempt=resumeRestored||(resume?"02":"01");
if(!resume&&!resumeRestored)assert(!fs.existsSync(base)&&!fs.existsSync(work),"New independent session required");
else if(resume) {
  assert(fs.existsSync(path.join(base,"backend-ready.json")),"Re-observe actual owned backend before resuming");
  assert(!fs.existsSync(path.join(base,`execution-${attempt}.json`)));
}
else assert(!fs.existsSync(path.join(base,`execution-${attempt}.json`)));
const only=process.argv.find(s=>s.startsWith("--only-cell="));
const report={status:"RUNNING",at:new Date().toISOString(),commands:[],error:null,cleanupError:null,
  productChanges:0,modelRequests:0,newBuilds:0};
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
let prepared=resume,launched=resume;
const save=()=>{if(fs.existsSync(base))fs.writeFileSync(path.join(base,`execution-${attempt}.json`),JSON.stringify(report,null,2))};
const env={...process.env,AGENTVN_RUNTIME_ACCEPTANCE_RUN:base,AGENTVN_RUNTIME_ACCEPTANCE_WORK:work,
  AGENTVN_WORKSPACE_OUTPUT:base,AGENTVN_TEST_PROJECT:path.join(work,"有声分页重启隔离小工程.vnproj")};
function command(exe,args,label){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd:"D:/AgentVN",env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    const row={exe,args,label,pid:child.pid,startedAt:new Date().toISOString()};report.commands.push(row);save();
    const chunks=[];for(const s of [child.stdout,child.stderr])s.on("data",b=>{chunks.push(b);process.stdout.write(b)});
    child.once("error",reject);child.once("exit",(code,signal)=>{
      row.exitCode=code;row.signal=signal;row.finishedAt=new Date().toISOString();
      if(fs.existsSync(work)){
        row.log=path.join(work,`${label}-${attempt}.log`);fs.writeFileSync(row.log,Buffer.concat(chunks),{flag:"wx"});
        row.logSha256=sha256(fs.readFileSync(row.log));
      }save();resolve(code);
    });
  });
}
const ps=(file,args,label)=>command("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",`scripts/${file}`,...args],label);
const profile=(action,label)=>ps("installed-preview-session.ps1",["-Suite","runtime-voice-paged","-Action",action,
  ...(resumeRestored?["-Attempt",String(Number(attempt))]:[])],label);
(async()=>{
  if(resumeRestored){
    assert.equal(await profile("ResumeQA","resume"),0);prepared=true;
    report.resumedRestoredSession={attempt,priorEvidencePreserved:true,newExport:false};
  }else if(!resume){
    assert.equal(await profile("Prepare","prepare"),0);prepared=true;
    assert.equal(await command(process.execPath,["scripts/installed-runtime-voice-paged-fixtures.cjs"],"fixtures"),0);
    assert.equal(await profile("Launch","launch"),0);launched=true;
    // Launch readiness is WebView readiness, not packaged backend readiness.
    // Observe the actual bounded health condition, never a fixed sleep.
    const deadline=Date.now()+60000;let healthy=false;
    while(Date.now()<deadline){
      try{healthy=(await fetch("http://127.0.0.1:8278/api/health",{signal:AbortSignal.timeout(1000)})).ok}catch{}
      if(healthy)break;await new Promise(r=>setTimeout(r,100));
    }
    assert(healthy,"Owned packaged backend must become healthy");
    assert.equal(await profile("Observe","observe"),0);
  }else{
    const prior=read(path.join(base,"execution-01.json"));assert.equal(prior.status,"FAILED");
    assert(prior.error.includes("1 !== 0"));assert(prior.cleanupError);
    const prep=read(path.join(base,"preparation.json"));assert(prep.profiles.every(p=>fs.existsSync(p.held)));
    report.resumedActiveSession={originalFailure:path.join(base,"execution-01.json"),
      backendObservation:path.join(base,"backend-ready.json"),newLaunch:false};
  }
  if(!resumeRestored){
    assert.equal(await command(process.execPath,["scripts/installed-runtime-abilities-export.cjs",
      path.join(base,"export-01"),path.join(base,"fixtures.json")],"export"),0);
    assert.equal(await ps("installed-assistant-recovery-session.ps1",["-Suite","runtime-voice-paged","-Action","StopAll",
      "-Evidence",`editor-stop-${attempt}`],"editor-stop"),0);launched=false;
  }
  const args=["scripts/installed-runtime-voice-paged-playwright.cjs",attempt];if(only)args.push(only);
  const runner=args[0];report.runner={path:path.resolve(runner),sha256:sha256(fs.readFileSync(runner))};save();
  const code=await command(process.execPath,args,"player");
  assert.equal(sha256(fs.readFileSync(runner)),report.runner.sha256,"Never change running test");
  const raw=read(path.join(base,`player-${attempt}/report.json`));assert(["PASS","FAILED"].includes(raw.status),"Non-terminal source cannot yield terminal success");
  assert.equal(code,raw.status==="PASS"?0:1);
  report.status=raw.status;report.sourceConclusion=raw.status;if(code)process.exitCode=1;
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1})
.finally(async()=>{
  try{
    if(launched)assert.equal(await ps("installed-assistant-recovery-session.ps1",["-Suite","runtime-voice-paged","-Action","StopAll",
      "-Evidence",`failure-stop-${attempt}`],"failure-stop"),0);
    if(prepared){assert.equal(await profile("Restore","restore"),0);
      const restoration=path.join(base,resumeRestored?`profile-restoration-${attempt}.json`:"profile-restoration.json");
      assert.equal(read(restoration).status,"PASS");report.profileRestoration="PASS";report.restorationFile=restoration}
  }catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1}
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(report));
});
