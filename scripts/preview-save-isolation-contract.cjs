"use strict";
// Execute the actual autosave/flush implementations at their persistence seam.
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const {transformSync}=require("../editor/node_modules/esbuild");
const source=fs.readFileSync(path.join(__dirname,"../GameCli_framework/src/store/runtimeStore.ts"),"utf8");
const start=source.indexOf("  function scheduleAutoSave("),end=source.indexOf("\n  function finishGalleryReplay(",start);
const flushStart=source.indexOf("flushAutoSave: async () => {"),flushEnd=source.indexOf("\n    openMenu:",flushStart);
assert(start>=0&&end>start&&flushStart>=0&&flushEnd>flushStart);
const schedule=source.slice(start,end),flush=source.slice(flushStart,flushEnd).replace(/^flushAutoSave: /,"const flushAutoSave = ").replace(/,\s*$/,";");
const code=transformSync(`${schedule}\n${flush}\nglobalThis.tested={scheduleAutoSave,flushAutoSave};`,{loader:"ts",format:"cjs"}).code;
function harness(mode="preview",enabled=true){
  const calls={persist:0,enqueued:0,snapshots:0,waits:0},state={runtimeMode:mode,currentGame:{id:"qa"},saves:[]};
  const context={Promise,Date,console,state,observedCheckpointSignature:undefined,suppressedCheckpointSignature:undefined,
    lastAutoSaveSignature:undefined,checkpointsSinceAutoSave:0,lastAutoSaveAt:0,AUTO_SAVE_CHECKPOINTS:1,AUTO_SAVE_MIN_INTERVAL_MS:0,
    useSettingsStore:{getState:()=>({settings:{autoSaveEnabled:enabled}})},get:()=>state,set:()=>{},
    stableCheckpointSignature:()=>"checkpoint",oldestAutoSaveSlot:()=>({kind:"auto",slot:1}),
    createSnapshot:()=>{calls.snapshots++;return{id:"snapshot"};},captureCurrentSavePreview:async()=>null,
    persistSnapshot:async()=>{calls.persist++;},engine:{state:{}},
    autoSaveQueue:{enqueue:fn=>{calls.enqueued++;return fn();},wait:async()=>{calls.waits++;return{status:"idle"};}},
    saveWrites:{wait:async()=>{calls.waits++;return{status:"idle"};}}};
  vm.runInNewContext(code,context);return{...context.tested,context,calls,state};
}
(async()=>{
  let cases=0;
  for(const enabled of [true,false])for(const force of [true,false]){
    const h=harness("preview",enabled),r=await h.scheduleAutoSave({},force);
    assert.equal(r.status,"skipped");assert.equal(r.reason,"preview");
    assert.equal(h.calls.persist,0);assert.equal(h.calls.enqueued,0);assert.equal(h.calls.snapshots,0);cases++;
  }
  const normal=harness("library",true);assert.equal((await normal.scheduleAutoSave({},true)).status,"saved");
  assert.equal(normal.calls.persist,1);assert.equal(normal.calls.enqueued,1);cases++;
  for(const force of [false,true]){
    const h=harness("library",true);h.context.lastAutoSaveSignature="checkpoint";
    const r=await h.scheduleAutoSave({},force);
    assert.equal(r.status,force?"saved":"skipped");
    assert.equal(h.calls.persist,force?1:0,"Restore suppression applies to routine saves, never an explicit exit flush");cases++;
  }
  const disabled=harness("library",false);assert.equal((await disabled.scheduleAutoSave({},true)).reason,"disabled");
  assert.equal(disabled.calls.persist,0);cases++;
  for(const mode of ["preview","library"]){
    const h=harness(mode,mode==="preview");let finishExisting,finishAuto,done=false;
    h.context.saveWrites.wait=()=>new Promise(r=>{finishExisting=r;});
    h.context.autoSaveQueue.wait=()=>new Promise(r=>{finishAuto=r;});
    const pending=h.flushAutoSave().then(v=>{done=true;return v;});
    await Promise.resolve();assert.equal(done,false);assert.equal(h.calls.persist,0);
    finishAuto({status:"idle"});await Promise.resolve();assert.equal(done,false);
    finishExisting({status:"idle"});const r=await pending;
    assert.equal(r.reason,mode==="preview"?"preview":"disabled");assert.equal(h.calls.persist,0);cases++;
  }
  const failed=harness();failed.context.saveWrites.wait=async()=>({status:"failed",message:"existing write failed"});
  const result=await failed.flushAutoSave();assert.equal(result.status,"failed");assert.equal(result.message,"existing write failed");
  assert.equal(failed.calls.persist,0);cases++;
  assert.equal(cases,11);console.log(`preview save isolation contract: PASS (${cases} actual-code seam behaviors, controlled storage)`);
})().catch(e=>{console.error(e);process.exitCode=1;});
