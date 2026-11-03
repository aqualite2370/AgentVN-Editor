"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),qa="F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01";
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc=f=>({path:path.resolve(f),sha256:sha(f),bytes:fs.statSync(f).size});
const out=path.join(qa,"audit-01");assert(!fs.existsSync(out));fs.mkdirSync(out);
const receipt={status:"RUNNING",at:new Date().toISOString(),checks:[],scope:"CURRENT_SOURCE_AND_DEV_PREVIEW_CLOSE_REPAIR_NOT_RELEASE",
  fullAcceptance:false,modelRequests:0};
function check(name,fn){const c={name,status:"RUNNING"};receipt.checks.push(c);
  try{c.detail=fn();c.status="PASS";}catch(e){c.status="FAILED";c.error=String(e.stack||e);throw e;}}
try{
  const prep=read(path.join(root,"output/native-dev-preview-repair-20261020-01/preparation.json"));
  const built=read(path.join(qa,"verified-build.json"));
  receipt.dev=built.products[0];receipt.player=built.products[2];receipt.backend=built.products[3];
  receipt.sources=built.sources;
  receipt.qaSources=["scripts/native-dev-preview-continuation.cjs","scripts/native-dev-preview-profile.ps1",
    "scripts/lib/owned-process-tree.cjs","scripts/preview-save-isolation-contract.cjs",
    "scripts/preview-cancellation-evidence-test.cjs","scripts/gamecli-preview-upload-contract-test.cjs"]
    .map(f=>desc(path.join(root,f)));
  const named=(dir,prefix)=>{
    const names=fs.readdirSync(path.join(root,dir)).filter(n=>n.startsWith(prefix)&&n.endsWith(".js"));
    assert.equal(names.length,1,`${dir}/${prefix} compiled sample must be unique`);
    return desc(path.join(root,dir,names[0]));
  };
  receipt.compiled=[named("GameCli_framework/dist/assets","StoryPlayer-"),
    named("editor/dist/gamecli-preview/assets","StoryPlayer-"),named("editor/dist/assets","index-")];
  const red=read(path.join(qa,"red-owner-01/report.json")),owner=read(path.join(qa,"green-owner-02/report.json"));
  const failedObserver=read(path.join(qa,"green-owner-01/report.json"));
  const full=read(path.join(qa,"green-full-01/report.json")),gates=read(path.join(qa,"prebuild-02/report.json")),dev=read(path.join(qa,"dev-01/report.json"));
  check("Real red/green same-path Player ownership regression changes from killed to alive and usable",()=>{
    assert.equal(red.status,"FAILED");assert.match(red.error,/Unrelated real Player was killed/);
    assert.equal(red.sentinel.previewRoot,red.players[0].previewRoot);
    assert.notEqual(red.sentinel.ParentProcessId,red.host.pid);
    assert.equal(owner.status,"PASS");assert.equal(owner.ownershipReview,true);assert.equal(owner.cases.length,0);
    assert.equal(owner.ownershipChecks.length,3);assert(owner.ownershipChecks.every(c=>c.status==="PASS"));
    assert.equal(owner.sentinel.previewRoot,owner.players[0].previewRoot);
    assert.notEqual(owner.sentinel.ParentProcessId,owner.host.pid);
    assert(owner.checks.every(c=>c.status==="PASS"));
    assert.equal(red.executable.sha256,prep.products[0].sha256);
    assert.equal(owner.executable.sha256,built.products[0].sha256);assert.notEqual(owner.executable.sha256,red.executable.sha256);
    const actionBlock=r=>{
      const text=fs.readFileSync(r.tools[0].path,"utf8");
      return text.slice(text.indexOf("    if(ownershipReview) {"),text.indexOf("    for(const m of ownershipReview?[]:cases)"));
    };
    assert.equal(actionBlock(red),actionBlock(owner));
    const observer=read(path.join(qa,"observer-selftest-01/report.json"));
    assert.equal(failedObserver.status,"FAILED");assert.match(failedObserver.error,/natural descendants exit/);
    assert.equal(observer.status,"PASS");assert(observer.exactPriorObserverMisclassificationReproduced);
    assert.equal(observer.realMisclassifiedProcess.Name,"vctip.exe");
    assert.equal(sha(observer.helper.path),observer.helper.sha256);
    return {red:desc(path.join(qa,"red-owner-01/report.json")),green:desc(path.join(qa,"green-owner-02/report.json")),
      exactSameOwnershipActions:true,observerRevision:desc(path.join(qa,"observer-selftest-01/report.json")),
      failedObserverPreserved:desc(path.join(qa,"green-owner-01/report.json")),distinctUnrelatedPlayer:true,physicalInput:false};
  });
  check("Seven native tests, eleven associated commands and sequential build gates precede actual Dev replacement",()=>{
    assert.equal(gates.status,"PREBUILD_PASS");assert.equal(gates.steps.length,17);assert(gates.steps.every(c=>c.status==="PASS"));
    assert.equal(gates.steps.filter(c=>c.suites).flatMap(c=>c.suites).reduce((n,s)=>n+s.passed,0),7);
    assert.equal(dev.status,"DEV_BUILD_AND_ACTUAL_REPLACEMENT_PASS");assert.equal(dev.steps[0].exitCode,0);
    assert(Date.parse(gates.finishedAt)<=Date.parse(dev.at));
    for(const p of [...gates.sources,...built.products,...built.sources])assert.equal(sha(p.path),p.sha256);
    assert.equal(built.products[0].sha256,built.products[1].sha256);
    assert.notEqual(built.products[0].sha256,prep.products[0].sha256);
    assert.equal(sha(path.join(root,"GameCli_framework/src-tauri/target/release/agentvn-player.exe")),built.products[2].sha256);
    const old=read(path.join(qa,"prebuild-01/report.json"));assert.equal(old.status,"FAILED");
    assert.match(old.error,/preview-save-isolation-contract/);
    return {prebuild:desc(path.join(qa,"prebuild-02/report.json")),dev:desc(path.join(qa,"dev-01/report.json")),
      products:built.products,oldQAStringFailurePreserved:true};
  });
  check("Post-build real external/node matrix has twelve complete display cases and twenty-four exact screenshots",()=>{
    assert.equal(full.status,"PASS");assert.equal(full.cases.length,12);assert.equal(full.players.length,2);
    assert(full.checks.every(c=>c.status==="PASS"));assert(!full.productDiagnostics);
    assert.deepEqual(full.cases.map(c=>[c.width,c.height,c.dpr,c.reduced]),
      [1920,2560,3840].flatMap(w=>[1,2].flatMap(d=>[false,true].map(r=>[w,w*9/16,d,r]))));
    const images=[];
    for(const c of full.cases){
      assert.equal(c.status,"PASS");
      assert(c.externalText.includes("当前Dev预览第一句")&&c.nodeText.includes("当前Dev预览第一句"));
      for(const g of [c.confirmation,c.external,c.node]){
        assert(g.overflow<=1&&!g.focusUnavailable&&g.rect.left>=-1&&g.rect.top>=-1&&g.rect.right<=g.width+1&&g.rect.bottom<=g.height+1);
        assert(g.buttons.filter(b=>!b.disabled).every(b=>b.hit));
      }
      for(const s of [c.externalScreenshot,c.nodeScreenshot]){
        const b=fs.readFileSync(s.path);assert.equal(sha(s.path),s.sha256);assert.deepEqual(s.before,s.after);
        assert.equal(s.before.width,c.width);assert.equal(s.before.height,c.height);
        assert.equal(s.before.reduced,c.reduced);assert(Math.abs(s.before.dpr-c.dpr)<=1e-6);
        assert.equal(b.readUInt32BE(16),c.width*c.dpr);assert.equal(b.readUInt32BE(20),c.height*c.dpr);images.push(desc(s.path));
      }
    }
    assert.equal(images.length,24);return {combinations:12,images,source:desc(path.join(qa,"green-full-01/report.json")),
      qualification:"One Player serves twelve display cases; second actual launch verifies relaunch; CDP not physical 4K"};
  });
  check("All original directories restored; test data retained on F; no unexpected green native diagnostics",()=>{
    const restorations=[];
    for(const [name,r]of [["red-owner-01",red],["green-owner-01",failedObserver],["green-owner-02",owner],["green-full-01",full]]){
      const protectedState=read(path.join(qa,name,"profile-protection.json")),restored=read(r.profileRestoration.path);
      assert.equal(sha(r.profileRestoration.path),r.profileRestoration.sha256);assert.equal(restored.status,"PASS");
      assert.equal(restored.restored.length,3);
      for(const before of protectedState.records){
        const after=restored.restored.find(a=>a.original===before.original);assert(after);
        assert.equal(after.directoryId,before.directoryId);assert.deepEqual(after.files,before.files);
        assert(!fs.existsSync(before.held));
        for(const f of before.files)assert.equal(sha(path.join(before.original,f.relative)),f.sha256);
      }
      if(name!=="red-owner-01"){
        const log=fs.readFileSync(path.join(qa,name,"host.log"),"utf8");
        assert(!/CommandNotFoundException|Preview cleanup on exit failed|Owned process \d+ cleanup failed/.test(log));
      }
      restorations.push(desc(r.profileRestoration.path));
    }
    return {restorations,localProtectedCaches:"Original NTFS root identity only, not unreadable-child SHA certification"};
  });
  check("New QA artifacts are traceable, owned processes/ports absent, frozen installations unchanged",()=>{
    const all=[red,failedObserver,owner,full],known=all.flatMap(r=>r.known),ports=[...new Set(all.flatMap(r=>Object.values(r.ports)))];
    for(const r of all){assert.equal(r.modelRequests,0);assert.equal(r.cleanup.status,"PASS");
      assert.deepEqual(r.cleanup.survivors,[]);assert.deepEqual(r.cleanup.listeners,[]);
      if(r===owner||r===full)assert.deepEqual(r.cleanup.killed,[]);
      for(const tool of r.tools)assert.equal(sha(tool.path),tool.sha256);
    }
    const observed=spawnSync("powershell.exe",["-NoProfile","-Command",
      "$p=@(Get-CimInstance Win32_Process|Select-Object ProcessId,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}});"+
      `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})});`+
      "@{processes=$p;listeners=$l}|ConvertTo-Json -Depth 4 -Compress"],{encoding:"utf8",windowsHide:true,timeout:20000});
    assert.equal(observed.status,0);const current=JSON.parse(observed.stdout.replace(/^\uFEFF/,""));
    assert(!current.processes.some(p=>known.some(k=>p.ProcessId===k.ProcessId&&p.Created===k.Created)));
    assert.equal(current.listeners.length,0);
    // Old current-product hashes are intentionally superseded, never relabelled.
    const provenance=read("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-09/audit.json");
    const frozen=provenance.artifactChecks.filter(p=>
      p.path.startsWith("F:\\AgentVN\\QA\\AgentVN-QA-HostUpgrade-20261018-02\\installed-editor\\"));
    assert.equal(frozen.length,3);
    for(const p of frozen)assert.equal(sha(p.path),p.sha256);
    assert.deepEqual(provenance.historical.counts,{FAILED:9,BLOCKED:6,PASS:3});
    return {processIdentities:known.length,ports,greenCleanupForceKills:0,frozenChecked:frozen,
      previousCurrentProductReceiptSuperseded:true,newReleaseNotProven:true};
  });
  receipt.status="SOURCE_AND_DEV_PREVIEW_CLOSE_REPAIR_PASS";
}catch(e){receipt.status="FAILED";receipt.error=String(e.stack||e);process.exitCode=1;}
finally{
  receipt.finishedAt=new Date().toISOString();receipt.auditSource=desc(__filename);
  fs.copyFileSync(__filename,path.join(out,"executed-audit.cjs"),fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});
  if(receipt.status==="SOURCE_AND_DEV_PREVIEW_CLOSE_REPAIR_PASS")
    fs.writeFileSync(path.join(root,"output/native-dev-preview-repair-20261020-01/receipt-01.json"),
      JSON.stringify(receipt,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:receipt.status,checks:receipt.checks.map(c=>({name:c.name,status:c.status})),error:receipt.error},null,2));
}
