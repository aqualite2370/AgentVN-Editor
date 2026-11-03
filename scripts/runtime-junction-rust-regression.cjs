"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawn,spawnSync}=require("node:child_process"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),attempt=process.argv[2];assert.match(attempt||"",/^(red|green)-\d{2}$/);
const out=`F:/AgentVN/QA/Runtime-Junction-20261024-01/rust-${attempt}`;
const profile=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/junction-rust-${attempt}`;
for(const p of [out,profile]){assert(!fs.existsSync(p));fs.mkdirSync(p,{recursive:true});}
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const source=path.join(root,"GameCli_framework/src-tauri/src/lib.rs");
const report={status:"RUNNING",at:new Date().toISOString(),scope:"ACTUAL_PRODUCTION_WRITE_SAVE_FILE_REDIRECTED_PARENT",
 source:{path:source,sha256:sha(source)},profile,commands:[]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
function profiles(action){
 const args=["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"scripts/native-dev-preview-profile.ps1"),
  "-Action",action,"-RunDirectory",profile,"-CodexCacheView"];
 const r=spawnSync("powershell.exe",args,{cwd:root,encoding:"utf8",windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
 fs.writeFileSync(path.join(out,action+".log"),(r.stdout||"")+"\n"+(r.stderr||""),{flag:"wx"});
 report.commands.push({exe:"powershell.exe",args,exitCode:r.status});save();assert.equal(r.status,0,r.stdout+r.stderr);
}
let prepared=false;
(async()=>{
 save();prepared=true;profiles("Prepare");
 const journal=read(path.join(profile,"profile-protection.json")),roaming=journal.records.find(r=>r.original.includes("\\Roaming\\"));
 const id="qa_junction_rust_"+attempt,temporary=path.join(out,"temporary");fs.mkdirSync(temporary);
 const raw=path.join("C:/Users/1/AppData/Roaming/com.agentvn.player/saves",id),physical=path.join(roaming.target,"saves",id);
 report.roots={raw,physical};
 const args=["test","--offline","--locked","--lib","save_storage_redirected_parent_preserves_atomic_save",
  "--","--ignored","--test-threads=1"];
 const row={exe:"cargo.exe",args,cwd:path.join(root,"GameCli_framework/src-tauri"),status:"RUNNING",
  log:path.join(out,"rust.log"),startedAt:new Date().toISOString()};report.commands.push(row);save();
 const fd=fs.openSync(row.log,"wx");
 const child=spawn("cargo.exe",args,{cwd:row.cwd,windowsHide:true,stdio:["ignore",fd,fd],
  env:{...process.env,TEMP:temporary,TMP:temporary,AGENTVN_SAVE_JUNCTION_TEST_ROOT:raw,
   AGENTVN_SAVE_JUNCTION_PHYSICAL_ROOT:physical}});
 row.pid=child.pid;save();
 try{
  row.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
 }finally{fs.closeSync(fd);row.finishedAt=new Date().toISOString();save();}
 row.status=row.exitCode===0?"PASS":"FAILED";save();
 assert.equal(row.exitCode,0,"Production redirected-parent save regression failed: "+row.log);
 assert.match(fs.readFileSync(row.log,"utf8"),/test result: ok\. 1 passed; 0 failed/);row.status="PASS";
 report.files=fs.readdirSync(physical).map(name=>({path:path.join(physical,name),sha256:sha(path.join(physical,name))}));
 assert.equal(report.files.length,3);report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
 .finally(()=>{
  try{if(prepared&&fs.existsSync(path.join(profile,"profile-protection.json"))){profiles("Restore");
   report.restoration={path:path.join(profile,"profile-restoration.json"),sha256:sha(path.join(profile,"profile-restoration.json"))};
   assert.equal(read(report.restoration.path).status,"PASS");}}
  catch(e){report.status="FAILED";report.cleanupError=String(e.stack||e);process.exitCode=1;}
  assert.equal(sha(source),report.source.sha256);
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({
   status:report.status,out,error:report.error,cleanupError:report.cleanupError}));
 });
