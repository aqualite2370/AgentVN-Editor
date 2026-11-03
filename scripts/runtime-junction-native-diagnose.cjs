"use strict";
// Six actual host commands in sealed old/current Players. No UI save claims.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),net=require("node:net");
const {spawn,spawnSync}=require("node:child_process"),crypto=require("node:crypto");
const {chromium}=require("../editor/node_modules/playwright");
const {rows,listeners,until,ps}=require("./lib/current-native-editor-session.cjs");
const {ownedProcessTree}=require("./lib/owned-process-tree.cjs");
const root=path.resolve(__dirname,".."),attempt=process.argv[2]||"01";assert.match(attempt,/^\d{2}$/);
const out=`F:/AgentVN/QA/Runtime-Junction-20261024-01/native-${attempt}`;
const profile=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/junction-native-${attempt}`;
for(const d of [out,profile]){assert(!fs.existsSync(d));fs.mkdirSync(d,{recursive:true});}
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc=p=>({path:p,sha256:sha(p),bytes:fs.statSync(p).size});
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const installed=read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");
const frozen=path.join(installed.installRoot,"agentvn-player.exe"),current=path.join(root,"editor/src-tauri/binaries/agentvn-player.exe");
assert.equal(sha(frozen),installed.resources.find(r=>path.basename(r.path)==="agentvn-player.exe").sha256);
const report={status:"RUNNING",at:new Date().toISOString(),scope:"ACTUAL_PLAYER_NATIVE_IO_DIAGNOSTIC_NOT_UI_FLOW_OR_FULL_ACCEPTANCE",
 productChanges:0,modelRequests:0,builds:0,profile,out,executables:[desc(frozen),desc(current)],cases:[],launches:[],commands:[],cleanups:[]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const checkpoint=`F:/AgentVN/Checkpoints/Runtime-Junction-20261024-native-${attempt}`;
assert(!fs.existsSync(checkpoint));fs.mkdirSync(checkpoint,{recursive:true});
const checkpointFiles=[__filename,path.join(root,"scripts/native-dev-preview-profile.ps1"),
 path.join(root,"GameCli_framework/src-tauri/src/lib.rs"),path.join(root,"plans/ACTIVE_TASKS.md")];
const copies=checkpointFiles.map(p=>{
 const target=path.join(checkpoint,path.basename(p));fs.copyFileSync(p,target,fs.constants.COPYFILE_EXCL);
 assert.equal(sha(p),sha(target));return{source:desc(p),copy:desc(target)};
});
fs.writeFileSync(path.join(checkpoint,"manifest.json"),JSON.stringify({at:report.at,copies,executables:report.executables},null,2),{flag:"wx"});
report.checkpoint=checkpoint;
let prepared=false,host,browser,launch,known=new Map();
function remember(){
 const actual=rows();if(host&&launch){
  const tree=ownedProcessTree(actual,host.pid,launch.created);
  for(const p of tree)known.set(p.ProcessId+":"+p.Created,p);
 }
 report.known=[...known.values()];save();return actual;
}
function command(label,exe,args){
 const r=spawnSync(exe,args,{cwd:root,encoding:"utf8",windowsHide:true,timeout:45000,maxBuffer:2*1024*1024});
 fs.writeFileSync(path.join(out,label+".log"),(r.stdout||"")+"\n"+(r.stderr||""),{flag:"wx"});
 report.commands.push({label,exe,args,exitCode:r.status,error:r.error?.message});save();return r;
}
function profiles(action){
 const r=command("profile-"+action,"powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
  path.join(root,"scripts/native-dev-preview-profile.ps1"),"-Action",action,"-RunDirectory",profile,"-CodexCacheView"]);
 assert.equal(r.status,0,r.stdout+r.stderr);
}
async function freePort(){return new Promise((resolve,reject)=>{
 const s=net.createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});
});}
async function stop(){
 if(!host)return;
 await browser?.close().catch(()=>{});browser=undefined;remember();
 const killed=[];
 for(const p of [...known.values()].reverse()){
  if(!rows().some(q=>q.ProcessId===p.ProcessId&&q.Created===p.Created))continue;
  ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';`+
   `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
  killed.push({pid:p.ProcessId,created:p.Created});
 }
 const actual=rows(),survivors=[...known.values()].filter(p=>actual.some(q=>q.ProcessId===p.ProcessId&&q.Created===p.Created));
 const listening=listeners([launch.port]);report.cleanups.push({killed,survivors,listeners:listening,normalExitClaimed:false});save();
 assert.equal(survivors.length,0);assert.equal(listening.length,0);host=undefined;
}
(async()=>{
 save();assert(!rows().some(p=>/^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
 prepared=true;profiles("Prepare");
 const journal=read(path.join(profile,"profile-protection.json"));report.profileJournal=desc(path.join(profile,"profile-protection.json"));
 const roaming=journal.records.find(r=>r.original.includes("\\Roaming\\"));assert(roaming);
 report.rawProfile="C:/Users/1/AppData/Roaming/com.agentvn.player";
 report.resolvedProfile=fs.realpathSync.native(report.rawProfile);assert.equal(path.resolve(report.resolvedProfile),path.resolve(roaming.target));
 for(const [index,exe]of [frozen,current].entries()){
  const port=await freePort();assert.equal(listeners([port]).length,0);
  const label=index===0?"frozen1922":"currentDev",webview=path.join(out,`${label}-webview`),temporary=path.join(out,"temporary");
  fs.mkdirSync(temporary,{recursive:true});
  const env={...process.env};
  for(const key of Object.keys(env))if(/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/.test(key))delete env[key];
  Object.assign(env,{WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,
   WEBVIEW2_USER_DATA_FOLDER:webview,TEMP:temporary,TMP:temporary});
  const fd=fs.openSync(path.join(out,label+"-host.log"),"wx");
  host=spawn(exe,["--mode","library"],{cwd:path.dirname(exe),env,windowsHide:true,stdio:["ignore",fd,fd]});fs.closeSync(fd);
  const identity=await until(()=>rows().find(p=>p.ProcessId===host.pid),"native Player identity");
  assert.equal(path.resolve(identity.ExecutablePath).toLowerCase(),path.resolve(exe).toLowerCase());
  launch={label,pid:host.pid,created:identity.Created,port,webview,executable:desc(exe)};report.launches.push(launch);remember();
  await until(async()=>{
   assert.equal(host.exitCode,null);remember();
   try{return(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(800)})).ok;}catch{return false;}
  },"owned native CDP");
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes("tauri.localhost")),"Player page");
  await page.waitForFunction(()=>typeof window.__TAURI_INTERNALS__?.invoke==="function");
  const installId=`qa_junction_${attempt}_${index}`,physical=path.join(roaming.target,"saves",installId);
  for(const [kind,slot]of [["manual",1],["auto",1],["quick",1]]){
   const value={save_id:`${label}-${kind}`,game_id:"qa-junction",save_kind:kind,slot,scene_id:"fixture",command_index:0};
   const row={label,kind,slot,installId,status:"RUNNING",physical};report.cases.push(row);save();
   row.result=await page.evaluate(async({installId,kind,slot,value})=>{
    try{
     await window.__TAURI_INTERNALS__.invoke("write_save",{installId,kind,slot,save:value});
     return{save:await window.__TAURI_INTERNALS__.invoke("read_save",{installId,kind,slot})};
    }catch(error){return{error:String(error)};}
   },{installId,kind,slot,value});
   const filename=kind==="manual"?"slot-01.json":kind+"-01.json";
   row.files=fs.existsSync(physical)?fs.readdirSync(physical).map(n=>desc(path.join(physical,n))):[];
   row.status=row.result.error?"FAILED":"PASS";
   if(!row.result.error){
    assert.deepEqual(row.result.save,value);
    const f=path.join(physical,filename);assert.deepEqual(read(f),value);
    row.saved=desc(f);
   }
   save();
  }
  remember();
  const raw=path.join(report.rawProfile,"saves",installId);
  // The old failing write's exact native directory, while the Player remains
  // alive, also receives the production-function-only control.
  for(const mode of ["raw","canonical","first-raw","first-canonical"]){
   const r=command(label+"-control-"+mode,"F:/AgentVN/QA/Runtime-Junction-20261024-01/probe-03/probe.exe",[raw,mode]);
   assert.equal(r.status,0,r.stdout+r.stderr);
   (report.controls??=[]).push({label,...JSON.parse(r.stdout.trim())});save();
  }
  await stop();
 }
 assert.equal(report.cases.length,6);assert.equal(report.controls.length,8);
 report.status=report.cases.every(r=>r.status==="PASS")?"NO_NATIVE_REPRO":"REPRODUCED_NATIVE_IO";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
 .finally(async()=>{
  try{await stop();}catch(e){report.status="FAILED";report.cleanupError=String(e.stack||e);process.exitCode=1;}
  if(prepared&&fs.existsSync(path.join(profile,"profile-protection.json"))){
   try{profiles("Restore");report.restoration=desc(path.join(profile,"profile-restoration.json"));assert.equal(read(report.restoration.path).status,"PASS");}
   catch(e){report.status="FAILED";report.cleanupError=String(e.stack||e);process.exitCode=1;}
  }
  for(const e of report.executables)assert.equal(sha(e.path),e.sha256);
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({
   status:report.status,out,cases:report.cases.map(c=>({label:c.label,kind:c.kind,status:c.status,error:c.result?.error})),
   controls:report.controls?.map(c=>[c.label,c.mode,c.status]),error:report.error,cleanupError:report.cleanupError}));
 });
