"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process"),crypto=require("node:crypto");
const out=path.resolve(process.env.AGENTVN_DIRECTORY_OUTPUT_TEST||"");
assert(out.toLowerCase().startsWith("f:\\agentvn\\qa\\project-directory-write-20261024-01\\")&&!fs.existsSync(out));
fs.mkdirSync(out,{recursive:true});
const source=path.resolve(__dirname,"../editor/src-tauri/src/project_bundle_output.rs");
const report={status:"RUNNING",scope:"ACTUAL_PRODUCTION_RUST_OUTPUT_HELPER_REAL_IO_NOT_NATIVE_HOST",
 source,sha256:crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"),commands:[]};
try{
 const executable=path.join(out,"test.exe");
 for(const [exe,args]of [["rustc.exe",["--edition=2021","--test",source,"-o",executable]],[executable,["--test-threads=1"]]]){
  const r=spawnSync(exe,args,{encoding:"utf8",windowsHide:true,timeout:60000,
   env:{...process.env,TEMP:out,TMP:out}});
  fs.writeFileSync(path.join(out,`command-${report.commands.length+1}.log`),(r.stdout||"")+"\n"+(r.stderr||""),{flag:"wx"});
  report.commands.push({exe,args,exitCode:r.status,error:r.error?.message});assert.equal(r.status,0,r.stdout+r.stderr);
  if(exe===executable)assert.match(r.stdout,/test result: ok\. 3 passed; 0 failed/);
 }
 report.status="PASS";report.cases=3;
}catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
