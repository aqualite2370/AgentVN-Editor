"use strict";
// Independent terminal evidence and restoration checks. Product FAILED can
// coexist with an audit PASS; never substitute audit status for source status.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process"),{sha256}=require("./lib/installed-acceptance.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-paged-4k-20261019-01";
const attempt=process.argv[2]||"01",audit=process.argv[3]||"01";assert(/^\d{2}$/.test(attempt)&&/^\d{2}$/.test(audit));
const dest=path.join(base,`audit-${attempt}-${audit}.json`);assert(!fs.existsSync(dest));
const result={status:"RUNNING",at:new Date().toISOString(),sourceConclusion:"UNPROVEN",checks:[],sources:[],error:null,
  scope:"EVIDENCE_RESTORATION_ONLY_NOT_ADDITIONAL_PRODUCT_UI_TESTS"};
const sha=p=>sha256(fs.readFileSync(p));
function read(p){result.sources.push({path:p,sha256:sha(p)});return JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""))}
function check(name,fn){
  const row={name,status:"RUNNING"};result.checks.push(row);
  try{row.detail=fn();row.status="PASS";console.log(`PASS ${name}`)}
  catch(e){row.status="FAILED";row.error=String(e.stack||e);throw e}
}
try{
  const raw=read(path.join(base,`player-${attempt}/report.json`));
  const execution=read(path.join(base,`execution-${attempt}.json`));
  const prep=read(path.join(base,"preparation.json")),restored=read(execution.restorationFile||path.join(base,"profile-restoration.json"));
  const fixture=read(path.join(base,"fixtures.json")),exported=read(path.join(base,"export-01/report.json"));
  result.sourceConclusion=raw.status;assert(raw.finishedAt&&execution.finishedAt);
  check("Terminal source reports cover every declared layout/viewport/motion combination with honest failures",()=>{
    assert(["PASS","FAILED"].includes(raw.status));assert.equal(raw.cells.length,raw.expectedFlows);
    const keys=new Set();
    for(const c of raw.cells){
      const key=`${c.viewport.width}x${c.viewport.height}-dpr${c.viewport.dpr}-${c.viewport.reduced?"reduced":"normal"}-${c.layout}`;
      assert.equal(c.name,key);assert(!keys.has(key));keys.add(key);assert(["PASS","FAILED"].includes(c.status));
      if(c.status==="PASS"){assert.equal(c.checks.length,c.layout==="renpy"?11:7);assert(c.checks.every(s=>s.status==="PASS"));assert.equal(c.saved.length,3)}
      else assert(c.error||c.checks.some(s=>s.status==="FAILED"));
    }
    if(!raw.onlyCell){
      assert.equal(raw.cells.length,8);
      for(const [w,h]of [[3840,2160]])for(const d of [1,2])
        for(const reduced of [false,true])for(const layout of ["agentvn","renpy"])
          assert(keys.has(`${w}x${h}-dpr${d}-${reduced?"reduced":"normal"}-${layout}`));
    }
    assert.equal(raw.status,raw.cells.every(c=>c.status==="PASS")?"PASS":"FAILED");
    assert.equal(execution.sourceConclusion,raw.status);assert.equal(execution.status,raw.status);
    assert.equal(execution.runner.sha256,sha(execution.runner.path));
    assert.deepEqual(raw.pageErrors,[]);return {flows:raw.cells.length,scope:raw.onlyCell?"SINGLE_CELL":"FULL_MATRIX",
      passed:raw.cells.filter(c=>c.status==="PASS").length,failed:raw.cells.filter(c=>c.status==="FAILED").length};
  });
  check("Actual installed Editor exported both cartridges with exact input, WAV, script and frozen executable identities",()=>{
    assert.equal(exported.status,"PASS");assert.equal(exported.cartridges.length,2);
    assert.equal(exported.cartridges[0].scriptSha256,exported.cartridges[1].scriptSha256);
    assert.equal(sha(fixture.input),fixture.inputSha256);assert.equal(sha(fixture.voice.path),fixture.voice.sha256);
    for(const c of exported.cartridges)assert.equal(sha(c.path),c.sha256);
    for(const s of raw.sources)assert.equal(sha(s.path),s.sha256);
    const original=prep.profiles.find(p=>p.app==="player"&&p.kind==="Roaming");
    const retained=restored.profiles.find(p=>p.app==="player"&&p.kind==="Roaming");
    assert.equal(path.resolve(retained.testHeld),path.resolve(original.original+".qa-tested-runtime-voice-paged-4k-20261019-01"));
    let mappings=0;
    for(const l of raw.launches){
      if(!l.persistedLibraryRecord)continue;
      const relative=path.relative(original.original,l.persistedLibraryRecord.cartridgePath);
      assert(relative&&!path.isAbsolute(relative)&&!relative.startsWith(".."));
      const exportedCard=exported.cartridges.find(c=>c.layout===raw.cells.find(c=>c.name===l.cell).layout);
      assert.equal(sha(path.join(retained.testHeld,relative)),exportedCard.sha256);mappings++;
      if(l.restart)assert(!l.controlledLibraryImport,"Restart must use real persisted library, not reseed");
    }
    return {mappedLibraryCopies:mappings,newBuilds:0,newListeningClaim:false,modelRequests:0};
  });
  check("Passing source flows prove exact pagination, durable interior-page save and real-process silent recovery",()=>{
    let flows=0,pages=0,restarts=0,negativeWindows=0,plays=0;
    for(const c of raw.cells){
      for(const w of c.negativeWindows){assert(w.windowMs>=2200);assert.equal(w.observed,w.expected);negativeWindows++}
      for(const l of raw.launches.filter(l=>l.cell===c.name)){
        for(const call of l.audio?.calls||[]){
          assert.equal(call.settlement,"resolved");assert(l.audio.events.some(e=>e.id===call.id&&e.event==="playing"));
          assert(l.audio.events.some(e=>e.id===call.id&&e.event==="timeupdate"&&e.time>0&&Math.abs(e.duration-2)<.01));plays++;
        }
      }
      if(c.status!=="PASS")continue;flows++;
      for(let i=0;i<3;i++){
        const d=c.checks[i].detail;assert(d.pages.length>1);
        assert.equal(d.pages.map(s=>s.text).join(""),fixture.voice.dialogs[i*2].text);
        for(const [j,s]of d.pages.entries()){assert.equal(s.page,j+1);assert.equal(s.command,i*2);pages++}
        const saved=c.saved[i];assert.equal(saved.page.page,2);assert.equal(saved.manual.dialog_page_index,1);
        assert.equal(saved.manual.dialog_page_count,d.pages.length);
        const restoredPage=c.checks[4+i].detail.restored;
        assert.equal(restoredPage.page,2);assert.equal(restoredPage.text,saved.page.text);
        assert.deepEqual(restoredPage.nvl,saved.page.nvl);
      }
      const restart=c.checks[3].detail;assert.notEqual(restart.oldPid,restart.newPid);assert.equal(restart.reseeded,false);
      const launches=raw.launches.filter(l=>l.cell===c.name);assert.equal(launches.length,2);
      assert.equal(launches[0].pid,restart.oldPid);assert.equal(launches[1].pid,restart.newPid);
      assert.equal(launches[0].audio.calls.length,6);assert.equal(launches[1].audio.calls.length,3);restarts++;
      if(c.layout==="renpy"){
        for(let i=0;i<3;i++)assert.equal(c.checks[7+i].detail.text,c.saved[i].page.text);
        assert.equal(c.checks[10].detail.text,c.saved[2].page.text);
      }
    }
    return {passingFlows:flows,fullyVerifiedPages:pages,realProcessRestarts:restarts,realMediaPlays:plays,
      completedNegativeWindows:negativeWindows,notAProductPassWhenFlowsZero:flows===0};
  });
  check("Actual PNG parameters/pixels and native filesystem save copies match recorded hashes",()=>{
    for(const s of raw.screenshots){
      const b=fs.readFileSync(s.path);assert.equal(sha256(b),s.sha256);assert.deepEqual(s.before,s.after);
      assert.equal(b.readUInt32BE(16),s.before.width*s.before.dpr);assert.equal(b.readUInt32BE(20),s.before.height*s.before.dpr);
    }
    const original=prep.profiles.find(p=>p.app==="player"&&p.kind==="Roaming");
    const retained=restored.profiles.find(p=>p.app==="player"&&p.kind==="Roaming");
    for(const s of raw.nativeSaves){
      assert.equal(sha(s.retained),s.sha256);assert.equal(read(s.retained).save_id,s.saveId);
      const relative=path.relative(original.original,s.source);
      assert(relative&&!relative.startsWith("..")&&!path.isAbsolute(relative));
      assert.equal(sha(path.join(retained.testHeld,relative)),s.sha256,"Restart/load must not change persisted save bytes");
    }
    assert(raw.screenshots.length>0);return {screenshots:raw.screenshots.length,nativeSaveCopies:raw.nativeSaves.length};
  });
  check("All four original profiles and55 baseline files are restored against independent backups",()=>{
    assert.equal(restored.status,"PASS");assert.equal(execution.profileRestoration,"PASS");
    assert(!raw.cleanupError&&!execution.cleanupError);let files=0;
    for(const p of prep.profiles){
      assert(fs.existsSync(p.original)&&!fs.existsSync(p.held));
      for(const f of p.files){assert.equal(sha(path.join(p.original,f.relative)),f.sha256);assert.equal(sha(f.backup),f.sha256);files++}
    }assert.equal(files,55);return {profiles:prep.profiles.length,independentFileHashes:files};
  });
  check("Frozen binaries, Dev and560 product files preserve the earlier seven authorized source changes only",()=>{
    assert.equal(sha(path.join(prep.installRoot,"agentvn-editor.exe")),"f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"),prep.originalDevSha256);
    const baseline=read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const authorized=read("D:/AgentVN/output/editor-selection-mask-20261019-01/terminal-audit-02.json");
    const allowed=new Map(authorized.sources.map(s=>[path.resolve("D:/AgentVN",s.file),s.sha256]));
    assert.equal(baseline.source.length,560);assert.equal(allowed.size,7);
    for(const f of baseline.source)assert.equal(sha(f.path),allowed.get(path.resolve(f.path))||f.sha256,f.path);
    return {checked:560,priorAuthorizedChanges:7,newProductChanges:0,devRebuilt:false};
  });
  check("All attributed test processes and ports are gone after real termination and default-profile restoration",()=>{
    assert(raw.launches.length>0&&raw.launches.every(l=>l.cleanup?.status==="PASS"));
    const launch=read(path.join(base,"launch.json")),stopped=read(path.join(base,"editor-stop-01.json"));assert.equal(stopped.status,"PASS");
    const pids=[...raw.launches.map(l=>l.pid),...stopped.before.map(p=>p.ProcessId)];
    const ports=[...raw.launches.map(l=>l.cdpPort),launch.cdpPort,launch.playerCdpPort,launch.backendPort];
    const command=`$p=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in @(${pids.join(",")})});`+
      `$t=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})});`+
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4`;
    const residual=JSON.parse(execFileSync("powershell.exe",["-NoProfile","-Command",command],{encoding:"utf8",windowsHide:true,timeout:20000}));
    assert.equal(residual.processes.length,0);assert.equal(residual.ports.length,0);return residual;
  });
  check("Original failed QA matrix and distinct stronger 4K fixture remain separately attributable",()=>{
    const priorBase="D:/AgentVN/output/installed-runtime-voice-paged-20261019-01";
    const prior=read(path.join(priorBase,"player-04/report.json"));assert.equal(prior.status,"FAILED");
    assert.equal(prior.cells.filter(c=>c.status==="PASS").length,16);
    const oldFixture=read(path.join(priorBase,"fixtures.json"));
    assert.equal(sha(oldFixture.input),oldFixture.inputSha256);
    assert.equal(fixture.voice.sha256,oldFixture.voice.sha256);
    assert.equal(fixture.voice.dialogs[0].text,oldFixture.voice.dialogs[0].text);
    assert.equal(fixture.voice.dialogs[4].text,oldFixture.voice.dialogs[4].text);
    assert(fixture.voice.dialogs[2].text.length>oldFixture.voice.dialogs[2].text.length*3);
    const frozen="F:/AgentVN/Checkpoints/Runtime-Voice-Paged-4K-20261019-01/installed-runtime-voice-paged-playwright.cjs";
    assert.equal(sha(frozen),"cd570c686cce452b662618220b0a9a9b6b007b6781ae23cd3188d5425df69ae3");
    assert.equal(sha("D:/AgentVN/scripts/installed-runtime-voice-paged-playwright.cjs"),sha(frozen));
    return {priorQaMatrix:"FAILED_RETAINED",priorCompletePassingFlows:16,
      supplement:"4K_ONLY_DISTINCT_LONGER_NVL_INPUT",sameFixtureAcrossAllResolutions:false,
      currentSourceStatus:raw.status};
  });
  result.status="PASS";
}catch(e){result.status="FAILED";result.error=String(e.stack||e);process.exitCode=1}
finally{result.finishedAt=new Date().toISOString();fs.writeFileSync(dest,JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:result.status,sourceConclusion:result.sourceConclusion,checks:result.checks.length,dest,error:result.error}))}
