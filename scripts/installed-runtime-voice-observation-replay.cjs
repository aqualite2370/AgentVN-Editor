"use strict";
// Deterministic replay of actual media observations, NOT new product UI tests.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {sha256}=require("./lib/installed-acceptance.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-20261019-01",action=process.argv[2];
const input=path.join(base,"observer-replay-input.json");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
if(action==="capture"){
  assert(!fs.existsSync(input));
  const source=path.join(base,"player-01/report.json"),bytes=fs.readFileSync(source),raw=JSON.parse(bytes);
  const cell=raw.cells.find(c=>c.status==="PASS");assert(cell);
  fs.writeFileSync(input,JSON.stringify({at:new Date().toISOString(),source,sourceSnapshotSha256:sha256(bytes),
    cell,fixture:read(path.join(base,"fixtures.json")),scope:"IMMUTABLE_COMPLETED_CELL_FROM_RUNNING_MATRIX"},null,2),{flag:"wx"});
  const report={status:"RUNNING",at:new Date().toISOString(),scope:"LEGACY_AUDIT_ORACLE_REPRO_NOT_PRODUCT_FAILURE",
    hypotheses:[
      "Initial audio effect commits before animated playing DOM: only first call lacks scene/command.",
      "Observer selector wrong: all later calls would also lack scene/command.",
      "Unexpected title/background playback: initial source/hash or first committed play count would differ."
    ],inputSha256:sha256(fs.readFileSync(input))};
  try{
    assert.deepEqual(cell.audio.calls.map(c=>Number(c.command)),[0,1,1,2,3,4,4,5,6,7,7,8]);
    report.status="PASS";
  }catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1}
  report.observed=cell.audio.calls.map(c=>({id:c.id,command:c.command??null,scene:c.scene??null}));
  report.firstCommittedSnapshot=cell.checks[0].detail;
  fs.writeFileSync(path.join(base,"observer-preflight-01.json"),JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify(report));
}else{
  assert.equal(action,"test");
  const {validateVoiceCommandOwnership:validate}=require("./lib/voice-playback-evidence.cjs");
  const frozen=read(input),result={status:"RUNNING",at:new Date().toISOString(),
    scope:"AUDIT_ORACLE_REPLAY_NOT_NEW_PRODUCT_TESTS",inputSha256:sha256(fs.readFileSync(input)),checks:[]};
  const check=(name,fn)=>{fn();result.checks.push({name,status:"PASS"});console.log(`PASS ${name}`)};
  const reject=(name,mutate)=>check(name,()=>{const c=structuredClone(frozen.cell);mutate(c);assert.throws(()=>validate(c,frozen.fixture))});
  try{
    check("Actual pre-mount first playback is linked to real first committed snapshot",()=>{
      assert.equal(validate(frozen.cell,frozen.fixture).initialCallSiteDomAvailable,false);
    });
    check("A directly DOM-attributed first playback is also valid",()=>{
      const c=structuredClone(frozen.cell);c.audio.calls[0].command="0";c.audio.calls[0].scene="voice_restore";
      assert.equal(validate(c,frozen.fixture).initialCallSiteDomAvailable,true);
    });
    reject("Reject extra play",c=>c.audio.calls.push(structuredClone(c.audio.calls[0])));
    reject("Reject missing later DOM command",c=>delete c.audio.calls[1].command);
    reject("Reject wrong later scene",c=>c.audio.calls[1].scene="other");
    reject("Reject skipped command",c=>c.audio.calls[1].command="2");
    reject("Reject wrong first committed command",c=>c.checks[0].detail.state.command=1);
    reject("Reject first committed play count other than one",c=>c.checks[0].detail.count=2);
    reject("Reject first fetched source bytes mismatch",c=>c.checks[0].detail.bytes.sha256="bad");
    reject("Reject unexpected later audio source",c=>c.audio.calls[1].source="other");
    reject("Reject unresolved playback",c=>c.audio.calls[1].settlement="pending");
    reject("Reject partial first DOM attribution",c=>c.audio.calls[0].command="0");
    reject("Reject rewritten first snapshot text",c=>c.checks[0].detail.state.text="other");
    result.status="PASS";
  }catch(e){result.status="FAILED";result.error=String(e.stack||e);process.exitCode=1}
  fs.writeFileSync(path.join(base,"observer-preflight-02.json"),JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:result.status,cases:result.checks.length,productTests:0}));
}
