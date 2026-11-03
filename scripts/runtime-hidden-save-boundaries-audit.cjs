"use strict";
// Read-only audit of the whole new boundary matrix, not a native acceptance substitute.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const attempt=process.argv[2];assert.match(attempt||"",/^matrix-\d{2}$/);
const out=path.resolve(`F:/AgentVN/QA/Runtime-Hidden-Saves-20261026-01/${attempt}`);
const file=path.join(out,"report.json");
const auditFile=path.join(out,"safety-audit-01.json");
assert(!fs.existsSync(auditFile),"Never overwrite a previous audit");
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const report=JSON.parse(fs.readFileSync(file,"utf8"));
const names=[
  "same-tick auto/skip/hide and held-key release",
  "hidden-time exit waits for actual controlled write, duplicate submit merged",
  "hidden-time save reload does not restore temporary hidden state",
  "autosave disabled waits for existing manual write without creating auto",
  "failed in-flight manual write blocks exit and supports explicit retry",
];
function validate(r) {
  assert.equal(r.status,"PASS");assert.equal(r.cleanupStatus,"PASS");
  assert(r.finishedAt&&r.startedAt&&r.finishedAt>=r.startedAt);
  assert.equal(r.desktopInput,0);assert.equal(r.nativeWindowLaunches,0);
  assert.equal(r.productChanges,0);assert.equal(r.modelRequests,0);
  assert.equal(r.scope,"EXISTING_COMPRESSED_RUNTIME_HEADLESS_SOFTWARE_CONTROLLED_NATIVE_IO_NOT_INSTALLED_NATIVE");
  assert.equal(r.renderer.featureStatus.gpu_compositing,"disabled_software");
  assert(r.renderer.devices.some(d=>/SwiftShader/.test(d.deviceString)));
  assert.equal(r.cases.length,24);assert.equal(r.screenshots.length,24);
  assert.deepEqual(r.errors,[]);
  const seen=new Set();
  for(const c of r.cases) {
    assert.equal(c.status,"PASS");
    assert(["renpy","agentvn"].includes(c.layout));
    assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h])=>c.width===w&&c.height===h));
    assert([1,2].includes(c.dpr));assert.equal(typeof c.reduced,"boolean");
    const key=[c.layout,c.width,c.height,c.dpr,c.reduced].join("/");
    assert(!seen.has(key));seen.add(key);
    assert.deepEqual(c.operations.map(o=>o.name),names);
    assert(c.operations.every(o=>o.status==="PASS"&&o.io&&o.io.pending===0));
    const [paused,hidden,loaded,waiting,failed]=c.operations;
    assert.equal(paused.detail.resumed.auto,"true");assert.equal(paused.detail.resumed.skip,"true");
    assert(paused.detail.negativeObservationMs>=850);
    assert.equal(hidden.io.exitCalls,1);assert.equal(hidden.io.writes.length,1);
    assert.equal(hidden.io.writes[0].kind,"auto");assert.equal(hidden.io.saves.length,1);
    const snapshot=hidden.io.saves[0];
    assert.equal(snapshot.scene_id,hidden.detail.before.scene);
    assert.equal(snapshot.command_index,hidden.detail.before.index);
    assert(snapshot.dialog.text&&hidden.detail.before.text.includes(snapshot.dialog.text));
    assert.equal(snapshot.history.at(-1).text,snapshot.dialog.text);
    assert(!JSON.stringify(snapshot).includes("isUiHidden"));
    assert.equal(loaded.detail.hidden,false);assert.equal(loaded.detail.readSlot,snapshot.slot);
    assert.equal(loaded.io.writes.length,0);
    assert.equal(waiting.io.exitCalls,1);assert.equal(waiting.io.writes.length,1);
    assert.equal(waiting.io.writes[0].kind,"manual");
    assert.equal(waiting.io.writes[0].save.scene_id,waiting.detail.before.scene);
    assert.equal(waiting.io.writes[0].save.command_index,waiting.detail.before.index);
    assert.equal(failed.detail.blockedBeforeRetry,true);
    assert.equal(failed.io.exitCalls,1);assert.equal(failed.io.writes.length,1);
    assert.equal(failed.io.writes[0].kind,"manual");assert.equal(failed.io.saves.length,0);
    assert(failed.io.events.length>=1);
    for(const event of c.operations.flatMap(o=>o.io.events)) {
      assert.equal(event.command,"append_frontend_error");assert.equal(event.args.source,"player.save");
      assert.equal(JSON.parse(event.args.message).error.message,"受控已在途写入失败");
    }
    const screenshot=r.screenshots.find(s=>path.basename(s.path)===`${c.layout}-${c.width}-${c.dpr}-${c.reduced}.png`);
    assert(screenshot);
    assert.equal(path.dirname(path.resolve(screenshot.path)),out);
    assert.deepEqual({width:screenshot.before.width,height:screenshot.before.height,
      dpr:screenshot.before.dpr,reduced:screenshot.before.reduced},
    {width:c.width,height:c.height,dpr:c.dpr,reduced:c.reduced});
    assert.equal(screenshot.before.invalidFocus,false);assert(screenshot.before.overflow<=1);
    assert.equal(screenshot.width,c.width*c.dpr);assert.equal(screenshot.height,c.height*c.dpr);
  }
}
validate(report);
// The original runner measured the unsafe outcome correctly, but its oracle
// incorrectly accepted "retry" exiting without any successful save.
function unsafeRetry(c) {
  const failure=c.operations[4];
  return failure.detail.blockedBeforeRetry && failure.io.exitCalls>0
    && failure.io.saves.length===0 && failure.io.writes.length===1;
}
const productFailures=report.cases.filter(unsafeRetry).map(c=>({
  layout:c.layout,width:c.width,height:c.height,dpr:c.dpr,reduced:c.reduced,
  status:"FAILED",code:"DISABLED_AUTOSAVE_RETRY_EXITS_WITHOUT_SAVE",
  writes:c.operations[4].io.writes.length,saved:c.operations[4].io.saves.length,
  exits:c.operations[4].io.exitCalls,
}));
assert.equal(productFailures.length,24);
assert.equal(unsafeRetry({...report.cases[0],operations:[
  ...report.cases[0].operations.slice(0,4),
  {...report.cases[0].operations[4],io:{exitCalls:0,saves:[],writes:[{}]}},
]}),false,"Returning to the game without exiting is not this unsafe retry");
assert.equal(unsafeRetry({...report.cases[0],operations:[
  ...report.cases[0].operations.slice(0,4),
  {...report.cases[0].operations[4],io:{exitCalls:1,saves:[{}],writes:[{},{}]}},
]}),false,"An actual successful retry is not this unsafe retry");
let rejected=0;
for(const damage of [
  r=>{r.cases=[];},
  r=>{r.cases[1]=structuredClone(r.cases[0]);},
  r=>{r.cases[0].operations.pop();},
  r=>{r.cases[0].operations[1].io.exitCalls=2;},
  r=>{r.cases[0].operations[3].io.writes[0].kind="auto";},
  r=>{r.cases[0].operations[4].io.saves=[{}];},
  r=>{r.screenshots[0].before.dpr=3;},
  r=>{r.cleanupStatus="FAILED";},
  r=>{r.renderer.featureStatus.gpu_compositing="enabled";},
]) {
  const invalid=structuredClone(report);damage(invalid);
  assert.throws(()=>validate(invalid));rejected++;
}
for(const f of [...report.frontend,...report.sources,...report.fixtures,...report.screenshots])
  assert.equal(sha(f.path),f.sha256,`Evidence bytes changed: ${f.path}`);
for(const f of report.screenshots) {
  const bytes=fs.readFileSync(f.path);
  assert.equal(bytes.subarray(1,4).toString(),"PNG");
  assert.equal(bytes.readUInt32BE(16),f.width);assert.equal(bytes.readUInt32BE(20),f.height);
}
fetch(`${report.service.url}/owner/${report.service.owner}`,{signal:AbortSignal.timeout(700)}).then(()=>{
  throw Error("Test service is still active");
},()=>({status:"FAILED",evidenceIntegrity:"PASS",scope:report.scope,cells:24,
  independentlySupportedOperations:96,productFailures,screenshots:24,
  negativeReceipts:rejected,input:{path:file,sha256:sha(file)},desktopInput:0,
  originalRunnerStatus:report.status,
  oracleCorrection:"Raw PASS is retained. All 24 failed-manual-save retries exited without persisting data; none counts as functional PASS.",
  screenshotBoundary:"Raw pre-capture parameters retained; post-capture equality asserted in hashed runner, not separately retained",
  nativeAcceptance:false})).then(result=>{
    result.auditor={path:__filename,sha256:sha(__filename)};
    fs.writeFileSync(auditFile,JSON.stringify(result,null,2),{flag:"wx"});
    console.log(JSON.stringify(result,null,2));
    process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});
