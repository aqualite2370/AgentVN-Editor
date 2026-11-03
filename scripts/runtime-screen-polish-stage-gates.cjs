"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {spawn}=require("node:child_process");
const {fixture}=require("./lib/editor-ui-acceptance.cjs");
const {collectStageResourceEvidence}=require("./lib/stage-resource-evidence.cjs");
const root=path.resolve(__dirname,".."),qa="F:/AgentVN/QA/Runtime-Screen-Polish-20261022-01";
const [matrixName,name]=process.argv.slice(2);assert(/^matrix-\d{2}$/.test(matrixName||"")&&/^gates-\d{2}$/.test(name||""));
const out=path.join(qa,name);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const matrixFile=path.join(qa,matrixName,"report.json"),matrix=JSON.parse(fs.readFileSync(matrixFile));
const report={status:"RUNNING",at:new Date().toISOString(),scope:"RUNTIME_SOURCE_BROWSER_AND_EDITOR_DEV_NOT_RELEASE_OR_DEVICE",
  modelRequests:0,matrix:{path:matrixFile,sha256:sha(matrixFile)},sources:matrix.sources,steps:[]};
const persist=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const resumeName=process.argv.find(s=>s.startsWith("--resume="))?.split("=")[1];
let previous;
if(resumeName){assert(/^gates-\d{2}$/.test(resumeName)&&resumeName!==name);previous=JSON.parse(fs.readFileSync(path.join(qa,resumeName,"report.json")));
  assert.equal(previous.status,"FAILED");assert.equal(previous.matrix.sha256,report.matrix.sha256);
  for(const source of previous.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);}
async function run(label,command,args,env={}) {
  const old=previous?.steps.find(s=>s.label===label&&s.status==="PASS");
  if(old){
    assert.deepEqual(old.command,[command,...args]);assert.deepEqual(old.overrides,env);
    for(const file of args.filter(s=>s.endsWith(".cjs")))assert(fs.statSync(path.join(root,file)).mtimeMs<=Date.parse(old.finishedAt));
    if(old.evidence)assert.equal(sha(old.evidence.path),old.evidence.sha256);
    report.steps.push({...old,reusedFrom:path.join(qa,resumeName,"report.json"),executedThisAttempt:false});persist();console.log(`REUSE PASS ${label}`);return;
  }
  const dir=path.join(out,label);fs.mkdirSync(dir,{recursive:true});
  const input=path.join(dir,"isolated.vnproj");fs.writeFileSync(input,JSON.stringify(fixture(`screen-polish-${name}-${label}`)),{flag:"wx"});
  const output=path.join(dir,"evidence"),step={label,command:[command,...args],status:"RUNNING",at:new Date().toISOString(),
    log:path.join(dir,"command.log"),overrides:env,isolation:{input,output},executedThisAttempt:true};
  for(const file of args.filter(s=>s.endsWith(".cjs")))fs.copyFileSync(path.join(root,file),path.join(dir,path.basename(file)),fs.constants.COPYFILE_EXCL);
  report.steps.push(step);persist();console.log(`START ${label}`);
  const log=fs.createWriteStream(step.log,{flags:"wx"});
  step.exitCode=await new Promise(resolve=>{
    const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,
      AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:output,AGENTVN_QA_OUTPUT:output,
      AGENTVN_RUNTIME_MENU_MOTION_OUTPUT:output,AGENTVN_RUNTIME_EXIT_OUTPUT:output,
      RUNTIME_QA_GPU:"1",PROFILE_DPR:"1",PROFILE_REDUCED:"",PROFILE_VIEWPORTS:"[[1920,1080],[2560,1440],[3840,2160]]",
      RUNTIME_MOTION_VIEWPORTS:"1080p,1440p,4k",RUNTIME_MOTION_DPR:"1",RUNTIME_MOTION_REDUCED:"",
      RENPY_MENU_FAST:"",EXIT_FAST:"",EXIT_VIEWPORTS:"1920x1080,2560x1440,3840x2160",...env}});
    step.pid=child.pid;child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    child.on("error",e=>step.error=String(e));child.on("close",code=>log.end(()=>resolve(code)));
  });
  step.status=step.exitCode===0?"PASS":"FAILED";step.finishedAt=new Date().toISOString();persist();
  assert.equal(step.exitCode,0,`${label} failed; do not build Dev`);
  if(args.some(file=>file.endsWith("playwright.cjs"))){
    const file=path.join(output,"report.json"),evidence=JSON.parse(fs.readFileSync(file));
    assert.equal(evidence.status,"PASS");assert(evidence.cases.length>0);
    assert(evidence.cases.every(row=>row.status==="PASS"));
    step.evidence={path:file,sha256:sha(file),cases:evidence.cases.length};persist();
  }
  console.log(`PASS ${label}`);
}
(async()=>{
  assert.equal(matrix.status,"PASS");assert.equal(matrix.cleanup.status,"PASS");assert.equal(matrix.cases.length,168);
  assert.equal(matrix.screenshots.length,24);assert(matrix.cases.every(row=>row.status==="PASS"));
  const combinations=new Set(matrix.cases.map(c=>[c.width,c.height,c.dpr,c.reduced,c.type].join(":")));
  assert.equal(combinations.size,24);
  for(const source of report.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);
  const installer=path.join(root,"releases/editor/AgentVN_Editor_v1.9.21_20261022_005853.exe");
  const database=path.join(process.env.APPDATA,"com.agentvn.editor/backend/vn_engine.db");
  report.installer={path:installer,sha256:sha(installer)};report.database={path:database,sha256:sha(database)};
  report.devBefore={path:path.join(root,"AgentVN Dev.exe"),sha256:sha(path.join(root,"AgentVN Dev.exe"))};persist();
  for(const test of ["runtime-save-queue-test","runtime-exit-flow-test","runtime-system-back-test","runtime-window-close-test",
    "runtime-terminal-save-test","runtime-screen-transition-contract","main-menu-exit-contract"])
    await run(test,process.execPath,[`scripts/${test}.cjs`]);
  await run("quick-save-behavior",process.execPath,["scripts/renpy-quick-save-playwright.cjs","--viewport=1920x1080"]);
  await run("shared-menu",process.execPath,["scripts/renpy-menu-playwright.cjs"]);
  await run("help",process.execPath,["scripts/renpy-help-playwright.cjs"]);
  await run("exit-safety",process.execPath,["scripts/runtime-exit-behavior-playwright.cjs"]);
  await run("renpy-transitions",process.execPath,["scripts/runtime-menu-motion-playwright.cjs"]);
  await run("agentvn-blackouts",process.execPath,["scripts/runtime-agentvn-blackout-playwright.cjs"]);
  await run("editor-typecheck","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run typecheck"]);
  await run("editor-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run build"]);
  await run("gamecli-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
  for(const source of report.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);
  if(process.argv.includes("--deliver-dev")){
    const backup=path.join(out,"AgentVN Dev-before.exe");fs.copyFileSync(report.devBefore.path,backup,fs.constants.COPYFILE_EXCL);
    report.devBefore.backup=backup;persist();
    await run("complete-dev","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    report.devAfter={path:report.devBefore.path,sha256:sha(report.devBefore.path),
      debugSha256:sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")),
      modifiedAt:fs.statSync(report.devBefore.path).mtime.toISOString()};
    assert.equal(report.devAfter.sha256,report.devAfter.debugSha256);
    assert(Date.parse(report.devAfter.modifiedAt)>=Date.parse(report.steps.at(-1).at));assert(!fs.existsSync(path.join(root,"AgentVN Dev.pending.exe")));
    report.resources=collectStageResourceEvidence(root,report.sources.map(s=>s.file));
  }
  assert.equal(sha(installer),report.installer.sha256);assert.equal(sha(database),report.database.sha256);
  for(const source of report.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);
  report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack);process.exitCode=1;})
  .finally(()=>{report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({status:report.status,out,error:report.error}));});
