"use strict";
// GUI library state is machine-local; only copied project resources/layouts
// travel in vnproj. Exercise an actual native save and fresh-profile open.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");
const JSZip=require("../editor/node_modules/jszip");
const A=require("./lib/installed-acceptance.cjs");
const {installedReleaseSession}=require("./lib/installed-release-session.cjs");
const {ps}=require("./lib/current-native-editor-session.cjs");
const root=path.resolve(__dirname,"..");
const sourceRoot="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-66";
const out="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-67";
const installationFile="F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json";
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>A.sha256(fs.readFileSync(f));
const desc=f=>({path:path.resolve(f),sha256:sha(f),bytes:fs.statSync(f).size});
const source=read(path.join(sourceRoot,"report.json"));
assert.equal(source.status,"EDITOR_PASS_NATIVE_PLAYER_NOT_RUN");
assert(source.steps.length===8&&source.steps.every(s=>s.status==="PASS"));assert.equal(source.assetProofs.length,26);
assert(!fs.existsSync(out));fs.mkdirSync(out);
const inventory=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const f=path.join(dir,e.name);assert(!e.isSymbolicLink());
  return e.isDirectory()?inventory(f):[desc(f)];
}).sort((a,b)=>a.path.localeCompare(b.path));
const sourceFiles=inventory(path.join(sourceRoot,"data"));
fs.cpSync(path.join(sourceRoot,"data"),path.join(out,"data"),{recursive:true,errorOnExist:true,force:false});
const report={status:"RUNNING",version:"1.9.30",at:new Date().toISOString(),source:desc(path.join(sourceRoot,"report.json")),
  cases:[],launches:[],cleanups:[],screenshots:[],errors:[],modelRequests:0,productChanges:0,builds:0,
  scope:"ACTUAL_INSTALLED_GUI_PROJECT_NATIVE_VNPROJ_SAVE_AND_FRESH_PROFILE_NATIVE_OPEN",
  boundaries:["No personal library export claim","Explicit isolated profile, not default-data-path acceptance",
    "Owned forced restart, not normal-close claim","No setup, Android, upgrade or real model"]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let host,page,cachePrepared=false,download;
async function cache(action) {
  const r=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(root,"scripts/installed-layout-cache-session.ps1"),"-Action",action,"-RunDirectory",out,"-CodexCacheView"],
    {encoding:"utf8",windowsHide:true,timeout:45000});
  (report.cache??=[]).push({action,code:r.status,stdout:r.stdout,stderr:r.stderr});save();
  assert.equal(r.status,0,r.stdout+r.stderr);
}
async function stage(name,fn) {
  const c={name,status:"RUNNING",at:new Date().toISOString()};report.cases.push(c);save();
  try{c.detail=await fn();c.status="PASS";console.log("PASS "+name);}
  catch(e){c.status="FAILED";c.error=String(e.stack||e);throw e;}
  finally{c.finishedAt=new Date().toISOString();save();}
}
async function start(run) {
  host=installedReleaseSession({installationFile,out:run,report,save,input:source.environment.AGENTVN_TEST_PROJECT});
  page=await host.start();
}
async function resources(snapshot) {
  assert.equal(snapshot.projectId,source.savedProject.projectId);
  assert.deepEqual(snapshot.settings.runtimeUILayoutProfiles,source.savedProject.settings.runtimeUILayoutProfiles);
  assert.deepEqual(snapshot.settings.runtimeUILayout,source.savedProject.settings.runtimeUILayout);
  assert.equal(snapshot.assetManifest.length,26);
  const proof=[];
  for(const a of snapshot.assetManifest) {
    const expected=source.assetProofs.find(f=>f.id===a.asset_id);assert(expected,a.asset_id);
    const bytes=await A.assetBytes(host.current.ports[0],a);
    assert.equal(A.sha256(bytes),expected.sha256);proof.push({id:a.asset_id,sha256:expected.sha256});
  }
  return proof;
}
(async()=>{
  fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);
  cachePrepared=true;await cache("Prepare");
  await start(out);
  await stage("original-authored-project-from-copied-isolated-database",async()=>{
    await page.locator('[data-help-key="home.recentProject"]').filter({hasText:source.savedProject.title}).click();
    await A.settleEditor(page);
    return {resources:await resources(await A.projectSnapshot(host.current.ports[0]))};
  });
  await stage("actual-native-save-portable-two-layouts-and-all-resource-bytes",async()=>{
    const downloads=ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    const before=new Set(fs.readdirSync(downloads));
    await page.getByRole("button",{name:"保存工程",exact:true}).click();
    const modal=page.getByTestId("project-save-confirmation");await modal.waitFor();
    const added=fs.readdirSync(downloads).filter(f=>!before.has(f)&&f.startsWith(source.savedProject.title)&&f.endsWith(".vnproj"));
    assert.equal(added.length,1);
    download=path.join(downloads,added[0]);
    const target=path.join(out,"完整GUI资源工程往返.vnproj");
    fs.copyFileSync(download,target,fs.constants.COPYFILE_EXCL);assert.equal(sha(target),sha(download));
    report.portable=desc(target);report.download=desc(download);save();
    assert((await modal.innerText()).includes(download));
    const z=await JSZip.loadAsync(fs.readFileSync(target),{checkCRC32:true});
    const p=JSON.parse(await z.file("project.json").async("string"));
    assert.equal(p.project_id,source.savedProject.projectId);
    assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles,source.savedProject.settings.runtimeUILayoutProfiles);
    assert.deepEqual(p.editor_settings.runtimeUILayout,source.savedProject.settings.runtimeUILayout);
    assert.equal(p.asset_manifest.length,26);
    assert(!JSON.stringify(p).includes("projectExportDirectories"));
    for(const a of p.asset_manifest) {
      const expected=source.assetProofs.find(f=>f.id===a.asset_id);assert(expected);
      assert.equal(A.sha256(await z.file(a.metadata.project_path).async("nodebuffer")),expected.sha256);
    }
    await modal.getByRole("button",{name:"OK",exact:true}).click();await modal.waitFor({state:"hidden"});
    return {portable:report.portable,resources:26,bothLayouts:true};
  });
  await stage("fresh-native-file-open-restores-both-layouts-and-twenty-six-resources",async()=>{
    await host.stop("GUI portable fresh-profile boundary; exact owned forced stop");host=page=undefined;
    const fresh=path.join(out,"fresh-profile");fs.mkdirSync(fresh);await start(fresh);
    const trigger=page.getByLabel("创建或打开项目").getByRole("button",{name:"导入项目",exact:true});
    const input=await A.nativeInput({page,trigger,out,name:"gui-portable-native-open",ownerPid:host.current.pid,
      selectedPath:report.portable.path,timeoutMs:1200000});
    await page.locator(".editor-toolbar").waitFor();await A.settleEditor(page);
    const proof=await resources(await A.projectSnapshot(host.current.ports[0]));
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem("agentvn.projectExportDirectories.v1")||"{}")),{});
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();await A.settleEditor(page);
    await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.getByTestId("renpy-gui-import-open").click();
    const d=page.getByTestId("renpy-gui-import-dialog");await d.waitFor();
    assert.equal(await d.locator("article[data-pack-id]").count(),0,"Personal GUI library must not travel in project");
    await d.getByRole("button",{name:"取消，不修改工程",exact:true}).click();await d.waitFor({state:"detached"});
    await host.shot("native-reopened-layout");
    return {input,resources:proof,localLibraryNotBundled:true,bothLayouts:true};
  });
  assert.equal(report.cases.length,3);assert.deepEqual(report.errors,[]);assert.equal(report.modelRequests,0);
  report.status="PASS";
})().catch(async e=>{
  report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;
  if(page)try{report.failureText=await page.locator("body").innerText();}catch{}
}).finally(async()=>{
  try {
    if(host)await host.stop("GUI portable finally; exact owned cleanup");
    if(cachePrepared){await cache("Restore");assert.equal(read(path.join(out,"native-cache-restoration.json")).status,"PASS");}
    assert.deepEqual(inventory(path.join(sourceRoot,"data")),sourceFiles);
    report.sourceFilesUnchanged=true;
    if(download&&fs.existsSync(download)) {
      assert.equal(sha(download),report.portable.sha256);assert.equal(sha(report.portable.path),report.portable.sha256);
      assert.equal(path.dirname(download),path.join(process.env.USERPROFILE,"Downloads"));
      fs.unlinkSync(download);report.downloadCleanup={status:"PASS",retained:report.portable,removed:download};
    }
    assert(report.cleanups.length>0&&report.cleanups.every(c=>c.status==="PASS"));
  }catch(e){report.status="FAILED";report.cleanupError=String(e.stack||e);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,out,error:report.error,cleanupError:report.cleanupError}));
});
