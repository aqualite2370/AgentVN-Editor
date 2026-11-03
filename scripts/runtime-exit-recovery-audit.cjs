"use strict";
// Independent behavior audit: a failed save may be retried or explicitly
// abandoned, but an empty queue is never evidence that a retry persisted data.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const attempt=process.argv[2];
assert.match(attempt||"",/^recovery-matrix-\d{2}$/);
const out=path.resolve(`F:/AgentVN/QA/Runtime-Hidden-Saves-20261026-01/${attempt}`);
const file=path.join(out,"report.json"),auditFile=path.join(out,"recovery-audit-01.json");
assert(!fs.existsSync(auditFile),"Do not overwrite historical evidence");
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const report=JSON.parse(fs.readFileSync(file,"utf8"));
const names=[
  "disabled autosave returns to manual save; failed resave stays open; successful resave permits exit",
  "disabled autosave discard requires second confirmation and supports cancel",
  "enabled autosave retry really writes and waits; duplicate submit merged",
  "disabled autosave with no pending task never forces a save",
];
function geometry(g) {
  assert(g.inside&&g.focused);
  assert(g.buttons.length>=3);
  assert(g.buttons.every(b=>!b.clipped&&(b.disabled||b.hit)));
}
function validate(r) {
  assert.equal(r.status,"PASS");assert.equal(r.cleanupStatus,"PASS");
  assert.equal(r.scope,"COMPRESSED_RUNTIME_RECOVERY_HEADLESS_SOFTWARE_CONTROLLED_NATIVE_IO_NOT_INSTALLED_NATIVE");
  assert.equal(r.desktopInput,0);assert.equal(r.nativeWindowLaunches,0);assert.equal(r.modelRequests,0);
  assert(r.startedAt&&r.finishedAt&&r.finishedAt>=r.startedAt);
  assert.deepEqual(r.errors,[]);
  assert.equal(r.renderer.featureStatus.gpu_compositing,"disabled_software");
  assert(r.renderer.devices.some(d=>/SwiftShader/.test(d.deviceString)));
  assert.equal(r.cases.length,24);assert.equal(r.screenshots.length,24);
  const seen=new Set();
  for(const c of r.cases) {
    assert.equal(c.status,"PASS");
    assert(["renpy","agentvn"].includes(c.layout));
    assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h])=>w===c.width&&h===c.height));
    assert([1,2].includes(c.dpr));assert.equal(typeof c.reduced,"boolean");
    const key=[c.layout,c.width,c.height,c.dpr,c.reduced].join("/");
    assert(!seen.has(key));seen.add(key);
    assert.deepEqual(c.operations.map(o=>o.name),names);
    assert(c.operations.every(o=>o.status==="PASS"&&o.io.pending===0));
    const [retry,discard,automatic,empty]=c.operations;
    geometry(retry.detail.geometry);geometry(automatic.detail.geometry);
    assert.equal(retry.detail.failedAttempts,2);assert.equal(retry.detail.retryExitCalls,0);
    assert.equal(retry.io.exitCalls,1);assert.equal(retry.io.writes.length,3);
    assert(retry.io.writes.every(w=>w.kind==="manual"&&w.slot===1));
    assert.equal(retry.io.saves.length,1);assert.equal(retry.io.saves[0].save_kind,"manual");
    assert.equal(discard.detail.cancelStayedOpen,true);assert.equal(discard.detail.confirmedDiscard,true);
    assert.equal(discard.io.exitCalls,1);assert.equal(discard.io.writes.length,1);
    assert.equal(discard.io.saves.length,0);assert.equal(discard.io.writes[0].kind,"manual");
    assert.equal(automatic.io.exitCalls,1);assert.equal(automatic.io.writes.length,2);
    assert(automatic.io.writes.every(w=>w.kind==="auto"));
    assert.equal(automatic.io.saves.length,1);
    for(const op of [retry,automatic]) {
      const saved=op.io.saves[0],before=op.detail.before;
      assert.equal(saved.scene_id,before.scene);assert.equal(saved.command_index,before.index);
      assert(saved.dialog?.text&&before.text.includes(saved.dialog.text));
      assert.equal(saved.history.at(-1).text,saved.dialog.text);
      assert(!JSON.stringify(saved).includes("isUiHidden"));
      assert.equal(op.io.events.length,op===retry?2:1);
    }
    assert.equal(empty.io.exitCalls,1);assert.equal(empty.io.writes.length,0);
    assert.equal(empty.io.saves.length,0);assert.equal(empty.io.events.length,0);
    assert.equal(discard.io.events.length,1);
    for(const op of c.operations) for(const event of op.io.events) {
      assert.equal(event.command,"append_frontend_error");
      const entry=JSON.parse(event.args.message);
      if(op===automatic) {
        assert.equal(event.args.source,"player.console");
        assert.equal(entry.error[0],"Auto save failed.");
        assert.equal(entry.error.length,2);
        assert.equal(entry.error[1].message,"受控已在途写入失败");
      }else {
        assert.equal(event.args.source,"player.save");
        assert.equal(entry.error.message,"受控已在途写入失败");
      }
    }
    const shot=r.screenshots.find(s=>path.basename(s.path)===`${c.layout}-${c.width}-${c.dpr}-${c.reduced}.png`);
    assert(shot);assert.equal(path.dirname(path.resolve(shot.path)),out);
    const display={width:c.width,height:c.height,dpr:c.dpr,reduced:c.reduced};
    assert.deepEqual(shot.before,display);assert.deepEqual(shot.after,display);
    assert.equal(shot.width,c.width*c.dpr);assert.equal(shot.height,c.height*c.dpr);
  }
}
validate(report);
let rejected=0;
for(const damage of [
  r=>r.cases.splice(0),
  r=>{r.cases[1]=structuredClone(r.cases[0]);},
  r=>{r.cases[0].operations.pop();},
  r=>{r.cases[0].operations[0].io.saves=[];},
  r=>{r.cases[0].operations[0].io.writes[1].kind="auto";},
  r=>{r.cases[0].operations[0].detail.retryExitCalls=1;},
  r=>{r.cases[0].operations[1].detail.cancelStayedOpen=false;},
  r=>{r.cases[0].operations[2].io.writes.pop();},
  r=>{r.cases[0].operations[2].io.pending=1;},
  r=>{r.cases[0].operations[3].io.writes=[{}];},
  r=>{r.cases[0].operations[0].detail.geometry.buttons[0].hit=false;},
  r=>{r.screenshots[0].after.dpr=3;},
  r=>{r.renderer.featureStatus.gpu_compositing="enabled";},
  r=>{r.cleanupStatus="FAILED";},
]) {
  const invalid=structuredClone(report);damage(invalid);
  assert.throws(()=>validate(invalid));rejected++;
}
for(const f of [...report.frontend,...report.sources,...report.fixtures,...report.screenshots])
  assert.equal(sha(f.path),f.sha256,`Evidence bytes changed: ${f.path}`);
for(const shot of report.screenshots) {
  const bytes=fs.readFileSync(shot.path);
  assert.equal(bytes.subarray(1,4).toString(),"PNG");
  assert.equal(bytes.readUInt32BE(16),shot.width);assert.equal(bytes.readUInt32BE(20),shot.height);
}
fetch(`${report.service.url}${report.service.ownerPath}`,{signal:AbortSignal.timeout(700)}).then(()=>{
  throw Error("Owned test service is still running");
},()=>({status:"PASS",scope:report.scope,cells:24,flows:96,negativeReceipts:rejected,
  screenshots:24,input:{path:file,sha256:sha(file)},auditor:{path:__filename,sha256:sha(__filename)},
  nativeDisk:false,installedRuntime:false,Android:false,desktopInput:0})).then(result=>{
  fs.writeFileSync(auditFile,JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify(result,null,2));
}).catch(error=>{console.error(error);process.exitCode=1;});
