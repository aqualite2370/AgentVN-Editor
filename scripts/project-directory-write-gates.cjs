"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),crypto=require("node:crypto");
const phase=process.argv[2],attempt=process.argv[3]||"01",prerequisite=process.argv[4]||attempt;
assert(["support","build"].includes(phase));assert.match(attempt,/^\d{2}$/);assert.match(prerequisite,/^\d{2}$/);
const root=path.resolve(__dirname,".."),base="F:/AgentVN/QA/Project-Directory-Write-20261024-01";
const out=path.join(base,`${phase}-${attempt}`);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc=p=>({path:path.resolve(p),sha256:sha(p),bytes:fs.statSync(p).size,modifiedUtc:fs.statSync(p).mtime.toISOString()});
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sources=["editor/src-tauri/src/main.rs","editor/src-tauri/src/project_bundle_output.rs",
 "editor/src/components/editor/EditorToolbar.tsx","editor/src/utils/projectBundle.ts",
 "scripts/project-directory-write-native.cjs","scripts/project-directory-write-acl.ps1",
 "scripts/project-directory-output-test.cjs","scripts/project-save-native-error-playwright.cjs"].map(p=>desc(path.join(root,p)));
const report={status:"RUNNING",scope:"CURRENT_SOURCE_AND_DEV_NOT_FROZEN_INSTALLATION",phase,
 startedAt:new Date().toISOString(),modelRequests:0,sources,commands:[]};
const input=path.join(base,"red-02/isolated-small.vnproj");
assert(fs.existsSync(input));report.input=desc(input);
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
async function command(label,exe,args,extra={}){
 const temporary=path.join(out,"temporary");fs.mkdirSync(temporary,{recursive:true});
 const environment={TEMP:temporary,TMP:temporary,AGENTVN_TEST_PROJECT:input,
  AGENTVN_WORKSPACE_OUTPUT:path.join(out,label),...extra};
 const row={label,command:[exe,...args],environment,startedAt:new Date().toISOString(),status:"RUNNING",
  log:path.join(out,`${label}.log`)};report.commands.push(row);save();
 const fd=fs.openSync(row.log,"wx");
 try{
  const child=spawn(exe,args,{cwd:root,env:{...process.env,...environment},windowsHide:true,stdio:["ignore",fd,fd]});
  row.pid=child.pid;save();
  row.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
  assert.equal(row.exitCode,0,`${label}: ${row.log}`);row.status="PASS";
 }catch(e){row.status="FAILED";throw e;}
 finally{fs.closeSync(fd);row.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(row));}
}
(async()=>{
 save();
 if(phase==="support"){
  const red=read(path.join(base,"red-02/report.json"));
  assert.equal(red.status,"FAILED");assert.equal(red.cases.length,1);
  assert(red.error.includes("Directory IO failure must identify"));
  assert(red.cases[0].noFallbackNoPartialNoOverwrite&&red.restoration.status==="RESTORED"&&!red.cleanupError);
  await command("rust-output",process.execPath,["scripts/project-directory-output-test.cjs"],{
   AGENTVN_DIRECTORY_OUTPUT_TEST:path.join(out,"rust-output")});
  await command("project-directory-preferences",process.execPath,["scripts/project-export-directory-preferences-test.cjs"]);
  await command("portable-payload-contract",process.execPath,["scripts/project-save-asset-payload-contract.cjs"]);
  await command("native-error-ui",process.execPath,["scripts/project-save-native-error-playwright.cjs"],{
   AGENTVN_NATIVE_SAVE_ERROR_OUTPUT:path.join(out,"native-error-ui")});
  const rust=read(path.join(out,"rust-output/report.json")),ui=read(path.join(out,"native-error-ui/report.json"));
  assert.equal(rust.status,"PASS");assert.equal(rust.cases,3);
  assert.equal(ui.status,"PASS");assert.equal(ui.cases.length,12);
  assert(ui.cases.every(c=>c.status==="PASS"&&c.screenshot?.png.width===c.width*c.dpr));
 }else{
  const support=read(path.join(base,`support-${prerequisite}/report.json`));
  assert.equal(support.status,"PASS");assert.equal(support.commands.length,4);
  for(const f of support.sources)assert.equal(sha(f.path),f.sha256,`Source changed after direct regression: ${f.path}`);
  report.prerequisite=desc(path.join(base,`support-${prerequisite}/report.json`));
  for(const file of ["D:/AgentVN/AgentVN Dev.exe","D:/AgentVN/editor/src-tauri/binaries/agentvn-player.exe"]){
   const backup=path.join(out,"prior-products",path.basename(file));fs.mkdirSync(path.dirname(backup),{recursive:true});
   fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);assert.equal(sha(file),sha(backup));
   (report.priorProducts??=[]).push({original:desc(file),backup:desc(backup)});
  }
  await command("editor-typecheck","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run typecheck"]);
  await command("editor-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run build"]);
  await command("gamecli-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
  await command("full-dev","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
  report.dev=desc("D:/AgentVN/AgentVN Dev.exe");
  assert.equal(report.dev.sha256,sha("D:/AgentVN/editor/src-tauri/target/debug/agentvn-editor.exe"));
  assert(new Date(report.dev.modifiedUtc)>=new Date(report.commands.at(-1).startedAt));
  report.player=desc("D:/AgentVN/editor/src-tauri/binaries/agentvn-player.exe");
  assert.equal(report.player.sha256,sha("D:/AgentVN/GameCli_framework/src-tauri/target/release/agentvn-player.exe"));
  const bundled="D:/AgentVN/editor/src-tauri/bundle-workspace";
  report.bundled=[];
  for(const f of ["GameCli_framework/src-tauri/src/android_activity.rs",
   "GameCli_framework/src-tauri/src/android_activity_state.rs","GameCli_framework/src-tauri/capabilities/android-restored.json",
   "GameCli_framework/src/components/shell/RenpyTitleView.tsx","scripts/build-runtime-standalone-android.ps1"]){
   const source=desc(path.join(root,f)),copy=desc(path.join(bundled,f));assert.equal(source.sha256,copy.sha256);
   report.bundled.push({source,copy});
  }
 }
 for(const f of sources)assert.equal(sha(f.path),f.sha256);
 report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
 .finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({
  status:report.status,out,commands:report.commands.length,error:report.error}));});
