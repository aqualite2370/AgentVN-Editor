"use strict";
// Current-source/Dev gates; never reclassify the sealed installation.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const crypto=require("node:crypto"),{spawn,execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),phase=process.argv[2],attempt=process.argv[3]||"01";
assert(["support","build"].includes(phase));assert.match(attempt,/^\d{2}$/);
const base="F:/AgentVN/QA/Runtime-Junction-20261024-01",out=path.join(base,`${phase}-${attempt}`);
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc=p=>({path:path.resolve(p),sha256:sha(p),bytes:fs.statSync(p).size,modifiedUtc:fs.statSync(p).mtime.toISOString()});
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sources=["GameCli_framework/src-tauri/src/lib.rs","GameCli_framework/src-tauri/src/save_location.rs",
 "GameCli_framework/src-tauri/src/portable_save_migration.rs","GameCli_framework/src/utils/runtimeSaveQueue.ts",
 "scripts/runtime-junction-rust-regression.cjs","scripts/runtime-junction-stage-gates.cjs",
 "scripts/runtime-save-queue-test.cjs","scripts/runtime-exit-flow-test.cjs","scripts/runtime-terminal-save-test.cjs"]
 .map(p=>desc(path.join(root,p)));
const report={status:"RUNNING",scope:"CURRENT_SOURCE_AND_DEV_NOT_FROZEN_INSTALLATION",phase,
 startedAt:new Date().toISOString(),modelRequests:0,sources,commands:[]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
async function command(label,exe,args,cwd=root){
 const temporary=path.join(out,"temporary");fs.mkdirSync(temporary,{recursive:true});
 const row={label,command:[exe,...args],cwd,status:"RUNNING",startedAt:new Date().toISOString(),log:path.join(out,label+".log")};
 report.commands.push(row);save();
 const fd=fs.openSync(row.log,"wx");
 try{
  const child=spawn(exe,args,{cwd,env:{...process.env,TEMP:temporary,TMP:temporary},
   windowsHide:true,stdio:["ignore",fd,fd]});row.pid=child.pid;save();
  row.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
  assert.equal(row.exitCode,0,`${label}: ${row.log}`);row.status="PASS";
 }catch(e){row.status="FAILED";throw e;}
 finally{fs.closeSync(fd);row.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(row));}
}
(async()=>{
 save();
 const redPath=path.join(base,"rust-red-01/report.json"),greenPath=path.join(base,"rust-green-01/report.json");
 const red=read(redPath),green=read(greenPath);
 assert.equal(red.status,"FAILED");assert.match(fs.readFileSync(path.join(base,"rust-red-01/rust.log"),"utf8"),/Cannot finalize save file:.*os error 3/);
 assert.equal(green.status,"PASS");assert.equal(green.files.length,3);
 assert.equal(read(green.restoration.path).status,"PASS");assert.equal(sha(green.source.path),green.source.sha256);
 report.red=desc(redPath);report.green=desc(greenPath);
 if(phase==="support"){
  await command("rust-library","cargo.exe",["test","--offline","--locked","--lib","--","--test-threads=1"],
   path.join(root,"GameCli_framework/src-tauri"));
  assert.match(fs.readFileSync(report.commands[0].log,"utf8"),/test result: ok\. 28 passed; 0 failed; 1 ignored/);
  for(const name of ["runtime-save-queue","runtime-exit-flow","runtime-terminal-save"])
   await command(name,process.execPath,[`scripts/${name}-test.cjs`]);
 }else{
  const supportPath=path.join(base,`support-${attempt}/report.json`),support=read(supportPath);
  assert.equal(support.status,"PASS");assert.equal(support.commands.length,4);
  for(const f of support.sources)assert.equal(sha(f.path),f.sha256);
  report.prerequisite=desc(supportPath);
  const checkpoint=`F:/AgentVN/Checkpoints/Runtime-Junction-20261024-build-${attempt}`;
  assert(!fs.existsSync(checkpoint));fs.mkdirSync(checkpoint,{recursive:true});
  report.checkpoint=checkpoint;
  for(const f of [...sources,...["AGENTS.md","plans/ACTIVE_TASKS.md","plans/FULL_REGRESSION_20261017.md"].map(p=>desc(path.join(root,p)))]){
   const target=path.join(checkpoint,"files",path.relative(root,f.path));fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.copyFileSync(f.path,target,fs.constants.COPYFILE_EXCL);assert.equal(sha(target),f.sha256);
  }
  fs.writeFileSync(path.join(checkpoint,"working-tree.patch"),execFileSync("git",["diff","--binary"],
   {cwd:root,maxBuffer:64*1024*1024}),{flag:"wx"});
  report.priorProducts=[];
  for(const p of ["AgentVN Dev.exe","editor/src-tauri/binaries/agentvn-player.exe"]){
   const f=desc(path.join(root,p)),copy=path.join(checkpoint,"prior-products",path.basename(p));
   fs.mkdirSync(path.dirname(copy),{recursive:true});fs.copyFileSync(f.path,copy,fs.constants.COPYFILE_EXCL);
   assert.equal(sha(copy),f.sha256);report.priorProducts.push({original:f,backup:desc(copy)});
  }
  fs.writeFileSync(path.join(checkpoint,"manifest.json"),JSON.stringify({sources,priorProducts:report.priorProducts,
   preFixCheckpoint:"F:/AgentVN/Checkpoints/Runtime-Junction-20261024-native-01",
   red:report.red,green:report.green},null,2),{flag:"wx"});save();
  await command("editor-typecheck","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run typecheck"]);
  await command("editor-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run build"]);
  await command("gamecli-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
  await command("full-dev","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
  report.dev=desc(path.join(root,"AgentVN Dev.exe"));
  assert.equal(report.dev.sha256,sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")));
  assert(new Date(report.dev.modifiedUtc)>=new Date(report.commands.at(-1).startedAt));
  report.player=desc(path.join(root,"editor/src-tauri/binaries/agentvn-player.exe"));
  assert.equal(report.player.sha256,sha(path.join(root,"GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
  report.bundled=[];
  for(const f of ["GameCli_framework/src-tauri/src/lib.rs","GameCli_framework/src-tauri/src/save_location.rs",
   "GameCli_framework/src-tauri/src/portable_save_migration.rs"]){
   const source=desc(path.join(root,f)),copy=desc(path.join(root,"editor/src-tauri/bundle-workspace",f));
   assert.equal(source.sha256,copy.sha256);report.bundled.push({source,copy});
  }
 }
 for(const f of sources)assert.equal(sha(f.path),f.sha256);
 report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
 .finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({
  status:report.status,out,commands:report.commands.length,error:report.error}));});
