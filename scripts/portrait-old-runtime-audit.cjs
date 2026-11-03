"use strict";
// Independent terminal checks; no product writes, model calls, or Windows input.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const assert=require("node:assert/strict"),{execFileSync}=require("node:child_process");
const qa="F:/AgentVN/QA/Portrait-Old-Runtime-20261020-01",root=path.resolve(__dirname,"..");
const out=path.join(root,"output/portrait-old-runtime-20261020-01");
const iteration=process.argv[2]||"01";assert(/^\d{2}$/.test(iteration));
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe=f=>({path:path.resolve(f),sha256:sha(f),bytes:fs.statSync(f).size});
const report={status:"RUNNING",at:new Date().toISOString(),checks:[],modelRequests:0,productChanges:0,newBuilds:0};
function check(name,fn){const row={name,status:"RUNNING"};report.checks.push(row);
  try{row.detail=fn();row.status="PASS";console.log(`PASS ${name}`);}
  catch(e){row.status="FAILED";row.error=String(e.stack||e);throw e;}}
try{
  const prep=read(path.join(out,"preparation.json")),fullFile=path.join(qa,"run-04/report.json");
  const full=read(fullFile),receipt=read(path.join(out,"receipt-04.json"));
  check("Twelve actual displays per exact authored package; real 0.21-to-0.22 protocol rejection",()=>{
    assert.equal(receipt.status,"HISTORICAL_BINARY_PORTRAIT_PROTOCOL_REFUSAL_PASS");
    assert.equal(full.status,"PASS");assert.equal(full.cases.length,36);assert.equal(full.launches.length,36);
    assert.equal(full.cleanup.length,36);assert(full.cleanup.every(c=>c.status==="PASS"));
    assert.deepEqual(full.pageErrors,[]);assert.equal(full.modelRequests,0);
    for(const type of ["legacy-control","agentvn","renpy"]){
      const rows=full.cases.filter(c=>c.layout===type);
      assert.deepEqual(rows.map(c=>JSON.stringify([c.width,c.height,c.dpr,c.reduced])).sort(),
        [[1920,1080],[2560,1440],[3840,2160]].flatMap(([w,h])=>[1,2].flatMap(d=>[false,true].map(r=>JSON.stringify([w,h,d,r])))).sort());
      for(const c of rows){assert.equal(c.status,"PASS");
        if(type==="legacy-control"){assert(c.start.visible&&c.start.enabled);assert(c.playText.includes(prep.artifacts[0].sentinel));}
        else{assert.equal(c.actualProtocol,"0.21.0");assert(c.text.includes("卡带要求 0.22.0"));
          assert(!(c.start.visible&&c.start.enabled));assert(!c.text.includes("ui_layout_version"));
          assert(c.errorGeometry.buttons.length&&c.errorGeometry.buttons.every(b=>b.hit));}
      }
    }
    return {evidence:describe(fullFile),configuredDisplays:12,actualNativeLaunches:36,
      unsupportedAuthorPackages:2,refusalCases:24,supportedPlayCases:12,source:prep.authorReceipt};
  });
  check("Immutable UI exports, actual executable PE identity and all sampled frozen/current products",()=>{
    const identity=execFileSync("powershell.exe",["-NoProfile","-Command",
      `Get-Item -LiteralPath '${prep.executedCopy.path}'|ForEach-Object {@{fileVersion=$_.VersionInfo.FileVersion;productVersion=$_.VersionInfo.ProductVersion}}|ConvertTo-Json -Compress`],
    {encoding:"utf8",windowsHide:true}).trim();
    const pe=JSON.parse(identity);
    assert.equal(pe.productVersion,"1.9.1"); // PE product version differs from Runtime protocol.
    const historical=read(path.join(root,"output/project-import-atomic-20261020-01/receipt-02.json"));
    const current=[prep.dev,prep.currentPlayer,prep.frozen,prep.executedCopy,historical.backendUnchanged,...historical.frozen,...prep.artifacts];
    for(const a of current)assert.equal(sha(a.path),a.sha256);
    const author=read(prep.authorReceipt.path);
    assert.equal(sha(prep.authorReceipt.path),prep.authorReceipt.sha256);
    for(const a of prep.artifacts.filter(a=>a.layout!=="legacy-control")){
      const original=author.cartridges.find(c=>c.type===a.layout);assert(original);
      assert.equal(a.sha256,original.sha256);assert.equal(a.manifest.runtime_version,"0.22.0");
      assert(Object.keys(a.portrait).length);
    }
    return {pe,actualOldProtocol:"0.21.0",artifacts:current.map(a=>describe(a.path)),
      qualification:"Exact historical installed-binary copy, not a newly installed old game or an upgrade test"};
  });
  check("All original nine player files restored after every profile cycle and still byte-identical",()=>{
    const rows=[];
    for(const cycle of ["01","02","03","04"]){
      const suffix=cycle==="01"?"":`-${cycle}`;
      const p=read(path.join(qa,`profile-protection${suffix}.json`));
      const r=read(path.join(qa,`profile-restoration${suffix}.json`));
      assert.equal(r.status,"PASS");assert.equal(p.files.length,9);assert.equal(r.restoredFiles.length,9);
      assert(!fs.existsSync(p.held));
      for(const f of p.files){
        assert.equal(sha(path.join(p.original,f.relative)),f.sha256);
        assert.equal(sha(path.join(p.backup,f.relative)),f.sha256);
        assert.equal(r.restoredFiles.find(x=>x.relative===f.relative).sha256,f.sha256);
      }
      rows.push({cycle,restoration:describe(path.join(qa,`profile-restoration${suffix}.json`)),files:9});
    }
    return {cycles:rows,removedOriginalFiles:0,webview:"Each launch used a new F-drive profile confirmed by real process command lines"};
  });
  check("Raw screenshot parameters and actual physical PNG dimensions retained without DPR coercion",()=>{
    assert.equal(full.screenshots.length,36);
    for(const s of full.screenshots){
      assert.equal(sha(s.path),s.sha256);assert.deepEqual(s.before,s.after);
      assert.equal(s.before.width,s.expected.width);assert.equal(s.before.height,s.expected.height);
      assert.equal(s.before.reduced,s.expected.reduced);
      assert(Math.abs(s.before.dpr-s.expected.dpr)<=1e-6);
      const b=fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16),s.expected.width*s.expected.dpr);
      assert.equal(b.readUInt32BE(20),s.expected.height*s.expected.dpr);
    }
    const self=read(path.join(qa,"display-selftest-01.json"));assert.equal(self.status,"PASS");assert.equal(self.cases,7);
    return {screenshots:36,rawDprValues:[...new Set(full.screenshots.map(s=>s.before.dpr))],
      nominalDpr:[1,2],tolerance:1e-6,qualification:"Native WebView viewport emulation; not physical monitors or transition acceptance"};
  });
  check("Original failed attempts, executed test snapshots and deterministic related checks retained",()=>{
    const attempts=["00","02","01","03","04"].map(id=>{
      const f=path.join(qa,`run-${id}/report.json`),r=read(f);
      assert.equal(r.status,["03","04"].includes(id)?"PASS":"FAILED");
      assert.equal(sha(path.join(qa,`run-${id}/executed-test.cjs`)),r.testSource.sha256);
      assert(r.cleanup.length&&r.cleanup.every(c=>c.status==="PASS"));
      return {attempt:id,status:r.status,error:r.error,evidence:describe(f)};
    });
    const support=read(path.join(qa,"support-01/report.json"));
    assert.equal(support.status,"PASS");assert.equal(support.steps.length,2);
    for(const s of support.steps){assert.equal(s.exitCode,0);assert.equal(sha(s.logPath),s.logSha256);
      assert.equal(sha(path.join(root,s.command[1])),s.sourceSha256);}
    assert(fs.readFileSync(support.steps[0].logPath,"utf8").includes("PASS 44"));
    assert(fs.readFileSync(support.steps[1].logPath,"utf8").includes("PASS:11"));
    for(const f of prep.saved)assert.equal(sha(path.join(prep.checkpoint,f.file)),f.sha256);
    return {attempts,relatedChecks:55,support:describe(path.join(qa,"support-01/report.json")),
      corrections:"00: CDP page readiness; 02: integral DPR floating-point roundoff; 01: historical fixed-mode arguments not retained by frontend reload"};
  });
  check("Every recorded owned launch PID, WebView and CDP port has exited",()=>{
    const reports=["00","02","01","03","04"].map(id=>read(path.join(qa,`run-${id}/report.json`)));
    const pids=[...new Set(reports.flatMap(r=>r.launches.flatMap(l=>[l.pid,...(l.webviewProcesses||[]).map(p=>p.ProcessId)])))];
    const ports=[...new Set(reports.flatMap(r=>r.launches.map(l=>l.port)))];
    const current=JSON.parse(execFileSync("powershell.exe",["-NoProfile","-Command",
      `$all=@(Get-CimInstance Win32_Process);`+
      `$p=@($all|Where-Object {$_.ExecutablePath -eq '${prep.executedCopy.path}' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*Portrait-Old-Runtime-20261020-01*')}|Select-Object ProcessId,ExecutablePath,CreationDate,CommandLine);`+
      `$observed=@($all|Where-Object {$_.ProcessId -in @(${pids.join(",")})}|Select-Object ProcessId,ExecutablePath,CreationDate,CommandLine);`+
      `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);`+
      `@{processes=$p;recordedPidMatches=$observed;listeners=$l}|ConvertTo-Json -Depth 4 -Compress`],
    {encoding:"utf8",windowsHide:true}));
    // Preserve ownership evidence before asserting. Numeric PIDs may be reused;
    // only this exact executable/profile scope constitutes a leftover process.
    report.currentCleanupObservation=current;
    assert.equal(current.processes.length,0);assert.equal(current.listeners.length,0);
    return {pids,ports,current,qualification:"Owned test tree termination, not proof of normal native close/exit-save"};
  });
  report.status="PASS";
}catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();report.source=describe(__filename);
  const target=path.join(out,`terminal-audit-${iteration}.json`);fs.writeFileSync(target,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,path:target,error:report.error}));
}
