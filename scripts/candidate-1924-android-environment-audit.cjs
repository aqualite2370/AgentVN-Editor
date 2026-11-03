"use strict";
// Read-only combined audit. An independent successful continuation must never
// turn the original failed import diagnosis into an overall PASS.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {sha256}=require("./lib/installed-acceptance.cjs");
const {rows,listeners,ps}=require("./lib/current-native-editor-session.cjs");
const base="F:/AgentVN/QA/Android-Environment-1924-20261025-04";
const continuation="F:/AgentVN/QA/Android-Environment-1924-20261025-05";
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>sha256(fs.readFileSync(f));
function cache(v,version){
  assert.equal(v.ok,true);assert.equal(v.status,"PASS");assert.equal(v.cachePlatform,"android");
  assert.equal(v.cacheSchemaVersion,1);assert.equal(v.cacheEditorVersion,version);
  assert(v.checks.length>=10&&v.checks.every(c=>c.status==="PASS"));
}
function matrix(v){
  assert.equal(v.length,12);const seen=new Set();
  for(const r of v){
    assert.equal(r.status,"PASS");assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h])=>w===r.width&&h===r.height));
    assert([1,2].includes(r.dpr)&&typeof r.reduced==="boolean");
    const key=[r.width,r.height,r.dpr,r.reduced].join(":");assert(!seen.has(key));seen.add(key);
    assert.equal(r.geometry.length,3);
    for(const g of r.geometry)assert(g.hit&&!g.clipped&&g.overflow<=1&&g.rect.x>=0&&g.rect.y>=0&&g.rect.right<=r.width+1&&g.rect.bottom<=r.height+1);
    cache(r.result.cache,"1.9.24");assert.equal(r.result.value.cacheHit,true);
  }
}
function png(s){
  assert.equal(sha(s.path),s.sha256);const b=fs.readFileSync(s.path);
  assert.deepEqual(s.before,s.after);assert.equal(b.readUInt32BE(16),s.png.width);assert.equal(b.readUInt32BE(20),s.png.height);
  assert.equal(s.png.width,s.before.width*s.before.dpr);assert.equal(s.png.height,s.before.height*s.before.dpr);
}
if(process.argv[2]==="--self-test"){
  const r={width:1920,height:1080,dpr:1,reduced:false,status:"PASS",geometry:[]};
  assert.throws(()=>matrix([]));assert.throws(()=>matrix(Array(12).fill(r)));
  const v={ok:true,status:"PASS",cachePlatform:"android",cacheSchemaVersion:1,cacheEditorVersion:"1.9.24",
    checks:Array.from({length:10},()=>({status:"PASS"}))};cache(v,"1.9.24");
  for(const delta of [{ok:false},{status:"BLOCKED"},{cacheEditorVersion:"1.9.22"},{cachePlatform:"windows"},{checks:[]}]){
    assert.throws(()=>cache({...v,...delta},"1.9.24"));
  }
  console.log("PASS: empty/duplicate matrices and five false cache claims rejected; no product launch");
}else{
  assert.deepEqual(process.argv.slice(2),["01"]);
  const destination=path.join(continuation,"combined-audit-01.json");assert(!fs.existsSync(destination));
  const report={status:"RUNNING",featureStatus:"PARTIAL_PASS",at:new Date().toISOString(),groups:[],
    failed:["ENV-IMPORT-DIAGNOSTIC-01: actual corrupt package dialog discards the specific reason"],
    blocked:["Complete valid .avnenv import/deployment: no verified archive available"],
    limitations:["Not a clean machine","Explicit DB/WebView profiles; native caches use physical default paths",
      "No APK/device/elevation claim","No new Dev or editor package","Not a new editor installation or upgrade"],
    productChanges:0,modelRequests:0,sources:[]};
  function group(name,run){const row={name,status:"RUNNING"};report.groups.push(row);
    try{row.detail=run();row.status="PASS";}catch(e){row.status="FAILED";row.error=String(e.stack||e);throw e;}}
  try{
    const a=read(path.join(base,"report.json")),b=read(path.join(continuation,"report.json"));
    report.sources=[base,continuation].map(p=>({path:path.join(p,"report.json"),sha256:sha(path.join(p,"report.json"))}));
    group("real-two-version-native-cache",()=>{
      assert.equal(a.status,"FAILED");assert.equal(a.steps.length,4);assert(a.steps.slice(0,3).every(s=>s.status==="PASS"));
      assert.equal(a.steps[3].status,"FAILED");assert.equal(a.cleanupStatus,"PASS");assert.equal(a.modelRequests,0);
      for(const [step,version]of [[a.steps[0],"1.9.22"],[a.steps[1],"1.9.24"]]){
        const {first,again}=step.detail;cache(first.cache,version);cache(again.cache,version);
        assert.notEqual(first.value.cacheHit,true);assert.equal(again.value.cacheHit,true);assert.equal(first.cacheSha256,again.cacheSha256);
        for(const detail of [first,again])for(const f of detail.evidence)assert.equal(sha(f.retained),f.sha256);
      }
      assert.notEqual(a.steps[0].detail.again.cacheSha256,a.steps[1].detail.first.cacheSha256);
      return {oldVersion:"1.9.22",currentVersion:"1.9.24",freshChecks:2,sameVersionReuses:2};
    });
    group("native-picker-and-original-diagnostic-failure-retained",()=>{
      const cancel=read(path.join(base,"cancel-picker-completed.json")),corrupt=read(path.join(base,"corrupt-picker-completed.json"));
      for(const [r,label]of [[cancel,"cancel"],[corrupt,"corrupt"]]){
        assert.equal(r.label,label);assert.equal(r.method,"Computer Use");assert.equal(r.pid,a.launches[1].pid);assert.equal(r.pickerAbsent,true);
      }
      assert.equal(cancel.action,"cancel");assert.equal(corrupt.action,"select");
      assert.equal(path.resolve(corrupt.selectedFile),path.resolve(base,"损坏依赖包.avnenv"));
      assert(/构建依赖导入失败/.test(a.steps[3].error));
      assert.equal(sha(path.join(base,"cache-2/android-pass.json")),a.steps[1].detail.again.cacheSha256);
      assert(!fs.existsSync(path.join(base,"cache-2/android-operation.lock")));
      return {cancel:"PASS",invalidArchiveRejected:true,specificDiagnostic:"FAILED",
        validPassCacheUnchanged:true,fullToolchainByteInventory:"NOT_COLLECTED"};
    });
    group("display-matrix-restart-and-real-normal-close",()=>{
      assert.equal(b.status,"PASS");assert.equal(b.steps.length,3);assert(b.steps.every(s=>s.status==="PASS"));
      assert.equal(b.modelRequests,0);assert.equal(b.errors.length,0);matrix(b.matrix);
      assert.equal(b.steps[0].detail.cacheSha256,a.steps[1].detail.again.cacheSha256);
      assert.equal(b.steps[2].detail.value.cacheHit,true);assert.equal(b.steps[2].detail.cacheSha256,b.steps[0].detail.cacheSha256);
      assert.equal(b.launches.length,2);assert.notEqual(b.launches[0].created,b.launches[1].created);
      assert.equal(b.cleanups.length,2);assert(b.cleanups.every(c=>c.status==="PASS"&&c.killed.length===0&&/^NORMAL_CLOSE_VERIFIED_/.test(c.reason)));
      for(const label of ["current","restart"]){
        const r=read(path.join(continuation,label+"-close-completed.json"));
        assert.equal(r.method,"Computer Use Alt+F4");assert.equal(r.windowAbsent,true);
        assert(b.launches.some(l=>l.pid===r.pid));
      }
      assert.equal(b.screenshots.length,13);assert.equal(a.screenshots.length,2);
      for(const s of [...a.screenshots,...b.screenshots])png(s);
      return {combinations:12,pngCount:15,newProcessCacheRestore:true,normalCurrentCloses:2};
    });
    group("source-hashes-archives-original-cache-restoration-and-residuals",()=>{
      const live=rows(),ports=new Set();let originalFiles=0,qaFiles=0,qaBytes=0;
      for(const [folder,r]of [[base,a],[continuation,b]]){
        const protection=read(path.join(folder,"cache-protection.json")),restored=read(path.join(folder,"cache-restoration.json"));
        assert.equal(restored.status,"PASS");assert.equal(restored.deletedUserFiles,0);assert.equal(restored.restored.length,3);
        for(const [i,p]of protection.records.entries()){
          const actual=ps(`fsutil.exe file queryfileid '${p.original}'`);assert(actual.toLowerCase().includes(p.directoryId));
          for(const f of p.files){assert.equal(sha(path.join(p.original,f.relative)),f.sha256);originalFiles++;}
          assert(!fs.existsSync(p.held));const archive=read(path.join(folder,`archive-${i}.json`));
          assert.equal(archive.status,"PASS");assert.equal(archive.directoryId,p.testDirectoryId);
          for(const f of archive.files){assert.equal(sha(path.join(archive.target,f.relative)),f.sha256);qaFiles++;qaBytes+=f.bytes;}
        }
        for(const l of r.launches){assert(!live.some(p=>p.ProcessId===l.pid&&p.Created===l.created));l.ports.forEach(p=>ports.add(p));}
        for(const p of r.knownProcesses)assert(!live.some(q=>q.ProcessId===p.ProcessId&&q.Created===p.Created));
      }
      assert.equal(listeners([...ports]).length,0);
      const install=read("F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json");
      for(const f of [install.package,install.executable,...install.resources,...install.protectedFiles])assert.equal(sha(f.path),f.sha256);
      return {originalFileChecks:originalFiles,archivedQaFiles:qaFiles,archivedQaBytes:qaBytes,ports:ports.size,allOwnedHostsAbsent:true};
    });
    assert.equal(report.groups.length,4);report.status="PASS";
  }catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
  finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(destination,JSON.stringify(report,null,2),{flag:"wx"});
    console.log(JSON.stringify({status:report.status,featureStatus:report.featureStatus,groups:report.groups,error:report.error,destination},null,2));}
}
