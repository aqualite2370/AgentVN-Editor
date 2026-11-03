"use strict";
// Actual installed 1.9.22 -> native picker -> one real publishing UI build.
// Observation is read-only: no Tauri interception, source builder or store import.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");
const JSZip=require("../editor/node_modules/jszip");
const A=require("./lib/installed-acceptance.cjs");
const {fixture}=require("./lib/editor-ui-acceptance.cjs");
const {installedReleaseSession}=require("./lib/installed-release-session.cjs");
const {rows,listeners,until}=require("./lib/current-native-editor-session.cjs");
const {ownedProcessTree}=require("./lib/owned-process-tree.cjs");
const {retainedUpgradeFixture}=require("./lib/windows-game-upgrade-fixture.cjs");
const root=path.resolve(__dirname,".."),attempt=process.argv[2]||"02";assert(/^\d{2}$/.test(attempt));
const out=path.join("F:/AgentVN/QA/Windows-Package-20261021-01",`editor-${attempt}`);
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>A.sha256(fs.readFileSync(f)),desc=f=>({path:f,sha256:sha(f),bytes:fs.statSync(f).size,generatedAt:fs.statSync(f).mtime.toISOString()});
const installation="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";
const sealed=read(installation);assert.equal(sealed.version,"1.9.22");
const report={status:"RUNNING",at:new Date().toISOString(),scope:"ACTUAL_INSTALLED_1_9_22_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD",
  modelRequests:0,productChanges:0,builds:0,steps:[],screenshots:[],launches:[],cleanups:[],errors:[],observations:[],
  nativeChooserClaim:false,normalCloseClaim:false,sourceBuilderInvocation:false,installation:desc(installation),
  protectedFiles:read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json").protectedFiles,
  knownBuildProcesses:[],notRun:["credible old-game upgrade","Android","final user project","clean-machine independence"]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const upgrade=process.argv.includes("--upgrade-from-retained")?retainedUpgradeFixture():null;
if(upgrade)report.upgradeFixture=upgrade;
const gameVersion=upgrade?.version||"1.0.0",marker=upgrade?.marker||"QA_WINDOWS_NATIVE";
const project=upgrade?.project||fixture(`qa_windows_native_1922_${attempt}`);
if(!upgrade){
  project.schema_version="1.1.0";project.title=`AVN Native Windows 1922 ${attempt}`;
  project.nodes[0].data.loadingAnimation={kind:"default"};project.nodes[0].data.openingAudio=[];
  project.nodes[1].data.scene.commands=[0,1,2].map(i=>({type:"narration",text:`QA_WINDOWS_NATIVE_${i}：隔离临时工程的真实发布、独立运行与存档验证。`}));
}
const input=path.join(out,"isolated-project.vnproj");fs.writeFileSync(input,JSON.stringify(project),{flag:"wx"});
process.env.AGENTVN_TEST_PROJECT=input;process.env.AGENTVN_WORKSPACE_OUTPUT=out;
report.input=desc(input);report.projectId=project.project_id;report.environment={AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:out};
const output=path.join(out,"中文 Windows 输出");fs.mkdirSync(output);
let owner,page,cachePrepared=false,packagePrepared=false,pending=false,terminal=false,lastMessage="";
const watched=new Map();
function unchanged(){for(const f of report.protectedFiles)assert.equal(sha(f.path),f.sha256);assert.equal(sha(installation),report.installation.sha256);}
function cache(tool,action){
  const r=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"scripts",tool),
    "-Action",action,"-RunDirectory",out,"-CodexCacheView"],{windowsHide:true,encoding:"utf8",timeout:120000});
  fs.writeFileSync(path.join(out,`${tool}-${action}.log`),r.stdout+r.stderr,{flag:"wx"});
  assert.equal(r.status,0,r.stdout+r.stderr);
}
async function stage(name,fn){
  const row={name,status:"RUNNING",at:new Date().toISOString()};report.steps.push(row);report.stage=name;save();console.log("START",name);
  try{row.detail=await fn();row.status="PASS";}catch(e){row.status="FAILED";row.error=String(e.stack||e);throw e;}
  finally{row.finishedAt=new Date().toISOString();save();}
}
async function environment(){
  const dialog=page.getByTestId("package-environment-operation-dialog");
  await until(async()=>{
    if(await dialog.isVisible()){
      const phase=await dialog.getAttribute("data-environment-phase");
      if(!["completed","failed"].includes(phase))return false;
      (report.environmentChecks??=[]).push({phase,text:await dialog.innerText()});save();
      await dialog.getByRole("button",{name:phase==="completed"?"完成":"关闭",exact:true}).click();
      await dialog.waitFor({state:"detached"});
    }
    const button=page.locator('[data-help-key="package.export"]');
    if(await button.isVisible()){
      const status=await button.getAttribute("data-environment-status");
      if(status==="passed")return true;
      const check=page.locator('[data-help-key="package.windowsEnvCheck"]:visible');
      if(await check.count()){await check.click();return false;}
      report.environmentStatus=status;save();
    }
    return false;
  },"real installed Windows environment completion",180000);
}
function retain(file,label){
  const bytes=fs.readFileSync(file),hash=A.sha256(bytes),key=`${label}:${hash}`;
  if(watched.has(key))return watched.get(key);
  const dir=path.join(out,"observed-build");fs.mkdirSync(dir,{recursive:true});
  const destination=path.join(dir,`${label}-${hash.slice(0,12)}${path.extname(file)}`);
  fs.writeFileSync(destination,bytes,{flag:"wx"});const item={source:file,...desc(destination),observedAt:new Date().toISOString()};
  watched.set(key,item);report.observedFiles=[...watched.values()];return item;
}
async function observe(){
  const current=owner.current;
  for(const p of ownedProcessTree(rows(),current.pid,current.created))
    if(!report.knownBuildProcesses.some(n=>n.ProcessId===p.ProcessId&&n.Created===p.Created))report.knownBuildProcesses.push(p);
  const base=path.join(out,"package-cache");
  for(const e of fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^\d+$/.test(e.name))){
    const run=path.join(base,e.name),workspace=path.join(run,"build-workspace");
    for(const [relative,label]of [["build-versions.json","versions"],["scripts/build-runtime-standalone-windows.cjs","builder"],
      ["GameCli_framework/src-tauri/src/lib.rs","runtime"],["GameCli_framework/src-tauri/tauri.conf.json","tauri"]]){
      const file=path.join(workspace,relative);if(fs.existsSync(file))retain(file,label);
    }
    for(const [relative,label]of [["game.vncart","source-cartridge"],["diagnostics/package-build-manifest.json","manifest"],
      ["diagnostics/standalone-windows-build.log","build-log"],["diagnostics/standalone-windows-verify.json","verify"],
      ["diagnostics/standalone-package-command.log","commands"]]){
      const file=path.join(run,relative);if(fs.existsSync(file))retain(file,label);
    }
    const cartridgeCandidates=fs.readdirSync(run).filter(n=>n.endsWith(".vncart"));
    for(const name of cartridgeCandidates)retain(path.join(run,name),"source-cartridge");
  }
  const text=await page.locator(".package-log-console").innerText().catch(()=>"");
  if(text!==lastMessage){lastMessage=text;fs.writeFileSync(path.join(out,"live-console.txt"),text);console.log(text.slice(-550));}
  const state={at:new Date().toISOString(),busy:await page.locator('[data-help-key="package.export"]').getAttribute("aria-busy").catch(()=>null),
    result:await page.getByTestId("package-build-result-dialog").isVisible(),tail:text.slice(-300)};
  report.observations.push(state);save();return state;
}
async function normalClose(){
  const request={requestId:require("node:crypto").randomUUID(),ownerPid:owner.current.pid,
    name:"windows-editor-normal-close",completion:path.join(out,"normal-close-completed.json")};
  fs.writeFileSync(path.join(out,"native-input-request.json"),JSON.stringify(request,null,2));
  console.log(JSON.stringify({stage:"NATIVE_NORMAL_CLOSE_REQUIRED",...request}));
  await until(()=>fs.existsSync(request.completion),"native normal Editor close",1200000);
  const receipt=read(request.completion);
  assert.equal(receipt.status,"INPUT_COMPLETED");assert.equal(receipt.requestId,request.requestId);
  assert.equal(receipt.ownerPid,request.ownerPid);assert(receipt.interaction.includes("Computer Use"));
  const launch=owner.current;
  await until(()=>!rows().some(p=>p.ProcessId===launch.pid&&p.Created===launch.created)&&listeners(launch.ports).length===0,
    "normal Editor/backend exit",30000);
  await owner.stop("Observed normal native close");assert.deepEqual(report.cleanups.at(-1).killed,[]);
  report.normalCloseClaim=true;return {request,receipt};
}
(async()=>{
  unchanged();
  fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(installation,path.join(out,"installation.json"),fs.constants.COPYFILE_EXCL);
  cache("installed-layout-cache-session.ps1","SelfTest");cache("windows-package-cache-session.ps1","SelfTest");
  cache("installed-layout-cache-session.ps1","Prepare");cachePrepared=true;
  cache("windows-package-cache-session.ps1","Prepare");packagePrepared=true;
  owner=installedReleaseSession({installationFile:installation,out,report,save,input});
  await stage("actual-installed-editor-and-public-fixture-import",async()=>{
    page=await owner.start();
    const response=await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`,{
      method:"POST",headers:{"content-type":"application/octet-stream","X-AgentVN-Filename":"isolated-project.vnproj"},
      body:fs.readFileSync(input),signal:AbortSignal.timeout(30000)});
    const payload=await response.json();assert(response.ok&&payload.ok&&payload.data.project_id===project.project_id);
    await page.reload();await page.locator(".recent-project-open:visible").filter({hasText:project.title}).click();
    await page.locator(".editor-toolbar").waitFor();await A.settleEditor(page);
    return {projectId:project.project_id,controlledPublicImport:true};
  });
  await stage("real-publish-settings-and-native-output-picker",async()=>{
    await page.locator('[data-workspace-surface="publish"]:visible').click();await A.settleEditor(page);
    const initial=page.getByTestId("package-environment-operation-dialog");
    // Auto-check starts after the workspace transition; do not race an
    // isVisible snapshot against the later modal mount.
    await until(async()=>{
      if(await initial.isVisible()){
        const phase=await initial.getAttribute("data-environment-phase");
        if(!["completed","failed"].includes(phase))return false;
        report.initialEnvironment={phase,text:await initial.innerText()};save();
        await initial.getByRole("button",{name:phase==="completed"?"完成":"关闭",exact:true}).click();
        await initial.waitFor({state:"detached"});
      }
      const settings=page.locator('[data-package-stage="settings"]');
      try{await settings.click({timeout:750});}catch{return false;}
      return await page.locator('[data-help-key="package.mode"]').isVisible();
    },"actual publish settings after automatic environment completion",180000);
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option",{name:/打包 Windows 单软件/}).click();
    await environment();
    for(const [key,value]of [["gameId",project.project_id],["title",project.title],["author","QA"],
      ["version",gameVersion],["description","Normal installed Editor UI Windows export acceptance."]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    const native=await A.nativeInput({page,trigger:page.locator('[data-help-key="package.chooseOutputDir"]'),out,
      name:"windows-output-select",ownerPid:owner.current.pid,selectedPath:output,
      completionProbe:page.locator('[data-help-key="package.outputDir"]'),timeoutMs:1200000});
    assert.equal(await page.locator('[data-help-key="package.outputDir"]').inputValue(),output);
    report.nativeChooserClaim=true;report.nativeOutput=native;await owner.shot("native-output-selected");
    const warnings=page.getByRole("button",{name:"查看并确认警告",exact:true});
    if(await warnings.isVisible())await warnings.click();
    const consent=page.locator('[data-help-key="package.confirmWarnings"]');
    if(await consent.isVisible())await consent.check();
    const exportButton=page.locator('[data-help-key="package.export"]');assert(await exportButton.isEnabled());
    return {native,environment:await exportButton.getAttribute("data-environment-status")};
  });
  await stage("single-real-ui-windows-build-and-result",async()=>{
    const button=page.locator('[data-help-key="package.export"]');
    assert.equal(report.builds,0);report.builds=1;pending=true;report.clickedAt=new Date().toISOString();save();
    await button.click();
    while(true){
      const state=await observe();
      if(state.result){terminal=true;pending=false;break;}
      await new Promise(resolve=>setTimeout(resolve,2500));
    }
    const dialog=page.getByTestId("package-build-result-dialog");report.resultText=await dialog.innerText();
    await owner.shot("windows-build-result");report.console=await page.locator(".package-log-console").innerText();
    fs.writeFileSync(path.join(out,"final-console.txt"),report.console,{flag:"wx"});
    const failure=!report.resultText.includes("Windows 软件构建成功");
    report.featureStatus=failure?"FAILED":"PASS";save();assert(!failure,report.resultText);
    const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
      const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else files.push(file);}}
    walk(output);report.artifacts=files.map(desc);save();
    const installers=report.artifacts.filter(a=>/\.exe$/i.test(a.path)&&/setup|installer|安装/i.test(path.basename(a.path)));
    const portable=report.artifacts.filter(a=>/\.exe$/i.test(a.path)&&!installers.includes(a));
    assert.equal(installers.length,1);assert.equal(portable.length,1);assert(!files.some(f=>/\.msi$/i.test(f)));
    report.windowsInstaller=installers[0];report.windowsPortable=portable[0];
    const versions=report.observedFiles.filter(f=>path.basename(f.path).startsWith("versions-"));
    assert(versions.some(f=>read(f.path).editorVersion==="1.9.22"));
    for(const [label,relative]of [["builder","scripts/build-runtime-standalone-windows.cjs"],["runtime","GameCli_framework/src-tauri/src/lib.rs"]]){
      const expected=sha(path.join(sealed.installRoot,relative));
      assert(report.observedFiles.some(f=>path.basename(f.path).startsWith(label+"-")&&f.sha256===expected));
    }
    const embedded=path.join(path.dirname(portable[0].path),"embedded-cartridge");
    const manifest=read(path.join(embedded,"manifest.json")),script=read(path.join(embedded,"script.json"));
    assert.equal(manifest.game_id,project.project_id);assert.equal(manifest.version,gameVersion);
    for(const i of [0,1,2])assert(JSON.stringify(script).includes(`${marker}_${i}`));
    report.embedded={manifest:desc(path.join(embedded,"manifest.json")),script:desc(path.join(embedded,"script.json"))};
    return {installer:report.windowsInstaller,portable:report.windowsPortable,nativeChooser:true,realUI:true};
  });
  await stage("normal-native-editor-close",normalClose);
  assert.deepEqual(report.errors,[]);unchanged();report.status="PASS";
})().catch(async e=>{
  report.status=pending&&!terminal?"OBSERVATION_FAILED_BUILD_PRESERVED":"FAILED";report.error=String(e.stack||e);
  if(page&&!page.isClosed())await owner.shot("failure").catch(()=>{});
}).finally(async()=>{
  if(pending&&!terminal){
    report.cleanupStatus="LIVE_BUILD_PRESERVED_DO_NOT_RESTART";save();
    console.log(JSON.stringify({status:report.status,out,live:owner?.current,error:report.error}));return;
  }
  try{
    await owner?.stop("Windows native UI finally");
    if(packagePrepared){cache("windows-package-cache-session.ps1","Restore");report.packageRestoration=read(path.join(out,"package-cache-restoration.json"));}
    if(cachePrepared){cache("installed-layout-cache-session.ps1","Restore");report.cacheRestoration=read(path.join(out,"native-cache-restoration.json"));}
    unchanged();report.protectedUnchanged=true;
    const now=rows();assert(!report.knownBuildProcesses.some(p=>now.some(n=>n.ProcessId===p.ProcessId&&n.Created===p.Created)));
    assert.equal(listeners(report.launches.flatMap(l=>l.ports)).length,0);report.cleanupStatus="PASS";
  }catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";}
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,featureStatus:report.featureStatus,
    out,error:report.error,cleanupError:report.cleanupError}));if(report.status!=="PASS")process.exitCode=1;
});
