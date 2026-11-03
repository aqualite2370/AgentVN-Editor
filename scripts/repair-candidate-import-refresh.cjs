"use strict";
// Incorporates the import transaction receipt; never re-runs models or product builds.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),label="Repair-Candidate-Import-Refresh-20261020-01";
const qa=`F:/AgentVN/QA/${label}`,checkpoint=`F:/AgentVN/Checkpoints/${label}`;
const summary=path.join(root,"output/repair-candidate-import-refresh-20261020-01");
const [mode,iteration="",auditIteration=mode==="red"?"08":"09"]=process.argv.slice(2);
assert(["prepare","red","green","verify"].includes(mode));
assert(iteration===""||/^\d{2}$/.test(iteration));assert(/^\d{2}$/.test(auditIteration));
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const describe=f=>({path:path.resolve(f),sha256:sha(f),bytes:fs.statSync(f).size});
const write=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2),{flag:"wx"});
const products=["AgentVN Dev.exe","editor/src-tauri/binaries/agentvn-player.exe","editor/src-tauri/binaries/creator-backend.exe"];
if(mode==="prepare"){
  for(const d of [qa,checkpoint,summary]){assert(!fs.existsSync(d));fs.mkdirSync(d,{recursive:true});}
  const files=["scripts/repair-candidate-preflight.cjs","scripts/repair-candidate-import-refresh.cjs",
    "scripts/lib/repair-candidate-provenance.cjs","scripts/repair-candidate-provenance-test.cjs",
    "plans/ACTIVE_TASKS.md","plans/FULL_REGRESSION_20261017.md"];
  const saved=files.map(file=>{const target=path.join(checkpoint,file);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(root,file),target,fs.constants.COPYFILE_EXCL);return {file,...describe(target)};});
  write(path.join(summary,"preparation.json"),{status:"PASS",at:new Date().toISOString(),saved,
    products:products.map(f=>describe(path.join(root,f))),qa,checkpoint,
    priorIntegration:describe("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-07/audit.json")});
  console.log(JSON.stringify({status:"PASS",qa,checkpoint}));
}else{
  const out=path.join(qa,`${mode}${iteration?`-${iteration}`:""}`);assert(!fs.existsSync(out));fs.mkdirSync(out);
  const report={status:"RUNNING",at:new Date().toISOString(),mode,commands:[],productChanges:0,builds:0,
    newModelRequests:0,scope:"SOURCE_PROVENANCE_REFRESH_NOT_FEATURE_OR_INSTALLED_ACCEPTANCE"};
  function run(args,expected=0){
    const log=path.join(out,`${report.commands.length+1}.log`);
    const r=spawnSync(process.execPath,args,{cwd:root,encoding:"utf8",windowsHide:true,maxBuffer:8*1024*1024});
    fs.writeFileSync(log,(r.stdout||"")+(r.stderr||""),{flag:"wx"});
    report.commands.push({command:[process.execPath,...args],exitCode:r.status,expectedExitCode:expected,log:describe(log)});
    assert.ifError(r.error);assert.equal(r.status,expected,log);
  }
  try{
    const prep=read(path.join(summary,"preparation.json"));
    const b=read("F:/AgentVN/QA/Repair-Candidate-Refresh-20261020-01/backend-01/report.json");
    assert.equal(b.status,"PASS");
    const directory=`F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-${auditIteration}`;
    if(mode!=="verify"){
      run(["scripts/repair-candidate-preflight.cjs",directory,b.behavior,
        "F:/AgentVN/QA/Data-URL-Repair-20261020-01/payload-01.json"],mode==="red"?1:0);
      const a=read(path.join(directory,"audit.json"));
      report.audit=describe(path.join(directory,"audit.json"));
      if(mode==="red"){
        assert.equal(a.provenanceStatus,"FAILED");assert.equal(a.receipts.length,19);
        assert(!a.sourceChecks.some(s=>s.path.toLowerCase()===path.join(root,"editor/src/app/App.tsx").toLowerCase()),
          "The old receipt set did not declare the newly changed Editor App; absence is not a hash mismatch");
        assert(a.artifactChecks.some(s=>s.label==="latest root Dev"&&s.status==="FAILED"));
        assert(a.artifactChecks.some(s=>s.label==="current rebuilt Player"&&s.status==="FAILED"));
        report.expectedRejection="Old nineteen-receipt provenance cannot certify the new import-fix source and Dev";
        report.missingSourceDeclaration="editor/src/app/App.tsx";
        report.errors=a.errors;
      }else{
        assert.equal(a.provenanceStatus,"PASS");assert.equal(a.receipts.length,20);assert.equal(a.errors.length,0);
        run(["scripts/repair-candidate-provenance-test.cjs"]);
        run(["scripts/full-regression-evidence-test.cjs"]);
        report.counts={receipts:a.receipts.length,sources:a.sourceChecks.length,references:a.evidenceChecks.length,
          bundled:a.bundledChecks.length,artifacts:a.artifactChecks.length};
      }
    }else{
      const a=read(path.join(directory,"audit.json"));
      assert.equal(a.provenanceStatus,"PASS");assert.equal(a.receipts.length,20);assert.equal(a.errors.length,0);
      assert.equal(a.fullAcceptance,false);assert.equal(a.acceptanceStatus,"BLOCKED");
      assert.deepEqual(a.historical.counts,{FAILED:9,BLOCKED:6,PASS:3});
      for(const entry of [...a.receipts,...a.sourceChecks,...a.evidenceChecks,...a.bundledChecks,...a.artifactChecks])
        assert.equal(sha(entry.path),entry.sha256);
      const source=a.sourceChecks.find(s=>s.path.toLowerCase()===path.join(root,"editor/src/app/App.tsx").toLowerCase());
      assert.equal(source.receiptId,"IMPORT-ATOMIC");
      assert.deepEqual(source.previous,[],"First explicit declaration must not invent an earlier source identity");
      const importReceipt=read(path.join(root,"output/project-import-atomic-20261020-01/receipt-02.json"));
      assert.equal(source.sha256,importReceipt.resources.frontendSources[0].sha256);
      assert.equal(a.artifactChecks.find(s=>s.label==="latest root Dev").sha256,importReceipt.dev.sha256);
      assert.equal(a.backendRevalidation.buildCommandOrigin,"RECORDED_OFFICIAL_BUILD");
      assert.equal(a.backendRevalidation.currentSha256,b.sidecarSha256);
      assert.equal(a.backendRevalidation.behavior.sha256,sha(b.behavior));
      const oldAbility=read(path.join(root,"output/portrait-old-runtime-20261020-01/terminal-audit-02.json"));
      assert.equal(oldAbility.status,"PASS");assert.equal(oldAbility.checks.length,6);
      assert(oldAbility.checks.every(c=>c.status==="PASS"));
      report.relatedCapability={path:path.join(root,"output/portrait-old-runtime-20261020-01/terminal-audit-02.json"),
        sha256:sha(path.join(root,"output/portrait-old-runtime-20261020-01/terminal-audit-02.json")),
        qualification:"Separate historical 0.21-to-0.22 binary refusal; not a twenty-first repair or new product test"};
      report.audit=describe(path.join(directory,"audit.json"));
      report.currentSource=source;report.counts={receipts:a.receipts.length,sources:a.sourceChecks.length,
        references:a.evidenceChecks.length,bundled:a.bundledChecks.length,artifacts:a.artifactChecks.length};
      report.backendProtocolCasesReferenced=13;report.controlledRequestsReferenced=78;
      report.qualifier="References existing same-SHA local controlled backend test; no new backend/model executions";
    }
    for(const p of prep.products)assert.equal(sha(p.path),p.sha256);
    for(const p of prep.saved)assert.equal(sha(p.path),p.sha256);
    report.status="PASS";
  }catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
  finally{
    report.finishedAt=new Date().toISOString();
    report.sources=["scripts/repair-candidate-import-refresh.cjs","scripts/repair-candidate-preflight.cjs"].map(file=>{
      const target=path.join(out,"sources",file);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(root,file),target,fs.constants.COPYFILE_EXCL);return {file,...describe(target)};
    });
    write(path.join(out,"report.json"),report);
    console.log(JSON.stringify({status:report.status,mode,counts:report.counts,error:report.error}));
  }
}
