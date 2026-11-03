"use strict";
// Independent checks of original evidence and restoration, not new UI tests.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process"),{sha256}=require("./lib/installed-acceptance.cjs");
const {validateVoiceCommandOwnership}=require("./lib/voice-playback-evidence.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-20261019-01";
const attempt=process.argv[2]||"01",audit=process.argv[3]||"01";
assert(/^\d{2}$/.test(attempt)&&/^\d{2}$/.test(audit));
const destination=path.join(base,`audit-${attempt}-${audit}.json`);assert(!fs.existsSync(destination));
const report={status:"RUNNING",at:new Date().toISOString(),checks:[],sources:[],
  sourceConclusion:"UNPROVEN",scope:"EVIDENCE_AND_RESTORATION_NOT_NEW_UI_OR_LISTENING_TESTS",error:null};
const sha=p=>sha256(fs.readFileSync(p));
function read(p){report.sources.push({path:p,sha256:sha(p)});return JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""))}
function check(name,fn){
  const row={name,status:"RUNNING"};report.checks.push(row);
  try{row.detail=fn();row.status="PASS";console.log(`PASS ${name}`)}
  catch(e){row.status="FAILED";row.error=String(e.stack||e);throw e}
}
try{
  const execution=read(path.join(base,`execution-${attempt}.json`));
  const raw=read(path.join(base,`player-${attempt}/report.json`));
  const prep=read(path.join(base,"preparation.json"));
  const fixture=read(path.join(base,"fixtures.json"));
  const exported=read(path.join(base,"export-01/report.json"));
  const restoredProfiles=read(path.join(base,"profile-restoration.json"));
  assert.equal(restoredProfiles.status,"PASS");
  const originalPlayer=prep.profiles.find(p=>p.app==="player"&&p.kind==="Roaming");
  const retainedPlayer=restoredProfiles.profiles.find(p=>p.app==="player"&&p.kind==="Roaming");
  assert(originalPlayer&&retainedPlayer);
  assert.equal(path.resolve(retainedPlayer.testHeld),
    path.resolve(originalPlayer.original+".qa-tested-runtime-voice-20261019-01"));
  const replay=read(path.join(base,"observer-replay-input.json"));
  const originalOracle=read(path.join(base,"observer-preflight-01.json"));
  const correctedOracle=read(path.join(base,"observer-preflight-02.json"));
  report.sources.push({path:"D:/AgentVN/scripts/lib/voice-playback-evidence.cjs",
    sha256:sha("D:/AgentVN/scripts/lib/voice-playback-evidence.cjs")});
  report.sourceConclusion=raw.status;
  if(audit!=="01"){
    const previous=read(path.join(base,`audit-${attempt}-01.json`));
    assert.equal(previous.status,"FAILED");assert.equal(previous.sourceConclusion,"PASS");
    assert(previous.error.includes("ENOENT")&&previous.error.includes("game.vncart"));
    report.previousAudit={status:"FAILED_RETAINED",cause:"QA_LOOKED_IN_ORIGINAL_PROFILE_AFTER_RESTORATION",
      productTestRerun:false};
  }
  check("Original first-call DOM-oracle failure remains immutable; corrected ownership validator rejects invalid evidence",()=>{
    assert.equal(originalOracle.status,"FAILED");
    assert.equal(originalOracle.scope,"LEGACY_AUDIT_ORACLE_REPRO_NOT_PRODUCT_FAILURE");
    assert.equal(correctedOracle.status,"PASS");assert.equal(correctedOracle.checks.length,13);
    assert(correctedOracle.checks.every(c=>c.status==="PASS"));
    assert.equal(originalOracle.inputSha256,sha(path.join(base,"observer-replay-input.json")));
    assert.equal(correctedOracle.inputSha256,originalOracle.inputSha256);
    assert.deepEqual(replay.cell,raw.cells.find(c=>c.name===replay.cell.name));
    return {historicalOracle:"FAILED_RETAINED",validatorReplayCases:13,
      runningPlayerTestChanged:false,productFailureInferred:false};
  });
  check("Complete terminal24 layout flows contain every12 viewport/DPR/motion combination without empty PASS",()=>{
    assert(["PASS","FAILED"].includes(raw.status));assert(raw.finishedAt&&execution.finishedAt);
    assert.equal(raw.cells.length,24);const keys=new Set();
    for(const c of raw.cells){
      const v=c.viewport,k=[v.width,v.height,v.dpr,v.reduced,c.layout].join("/");assert(!keys.has(k));keys.add(k);
      assert(["PASS","FAILED"].includes(c.status));
      if(c.status==="PASS"){assert.equal(c.checks.length,12);assert(c.checks.every(s=>s.status==="PASS"))}
      else assert(c.error||c.checks.some(s=>s.status==="FAILED"));
    }
    for(const [w,h]of [[1920,1080],[2560,1440],[3840,2160]])for(const d of [1,2])
      for(const reduced of [false,true])for(const layout of ["agentvn","renpy"])
        assert(keys.has([w,h,d,reduced,layout].join("/")));
    assert.equal(raw.status,raw.cells.every(c=>c.status==="PASS")?"PASS":"FAILED");
    assert.equal(execution.sourceConclusion,raw.status);assert.equal(execution.status,raw.status);
    assert.deepEqual(raw.pageErrors,[]);return {layoutFlows:24,combinations:12,sourceConclusion:raw.status};
  });
  check("Actual UI-exported inputs, WAV and frozen installed Player retain exact bytes",()=>{
    assert.equal(exported.status,"PASS");assert.equal(exported.cartridges.length,2);
    for(const c of exported.cartridges)assert.equal(sha(c.path),c.sha256);
    assert.equal(exported.cartridges[0].scriptSha256,exported.cartridges[1].scriptSha256);
    assert.equal(sha(fixture.input),fixture.inputSha256);
    assert.equal(sha(fixture.voice.path),fixture.voice.sha256);
    for(const f of raw.sources)assert.equal(sha(f.path),f.sha256);
    assert.equal(sha(execution.runner.path),execution.runner.sha256);
    const mappings=[];
    for(const l of raw.launches){
      assert.equal(l.controlledLibraryImport.normalFilePickerClaim,false);
      const original=exported.cartridges.find(c=>c.layout===raw.cells.find(c=>c.name===l.cell).layout);
      const beforeRestore=l.controlledLibraryImport.record.cartridgePath;
      const relative=path.relative(originalPlayer.original,beforeRestore);
      assert(relative&&!path.isAbsolute(relative)&&!relative.startsWith(".."),"Card must belong to this protected QA Player");
      const retained=path.join(retainedPlayer.testHeld,relative);
      assert.equal(sha(retained),original.sha256);
      mappings.push({beforeRestore,retained,sha256:original.sha256});
    }
    return {newProductChanges:0,newModelRequests:0,uiExportedCartridges:2,normalFilePickerClaim:false,
      restoredProfileMappings:mappings};
  });
  check("Successful flows have real resolved media plays and clock progress, silent restore and unaltered NVL",()=>{
    let calls=0,negativeWindows=0,successfulFlows=0,preMountInitialObservations=0;
    for(const c of raw.cells){
      if(c.status!=="PASS")continue;successfulFlows++;
      const q=c.audio;assert(q);assert.equal(q.calls.length,12);
      const ownership=validateVoiceCommandOwnership(c,fixture);
      if(!ownership.initialCallSiteDomAvailable)preMountInitialObservations++;
      assert(!q.events.some(e=>e.event==="error"));
      for(const call of q.calls){
        assert(q.events.some(e=>e.id===call.id&&e.event==="playing"));
        assert(q.events.some(e=>e.id===call.id&&e.event==="timeupdate"&&e.time>0&&Math.abs(e.duration-2)<.01));
        calls++;
      }
      for(let i=0;i<3;i++){
        const [initial,menu,loaded,rollback]=c.checks.slice(i*4,i*4+4).map(s=>s.detail);
        assert.equal(initial.bytes.sha256,fixture.voice.sha256);
        assert.equal(initial.bytes.bytes,64044);
        assert.equal(menu.stored.command_index,i*3);
        assert.equal(loaded.restored.command,i*3);
        assert.deepEqual(rollback.back.nvl,rollback.middle.nvl);
        assert.deepEqual(rollback.forward.nvl,rollback.last.nvl);
        assert.equal(rollback.back.command,i*3+1);assert.equal(rollback.forward.command,i*3+2);
        for(const observation of [menu.observation,loaded.observation,rollback.backObservation,rollback.forwardObservation]){
          assert.equal(observation.expectedCount,observation.observedCount);
          assert(observation.negativeWindowMs>=2200);negativeWindows++;
        }
      }
    }
    assert(successfulFlows>0);return {successfulFlows,realMediaPlays:calls,negativeWindows,
      preMountInitialObservations,newListeningAcceptance:false};
  });
  check("PNG physical pixels and native-save copies independently match reported evidence",()=>{
    for(const s of raw.screenshots){
      const b=fs.readFileSync(s.path);assert.equal(sha256(b),s.sha256);assert.deepEqual(s.before,s.after);
      assert.equal(b.readUInt32BE(16),s.before.width*s.before.dpr);
      assert.equal(b.readUInt32BE(20),s.before.height*s.before.dpr);
    }
    for(const s of raw.nativeSaves){assert.equal(sha(s.retained),s.sha256);assert.equal(read(s.retained).save_id,s.saveId)}
    if(raw.status==="PASS"){assert.equal(raw.screenshots.length,72);assert.equal(raw.nativeSaves.length,72)}
    assert(raw.screenshots.length>0);return {pngs:raw.screenshots.length,nativeSaves:raw.nativeSaves.length,webviewEmulationNotPhysicalDisplay:true};
  });
  check("Four original profiles and55 baseline files restored against independent backups",()=>{
    const restore=read(path.join(base,"profile-restoration.json"));assert.equal(restore.status,"PASS");
    assert.equal(execution.profileRestoration,"PASS");assert(!execution.cleanupError&&!raw.cleanupError);
    let files=0;assert.equal(prep.profiles.length,4);
    for(const p of prep.profiles){
      assert(fs.existsSync(p.original)&&!fs.existsSync(p.held));
      for(const f of p.files){assert.equal(sha(path.join(p.original,f.relative)),f.sha256);assert.equal(sha(f.backup),f.sha256);files++}
    }assert.equal(files,55);return {profiles:4,independentFileHashes:files};
  });
  check("Frozen EXEs/Dev and560 product sources preserve only the earlier seven authorized changes",()=>{
    assert.equal(sha(path.join(prep.installRoot,"agentvn-editor.exe")),"f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"),prep.originalDevSha256);
    const baseline=read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const authorized=read("D:/AgentVN/output/editor-selection-mask-20261019-01/terminal-audit-02.json");
    const allowed=new Map(authorized.sources.map(f=>[path.resolve("D:/AgentVN",f.file),f.sha256]));
    assert.equal(baseline.source.length,560);assert.equal(allowed.size,7);
    for(const f of baseline.source)assert.equal(sha(f.path),allowed.get(path.resolve(f.path))||f.sha256,f.path);
    return {sources:560,earlierAuthorizedChanges:7,newProductChanges:0,devRebuilt:false};
  });
  check("Attributed Editor/Player processes and all this session's ports are gone",()=>{
    assert.equal(raw.launches.length,24);assert(raw.launches.every(l=>l.cleanup?.status==="PASS"));
    const launch=read(path.join(base,"launch.json")),stopped=read(path.join(base,`editor-stop-${attempt}.json`));
    assert.equal(stopped.status,"PASS");
    const pids=[...raw.launches.map(l=>l.pid),...stopped.before.map(p=>p.ProcessId)];
    const ports=[...raw.launches.map(l=>l.cdpPort),launch.cdpPort,launch.playerCdpPort,launch.backendPort];
    const command=`$p=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -in @(${pids.join(",")})}); `+
      `$t=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in @(${ports.join(",")})}); `+
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 5`;
    const residual=JSON.parse(execFileSync("powershell.exe",["-NoProfile","-Command",command],{encoding:"utf8",windowsHide:true,timeout:20000}));
    assert.equal(residual.processes.length,0);assert.equal(residual.ports.length,0);
    return {playerLaunches:24,residual,normalCloseAcceptance:false};
  });
  report.status="PASS";
}catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1}
finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(destination,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,sourceConclusion:report.sourceConclusion,checks:report.checks.length,destination,error:report.error}))}
