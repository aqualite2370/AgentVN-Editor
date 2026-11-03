"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {rows,listeners,ps}=require("./lib/current-native-editor-session.cjs");
const base="F:/AgentVN/QA/Runtime-Junction-20261024-01",attempt=process.argv[2]||"01",nativeAttempt=process.argv[3]||"03";
assert.match(attempt,/^\d{2}$/);assert.match(nativeAttempt,/^\d{2}$/);
const out=path.join(base,`audit-${attempt}`);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const desc=p=>({path:path.resolve(p),sha256:sha(p)});
const nativePath=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/junction-green-${nativeAttempt}/report.json`;
const report={status:"RUNNING",at:new Date().toISOString(),scope:"AUDIT_CURRENT_SOURCE_DEV_JUNCTION_NOT_RELEASE_ANDROID",
 checks:[],modelRequests:0};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
function check(name,fn){fn();report.checks.push({name,status:"PASS"});save();}
function complete(r){
 assert.equal(r.status,"PASS");assert(r.finishedAt&&!r.cleanupError&&!r.observerError);
 assert.equal(r.cells.length,24);assert.equal(r.screenshots.length,24);assert.equal(r.nativeCases.length,6);
 for(const layout of ["agentvn","renpy"]){
  const cells=r.cells.filter(c=>c.layout===layout);assert.equal(cells.length,12);
  assert.equal(new Set(cells.map(c=>`${c.width}:${c.height}:${c.dpr}:${c.reduced}`)).size,12);
  for(const c of cells){
   assert.equal(c.status,"PASS");assert(c.hit.hit&&c.hit.enabled&&!c.hit.overflow);
   assert(c.disk.some(f=>f.data.save_kind==="manual"&&f.data.slot===1));assert(!c.disk.some(f=>f.path.endsWith(".tmp")));
   const s=c.screenshot;assert(s&&s.before&&s.after);assert.deepEqual(s.before,s.after);
   assert.equal(s.before.width,c.width);assert.equal(s.before.height,c.height);
   assert(Math.abs(s.before.dpr-c.dpr)<=1e-6);assert.equal(s.before.reduced,c.reduced);
   assert.equal(s.png.width,c.width*c.dpr);assert.equal(s.png.height,c.height*c.dpr);
  }
  assert.equal(r.nativeCases.filter(c=>c.layout===layout&&c.status==="PASS"&&c.writes.length===2).length,3);
  const launches=r.launches.filter(c=>c.layout===layout);assert.equal(launches.length,2);
  assert.equal(launches[0].confirmedExit.code,0);assert.equal(launches[0].confirmedExit.forceStopBeforeExit,false);
  assert(launches[0].automatic.length>0);assert.equal(launches[0].cleanup.method,"PROCESS_ALREADY_EXITED_BEFORE_CLEANUP");
  assert.equal(launches[1].restart,true);assert.deepEqual(launches[1].restored.actual,launches[1].restored.expected);
 }
 assert.equal(r.pageErrors.length,0);assert.equal(r.cleanup.survivors.length,0);assert.equal(r.cleanup.listeners.length,0);
}
try{
 save();const native=read(nativePath),build=read(path.join(base,"build-01/report.json")),support=read(path.join(base,"support-01/report.json"));
 report.native=desc(nativePath);report.build=desc(path.join(base,"build-01/report.json"));report.support=desc(path.join(base,"support-01/report.json"));
 check("Full nonempty matrix, six native category pairs, real exit auto-flush and restarted UI read",()=>complete(native));
 check("Auditor rejects incomplete or false evidence",()=>{
  const mutations=[
   r=>r.cells=[],r=>r.cells[0].status="RUNNING",r=>r.screenshots=[],
   r=>r.cells[0].screenshot.png.width=1,r=>r.nativeCases[0].writes.pop(),
   r=>r.launches[0].confirmedExit.forceStopBeforeExit=true,r=>r.cleanup.survivors.push({pid:1}),
  ];
  for(const change of mutations){const broken=structuredClone(native);change(broken);assert.throws(()=>complete(broken));}
  report.rejectedBadEvidence=mutations.length;
 });
 check("Original product failure and same real Rust test red to green remain intact",()=>{
  const old=read(path.join(base,"native-01/report.json"));assert.equal(old.status,"REPRODUCED_NATIVE_IO");
  assert.equal(old.cases.length,6);assert(old.cases.every(c=>c.status==="FAILED"&&c.result.error.includes("os error 3")));
  assert.equal(old.controls.filter(c=>c.status==="FAILED"&&/raw/.test(c.mode)).length,4);
  assert.equal(old.controls.filter(c=>c.status==="PASS"&&/canonical/.test(c.mode)).length,4);
  assert.equal(sha(old.executables[0].path),old.executables[0].sha256);report.frozenPlayer=old.executables[0];
  const red=read(path.join(base,"rust-red-01/report.json")),green=read(path.join(base,"rust-green-01/report.json"));
  assert.equal(red.status,"FAILED");assert.equal(green.status,"PASS");
  assert.match(fs.readFileSync(path.join(base,"rust-red-01/rust.log"),"utf8"),/0 passed; 1 failed/);
  assert.match(fs.readFileSync(path.join(base,"rust-green-01/rust.log"),"utf8"),/1 passed; 0 failed/);
  for(const r of [old,red,green])assert.equal(read(r.restoration.path).status,"PASS");
 });
 check("Actual files, screenshots, immutable build sources and Dev products match",()=>{
  assert.equal(support.status,"PASS");assert.equal(support.commands.length,4);
  assert.equal(build.status,"PASS");assert.equal(build.commands.length,4);
  assert(build.commands.every(c=>c.status==="PASS"&&c.exitCode===0));
  for(const f of [...build.sources,build.dev,build.player,...native.tools])assert.equal(sha(f.path),f.sha256);
  assert.equal(build.dev.sha256,sha("D:/AgentVN/editor/src-tauri/target/debug/agentvn-editor.exe"));
  assert.equal(build.player.sha256,sha("D:/AgentVN/GameCli_framework/src-tauri/target/release/agentvn-player.exe"));
  for(const f of build.bundled)assert.equal(sha(f.copy.path),f.source.sha256);
  for(const s of native.screenshots){
   const bytes=fs.readFileSync(s.path);assert.equal(hash(bytes),s.sha256);
   assert.equal(bytes.readUInt32BE(16),s.png.width);assert.equal(bytes.readUInt32BE(20),s.png.height);
  }
  // Earlier saves are intentionally overwritten; their complete serialized
  // payloads and hashes are kept in the raw report, not claimed as frozen files.
  for(const c of native.cells)for(const f of c.disk)
   assert.equal(hash(Buffer.from(JSON.stringify(f.data,null,2))),f.sha256);
  report.finalFiles=[];
  for(const installId of new Set(native.launches.map(l=>l.installId))){
   const directory=path.join(native.physicalProfile,"saves",installId);
   const files=fs.readdirSync(directory).map(name=>path.join(directory,name));
   assert(files.length>0&&files.every(f=>f.endsWith(".json")));
   report.finalFiles.push(...files.map(desc));
  }
 });
 check("Original profile bytes and directory identity restored; owned processes and ports gone",()=>{
  const restored=read(native.restoration.path);assert.equal(restored.status,"PASS");
  assert.equal(restored.deletedUserFiles,0);assert.equal(restored.restored.length,2);
  for(const item of restored.restored){
   assert(fs.existsSync(item.original));
   const fileId=ps(`fsutil.exe file queryfileid '${item.original.replace(/'/g,"''")}'`);
   assert(fileId.toLowerCase().includes(item.directoryId.toLowerCase()));
   for(const f of item.files)assert.equal(sha(path.join(item.original,f.relative)),f.sha256);
  }
  const actual=rows();
  assert(!native.knownProcesses.some(p=>actual.some(q=>p.ProcessId===q.ProcessId&&p.Created===q.Created)));
  assert.equal(listeners(native.launches.map(l=>l.port)).length,0);
  report.restoration=desc(native.restoration.path);
 });
 report.status="PASS";
}catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,out,checks:report.checks.length,error:report.error}));}
