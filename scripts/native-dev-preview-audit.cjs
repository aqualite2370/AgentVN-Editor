"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),qa="F:/AgentVN/QA/Native-Dev-Preview-20261020-01";
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe=f=>({path:path.resolve(f),sha256:sha(f),bytes:fs.statSync(f).size});
const out=path.join(qa,"audit-01");assert(!fs.existsSync(out));fs.mkdirSync(out);
const receipt={status:"RUNNING",at:new Date().toISOString(),checks:[],fullAcceptance:false,
  scope:"Evidence verification of current Dev preview flows; product close diagnostic remains FAILED"};
const check=(name,fn)=>{const c={name,status:"RUNNING"};receipt.checks.push(c);
  try{c.detail=fn();c.status="PASS";}catch(e){c.status="FAILED";c.error=String(e.stack||e);throw e;}};
try{
  const prep=read(path.join(root,"output/native-dev-preview-20261020-01/preparation.json"));
  const smoke=read(path.join(qa,"smoke-03/report.json")),full=read(path.join(qa,"full-01/report.json"));
  const repro=read(path.join(qa,"close-args-repro-01/report.json"));
  check("Current products, exact tool snapshots, fixture and frozen provenance unchanged",()=>{
    for(const p of [...prep.products,...prep.sources,prep.input,...prep.saved])assert.equal(sha(p.path),p.sha256);
    assert.equal(prep.products[0].sha256,prep.products[1].sha256);
    for(const p of full.tools)assert.equal(sha(p.path),p.sha256);
    assert.equal(sha(path.join(root,"scripts/native-dev-preview-continuation.cjs")),full.tools[0].sha256);
    assert.equal(sha(path.join(root,"scripts/native-dev-preview-profile.ps1")),full.tools[1].sha256);
    const provenance=read("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-09/audit.json");
    assert.deepEqual(provenance.historical.counts,{FAILED:9,BLOCKED:6,PASS:3});
    for(const p of provenance.artifactChecks)assert.equal(sha(p.path),p.sha256);
    return {products:prep.products,toolSnapshots:full.tools,frozenGroupCounts:provenance.historical.counts};
  });
  check("All twelve real WebView display combinations and separate external/node behavior",()=>{
    assert.equal(full.status,"CORE_FLOW_PASS_WITH_PRODUCT_DIAGNOSTIC");
    assert.equal(full.cases.length,12);assert.equal(full.players.length,2);
    assert.equal(full.checks.length,4);assert(full.checks.every(c=>c.status==="PASS"));
    assert.deepEqual(full.cases.map(c=>[c.width,c.height,c.dpr,c.reduced]),
      [1920,2560,3840].flatMap(w=>[1,2].flatMap(d=>[false,true].map(r=>[w,w*9/16,d,r]))));
    const expected=read(prep.input.path).nodes[1].data.scene.commands[0].text;
    for(const c of full.cases) {
      assert.equal(c.status,"PASS");assert(c.externalText.includes(expected)&&c.nodeText.includes(expected));
      for(const g of [c.confirmation,c.external,c.node]) {
        assert(g.overflow<=1&&!g.focusUnavailable);
        assert(g.rect.left>=-1&&g.rect.top>=-1&&g.rect.right<=g.width+1&&g.rect.bottom<=g.height+1);
        assert(g.buttons.filter(b=>!b.disabled).every(b=>b.hit));
      }
    }
    for(const p of full.players) {
      assert.equal(p.ParentProcessId,full.host.pid);
      assert.equal(p.executable.sha256,prep.products[2].sha256);
      assert.match(p.CommandLine,/--mode preview --preview-root/);
      // The shared temporary "current" directory may be legitimately replaced
      // by the second real launch; all captured script hashes must be identical.
      assert.equal(p.script.sha256,full.players[0].script.sha256);
    }
    return {evidence:describe(path.join(qa,"full-01/report.json")),displayCombinations:12,externalLaunches:2,
      note:"One real Player supplies twelve display cases; not twelve independent cold starts"};
  });
  check("Twenty-four screenshots preserve actual viewport/DPR/media and pixel dimensions",()=>{
    const images=[];
    for(const c of full.cases)for(const s of [c.externalScreenshot,c.nodeScreenshot]){
      const b=fs.readFileSync(s.path);assert.equal(sha(s.path),s.sha256);
      assert.deepEqual(s.before,s.after);assert.equal(s.before.width,c.width);assert.equal(s.before.height,c.height);
      assert(Math.abs(s.before.dpr-c.dpr)<=1e-6);assert.equal(s.before.reduced,c.reduced);
      assert.equal(b.readUInt32BE(16),c.width*c.dpr);assert.equal(b.readUInt32BE(20),c.height*c.dpr);
      images.push(describe(s.path));
    }
    assert.equal(images.length,24);return images;
  });
  check("Original Player directories and preview cache restored; roaming/save/cache bytes preserved",()=>{
    const records=[];
    for(const [name,run]of [["smoke-03",smoke],["full-01",full]]){
      const p=read(path.join(qa,name,"profile-protection.json")),r=read(run.profileRestoration.path);
      assert.equal(sha(run.profileRestoration.path),run.profileRestoration.sha256);
      assert.equal(r.status,"PASS");assert.equal(r.deletedUserFiles,0);
      assert.equal(r.restored.length,name==="full-01"?3:2);
      for(const old of p.records){
        const actual=r.restored.find(a=>a.original===old.original);assert(actual);
        assert.equal(actual.directoryId,old.directoryId);assert.equal(actual.byteInventory,old.byteInventory);
        assert.deepEqual(actual.files,old.files);assert(!fs.existsSync(old.held));
        for(const f of old.files)assert.equal(sha(path.join(old.original,f.relative)),f.sha256);
        assert(fs.existsSync(old.target));
      }
      records.push({run:name,restoration:describe(run.profileRestoration.path),
        qualification:name==="smoke-03"?"Editor temporary preview cache used normal C path; not a cache-isolation claim":
          "Three exact roots redirected to independent F test paths and restored"});
    }
    return records;
  });
  check("PowerShell fallback defect preserved, reproduced without killing any process",()=>{
    assert.equal(repro.status,"DEFECT_REPRODUCED");assert.equal(repro.processStopCalled,false);
    assert.match(repro.stdout,/QA_ARGS=0;NEEDLE=/);assert.match(repro.stderr,/CommandNotFoundException/);
    assert.equal(full.productDiagnostics.length,1);assert.equal(full.productDiagnostics[0].id,"PREVIEW-CLOSE-ARGS-01");
    assert.equal(full.productDiagnostics[0].status,"FAILED");
    const log=full.productDiagnostics[0].evidence;assert.equal(sha(log.path),log.sha256);
    assert(fs.readFileSync(log.path,"utf8").includes("CommandNotFoundException"));
    assert.equal(read(path.join(qa,"smoke-01/report.json")).status,"FAILED");
    assert.equal(read(path.join(qa,"smoke-02/report.json")).status,"FAILED");
    return {defect:full.productDiagnostics[0],reproduction:describe(path.join(qa,"close-args-repro-01/report.json")),
      noProductFix:true,notClaimingFallbackScopingPass:true};
  });
  check("Normal host close, zero model requests, exact owned identities and ports absent",()=>{
    const runs=[smoke,full],known=runs.flatMap(r=>r.known),ports=[...new Set(runs.flatMap(r=>Object.values(r.ports)))];
    for(const run of runs){
      assert.equal(run.modelRequests,0);assert.equal(run.productChanges,0);assert.equal(run.newBuilds,0);
      assert.equal(run.cleanup.status,"PASS");assert.deepEqual(run.cleanup.killed,[]);
      assert.deepEqual(run.cleanup.survivors,[]);assert.deepEqual(run.cleanup.listeners,[]);
      assert.equal(run.checks.at(-1).detail.exitCode,0);
    }
    const result=spawnSync("powershell.exe",["-NoProfile","-Command",
      "$p=@(Get-CimInstance Win32_Process|Select-Object ProcessId,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}});"+
      `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})});`+
      "@{processes=$p;listeners=$l}|ConvertTo-Json -Depth 4 -Compress"],{encoding:"utf8",windowsHide:true,timeout:20000});
    assert.equal(result.status,0);const state=JSON.parse(result.stdout.replace(/^\uFEFF/,""));
    assert(!state.processes.some(p=>known.some(k=>k.ProcessId===p.ProcessId&&k.Created===p.Created)));
    assert.equal(state.listeners.length,0);
    return {recordedProcessIdentities:known.length,ports,residualProcesses:0,residualListeners:0};
  });
  receipt.status="EVIDENCE_VERIFIED_PRODUCT_DEFECT_OPEN";
}catch(e){receipt.status="FAILED";receipt.error=String(e.stack||e);process.exitCode=1;}
finally{
  receipt.finishedAt=new Date().toISOString();receipt.auditSource=describe(__filename);
  fs.copyFileSync(__filename,path.join(out,"executed-audit.cjs"),fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:receipt.status,checks:receipt.checks.map(c=>({name:c.name,status:c.status})),error:receipt.error},null,2));
}
