"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawn,execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),phase=process.argv[2];
assert(["checkpoint","support","build"].includes(phase));
const attempt=process.argv[3]||"01";
assert(attempt==="01"||(phase==="build"&&["02","03"].includes(attempt)));
const base="F:/AgentVN/QA/Runtime-SavePage-Handoff-20261024-01";
const checkpoint="F:/AgentVN/Checkpoints/Runtime-SavePage-Handoff-20261024-01";
const out=phase==="checkpoint"?checkpoint:path.join(base,`${phase}-${attempt}`);
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const sha=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc=file=>({path:path.resolve(file),sha256:sha(file),bytes:fs.statSync(file).size,modifiedUtc:fs.statSync(file).mtime.toISOString()});
const previous=read("F:/AgentVN/QA/Runtime-SavePage-Time-20261024-01/build-01/report.json");
assert.equal(previous.status,"PASS");
const sourcePaths=["GameCli_framework/src/components/shell/SavePageTransition.tsx",
  "GameCli_framework/src/components/shell/SaveLoadScreen.tsx","GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/app/runtimePageCrossfade.ts","GameCli_framework/src/components/common/OpeningScreen.tsx",
  "GameCli_framework/src/styles/shell.css","GameCli_framework/src/styles/variables.css"];
const report={status:"RUNNING",phase,startedAt:new Date().toISOString(),modelRequests:0,commands:[],
  scope:"RUNTIME_SAVE_PAGE_AND_MENU_HANDOFF_NOT_INSTALLATION_OR_ANDROID",
  sources:sourcePaths.map(file=>desc(path.join(root,file))),frozen:previous.frozen};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const unchanged=files=>files.forEach(file=>assert.equal(sha(file.path),file.sha256,file.path));
async function command(label,exe,args,overrides={}){
  const row={label,command:[exe,...args],overrides,status:"RUNNING",startedAt:new Date().toISOString(),log:path.join(out,`${label}.log`)};
  report.commands.push(row);save();const fd=fs.openSync(row.log,"wx");
  try{
    const child=spawn(exe,args,{cwd:root,windowsHide:true,stdio:["ignore",fd,fd],env:{...process.env,
      AGENTVN_TEST_PROJECT:"F:/AgentVN/QA/Project-Directory-Write-20261024-01/red-02/isolated-small.vnproj",
      AGENTVN_WORKSPACE_OUTPUT:out,...overrides}});
    row.pid=child.pid;save();
    row.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
    assert.equal(row.exitCode,0,row.log);row.status="PASS";
  }catch(error){row.status="FAILED";throw error;}
  finally{fs.closeSync(fd);row.finishedAt=new Date().toISOString();save();console.log(label+" "+row.status);}
}
(async()=>{
  save();unchanged(report.frozen);
  // Preserve the already-fixed clock and its independent motion design.
  unchanged(previous.sources.filter(s=>!/SaveLoadScreen/.test(s.path)));
  if(phase==="checkpoint"){
    const red=read(path.join(base,"red-03/report.json"));
    assert.equal(red.status,"FAILED");assert.equal(red.cases.length,4);
    assert(red.cases.every(c=>c.status==="FAILED"));
    const native="F:/AgentVN/QA/Native-Runtime-State-20261020-01/save-page-native-time01-01/report.json";
    assert.equal(read(native).status,"FAILED");
    report.priorFailures=["red-01","red-02","red-03"].map(name=>desc(path.join(base,name,"report.json"))).concat(desc(native));
    report.copies=[];
    const files=[...sourcePaths,"AGENTS.md","plans/ACTIVE_TASKS.md","plans/FULL_REGRESSION_20261017.md",
      "scripts/runtime-save-page-handoff-regression.cjs","scripts/runtime-save-page-handoff-stage-gates.cjs",
      "scripts/runtime-save-page-native-playwright.cjs","scripts/runtime-save-page-native-audit.cjs",
      "scripts/lib/save-page-native-build-evidence.cjs","scripts/lib/save-page-native-preview-session.cjs",
      "scripts/runtime-screen-polish-playwright.cjs"];
    for(const relative of files){
      const file=path.join(root,relative),copy=path.join(out,"files",relative);
      fs.mkdirSync(path.dirname(copy),{recursive:true});fs.copyFileSync(file,copy,fs.constants.COPYFILE_EXCL);
      report.copies.push({source:desc(file),copy:desc(copy)});
    }
    for(const file of [previous.dev,previous.player]){
      assert.equal(sha(file.path),file.sha256);
      const copy=path.join(out,path.basename(file.path));fs.copyFileSync(file.path,copy,fs.constants.COPYFILE_EXCL);
      report.copies.push({source:desc(file.path),copy:desc(copy)});
    }
    fs.writeFileSync(path.join(out,"tracked.patch"),execFileSync("git",["-c","core.safecrlf=false","diff","--binary","HEAD"],
      {cwd:root,maxBuffer:192*1024*1024,stdio:["ignore","pipe","pipe"]}),{flag:"wx"});
  }else{
    const saved=read(path.join(checkpoint,"report.json"));assert.equal(saved.status,"PASS");
    unchanged(saved.copies.map(c=>c.copy));
    if(phase==="support"){
      await command("handoff-green",process.execPath,["scripts/runtime-save-page-handoff-regression.cjs","green-01"]);
      await command("runtime-pagination-matrix",process.execPath,
        ["scripts/runtime-screen-polish-playwright.cjs","matrix-03","--matrix","--motion-supplement"]);
      const matrixFile="F:/AgentVN/QA/Runtime-Screen-Polish-20261022-01/matrix-03/report.json",matrix=read(matrixFile);
      assert.equal(matrix.status,"PASS");assert.equal(matrix.cases.length,48);
      assert(matrix.cases.every(c=>c.status==="PASS"));assert.equal(matrix.contexts.length,24);
      assert(matrix.contexts.every(c=>c.closed&&JSON.stringify(c.before)===JSON.stringify(c.after)));
      report.matrix=desc(matrixFile);
      for(const reduced of [false,true]) await command(`renpy-menu-${reduced?"reduced":"normal"}`,process.execPath,
        ["scripts/runtime-menu-motion-playwright.cjs"],{
          AGENTVN_RUNTIME_MENU_MOTION_OUTPUT:path.join(out,`renpy-${reduced?"reduced":"normal"}`),
          RUNTIME_MOTION_VIEWPORTS:"1080p,1440p,4k",RUNTIME_MOTION_DPR:"1",
          RUNTIME_MOTION_REDUCED:reduced?"1":"0"});
      for(const file of ["runtime-save-queue-test","runtime-exit-flow-test","runtime-screen-transition-contract"])
        await command(file,process.execPath,[`scripts/${file}.cjs`]);
    }else{
      const support=read(path.join(base,"support-01/report.json"));assert.equal(support.status,"PASS");
      assert.equal(support.commands.length,7);assert(support.commands.every(c=>c.status==="PASS"&&c.exitCode===0));
      unchanged(support.sources);unchanged([support.matrix]);
      if(attempt!=="01"){
        const failedFile=path.join(base,"build-01/report.json"),failed=read(failedFile);
        assert.equal(failed.status,"FAILED");assert.equal(failed.commands.length,4);
        assert.equal(failed.commands[3].label,"full-dev");assert.equal(failed.commands[3].status,"FAILED");
        assert.match(fs.readFileSync(failed.commands[3].log,"utf8").replace(/\r?\n/g,""),/user-mapped section open/);
        unchanged(failed.sources);
        const diagnosticFile=path.join(base,"runtime-mode-lock-01.json"),diagnostic=read(diagnosticFile);
        assert.equal(diagnostic.exclusiveNontruncatingOpen,"PASS");assert.equal(diagnostic.owners.length,0);
        assert.equal(diagnostic.beforeSha256,diagnostic.afterSha256);
        assert.equal(sha(diagnostic.file),diagnostic.afterSha256);
        report.recovery={failedReport:desc(failedFile),diagnostic:desc(diagnosticFile),
          noProcessKilled:true,sourceBytesUnchanged:true};
        for(const old of failed.commands.slice(0,3)){
          assert.equal(old.status,"PASS");assert.equal(old.exitCode,0);
          report.commands.push({...old,reusedFrom:desc(failedFile),logIdentity:desc(old.log),executedThisAttempt:false});
        }
        assert.deepEqual(report.commands.map(c=>c.label),["editor-typecheck","editor-build","gamecli-build"]);save();
      }else{
        await command("editor-typecheck","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run typecheck"]);
        await command("editor-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run build"]);
        await command("gamecli-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
      }
      await command("full-dev","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
      report.dev=desc(path.join(root,"AgentVN Dev.exe"));
      report.player=desc(path.join(root,"editor/src-tauri/binaries/agentvn-player.exe"));
      assert.equal(report.dev.sha256,sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")));
      assert.equal(report.player.sha256,sha(path.join(root,"GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
      report.bundled=report.sources.map(file=>{
        const copy=desc(path.join(root,"editor/src-tauri/bundle-workspace",path.relative(root,file.path)));
        assert.equal(copy.sha256,file.sha256);return copy;});
    }
  }
  unchanged(report.sources);unchanged(report.frozen);report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({phase,status:report.status,out,error:report.error}));});
