"use strict";
// Read-only reconciliation of existing candidate evidence, not a new UI run.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {sha256}=require("./lib/installed-acceptance.cjs");
const root="D:/AgentVN",old=path.join(root,"output/installed-runtime-exceptions-20261018-01");
const dest=path.join(root,"output/installed-quick-gap-review-20261019-01");
assert(!fs.existsSync(dest),"Keep previous reviews immutable");
const result={status:"RUNNING",at:new Date().toISOString(),scope:"SOURCE_RECONCILIATION_NOT_NEW_PRODUCT_TESTS",
  sources:[],checks:[],requirements:[],newProductTests:0,productChanges:0,modelRequests:0,error:null};
const sha=p=>sha256(fs.readFileSync(p));
const read=p=>{result.sources.push({path:p,sha256:sha(p)});
  return JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""))};
function check(name,fn){
  const row={name,status:"RUNNING"};result.checks.push(row);
  try{row.detail=fn();row.status="PASS";console.log(`PASS ${name}`)}
  catch(e){row.status="BLOCKED";row.error=String(e.stack||e);throw e}
}
try{
  const first=read(path.join(old,"exceptions-01/report.json"));
  const second=read(path.join(old,"exceptions-02/report.json"));
  const audit=read(path.join(old,"terminal-audit-01.json"));
  const recent=read(path.join(root,"output/installed-runtime-business-matrix-20261019-01/attempt-03/1920x1080-dpr1-normal/report.json"));
  check("The apparent NOT_RUN fields are local step coverage, not proof that all candidate evidence is absent",()=>{
    const rows=recent.checks||recent.steps||[];
    const local=rows.find(r=>r.detail?.invalidLatestFallback==="NOT_RUN");assert(local);
    assert.equal(local.detail.quickWriteFailure,"NOT_RUN");assert.equal(local.detail.concurrentSubmission,"NOT_RUN");
    assert.equal(first.status,"FAILED");assert.equal(second.status,"FAILED");
    assert.equal(first.checks[2].status,"PASS");assert.equal(first.checks[5].status,"PASS");
    assert.equal(second.checks[0].status,"PASS");assert.equal(audit.status,"PASS");
    return {originalOverallFailuresRetained:true,notRunInSingleSourceNotGlobalAbsence:true};
  });
  check("The older limited evidence belongs to the identical current frozen installed Player and immutable raw inputs",()=>{
    const expected="71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a";
    for(const row of [first,second]){
      assert.equal(row.exe.sha256,expected);assert.equal(sha(row.exe.path),expected);
      assert.equal(sha(row.fixture.path),row.fixture.sha256);assert.equal(sha(row.source.path),row.source.sha256);
      assert.equal(row.productChanges,0);assert.equal(row.realModelRequests,0);
    }
    for(const input of audit.inputs)assert.equal(sha(input.path),input.sha256,input.path);
    let retained=0;
    for(const row of [first,second])for(const file of row.retained){assert.equal(sha(file.retained),file.sha256);retained++}
    assert(retained>0);
    return {sameCurrentPlayerSha256:expected,retainedFileCopies:retained,oldAuditInputs:audit.inputs.length};
  });
  check("Offline malformed latest JSON really falls back after process restart, with original bytes retained",()=>{
    const d=first.checks[2].detail;assert.equal(d.restoredPosition.command,0);
    assert.equal(d.nativeList.length,1);assert.equal(d.loadedOlderId,d.nativeList[0].save_id);
    assert.equal(d.restartRequiredInThisCase,true);assert.equal(d.corruptionDuringRunningCase,"NOT_RUN");
    for(const f of first.faultRestoration){assert.equal(f.status,"RESTORED");assert.equal(sha(f.retained),f.originalSha256)}
    return {limitedEvidence:"PASS",viewport:"1920x1080/DPR1/normal",
      invalidity:"OFFLINE_MALFORMED_JSON_ONLY",semanticInvalidity:"NOT_RUN",full12CombinationExceptionMatrix:"NOT_RUN"};
  });
  check("Real sharing-denied atomic replacement preserves six saves and a released-lock retry changes only its target",()=>{
    const d=second.checks[0].detail;assert.equal(d.method,"NATIVE_FILE_SHARE_DENY_NOT_ACL");
    assert.equal(d.before.length,6);assert.equal(d.after.length,6);assert(d.oldValidSavesPreservedOnFailure);
    assert(d.failure.includes("快存失败")&&d.failure.includes("不会回退"));
    const changed=d.after.filter(f=>!d.before.some(b=>b.name===f.name&&b.sha256===f.sha256));
    assert.equal(changed.length,1);assert.equal(changed[0].path,d.target);
    assert.equal(second.lock.cleanup,"PASS");assert.equal(second.lock.exitCode,0);
    return {limitedEvidence:"PASS",viewport:"1920x1080/DPR1/normal",preservedOldSaves:6,retryChanges:1,
      aclClaim:false,standaloneOrAndroidClaim:false,full12CombinationExceptionMatrix:"NOT_RUN"};
  });
  check("Existing double-click proves one durable write and a busy interval, not an individually timestamped second pending input",()=>{
    const d=first.checks[5].detail;assert.equal(d.created.length,1);
    assert.equal(d.before.length,6);assert.equal(d.after.length,6);
    assert.equal(d.observed.clicks.length,1);assert.equal(d.observed.clicks[0].trusted,true);
    const begin=d.observed.busy.find(v=>v.busy==="true"),end=d.observed.busy.at(-1);
    assert(begin&&end.busy!=="true"&&end.at>begin.at);assert.equal(d.mockDelay,false);
    assert(!d.observed.pointerEvents,"Do not invent missing pointer timestamps");
    return {limitedEvidence:"PASS",oneNewSave:true,busyMs:end.at-begin.at,
      secondPointerInsideBusy:"NOT_PROVEN",full12CombinationExceptionMatrix:"NOT_RUN"};
  });
  result.requirements=[
    {id:"QUICK-INVALID-LATEST",status:"BLOCKED",limitedEvidence:"PASS",
      remaining:"Semantic-invalid newest save and remaining required display combinations; existing offline malformed-JSON/restart fallback must not be repeated as wholly absent."},
    {id:"QUICK-WRITE-FAILURE",status:"BLOCKED",limitedEvidence:"PASS",
      remaining:"Remaining required display combinations; real sharing-denial failure/preserved six files/retry already evidenced, not ACL/standalone/Android."},
    {id:"QUICK-CONCURRENT",status:"BLOCKED",limitedEvidence:"PASS",
      remaining:"Explicit trusted second pointer event while actual busy=true, then one durable write and ability to save again; remaining display combinations."},
  ];
  result.status="PASS";
}catch(e){result.status="BLOCKED";result.error=String(e.stack||e);process.exitCode=1}
finally{
  result.finishedAt=new Date().toISOString();fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest,"review.json"),JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:result.status,checks:result.checks.length,requirements:result.requirements,
    destination:dest,error:result.error}));
}
