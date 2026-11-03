"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {spawn}=require("node:child_process");
const {fixture}=require("./lib/editor-ui-acceptance.cjs");
const root=path.resolve(__dirname,".."),qa="F:/AgentVN/QA/Editor-Sibling-Motion-20261021-01";
const [matrixName,safetyName,attempt]=process.argv.slice(2);
assert(/^matrix-\d{2}$/.test(matrixName||"") && /^safety-matrix-\d{2}$/.test(safetyName||"") && /^gates-\d{2}$/.test(attempt||""));
const out=path.join(qa,attempt);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files=["editor/src/components/advanced/AdvancedToolsPanel.tsx","editor/src/styles/editor-topbar.css",
  "editor/src/styles/variables.css","editor/src/utils/editorTransitionPresentation.ts",
  "editor/src/components/editor/EditorToolbar.tsx","editor/src/components/common/GlassSelectionGroup.tsx"];
const report={status:"RUNNING",scope:"EDITOR_SOURCE_BROWSER_AND_DEV_NOT_INSTALLED",startedAt:new Date().toISOString(),
  modelRequests:0,steps:[],sources:files.map(file=>({file,sha256:sha(path.join(root,file))}))};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let reusable;
const resumeName=process.argv.find(a=>a.startsWith("--resume-gates="))?.split("=")[1];
if(resumeName){
  assert(/^gates-\d{2}$/.test(resumeName) && resumeName!==attempt);
  reusable=JSON.parse(fs.readFileSync(path.join(qa,resumeName,"report.json")));
  assert.equal(reusable.status,"FAILED","Only a preserved failed gate can be continued");
  for(const source of reusable.sources)assert.equal(sha(path.join(root,source.file)),source.sha256,
    "Cannot reuse a gate across product changes");
}
async function run(label,command,args,overrides={}) {
  const old=reusable?.steps.find(s=>s.label===label && s.status==="PASS");
  if(old){
    assert.deepEqual(old.command,[command,...args]);assert.deepEqual(old.overrides,overrides);
    for(const arg of args.filter(a=>/\.cjs$/.test(a)))assert(
      fs.statSync(path.join(root,arg)).mtimeMs<=Date.parse(old.finishedAt),"Changed test must run again");
    if(old.evidence)assert.equal(sha(old.evidence.path),old.evidence.sha256);
    report.steps.push({...old,reusedFrom:path.join(qa,resumeName,"report.json"),executedThisAttempt:false});
    save();console.log(`REUSE PASS ${label}`);return;
  }
  const dir=path.join(out,label);fs.mkdirSync(dir,{recursive:true});
  const input=path.join(dir,"isolated.vnproj");fs.writeFileSync(input,JSON.stringify(fixture(`sibling-${attempt}-${label}`)),{flag:"wx"});
  const env={...process.env,AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:path.join(dir,"evidence"),
    MOTION_VIEWPORTS:"1080p,1440p,4k",MOTION_DPR:"1",MOTION_REDUCED:"",
    EDITOR_EXPECT_WORKSPACE_SPEED:"1.5",...overrides};
  const step={label,command:[command,...args],startedAt:new Date().toISOString(),status:"RUNNING",
    log:path.join(dir,"command.log"),isolation:{input,output:env.AGENTVN_WORKSPACE_OUTPUT},overrides,executedThisAttempt:true};
  report.steps.push(step);save();console.log(`START ${label}`);
  const log=fs.createWriteStream(step.log,{flags:"wx"});
  step.exitCode=await new Promise(resolve=>{
    const child=spawn(command,args,{cwd:root,windowsHide:true,env,stdio:["ignore","pipe","pipe"]});
    step.pid=child.pid;child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    child.on("error",e=>{step.error=String(e);});
    child.on("close",code=>log.end(()=>resolve(code)));
  });
  step.finishedAt=new Date().toISOString();step.status=step.exitCode===0?"PASS":"FAILED";save();
  console.log(`${step.status} ${label}`);assert.equal(step.exitCode,0,`${label}: stop before Dev`);
  if(args.some(a=>/playwright\.cjs$/.test(a))) {
    const evidencePath=path.join(env.AGENTVN_WORKSPACE_OUTPUT,"report.json");
    const evidence=JSON.parse(fs.readFileSync(evidencePath));
    if(args.includes("scripts/advanced-tools-transition-regression-playwright.cjs")) {
      assert.equal(evidence.ok,true);assert.equal(evidence.results.length,3);
      assert(evidence.results.every(r=>r.primaryTransition && r.geometryBridgeInterruption && r.additionalTransitions.length>0));
      step.evidence={path:evidencePath,sha256:sha(evidencePath),viewports:3};
    } else {
      assert.equal(evidence.status,"PASS");assert(evidence.cases.length>0,"Empty behavior report");
      assert(evidence.cases.every(c=>c.status==="PASS" || Array.isArray(c.failures)&&!c.failures.length));
      step.evidence={path:evidencePath,sha256:sha(evidencePath),cases:evidence.cases.length};
    }
    save();
  }
}
(async()=>{
  for(const [name,count] of [[matrixName,96],[safetyName,40]]) {
    const file=path.join(qa,name,"report.json"),data=JSON.parse(fs.readFileSync(file));
    assert.equal(data.status,"PASS");assert.equal(data.cleanup.status,"PASS");assert.equal(data.cases.length,count);
    assert(data.cases.every(c=>c.status==="PASS" || Array.isArray(c.failures)&&!c.failures.length));
    const combinations=new Map();
    for(const row of data.cases.filter(c=>c.width)) {
      const key=[row.width,row.height,row.dpr,row.reduced].join(":");
      combinations.set(key,(combinations.get(key)||0)+1);
    }
    assert.equal(combinations.size,12);assert([...combinations.values()].every(n=>n===(count===96?8:3)));
    for(const source of files)assert(fs.statSync(path.join(root,source)).mtimeMs<=Date.parse(data.startedAt),
      `Product changed after behavior evidence began: ${source}`);
    report[name]={path:file,sha256:sha(file),cases:count};
    if(data.screenshots)for(const shot of data.screenshots){
      const png=fs.readFileSync(shot.path);
      assert.equal(png.readUInt32BE(16),shot.width*shot.dpr);assert.equal(png.readUInt32BE(20),shot.height*shot.dpr);
    }
  }
  const installer=path.join(root,"releases/editor/AgentVN_Editor_v1.9.21_20261022_005853.exe");
  report.installer={path:installer,sha256:sha(installer)};
  const database=path.join(process.env.APPDATA,"com.agentvn.editor/backend/vn_engine.db");
  report.database={path:database,sha256:sha(database)};
  report.devBefore={path:path.join(root,"AgentVN Dev.exe"),sha256:sha(path.join(root,"AgentVN Dev.exe"))};save();
  for(const name of ["editor-transition-presentation-test","owned-vite-server-test","editor-workspace-contract"])
    await run(name,process.execPath,[`scripts/${name}.cjs`]);
  for(const dpr of [1,2])for(const reduced of [false,true])
    await run(`mask-dpr${dpr}-${reduced?"reduced":"normal"}`,process.execPath,
      ["scripts/editor-selection-mask-motion-playwright.cjs"],
      {MOTION_DPR:String(dpr),MOTION_REDUCED:reduced?"1":""});
  await run("options-behavior",process.execPath,["scripts/editor-options-motion-playwright.cjs"]);
  await run("advanced-transitions",process.execPath,["scripts/advanced-tools-transition-regression-playwright.cjs"],
    {ADVANCED_TOOLS_VIEWPORT:"1080p,1440p,4k",ADVANCED_TOOLS_DPR:"1",ADVANCED_TOOLS_REDUCED_MOTION:"",
      ADVANCED_TOOLS_ANGLE:"d3d11"});
  await run("editor-typecheck","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run typecheck"]);
  await run("editor-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run build"]);
  await run("gamecli-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
  for(const source of report.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);
  if(process.argv.includes("--deliver-dev")) {
    const backup=path.join(out,"AgentVN Dev-before.exe");
    fs.copyFileSync(report.devBefore.path,backup,fs.constants.COPYFILE_EXCL);
    assert.equal(sha(backup),report.devBefore.sha256);report.devBefore.backup=backup;save();
    await run("complete-dev","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
      "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    const dev=report.devBefore.path,debug=path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe");
    report.devAfter={path:dev,sha256:sha(dev),debugSha256:sha(debug),modifiedAt:fs.statSync(dev).mtime.toISOString()};
    assert.equal(report.devAfter.sha256,report.devAfter.debugSha256);
    assert(fs.statSync(dev).mtimeMs>=Date.parse(report.steps.at(-1).startedAt));
    assert(!fs.existsSync(path.join(root,"AgentVN Dev.pending.exe")));
  }
  for(const source of report.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);
  assert.equal(sha(installer),report.installer.sha256);assert.equal(sha(database),report.database.sha256);
  report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack);process.exitCode=1;})
.finally(()=>{report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,out,error:report.error}));});
