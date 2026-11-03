"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const crypto=require("node:crypto"),{spawn,spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),label="Native-Dev-Preview-Repair-20261020-01";
const qa=`F:/AgentVN/QA/${label}`,mode=process.argv[2];
assert(["prebuild","dev"].includes(mode));
const iteration=process.argv[3]||"01";assert(/^\d{2}$/.test(iteration));
const out=path.join(qa,`${mode}-${iteration}`);assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc=f=>({path:path.resolve(f),sha256:sha(f),bytes:fs.statSync(f).size,modifiedAt:fs.statSync(f).mtime.toISOString()});
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const prep=read(path.join(root,"output",label.toLowerCase(),"preparation.json"));
const report={status:"RUNNING",at:new Date().toISOString(),mode,steps:[],
  sources:prep.sources.map(p=>desc(p.path)),modelRequests:0,installs:0,
  artifactsBefore:prep.products.map(p=>desc(p.path))};
const persist=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const temporary=path.join(out,"temporary");fs.mkdirSync(temporary);
const env={...process.env,TEMP:temporary,TMP:temporary,AGENTVN_WORKSPACE_OUTPUT:path.join(out,"browser-evidence"),PSModulePath:[
  path.join(process.env.USERPROFILE,"Documents/WindowsPowerShell/Modules"),
  path.join(process.env.ProgramFiles,"WindowsPowerShell/Modules"),
  path.join(process.env.SystemRoot,"System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter)};
async function command(name,exe,args,environment=env,cargo=false){
  const step={name,command:[exe,...args],at:new Date().toISOString(),status:"RUNNING",
    stdout:path.join(out,`${name}.stdout.log`),stderr:path.join(out,`${name}.stderr.log`)};
  report.steps.push(step);persist();console.log(`START ${name}`);
  const o=fs.createWriteStream(step.stdout,{flags:"wx"}),e=fs.createWriteStream(step.stderr,{flags:"wx"});
  let stdout="",stderr="";
  try{
    const child=spawn(exe,args,{cwd:root,env:environment,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    step.pid=child.pid;persist();
    child.stdout.on("data",b=>{stdout+=b.toString();o.write(b);});
    child.stderr.on("data",b=>{stderr+=b.toString();e.write(b);});
    const result=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",(exitCode,signal)=>resolve({exitCode,signal}));});
    Object.assign(step,result);assert.equal(result.exitCode,0,`${name}\n${stderr.slice(-4000)}\n${stdout.slice(-2500)}`);
    if(cargo){
      const suites=[...stdout.matchAll(/test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored/g)]
        .map(m=>({status:m[1],passed:+m[2],failed:+m[3],ignored:+m[4]}));
      assert(suites.length&&suites.every(s=>s.status==="ok"&&s.failed===0)&&suites.reduce((n,s)=>n+s.passed,0)>0);
      step.suites=suites;
    }
    step.status="PASS";console.log(`PASS ${name}`);return stdout;
  }catch(err){step.status="FAILED";step.error=String(err.stack||err);throw err;}
  finally{await Promise.all([new Promise(r=>o.end(r)),new Promise(r=>e.end(r))]);step.finishedAt=new Date().toISOString();persist();}
}
(async()=>{
  fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);
  if(mode==="prebuild"){
    const msvc=JSON.parse((await command("msvc","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
      "scripts/resolve-msvc-environment.ps1","-Json"])).replace(/^\uFEFF/,""));
    assert.equal(msvc.status,"PASS");
    const buildEnv={...env,...msvc.environment,TEMP:temporary,TMP:temporary,PSModulePath:env.PSModulePath};
    for(const filter of ["owned_process","preview_process"])await command(`cargo-${filter}`,"cargo",[
      "test","--offline","--locked","--manifest-path","editor/src-tauri/Cargo.toml","--bin","agentvn-editor",filter,"--","--nocapture"],buildEnv,true);
    for(const test of ["gamecli-preview-protocol-contract","gamecli-preview-upload-contract-test","gamecli-preview-directory-contract",
      "gamecli-preview-progress-ui-contract","preview-save-isolation-contract","runtime-exit-flow-test","runtime-save-queue-test",
      "preview-cancellation-evidence-test","preview-entry-path-test","live-scene-preview-engine-test","runtime-preview-transition-contract"])
      await command(test,process.execPath,[`scripts/${test}.cjs`],buildEnv);
    for(const [dir,target]of [["editor","typecheck"],["editor","build"],["GameCli_framework","build"]])
      await command(`${dir}-${target}`,process.env.ComSpec||"cmd.exe",["/d","/s","/c",`npm --prefix D:\\AgentVN\\${dir} run ${target}`],buildEnv);
    for(const p of report.artifactsBefore)assert.equal(sha(p.path),p.sha256,"Test-only targets must not change delivered EXEs");
    report.status="PREBUILD_PASS";
  }else{
    const gates=read(path.join(qa,`prebuild-${process.env.AGENTVN_QA_PREBUILD_ITERATION||"01"}/report.json`));assert.equal(gates.status,"PREBUILD_PASS");
    assert.equal(gates.steps.length,17);assert(gates.steps.every(s=>s.status==="PASS"));
    for(const p of gates.sources)assert.equal(sha(p.path),p.sha256);
    await command("complete-dev-build","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    report.artifactsAfter=prep.products.map(p=>desc(p.path));
    assert.equal(report.artifactsAfter[0].sha256,report.artifactsAfter[1].sha256);
    assert.notEqual(report.artifactsAfter[0].sha256,prep.products[0].sha256);
    assert(Date.parse(report.artifactsAfter[0].modifiedAt)>Date.parse(report.at));
    const player=desc(path.join(root,"GameCli_framework/src-tauri/target/release/agentvn-player.exe"));
    assert.equal(player.sha256,report.artifactsAfter[2].sha256);report.actualPlayer=player;
    const verified={...prep,status:"VERIFIED_POST_BUILD",products:report.artifactsAfter,
      sources:prep.sources.map(p=>desc(p.path)),buildReport:path.join(out,"report.json"),buildReportAt:report.at};
    fs.writeFileSync(path.join(qa,"verified-build.json"),JSON.stringify(verified,null,2),{flag:"wx"});
    report.status="DEV_BUILD_AND_ACTUAL_REPLACEMENT_PASS";
  }
  for(const p of report.sources)assert.equal(sha(p.path),p.sha256);
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);console.error(report.error);process.exitCode=1;})
.finally(()=>{report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({status:report.status,out,steps:report.steps.length}));});
