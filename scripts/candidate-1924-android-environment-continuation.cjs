"use strict";
// Preserve the failed import diagnostic. Only add independent display/restart
// evidence, reusing the exact genuine 1.9.24 cache, never editing its metadata.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const Module=require("node:module"),vm=require("node:vm");
const {sha256}=require("./lib/installed-acceptance.cjs");
const sourceFile="F:/AgentVN/Checkpoints/Android-Environment-1924-20261025-04/candidate-1924-android-environment.cjs";
const sha=f=>sha256(fs.readFileSync(f)),read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
assert.equal(sha(sourceFile),"26002b3215bd9b1a4f3055c249d6d4520219f701a71ac9a4de6413b3e0de1e9c");
const originalOut="F:/AgentVN/QA/Android-Environment-1924-20261025-04";
const out="F:/AgentVN/QA/Android-Environment-1924-20261025-05";
const original=read(path.join(originalOut,"report.json"));
assert.equal(original.status,"FAILED");assert.equal(original.cleanupStatus,"PASS");
assert.equal(original.steps.length,4);assert(original.steps.slice(0,3).every(s=>s.status==="PASS"));
assert.equal(original.steps[3].status,"FAILED");
assert.equal(read(path.join(originalOut,"cache-restoration.json")).status,"PASS");
const cache=path.join(originalOut,"cache-2/android-pass.json");
assert.equal(sha(cache),original.steps[1].detail.again.cacheSha256,"Rejected package did not change the genuine PASS cache");
const changes=[];
function adapt(){
  let source=fs.readFileSync(sourceFile,"utf8");
  function replace(before,after){assert.equal(source.split(before).length-1,1,before);source=source.replace(before,after);changes.push({before,after});}
  replace(originalOut,out);
  replace('"-Action",action],','"-Action",action,"-Continuation"],');
  replace('command("Prepare");prepared=true;',`command("Prepare");prepared=true;
    const priorCache=${JSON.stringify(cache)};
    assert.equal(hash(priorCache),${JSON.stringify(sha(cache))});
    fs.copyFileSync(priorCache,pass,fs.constants.COPYFILE_EXCL);`);
  const start=source.indexOf('    await step("real-old-1.9.22-full-check-and-same-version-cache"');
  const end=source.indexOf('    await step("current-environment-controls-12-real-webview-combinations"');
  assert(start>0&&end>start);
  source=source.slice(0,start)+`    await step("genuine-current-cache-replay-no-metadata-edit",async()=>{
      const result=await start("current");assert.equal(result.value.cacheHit,true);
      assert.equal(result.cacheSha256,${JSON.stringify(sha(cache))});return result;
    });\n`+source.slice(end);
  changes.push({change:"Remove only already-tested old/current/picker flows; preserve original failure and all matrix/restart assertions"});
  replace('assert.equal(report.steps.length,6);','assert.equal(report.steps.length,3);');
  replace('TWO_EXISTING_NSIS_INSTALLS_ANDROID_CACHE_AND_NATIVE_PICKER','CURRENT_CACHE_REPLAY_12_DISPLAY_AND_RESTART_NOT_REPEATED_UPGRADE_OR_PICKER');
  replace('productChanges:0,modelRequests:0,launches:[]',
    `originalFailedImport:{path:${JSON.stringify(path.join(originalOut,"report.json"))},sha256:${JSON.stringify(sha(path.join(originalOut,"report.json")))}},productChanges:0,modelRequests:0,launches:[]`);
  new vm.Script(Module.wrap(source),{filename:__filename});return source;
}
const source=adapt();
if(process.argv[2]==="--self-test"){
  process.argv[2]="--self-test";
}else{assert.deepEqual(process.argv.slice(2),["run"]);assert(!fs.existsSync(out));}
const worker=new Module(__filename,module);worker.filename=__filename;worker.paths=module.paths;
worker._compile(source,__filename);
