"use strict";
// Real existing NSIS installation + fresh DB/WebView. Native picker/close input
// comes only from Computer Use receipts. No model, Tauri, store or clock mocks.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {execFileSync,spawnSync}=require("node:child_process");
const JSZip=require("../editor/node_modules/jszip");
const A=require("./lib/installed-acceptance.cjs"),{fixture}=require("./lib/editor-ui-acceptance.cjs");
const {installedReleaseSession}=require("./lib/installed-release-session.cjs");
const {captureInstalledWebview,readInstalledViewport}=require("./lib/current-native-capture.cjs");
const {rows,listeners,until}=require("./lib/current-native-editor-session.cjs");
const {ownedProcessTree}=require("./lib/owned-process-tree.cjs");
const root=path.resolve(__dirname,".."),out=path.resolve(process.argv[2]||"");
const candidateArg=process.argv.find(arg=>arg.startsWith("--candidate="));
const candidateFile=candidateArg?path.resolve(candidateArg.slice("--candidate=".length)):null;
const independent=process.argv[3]==="--independent-defaults";
const finishing=process.argv[3]==="--finish-native";
const continuing=process.argv[3]==="--continue-native"||finishing;
assert(process.argv[3]===undefined||process.argv[3]===candidateArg||independent||continuing,"Unknown QA mode");
assert(!candidateFile||!continuing,"Do not reuse old-version continuation state for a current candidate");
const nativeOrigin="F:/AgentVN/QA/Project-Directory-Installed-20261022-01/editor-03";
const priorRoot=finishing?"F:/AgentVN/QA/Project-Directory-Installed-20261022-01/editor-04":nativeOrigin;
const candidateRoot="F:\\AgentVN\\QA\\Functional-Continuation-20261101";
assert(candidateFile
  ? path.dirname(out)===candidateRoot&&/^session-\d{2}$/.test(path.basename(out))
  : /^F:\\AgentVN\\QA\\Project-Directory-Installed-20261022-01\\editor-\d{2}$/i.test(out));
assert(!fs.existsSync(out)&&!process.env.E5_LIFECYCLE_SOURCE,"Fresh actual-installed run required");
let audit="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";
const sha=file=>A.sha256(fs.readFileSync(file));
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const prior=continuing?read(path.join(priorRoot,"report.json")):undefined;
if(continuing){
  assert.equal(prior.status,"FAILED");assert.equal(prior.cleanupError,undefined);
  assert.equal(prior.stage,finishing?"fresh-profile-native-package-open-does-not-carry-machine-path":"unavailable-directory-no-fallback-and-real-retry");
  assert.equal(prior.cases.length,finishing?7:8);
  if(!finishing)assert(prior.cases.slice(0,7).every(c=>c.status==="PASS"));
  else for(const name of ["resume-original-native-selected-directories-without-repeating-passed-flows",
    "unavailable-directory-no-fallback-and-real-retry","directory-controls-real-12-combination-matrix",
    "reset-only-current-project-and-default-download","primary-final-normal-close"])
    assert.equal(prior.cases.find(c=>c.name===name)?.status,"PASS");
  assert(prior.cleanups.every(c=>c.status==="PASS"));
  assert.equal(read(path.join(priorRoot,"native-cache-restoration.json")).status,"PASS");
}
fs.mkdirSync(out,{recursive:true});
if(candidateFile){
  assert(A.inside(candidateRoot,candidateFile));
  const source=read(candidateFile);assert.equal(source.status,"PASS");assert.equal(source.version,"1.9.35");
  const actual=source.deployments.filter(d=>d.kind==="NSIS actual isolated installation");
  assert.equal(actual.length,1);const deployment=actual[0],installation=read(deployment.installationReport);
  assert.equal(installation.status,"PASS");assert.equal(installation.registryRestored,true);
  assert.equal(path.resolve(installation.installRoot),path.resolve(deployment.installedRoot));
  assert.equal(installation.executable.sha256,deployment.executable.sha256);
  const resources=source.runtimeCandidate.map(resource=>({
    path:path.join(deployment.installedRoot,resource.name),sha256:resource.sha256
  }));
  for(const f of [deployment.executable,...resources])assert.equal(sha(f.path),f.sha256);
  audit=path.join(out,"derived-installation-receipt.json");
  fs.writeFileSync(audit,JSON.stringify({
    status:"PASS",version:source.version,metadataRestoration:"PASS",
    metadataRestorationSource:"actual-installation.json registryRestored=true; no new install claimed",
    installRoot:deployment.installedRoot,executable:deployment.executable,resources,
    originalAudit:{path:candidateFile,sha256:sha(candidateFile)},
    originalInstallation:{path:deployment.installationReport,sha256:sha(deployment.installationReport)}
  },null,2),{flag:"wx"});
}else{
  assert.equal(read(audit).version,"1.9.22");
  assert.equal(read(audit).executable.sha256,"189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc");
}
const candidateVersion=read(audit).version;
fs.copyFileSync(audit,path.join(out,"sealed-installation-receipt.json"),fs.constants.COPYFILE_EXCL);
fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);
const report={status:"RUNNING",version:candidateVersion,at:new Date().toISOString(),scope:`ACTUAL_INSTALLED_${candidateVersion}_PROJECT_DIRECTORY_NATIVE_CHOOSER_AND_CLOSE`,
  modelRequests:0,productChanges:0,builds:0,cases:[],artifacts:[],screenshots:[],launches:[],cleanups:[],errors:[],
  controlled:["two fixtures via public installed-backend import","actual occupied timestamp filenames","owned directory rename","real owned-directory write-deny ACL"],
  originalInstallationReport:{path:audit,sha256:sha(audit)},executedSha256:sha(__filename)};
if(continuing){
  report.scope="ACTUAL_INSTALLED_1_9_22_NATIVE_DIRECTORY_CONTINUATION_AFTER_QA_NOTICE_SELECTOR_TIMEOUT";
  report.priorEvidence={path:path.join(priorRoot,"report.json"),sha256:sha(path.join(priorRoot,"report.json")),
    reusedCases:prior.cases.filter(c=>c.status==="PASS").map(c=>c.name),originalStatus:"FAILED",originalFailurePreserved:true};
  report.inheritedArtifacts=[...read(path.join(nativeOrigin,"report.json")).artifacts,...prior.artifacts]
    .filter(a=>fs.existsSync(a.path));
  for(const artifact of report.inheritedArtifacts)assert.equal(sha(artifact.path),artifact.sha256);
  if(finishing)report.originalNativeEvidence={path:path.join(nativeOrigin,"report.json"),sha256:sha(path.join(nativeOrigin,"report.json"))};
  // Copy only the stopped, isolated profile. Keep original state/evidence immutable.
  report.profileCopies=[];
  for(const name of ["data","webview"]){
    const source=path.join(priorRoot,name),destination=path.join(out,name);
    assert(!fs.existsSync(destination));assert(fs.lstatSync(source).isDirectory()&&!fs.lstatSync(source).isSymbolicLink());
    fs.cpSync(source,destination,{recursive:true,errorOnExist:true,force:false});
    report.profileCopies.push({source,destination});
  }
}
if(independent)Object.assign(report,{
  scope:"ACTUAL_INSTALLED_1_9_22_DEFAULT_DOWNLOADS_COLLISION_FORCED_RESTART_AND_CONTROL_GEOMETRY_ONLY",
  featureStatus:"BLOCKED_NATIVE_INPUT",
  notRun:["native directory select/cancel","custom-directory persistence and project isolation",
    "invalid custom directory and ACL refusal","normal window close","native portable package open"],
  nativeInputCompleted:false,normalCloseClaimed:false,
  priorBlocker:"F:/AgentVN/QA/Project-Directory-Installed-20261022-01/editor-01/computer-use-retry-blocked.json"
});
let owner,page,cdp,state,current={width:1920,height:1080,dpr:1,reduced:false},aclPending=false,cachePrepared=false;
const allKnown=new Map();
const aclReceipt=path.join(out,"acl-before.json"),missing=path.join(out,"中文 保存目录甲 暂存");
const projects=continuing?prior.projects:["甲","乙"].map((suffix,index)=>{
  const project=fixture(`project-directory-${path.basename(out)}-${index}`);
  project.schema_version="1.1.0";project.title=`QA分工程目录${suffix}_${path.basename(out)}`;
  project.nodes[0].data.loadingAnimation={kind:"default"};project.nodes[0].data.openingAudio=[];
  const input=path.join(out,`临时工程${suffix}.vnproj`);fs.writeFileSync(input,JSON.stringify(project),{flag:"wx"});
  const directory=path.join(out,`中文 保存目录${suffix}`);fs.mkdirSync(directory);
  return {projectId:project.project_id,title:project.title,input,directory,sha256:sha(input)};
});
if(continuing)for(const p of projects){
  assert.equal(sha(p.input),p.sha256);assert(fs.statSync(p.directory).isDirectory());
}
report.projects=projects;
process.env.AGENTVN_TEST_PROJECT=projects[0].input;process.env.AGENTVN_WORKSPACE_OUTPUT=out;
report.environment={AGENTVN_TEST_PROJECT:process.env.AGENTVN_TEST_PROJECT,AGENTVN_WORKSPACE_OUTPUT:out};
const protectedFiles=candidateFile
  ? ["editor/package.json","editor/src-tauri/tauri.conf.json","GameCli_framework/package.json"]
    .map(file=>path.join(root,file)).map(file=>({path:file,sha256:sha(file)}))
  : read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json").protectedFiles;
for(const file of protectedFiles)assert.equal(sha(file.path),file.sha256);
report.protected=protectedFiles;
const checkpoint=path.join("F:/AgentVN/Checkpoints",`Project-Directory-Installed-${candidateVersion}-${path.basename(out)}`);
assert(!fs.existsSync(checkpoint));fs.mkdirSync(checkpoint);
for(const file of ["plans/ACTIVE_TASKS.md","scripts/project-directory-installed-current.cjs","scripts/project-directory-installed-acl.ps1"]){
  const dest=path.join(checkpoint,file);fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.copyFileSync(path.join(root,file),dest,fs.constants.COPYFILE_EXCL);
}
fs.writeFileSync(path.join(checkpoint,"manifest.json"),JSON.stringify({at:report.at,protectedFiles,installation:report.originalInstallationReport},null,2),{flag:"wx"});
report.checkpoint=checkpoint;
const persist=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
async function stage(name,action,{soft=false}={}){
  const row={name,status:"RUNNING",at:new Date().toISOString()};report.cases.push(row);report.stage=name;persist();console.log(`START ${name}`);
  try{row.detail=await action(row);row.status="PASS";console.log(`PASS ${name}`);}
  catch(error){row.status="FAILED";row.error=String(error.stack||error);if(!soft)throw error;}
  finally{row.finishedAt=new Date().toISOString();persist();}
}
async function connect(run=out,restart=false){
  const input=run===out?projects[0].input:
    [...report.artifacts,...report.inheritedArtifacts||[]].find(a=>a.projectId===projects[1].projectId).path;
  owner=installedReleaseSession({installationFile:audit,out:run,report,save:persist,input});
  page=await owner.start();cdp=owner.cdp;
  const actual=owner.current;
  state={editorPid:actual.pid,backendPid:actual.backend.ProcessId,backendPort:actual.ports[0],cdpPort:actual.ports[1],
    databasePath:path.join(actual.data,"backend/vn_engine.db"),webviewRoot:actual.webview,created:actual.created,
    restart,installRoot:read(audit).installRoot,ports:actual.ports};
  remember();persist();
}
function remember(){
  for(const p of report.knownProcesses||[])allKnown.set(`${p.ProcessId}:${p.Created}`,p);
  if(owner&&state)for(const p of ownedProcessTree(rows(),state.editorPid,state.created))allKnown.set(`${p.ProcessId}:${p.Created}`,p);
  report.allKnownProcesses=[...allKnown.values()];persist();
}
function cache(action){
  const result=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(root,"scripts/installed-layout-cache-session.ps1"),"-Action",action,"-RunDirectory",out,"-CodexCacheView",
    ...(candidateFile?["-AllowedRunRoot",candidateRoot]:[])],
  {windowsHide:true,encoding:"utf8",timeout:45000});
  (report.cache??=[]).push({action,code:result.status,stdout:result.stdout,stderr:result.stderr});persist();
  assert.equal(result.status,0,result.stdout+result.stderr);
}
async function metrics(next){current=next;await cdp.send("Emulation.setDeviceMetricsOverride",{
  width:next.width,height:next.height,deviceScaleFactor:next.dpr,mobile:false});
  await page.emulateMedia({reducedMotion:next.reduced?"reduce":"no-preference"});await readInstalledViewport(page,current);}
async function shot(name){const result=await captureInstalledWebview(page,cdp,path.join(out,`${name}.png`),current);
  report.screenshots.push(result);persist();return result;}
async function options(){
  await A.dismissEnvironmentCompletion(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();await A.settleEditor(page);
  await page.getByRole("region",{name:"工程保存目录",exact:true}).scrollIntoViewIfNeeded();
}
async function open(p){
  if(await page.locator(".editor-toolbar").isVisible().catch(()=>false)){
    await page.locator('[data-workspace-surface="edit"]:visible').click();await A.settleEditor(page);
    await page.getByRole("button",{name:"返回首页",exact:true}).click();await A.settleEditor(page);
  }
  await page.locator(".recent-project-open:not(:disabled):visible").filter({hasText:p.title}).click();
  await page.locator(".editor-toolbar").waitFor();await A.settleEditor(page);
  assert.equal((await A.projectSnapshot(state.backendPort)).projectId,p.projectId);await options();
}
async function mapping(){return page.evaluate(()=>JSON.parse(localStorage.getItem("agentvn.projectExportDirectories.v1")||"{}"));}
async function label(){return (await page.locator('[data-help-key="settings.projectExportDirectory.current"]').innerText()).trim();}
async function choose(name,p,cancel=false){
  const before=await mapping(),old=await label();
  const input=await A.nativeInput({page,trigger:page.locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'),
    out,name,ownerPid:state.editorPid,selectedPath:p.directory,cancel,timeoutMs:1200000});
  if(cancel){assert.deepEqual(await mapping(),before);assert.equal(await label(),old);}
  else{
    await page.waitForFunction(({id,directory})=>JSON.parse(localStorage.getItem("agentvn.projectExportDirectories.v1")||"{}")[id]===directory,
      {id:p.projectId,directory:p.directory});
    const after=await mapping();assert.equal(await label(),p.directory);
    for(const [id,value]of Object.entries(before))if(id!==p.projectId)assert.equal(after[id],value);
  }
  return {input,before,after:await mapping(),label:await label()};
}
const ownedFiles=(dir,p)=>fs.readdirSync(dir).filter(n=>n.startsWith(p.title)&&n.endsWith(".vnproj"))
  .map(n=>({path:path.join(dir,n),sha256:sha(path.join(dir,n))}));
async function savePackage(p,dir){
  const before=ownedFiles(dir,p);
  await page.locator('[data-workspace-surface="edit"]:visible').click();await A.settleEditor(page);
  await page.getByRole("button",{name:"保存工程",exact:true}).click();
  const confirmation=page.getByTestId("project-save-confirmation");await confirmation.waitFor();
  const added=ownedFiles(dir,p).filter(n=>!before.some(b=>b.path===n.path));assert.equal(added.length,1);
  for(const old of before)assert.equal(sha(old.path),old.sha256,"Old package overwritten");
  const file=added[0].path;assert((await confirmation.innerText()).includes(file));
  const zip=await JSZip.loadAsync(fs.readFileSync(file)),portable=JSON.parse(await zip.file("project.json").async("string"));
  assert.equal(portable.project_id,p.projectId);assert.equal(portable.title,p.title);
  assert(portable.nodes.length===2&&portable.edges.length===1,"Portable graph must remain complete");
  const json=JSON.stringify(portable);
  assert(!json.includes("projectExportDirectories")&&!json.includes(out)&&!json.includes(out.replaceAll("\\","/")),
    "Machine-local output mapping leaked into portable package");
  const artifact={path:file,sha256:sha(file),bytes:fs.statSync(file).size,generatedAt:fs.statSync(file).mtime.toISOString(),
    projectId:p.projectId,priorFilesPreserved:before.length};
  report.artifacts.push(artifact);persist();
  await confirmation.getByRole("button",{name:"OK",exact:true}).click();await confirmation.waitFor({state:"hidden"});
  return artifact;
}
async function failedSave(p,expectedDir){
  const downloads=path.join(process.env.USERPROFILE,"Downloads"),before=ownedFiles(downloads,p);
  const errorRoot=path.join(state.installRoot,"error_log");
  const oldReports=new Set(fs.existsSync(errorRoot)?fs.readdirSync(errorRoot):[]);
  await page.locator('[data-workspace-surface="edit"]:visible').click();await A.settleEditor(page);
  await page.getByRole("button",{name:"保存工程",exact:true}).click();
  // Reportable errors are buttons, not role=alert/status; collect the actual
  // visible notice and its newly persisted full report (the preview truncates).
  const toast=page.locator('.toast-status.is-error:visible');
  await toast.waitFor();const notice=await toast.innerText();
  assert(/PROJECT_EXPORT_DIRECTORY_(?:INVALID|WRITE_FAILED)|拒绝访问|Access is denied|无法创建工程包临时文件/.test(notice),notice);
  const nativeReport=await until(()=>{
    for(const name of fs.readdirSync(errorRoot)){
      if(oldReports.has(name)||!/^AgentVN-Error-\d+\.txt$/.test(name))continue;
      const file=path.join(errorRoot,name),text=fs.readFileSync(file,"utf8");
      if(text.includes(p.projectId)&&text.includes("Source: 保存工程"))return {file,text};
    }
  },"fresh project-owned native save error report");
  const retained=path.join(out,`save-error-${report.cases.length}.txt`);
  fs.copyFileSync(nativeReport.file,retained,fs.constants.COPYFILE_EXCL);
  const messages=nativeReport.text.split("== Developer Diagnosis ==")[0].split("\n").filter(Boolean);
  assert.equal(await page.getByTestId("project-save-confirmation").count(),0);
  assert.deepEqual(ownedFiles(downloads,p),before,"Failed explicit output silently fell back to Downloads");
  return {messages,notice,fullReport:{source:nativeReport.file,path:retained,sha256:sha(retained)},
    expectedDirectory:expectedDir,noFallback:true,mapping:await mapping()};
}
async function normalClose(name){
  remember();
  const request={requestId:require("node:crypto").randomUUID(),name,ownerPid:state.editorPid,
    requestedAt:new Date().toISOString(),completion:path.join(out,`${name}-completed.json`)};
  assert(!fs.existsSync(request.completion));fs.writeFileSync(path.join(out,"native-input-request.json"),JSON.stringify(request,null,2));
  console.log(JSON.stringify({stage:"NATIVE_NORMAL_CLOSE_REQUIRED",...request}));
  const deadline=Date.now()+1200000;
  while(!fs.existsSync(request.completion)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
  assert(fs.existsSync(request.completion));const result=read(request.completion);
  assert.equal(result.status,"INPUT_COMPLETED");assert.equal(result.requestId,request.requestId);
  assert.equal(result.ownerPid,request.ownerPid);assert(result.interaction.includes("Computer Use"));
  await until(()=>!rows().some(p=>p.ProcessId===state.editorPid&&p.Created===state.created)
    &&!rows().some(p=>p.ProcessId===state.backendPid)&&listeners(state.ports).length===0,"normal Editor/backend shutdown",30000);
  const before=report.cleanups.length;
  await owner.stop("Already observed normal native close");owner=page=cdp=undefined;
  assert.equal(report.cleanups.length,before+1);assert.deepEqual(report.cleanups.at(-1).killed,[]);
  persist();return {request,result,editorExitedNaturally:true,backendExitedNaturally:true,
    portsClosed:true,forcedCleanup:report.cleanups.at(-1).killed};
}
function acl(mode){
  const result=execFileSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(root,"scripts/project-directory-installed-acl.ps1"),"-Mode",mode,"-Directory",projects[1].directory,"-Receipt",aclReceipt],
  {windowsHide:true,encoding:"utf8"});return JSON.parse(result.replace(/^\uFEFF/,""));
}
async function independentDefaults(){
  const downloads=path.join(process.env.USERPROFILE,"Downloads");
  report.defaultDownloadsBaseline=projects.map(p=>({projectId:p.projectId,files:ownedFiles(downloads,p)}));
  assert(report.defaultDownloadsBaseline.every(p=>p.files.length===0),"Fresh unique QA title required");
  persist();
  await stage("unconfigured-a-b-a-native-save-to-system-downloads",async()=>{
    const artifacts=[];
    for(const p of [projects[0],projects[1],projects[0]]){
      await open(p);assert.equal(await label(),"系统下载目录");assert.deepEqual(await mapping(),{});
      artifacts.push(await savePackage(p,downloads));
    }
    assert.equal(new Set(artifacts.map(a=>a.path)).size,3);
    return {artifacts,mapping:await mapping(),customDirectoryClaim:false};
  });
  await stage("occupied-default-filename-preserves-prior-package-bytes",async()=>{
    const p=projects[0],source=report.artifacts.find(a=>a.projectId===p.projectId);
    const mod={exports:{}};
    new Function("module","exports",require("../editor/node_modules/esbuild").buildSync({
      entryPoints:[path.join(root,"editor/src/utils/fileNames.ts")],bundle:true,platform:"node",format:"cjs",write:false
    }).outputFiles[0].text)(mod,mod.exports);
    const reserved=[],now=Date.now();
    report.collision={method:"Actual upcoming filenames occupied by valid unique QA packages; no clock/native mock",reserved};persist();
    for(let offset=0;offset<=90;offset++){
      const file=path.join(downloads,mod.exports.buildProjectExportFileName(p.title,new Date(now+offset*1000)));
      if(fs.existsSync(file))continue;
      fs.copyFileSync(source.path,file,fs.constants.COPYFILE_EXCL);reserved.push({path:file,sha256:sha(file)});persist();
    }
    const saved=await savePackage(p,downloads);assert(/-\d+\.vnproj$/.test(saved.path));
    assert(reserved.some(r=>r.path===saved.path.replace(/-\d+\.vnproj$/,".vnproj")));
    for(const old of reserved)assert.equal(sha(old.path),old.sha256);
    return {saved,reservedFiles:reserved.length,noClockMock:true};
  });
  await stage("owned-forced-stop-and-actual-host-backend-relaunch",async()=>{
    const before={...state};remember();await owner.stop("Independent defaults owned forced stop; not normal-close acceptance");
    owner=page=cdp=undefined;await connect(out,true);await metrics(current);
    assert.notEqual(state.editorPid,before.editorPid);assert.notEqual(state.backendPid,before.backendPid);
    assert.equal(state.databasePath,before.databasePath);assert.equal(state.webviewRoot,before.webviewRoot);
    const artifacts=[];
    for(const p of projects){
      await open(p);assert.equal(await label(),"系统下载目录");assert.deepEqual(await mapping(),{});
      artifacts.push(await savePackage(p,downloads));
    }
    return {before,after:{...state},artifacts,normalCloseClaimed:false,customDirectoryPersistenceClaim:false};
  });
  await stage("default-directory-controls-real-12-combination-matrix",async()=>{
    await open(projects[0]);const observations=[];
    for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])for(const reduced of [false,true]){
      await metrics({width,height,dpr,reduced});await options();
      const region=page.getByRole("region",{name:"工程保存目录",exact:true});
      const choose=region.locator('[data-help-key="settings.projectExportDirectory.choose"]');
      await choose.click({trial:true});
      assert(await region.locator('[data-help-key="settings.projectExportDirectory.reset"]').isDisabled());
      const geometry=await region.evaluate(node=>({
        rect:node.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth-innerWidth,
        controls:[...node.querySelectorAll("button")].map(b=>{const r=b.getBoundingClientRect();return {
          rect:r.toJSON(),disabled:b.disabled,clipped:b.scrollWidth>b.clientWidth+1,
          hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})
      }));
      assert.equal(geometry.controls.length,2);assert(geometry.overflow<=1);
      for(const b of geometry.controls)assert(b.hit&&!b.clipped&&b.rect.left>=0&&b.rect.top>=0&&b.rect.right<=width&&b.rect.bottom<=height);
      const [a,b]=geometry.controls.map(c=>c.rect);
      assert.equal(Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
        Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)),0,"Directory buttons overlap");
      assert.equal(await label(),"系统下载目录");assert.deepEqual(await mapping(),{});
      observations.push({width,height,dpr,reduced,geometry,screenshot:await shot(`default-directory-${width}-${dpr}-${reduced}`)});
    }
    assert.equal(observations.length,12);
    await metrics({width:1920,height:1080,dpr:1,reduced:false});return observations;
  });
  await stage("portable-package-public-import-in-new-db-and-webview",async()=>{
    remember();await owner.stop("Independent defaults switch to fresh profile; not normal-close acceptance");owner=page=cdp=undefined;
    const reopened=path.join(out,"portable-public-import");fs.mkdirSync(reopened);
    await connect(reopened);await metrics(current);
    const artifact=report.artifacts.find(a=>a.projectId===projects[1].projectId);
    const response=await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`,{method:"POST",
      headers:{"content-type":"application/octet-stream","X-AgentVN-Filename":encodeURIComponent(path.basename(artifact.path))},
      body:fs.readFileSync(artifact.path),signal:AbortSignal.timeout(30000)});
    const value=await response.json();assert(response.ok&&value.ok&&value.data.project_id===projects[1].projectId);
    await page.reload({waitUntil:"domcontentloaded"});await open(projects[1]);
    assert.equal(await label(),"系统下载目录");assert.deepEqual(await mapping(),{});
    const saved=await savePackage(projects[1],downloads);
    return {artifact,saved,nativeFilePickerClaim:false,publicBackendImport:true,freshDatabase:state.databasePath};
  });
  assert.equal(report.cases.length,6);assert.equal(report.errors.length,0);assert.equal(report.modelRequests,0);
  report.status="PASS";
}
function retainIndependentDownloads(){
  if(!independent||!report.defaultDownloadsBaseline)return;
  const downloads=path.join(process.env.USERPROFILE,"Downloads"),archive=path.join(out,"retained-downloads");
  fs.mkdirSync(archive,{recursive:true});report.downloadRetention??=[];
  assert(report.defaultDownloadsBaseline.every(p=>p.files.length===0));
  for(const p of projects)for(const file of ownedFiles(downloads,p)){
    assert.equal(path.dirname(file.path),downloads);assert(path.basename(file.path).startsWith(p.title));
    const zipBytes=fs.readFileSync(file.path),destination=path.join(archive,path.basename(file.path));
    assert.equal(A.sha256(zipBytes),file.sha256);
    if(!fs.existsSync(destination))fs.copyFileSync(file.path,destination,fs.constants.COPYFILE_EXCL);
    assert.equal(sha(destination),file.sha256);assert.equal(sha(file.path),file.sha256);
    fs.unlinkSync(file.path);
    report.downloadRetention.push({...file,archive:destination,sourceRemoved:true});
    persist();
  }
  assert(projects.every(p=>ownedFiles(downloads,p).length===0));
}
(async()=>{
  cache("SelfTest");cachePrepared=true;cache("Prepare");
  await connect();await metrics(current);
  if(continuing){
    await stage("resume-original-native-selected-directories-without-repeating-passed-flows",async()=>{
      for(const [index,p]of projects.entries()){
        await open(p);assert.equal(await label(),finishing&&index===0?"系统下载目录":p.directory);
      }
      return {mapping:await mapping(),priorEvidence:report.priorEvidence,
        originalFailureRetained:true,profileCopies:report.profileCopies};
    });
  }else{
  await stage("two-controlled-fixtures-and-defaults",async()=>{
    for(const p of projects){
      const response=await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`,{method:"POST",
        headers:{"content-type":"application/octet-stream","X-AgentVN-Filename":encodeURIComponent(path.basename(p.input))},
        body:fs.readFileSync(p.input),signal:AbortSignal.timeout(30000)});
      const value=await response.json();assert(response.ok&&value.ok&&value.data.project_id===p.projectId);
    }
    await page.reload({waitUntil:"domcontentloaded"});
    for(const p of projects){await open(p);assert.equal(await label(),"系统下载目录");}
    assert.deepEqual(await mapping(),{});return {projects,controlledPreparation:true};
  });
  if(independent){await independentDefaults();return;}
  await stage("native-cancel-does-not-set-directory",async()=>{await open(projects[0]);return choose("directory-cancel",projects[0],true);});
  await stage("native-project-a-chinese-space-directory",async()=>choose("directory-a-select",projects[0]));
  await stage("native-project-b-independent-directory",async()=>{await open(projects[1]);return choose("directory-b-select",projects[1]);});
  await stage("a-b-a-save-and-no-overwrite",async()=>{
    const artifacts=[];
    for(const p of [projects[0],projects[1],projects[0]]){
      await open(p);assert.equal(await label(),p.directory);artifacts.push(await savePackage(p,p.directory));
    }
    return {artifacts,mapping:await mapping()};
  });
  await stage("actual-filename-collision",async()=>{
    const p=projects[0],source=report.artifacts.find(a=>a.projectId===p.projectId);
    const mod={exports:{}};
    new Function("module","exports",require("../editor/node_modules/esbuild").buildSync({
      entryPoints:[path.join(root,"editor/src/utils/fileNames.ts")],bundle:true,platform:"node",format:"cjs",write:false
    }).outputFiles[0].text)(mod,mod.exports);
    const reserved=[];const now=Date.now();
    for(let offset=0;offset<=90;offset++){
      const file=path.join(p.directory,mod.exports.buildProjectExportFileName(p.title,new Date(now+offset*1000)));
      if(fs.existsSync(file))continue;
      fs.copyFileSync(source.path,file,fs.constants.COPYFILE_EXCL);reserved.push({path:file,sha256:sha(file)});
    }
    report.collision={method:"Actual upcoming native filenames occupied with valid QA packages; no clock mock",reserved};persist();
    const saved=await savePackage(p,p.directory);assert(/-\d+\.vnproj$/.test(saved.path));
    assert(reserved.some(r=>r.path===saved.path.replace(/-\d+\.vnproj$/,".vnproj")));
    for(const old of reserved)assert.equal(sha(old.path),old.sha256);
    return {saved,reservedFiles:reserved.length};
  });
  const oldState={...state};
  await stage("first-native-close-and-real-restart",async()=>{
    const close=await normalClose("restart-normal-close");await connect(out,true);await metrics(current);
    assert.notEqual(state.editorPid,oldState.editorPid);assert.notEqual(state.backendPid,oldState.backendPid);
    assert.equal(state.databasePath,oldState.databasePath);assert.equal(state.webviewRoot,oldState.webviewRoot);
    for(const p of projects){await open(p);assert.equal(await label(),p.directory);}
    return {close,before:oldState,after:state,mapping:await mapping()};
  });
  }
  if(!finishing)await stage("unavailable-directory-no-fallback-and-real-retry",async row=>{
    const p=projects[0];await open(p);assert(!fs.existsSync(missing));fs.renameSync(p.directory,missing);
    try{row.detail=await failedSave(p,p.directory);persist();assert(!fs.existsSync(p.directory));
      assert(row.detail.messages.join("\n").includes(p.directory),"Invalid-directory error must identify the actual path");
    }finally{assert(!fs.existsSync(p.directory)&&fs.lstatSync(missing).isDirectory());fs.renameSync(missing,p.directory);}
    row.detail.retry=await savePackage(p,p.directory);return row.detail;
  });
  await stage("actual-write-denial-no-fallback-actionable-error-and-retry",async row=>{
    const p=projects[1];await open(p);aclPending=true;
    try{
      row.detail={acl:acl("deny")};persist();
      const before=ownedFiles(p.directory,p);const failure=await failedSave(p,p.directory);
      row.detail.failure=failure;persist();assert.deepEqual(ownedFiles(p.directory,p),before);
      const message=failure.messages.join("\n");
      assert(message.includes(p.directory)&&/重新选择|保存目录/.test(message),
        "Access-denied error must identify the chosen directory and recovery, not suggest missing assets");
    }finally{report.aclRestoration=acl("restore");aclPending=false;persist();}
    row.detail.retry=await savePackage(p,p.directory);return row.detail;
  },{soft:true});
  if(!finishing){
  await stage("directory-controls-real-12-combination-matrix",async()=>{
    await open(projects[1]);const observations=[];
    for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])for(const reduced of [false,true]){
      await metrics({width,height,dpr,reduced});await options();
      const region=page.getByRole("region",{name:"工程保存目录",exact:true});
      for(const button of await region.getByRole("button").all())await button.click({trial:true});
      const geometry=await region.evaluate(node=>{
        const rect=node.getBoundingClientRect();return {rect:rect.toJSON(),overflow:document.documentElement.scrollWidth-innerWidth,
          controls:[...node.querySelectorAll("button")].map(b=>{const r=b.getBoundingClientRect();return {
            rect:r.toJSON(),disabled:b.disabled,clipped:b.scrollWidth>b.clientWidth+1,
            hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})};
      });
      assert.equal(geometry.controls.length,2);assert(geometry.overflow<=1);
      for(const b of geometry.controls)assert(b.hit&&!b.clipped&&b.rect.left>=0&&b.rect.top>=0&&b.rect.right<=width&&b.rect.bottom<=height);
      assert.equal(await label(),projects[1].directory);
      observations.push({width,height,dpr,reduced,geometry,screenshot:await shot(`directory-${width}-${dpr}-${reduced}`)});
    }
    await metrics({width:1920,height:1080,dpr:1,reduced:false});return observations;
  });
  await stage("reset-only-current-project-and-default-download",async()=>{
    await open(projects[0]);await page.locator('[data-help-key="settings.projectExportDirectory.reset"]').click();
    assert.equal(await label(),"系统下载目录");
    const map=await mapping();assert.equal(map[projects[0].projectId],undefined);assert.equal(map[projects[1].projectId],projects[1].directory);
    const downloads=path.join(process.env.USERPROFILE,"Downloads");
    const saved=await savePackage(projects[0],downloads),archive=path.join(out,path.basename(saved.path));
    assert(!fs.existsSync(archive));fs.copyFileSync(saved.path,archive,fs.constants.COPYFILE_EXCL);assert.equal(sha(archive),saved.sha256);
    assert(path.dirname(saved.path)===downloads&&path.basename(saved.path).startsWith(projects[0].title));
    fs.unlinkSync(saved.path);saved.archivedPath=archive;saved.downloadCleanup="REMOVED_OWNED_NEW_FILE_WITH_IDENTICAL_ARCHIVE";persist();
    await open(projects[1]);assert.equal(await label(),projects[1].directory);return {saved,mapping:await mapping()};
  });
  }
  await stage("primary-final-normal-close",()=>normalClose("primary-final-normal-close"));
  const reopenedRoot=path.join(out,"portable-reopen");fs.mkdirSync(reopenedRoot);
  fs.copyFileSync(audit,path.join(reopenedRoot,"sealed-installation-receipt.json"),fs.constants.COPYFILE_EXCL);
  await stage("fresh-profile-native-package-open-does-not-carry-machine-path",async()=>{
    await connect(reopenedRoot);await metrics(current);
    const artifact=[...report.artifacts,...report.inheritedArtifacts||[]].find(a=>a.projectId===projects[1].projectId);
    assert.equal(sha(artifact.path),artifact.sha256);
    const trigger=page.getByLabel("创建或打开项目").getByRole("button",{name:"导入项目",exact:true});await trigger.waitFor();
    const input=await A.nativeInput({page,trigger,out,name:"portable-native-open",ownerPid:state.editorPid,
      selectedPath:artifact.path,timeoutMs:1200000});
    await page.locator(".editor-toolbar").waitFor({timeout:120000});await options();
    assert.equal((await A.projectSnapshot(state.backendPort)).projectId,projects[1].projectId);
    assert.equal(await label(),"系统下载目录");assert.deepEqual(await mapping(),{});
    return {input,artifact,mapping:await mapping(),screenshot:await shot("fresh-profile-no-path")};
  });
  await stage("portable-profile-final-normal-close",()=>normalClose("portable-final-normal-close"));
  assert.equal(report.cases.length,finishing?5:continuing?8:14);assert.equal(report.errors.length,0);
  report.status=report.cases.every(c=>c.status==="PASS")?"PASS":"FAILED";
})().catch(async error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;
  if(page)try{report.failureScreenshot=await shot("failure");}catch{} })
  .finally(async()=>{
    try{
      if(aclPending&&fs.existsSync(aclReceipt)){report.aclRestoration=acl("restore");aclPending=false;}
      if(fs.existsSync(missing)){assert(!fs.existsSync(projects[0].directory));fs.renameSync(missing,projects[0].directory);}
      if(owner){remember();await owner.stop("Project directory finally");remember();}
      retainIndependentDownloads();
      assert(report.cleanups.length>0&&report.cleanups.every(c=>c.status==="PASS"));
      if(cachePrepared){cache("Restore");report.cacheRestoration=read(path.join(out,"native-cache-restoration.json")).status;assert.equal(report.cacheRestoration,"PASS");}
      for(const file of protectedFiles)assert.equal(sha(file.path),file.sha256);
      assert.equal(sha(audit),report.originalInstallationReport.sha256);
    }catch(error){report.status="FAILED";report.cleanupError=String(error.stack||error);}
    report.finishedAt=new Date().toISOString();persist();
    console.log(JSON.stringify({status:report.status,out,cases:report.cases.length,error:report.error,cleanupError:report.cleanupError}));
    if(report.status!=="PASS")process.exitCode=1;
  });
