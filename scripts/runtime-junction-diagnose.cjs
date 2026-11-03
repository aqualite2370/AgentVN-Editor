"use strict";
// Replays the actual production finalize function, not a replacement rename.
// No real Player profile is moved or changed. Every C: path is a new QA sibling.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),base="F:/AgentVN/QA/Runtime-Junction-20261024-01";
const attempt=process.argv[2]||"01";assert.match(attempt,/^\d{2}$/);
const out=path.join(base,`probe-${attempt}`);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const checkpoint=`F:/AgentVN/Checkpoints/Runtime-Junction-20261024-${attempt}`;
assert(!fs.existsSync(checkpoint));fs.mkdirSync(checkpoint,{recursive:true});
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const source=path.join(root,"GameCli_framework/src-tauri/src/lib.rs"),text=fs.readFileSync(source,"utf8");
const start=text.indexOf("fn finalize_save_file("),end=text.indexOf("\nfn write_save_file(",start);
assert(start>=0&&end>start);
const production=text.slice(start,end),sources=["GameCli_framework/src-tauri/src/lib.rs",
 "GameCli_framework/src-tauri/src/save_location.rs","scripts/native-dev-preview-profile.ps1",
 "plans/ACTIVE_TASKS.md","plans/FULL_REGRESSION_20261017.md",path.relative(root,__filename)];
const entries=sources.map(relative=>{
 const file=path.join(root,relative),copy=path.join(checkpoint,"files",relative);fs.mkdirSync(path.dirname(copy),{recursive:true});
 fs.copyFileSync(file,copy,fs.constants.COPYFILE_EXCL);assert.equal(sha(file),sha(copy));return{file,copy,sha256:sha(file)};
});
const old="F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-story-1922-01/session.json";
const report={status:"RUNNING",at:new Date().toISOString(),scope:"PRODUCTION_FINALIZE_FUNCTION_PATH_DIAGNOSTIC_NOT_PLAYER_OR_INSTALLED_ACCEPTANCE",
 modelRequests:0,productChanges:0,builds:0,checkpoint,source:{path:source,sha256:sha(source)},
 originalFailure:{path:old,sha256:sha(old)},cases:[],cleanups:[],commands:[]};
fs.writeFileSync(path.join(checkpoint,"manifest.json"),JSON.stringify({at:report.at,entries,originalFailure:report.originalFailure},null,2),{flag:"wx"});
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
function command(label,exe,args){
 const r=spawnSync(exe,args,{cwd:root,encoding:"utf8",windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 const log=path.join(out,label+".log");fs.writeFileSync(log,(r.stdout||"")+"\n"+(r.stderr||""),{flag:"wx"});
 report.commands.push({label,exe,args,exitCode:r.status,log,error:r.error?.message});save();return r;
}
function ps(label,script){
 const r=command(label,"powershell.exe",["-NoProfile","-Command","[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';"+script]);
 assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout.trim().replace(/^\uFEFF/,"");
}
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const generated=path.join(out,"probe.rs"),exe=path.join(out,"probe.exe");
const code=String.raw`
use std::{fs,io::Write,path::{Path,PathBuf}};
${production}
#[link(name="kernel32")]
unsafe extern "system" { fn GetCurrentPackageFullName(length:*mut u32,buffer:*mut u16)->i32; }
fn package_identity()->String {
 let mut n=0; let status=unsafe{GetCurrentPackageFullName(&mut n,std::ptr::null_mut())};
 if status!=122 { return format!("status:{status}"); }
 let mut b=vec![0u16;n as usize]; let status=unsafe{GetCurrentPackageFullName(&mut n,b.as_mut_ptr())};
 if status!=0{return format!("status:{status}");}
 String::from_utf16_lossy(&b[..n.saturating_sub(1) as usize])
}
fn canonical(p:&Path)->String { match p.canonicalize(){Ok(v)=>v.display().to_string(),Err(e)=>format!("ERROR: {e}")} }
fn main(){
 let args:Vec<_>=std::env::args().collect(); let directory=PathBuf::from(&args[1]); let mode=&args[2];
 let target=directory.join("slot.json"); let staging=directory.join(format!("slot.{}.tmp",std::process::id()));
 let original=b"old-valid-save"; let replacement=format!("new-valid-save-{mode}");
 let mut stage="seed-original"; let mut source_canonical=String::new(); let mut target_canonical=String::new();
 let result=(||->Result<(),String>{
  if mode.starts_with("first-") {
   if target.exists(){fs::remove_file(&target).map_err(|e|e.to_string())?;}
  }else{fs::write(&target,original).map_err(|e|e.to_string())?;}
  stage="create-staging";
  let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&staging).map_err(|e|e.to_string())?;
  stage="write-flush";
  file.write_all(replacement.as_bytes()).map_err(|e|e.to_string())?;
  file.sync_all().map_err(|e|e.to_string())?; drop(file);
  source_canonical=canonical(&staging); target_canonical=canonical(&target); stage="finalize";
  if mode.ends_with("canonical") {
   let s=staging.canonicalize().map_err(|e|e.to_string())?;
   let t=directory.canonicalize().map_err(|e|e.to_string())?.join("slot.json");
   finalize_save_file(&s,&t)?;
  }else{finalize_save_file(&staging,&target)?;}
  stage="verify-bytes";
  if fs::read(&target).map_err(|e|e.to_string())?!=replacement.as_bytes(){return Err("target bytes differ".into());}
  if staging.exists(){return Err("staging file remains".into());} Ok(())
 })();
 println!("{{\"status\":{:?},\"stage\":{:?},\"error\":{:?},\"directory\":{:?},\"mode\":{:?},\"package\":{:?},\"sourceCanonical\":{:?},\"targetCanonical\":{:?},\"sourceExistsAfter\":{},\"targetBytesAfter\":{:?}}}",
 if result.is_ok(){"PASS"}else{"FAILED"},stage,result.err().unwrap_or_default(),directory.display().to_string(),mode,package_identity(),
 source_canonical,target_canonical,staging.exists(),String::from_utf8_lossy(&fs::read(&target).unwrap_or_default()).to_string());
}
`;
const slug=`AgentVN-QA-Junction-20261024-${attempt}`;
const user=process.env.USERPROFILE,cache=path.join(user,"AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache");
const tests=[
 {label:"physical-f",directory:path.join(out,"physical-f")},
 {label:"junction-f",directory:path.join(out,"junction-f"),target:path.join(out,"junction-f-target")},
 {label:"physical-c-temp",directory:path.join(user,"AppData/Local/Temp",slug)},
 {label:"junction-roaming",directory:path.join(user,"AppData/Roaming",slug+"-roaming"),target:path.join(out,"roaming-target")},
 {label:"junction-codex-roaming",directory:path.join(cache,"Roaming",slug+"-codex"),target:path.join(out,"codex-target")},
 {label:"junction-player-roaming",directory:path.join(user,"AppData/Roaming/com.agentvn.player",slug+"-player"),target:path.join(out,"player-target")},
 {label:"junction-player-codex",directory:path.join(cache,"Roaming/com.agentvn.player",slug+"-player-codex"),target:path.join(out,"player-codex-target")}
];
report.tests=tests;
(async()=>{
 save();fs.writeFileSync(generated,code,{flag:"wx"});
 const compiled=command("compile","rustc.exe",["--edition=2021",generated,"-o",exe]);assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
 for(const t of tests){
  assert(!fs.existsSync(t.directory),"Never reuse an existing QA directory");
  t.prepared=true;save(); // Journal the exact target before any mutation.
  if(t.target){
   fs.mkdirSync(t.target);
   t.linkReceipt=ps("create-"+t.label,
    `$p=${quote(t.directory)};$t=${quote(t.target)};`+
    "if(Test-Path -LiteralPath $p){throw 'Existing link boundary'};"+
    "New-Item -ItemType Junction -Path $p -Target $t | Select-Object FullName,Target,Attributes | ConvertTo-Json -Compress");
  }else fs.mkdirSync(t.directory);
  save();
  for(const mode of ["raw","canonical","first-raw","first-canonical"]){
   const r=command(t.label+"-"+mode,exe,[t.directory,mode]);assert.equal(r.status,0,r.stdout+r.stderr);
   const value=JSON.parse(r.stdout.trim());report.cases.push({label:t.label,...value});save();
  }
 }
 assert.equal(report.cases.length,28);assert.equal(sha(source),report.source.sha256);
 report.status=report.cases.every(c=>c.status==="PASS")?"PASS_DIAGNOSTIC_NO_REPRO":"REPRODUCED";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
 .finally(()=>{
  for(const t of [...tests].reverse()){
   if(!t.prepared||!fs.existsSync(t.directory))continue;
   try{
    if(t.target){
     const r=ps("cleanup-"+t.label,`$p=${quote(t.directory)};$t=${quote(t.target)};`+
      "$i=Get-Item -LiteralPath $p -Force;"+
      "if(-not($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -or "+
      "[IO.Path]::GetFullPath([string]$i.Target) -ne [IO.Path]::GetFullPath($t)){throw 'Link identity mismatch'};"+
      "$i.Delete();if(Test-Path -LiteralPath $p){throw 'Link remains'};'REMOVED_OWNED_LINK_ONLY'");
     report.cleanups.push({label:t.label,status:"PASS",detail:r,targetPreserved:true});
    }else if(t.label==="physical-c-temp"){
     // Flat, freshly created QA directory only. Archive all bytes before
     // removing individual files; no recursive deletion or user profile moves.
     assert.equal(path.basename(t.directory),slug);assert(!fs.lstatSync(t.directory).isSymbolicLink());
     const archive=path.join(out,"c-temp-artifacts");fs.mkdirSync(archive);
     for(const name of fs.readdirSync(t.directory)){
      assert(/^(slot\.json|slot\.\d+\.tmp)$/.test(name),"Unexpected file; preserve the directory");
      const file=path.join(t.directory,name),copy=path.join(archive,name);
      assert(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink());
      fs.copyFileSync(file,copy,fs.constants.COPYFILE_EXCL);assert.equal(sha(file),sha(copy));fs.unlinkSync(file);
     }
     fs.rmdirSync(t.directory);report.cleanups.push({label:t.label,status:"PASS",archived:archive});
    }
   }catch(e){report.status="FAILED";(report.cleanupErrors??=[]).push({label:t.label,error:String(e.stack||e)});process.exitCode=1;}
  }
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,out,cases:report.cases,error:report.error,cleanupErrors:report.cleanupErrors}));
 });
