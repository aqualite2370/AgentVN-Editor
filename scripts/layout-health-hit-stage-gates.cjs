"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {spawn}=require("node:child_process");
const {fixture}=require("./lib/editor-ui-acceptance.cjs");
const root=path.resolve(__dirname,".."),qa="F:/AgentVN/QA/Layout-Health-Hit-20261022-01";
const name=process.argv[2];assert(/^gates-\d{2}$/.test(name||""));
const out=path.join(qa,name);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const matrixFile=path.join(qa,"matrix-01/report.json"),matrix=JSON.parse(fs.readFileSync(matrixFile));
assert.equal(matrix.status,"PASS");assert.equal(matrix.cleanup,"PASS");
assert.equal(matrix.cases.length,60);assert(matrix.cases.every(c=>c.status==="PASS"));
assert.equal(new Set(matrix.cases.map(c=>[c.width,c.height,c.dpr,c.reduced].join(":"))).size,12);
const report={status:"RUNNING",startedAt:new Date().toISOString(),scope:"EDITOR_LAYOUT_SOURCE_AND_FULL_DEV_NOT_FROZEN_RELEASE",
  matrix:{path:matrixFile,sha256:sha(matrixFile)},sources:matrix.sources,steps:[],modelRequests:0};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
async function run(label,command,args){
  const dir=path.join(out,label);fs.mkdirSync(dir);
  const input=path.join(dir,"isolated.vnproj");
  fs.writeFileSync(input,JSON.stringify(fixture("layout-health-"+name+"-"+label)),{flag:"wx"});
  const row={label,status:"RUNNING",command:[command,...args],startedAt:new Date().toISOString(),
    log:path.join(dir,"command.log"),input,output:path.join(dir,"workspace")};
  report.steps.push(row);save();console.log("START "+label);
  const log=fs.createWriteStream(row.log,{flags:"wx"});
  row.exitCode=await new Promise(resolve=>{
    const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,
      AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:row.output,RENPY_AUTHOR_MATRIX:""}});
    row.pid=child.pid;save();child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    child.on("error",e=>row.error=String(e));child.on("close",code=>log.end(()=>resolve(code)));
  });
  row.status=row.exitCode===0?"PASS":"FAILED";row.finishedAt=new Date().toISOString();save();
  assert.equal(row.exitCode,0,label+" failed; stop before Dev");
  console.log("PASS "+label);
}
(async()=>{
  for(const source of report.sources)assert.equal(sha(path.join(root,source.path)),source.sha256);
  const protectedFiles=["releases/editor/AgentVN_Editor_v1.9.21_20261022_005853.exe"];
  report.protected=protectedFiles.map(p=>({path:path.join(root,p),sha256:sha(path.join(root,p))}));
  const db=path.join(process.env.APPDATA,"com.agentvn.editor/backend/vn_engine.db");
  report.protected.push({path:db,sha256:sha(db)});
  report.devBefore={path:path.join(root,"AgentVN Dev.exe"),sha256:sha(path.join(root,"AgentVN Dev.exe"))};save();
  await run("related-author",process.execPath,["scripts/renpy-control-authoring-playwright.cjs","green-16","--pages"]);
  const authorFile="F:/AgentVN/QA/Renpy-Redesign-20261021-01/controls-green-16/report.json";
  const author=JSON.parse(fs.readFileSync(authorFile));assert.equal(author.status,"PASS");assert.equal(author.cleanup,"PASS");
  assert.equal(author.cases.length,2);report.author={path:authorFile,sha256:sha(authorFile)};save();
  await run("editor-typecheck","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run typecheck"]);
  await run("editor-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run build"]);
  await run("gamecli-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
  for(const source of report.sources)assert.equal(sha(path.join(root,source.path)),source.sha256);
  fs.copyFileSync(report.devBefore.path,path.join(out,"AgentVN Dev-before.exe"),fs.constants.COPYFILE_EXCL);
  await run("complete-dev","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
  const dev=report.devBefore.path;
  report.devAfter={path:dev,sha256:sha(dev),debugSha256:sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")),
    modifiedAt:fs.statSync(dev).mtime.toISOString()};
  assert.equal(report.devAfter.sha256,report.devAfter.debugSha256);
  assert(!fs.existsSync(path.join(root,"AgentVN Dev.pending.exe")));
  assert(Date.parse(report.devAfter.modifiedAt)>=Date.parse(report.steps.at(-1).startedAt));
  for(const file of report.protected)assert.equal(sha(file.path),file.sha256);
  report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
  .finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,out,error:report.error}));});
