"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawn,execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),phase=process.argv[2],attempt=process.argv[3]||"01";
assert(["checkpoint","support","build"].includes(phase));
assert(["01","02"].includes(attempt),"Explicit supported fresh attempt required");
const followup=attempt==="02";
const base="F:/AgentVN/QA/Runtime-Save-Grid-Fit-20261024-01",
  checkpoint=`F:/AgentVN/Checkpoints/Runtime-Save-Grid-Fit-20261024-${attempt}`;
const out=phase==="checkpoint"?checkpoint:path.join(base,`${phase}-${attempt}`);
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const sha=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc=file=>({path:path.resolve(file),sha256:sha(file),bytes:fs.statSync(file).size,modifiedUtc:fs.statSync(file).mtime.toISOString()});
const previous=read("F:/AgentVN/QA/Runtime-SavePage-Handoff-20261024-01/build-03/report.json");
assert.equal(previous.status,"PASS");
const sourcePaths=["GameCli_framework/src/components/shell/SaveLoadScreen.tsx","GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/components/shell/SavePageTransition.tsx","GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/app/runtimePageCrossfade.ts","GameCli_framework/src/components/common/OpeningScreen.tsx"];
const report={status:"RUNNING",phase,startedAt:new Date().toISOString(),modelRequests:0,commands:[],
  scope:"RUNTIME_SIX_SAVE_SLOTS_SOURCE_AND_DEV_NOT_INSTALLATION_OR_ANDROID",
  sources:sourcePaths.map(file=>desc(path.join(root,file))),frozen:previous.frozen};
const toolPaths=["scripts/runtime-screen-polish-playwright.cjs","scripts/runtime-save-grid-fit-stage-gates.cjs",
  ...(followup?["scripts/runtime-save-preview-image-fit-regression.cjs","scripts/browser-viewport-capture-regression.cjs",
    "scripts/lib/browser-viewport-capture.cjs","scripts/lib/current-native-capture.cjs"]:[])];
report.tools=toolPaths.map(file=>desc(path.join(root,file)));
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
  unchanged(previous.sources.filter(s=>!/SaveLoadScreen\.tsx$|shell\.css$/.test(s.path)));
  if(phase==="checkpoint"){
    const redFile="F:/AgentVN/QA/Runtime-Screen-Polish-20261022-01/red-03/report.json",red=read(redFile);
    assert.equal(red.status,"FAILED");assert.equal(red.cases.length,4);
    assert.equal(red.cases.filter(c=>c.status==="FAILED").length,3);
    assert.equal(red.contexts.length,2);assert(red.contexts.every(c=>c.closed));
    report.red=desc(redFile);report.copies=[];
    if(followup){
      const imageFile=path.join(base,"image-red-01/report.json"),image=read(imageFile);
      assert.equal(image.status,"FAILED");assert.equal(image.cases.length,2);
      assert(image.cases.every(c=>c.status==="FAILED"&&c.geometry.image.bottom>c.geometry.frame.bottom));
      report.imageRed=desc(imageFile);
      const priorSupport=read(path.join(base,"support-01/report.json"));
      assert.equal(priorSupport.status,"FAILED");
      report.priorSupport=desc(path.join(base,"support-01/report.json"));
    }
    for(const file of [...sourcePaths,"AGENTS.md","plans/ACTIVE_TASKS.md","plans/FULL_REGRESSION_20261017.md",
      ...toolPaths]){
      const source=path.join(root,file),copy=path.join(out,"files",file);
      fs.mkdirSync(path.dirname(copy),{recursive:true});fs.copyFileSync(source,copy,fs.constants.COPYFILE_EXCL);
      report.copies.push({source:desc(source),copy:desc(copy)});
    }
    for(const file of [previous.dev,previous.player]){
      assert.equal(sha(file.path),file.sha256);
      const copy=path.join(out,path.basename(file.path));fs.copyFileSync(file.path,copy,fs.constants.COPYFILE_EXCL);
      report.copies.push({source:desc(file.path),copy:desc(copy)});
    }
    fs.writeFileSync(path.join(out,"tracked.patch"),execFileSync("git",["-c","core.safecrlf=false","diff","--binary","HEAD"],
      {cwd:root,maxBuffer:192*1024*1024,stdio:["ignore","pipe","pipe"]}),{flag:"wx"});
  }else{
    const saved=read(path.join(checkpoint,"report.json"));assert.equal(saved.status,"PASS");unchanged(saved.copies.map(c=>c.copy));
    if(phase==="support"){
      if(followup){
        await command("browser-capture-selfcheck",process.execPath,["scripts/browser-viewport-capture-regression.cjs","green-03"]);
        await command("image-intrinsic-track",process.execPath,["scripts/runtime-save-preview-image-fit-regression.cjs","green-02"]);
      }
      const matrixAttempt=followup?"matrix-06":"matrix-04";
      await command("six-slot-full-matrix",process.execPath,
        ["scripts/runtime-screen-polish-playwright.cjs",matrixAttempt,"--matrix","--grid-fit"]);
      const matrixFile=`F:/AgentVN/QA/Runtime-Screen-Polish-20261022-01/${matrixAttempt}/report.json`,matrix=read(matrixFile);
      assert.equal(matrix.status,"PASS");assert.equal(matrix.cases.length,48);assert.equal(matrix.screenshots.length,48);
      assert(matrix.cases.every(c=>c.status==="PASS"));assert.equal(matrix.contexts.length,24);
      assert(matrix.contexts.every(c=>c.closed&&JSON.stringify(c.before)===JSON.stringify(c.after)));
      report.matrix=desc(matrixFile);
      await command("two-column-authored-grid",process.execPath,
        ["scripts/runtime-screen-polish-playwright.cjs",followup?"green-10":"green-07","--grid-fit","--two-columns"]);
      await command("pagination-motion-matrix",process.execPath,
        ["scripts/runtime-screen-polish-playwright.cjs",followup?"matrix-07":"matrix-05","--matrix","--motion-supplement"]);
      for(const file of ["runtime-save-queue-test","runtime-exit-flow-test","runtime-screen-transition-contract"])
        await command(file,process.execPath,[`scripts/${file}.cjs`]);
    }else{
      const support=read(path.join(base,`support-${attempt}/report.json`));assert.equal(support.status,"PASS");
      assert.equal(support.commands.length,followup?8:6);assert(support.commands.every(c=>c.status==="PASS"&&c.exitCode===0));
      unchanged(support.sources);unchanged(support.tools);unchanged([support.matrix]);
      await command("editor-typecheck","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run typecheck"]);
      await command("editor-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run build"]);
      await command("gamecli-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
      await command("full-dev","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
      report.dev=desc(path.join(root,"AgentVN Dev.exe"));report.player=desc(path.join(root,"editor/src-tauri/binaries/agentvn-player.exe"));
      assert.equal(report.dev.sha256,sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")));
      assert.equal(report.player.sha256,sha(path.join(root,"GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
      report.bundled=report.sources.map(file=>{const copy=desc(path.join(root,"editor/src-tauri/bundle-workspace",path.relative(root,file.path)));
        assert.equal(copy.sha256,file.sha256);return copy;});
    }
  }
  unchanged(report.sources);unchanged(report.tools);unchanged(report.frozen);report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({phase,status:report.status,out,error:report.error}));});
