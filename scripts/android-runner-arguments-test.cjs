const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const source = fs.readFileSync(path.join(__dirname,'build-runtime-standalone-android.cjs'),'utf8');
for(const elevated of [false,true]){
  let invocation;
  const request={outputDir:'C:/test/output',diagnosticsDir:'C:/test/diagnostics',cartridgePath:'C:/test/game.vncart',runId:'test-run-id',releaseIdentity:{schemaVersion:1},skipEnvironmentCheck:true};
  const fakeFs={...fs,readFileSync:()=>JSON.stringify(request),mkdirSync:()=>{},appendFileSync:()=>{}};
  const fakeProcess={platform:'win32',env:elevated?{AGENTVN_ANDROID_BUILD_REQUEST:'request.json'}:{},argv:['node','runner','--OutputDir',request.outputDir,'--DiagnosticsDir',request.diagnosticsDir,'--CartridgePath',request.cartridgePath,'--ReleaseIdentity','{}','--RunId',request.runId]};
  vm.runInNewContext(source,{require:name=>name==='node:fs'?fakeFs:name==='node:child_process'?{spawn:(program,args)=>{invocation={program,args};const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}}:require(name),__dirname,process:fakeProcess,Buffer,console});
  assert.equal(invocation.args.filter(a=>a==='-RunId').length,1,`elevated=${elevated}: RunId must be passed exactly once`);
  assert.equal(invocation.args[invocation.args.indexOf('-RunId')+1],request.runId);
}
console.log('PASS Android runner standard/elevated argument forwarding (no APK build or elevation)');
