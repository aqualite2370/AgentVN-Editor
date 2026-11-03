"use strict";
// Attach only to the verified, already-running isolated Editor while its main
// directory harness waits for a normal-close receipt. Never owns/terminates it.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");
const {chromium}=require("../editor/node_modules/playwright");
const A=require("./lib/installed-acceptance.cjs");
const {rows,until}=require("./lib/current-native-editor-session.cjs");
const recovering=process.argv[3]==="--recover";
assert(process.argv[3]===undefined||recovering);
const run=path.resolve(process.argv[2]||""),out=path.join(run,recovering?"acl-recovery-01":"acl-supplement-01");
assert.equal(run,path.resolve("F:/AgentVN/QA/Project-Directory-Installed-20261022-01/editor-05"));
assert(!fs.existsSync(out));fs.mkdirSync(out);
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const source=read(path.join(run,"report.json")),launch=source.launches.at(-1),project=source.projects[1];
assert.equal(source.status,"RUNNING");assert.equal(source.stage,"primary-final-normal-close");
assert(rows().some(p=>p.ProcessId===launch.pid&&p.Created===launch.created));
assert.equal(A.sha256(fs.readFileSync(launch.executable.path)),launch.executable.sha256);
const report={status:"RUNNING",at:new Date().toISOString(),run,launch,
  project,modelRequests:0,productChanges:0,checks:[],errors:[]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const receipt=path.join(run,"acl-supplement-01","acl-before.json");let browser,page,denied=false;
function acl(mode){
  const result=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(__dirname,"project-directory-installed-acl.ps1"),"-Mode",mode,
    "-Directory",project.directory,"-Receipt",receipt],{windowsHide:true,encoding:"utf8",timeout:30000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  return JSON.parse(result.stdout.replace(/^\uFEFF/,"").trim());
}
const ownFiles=dir=>fs.readdirSync(dir).filter(n=>n.startsWith(project.title)&&/\.vnproj(?:\.tmp)?$/.test(n))
  .map(n=>({path:path.join(dir,n),sha256:A.sha256(fs.readFileSync(path.join(dir,n)))}));
(async()=>{
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${launch.ports[1]}`);
  page=browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri\.localhost/.test(p.url()));
  assert(page);page.setDefaultTimeout(30000);
  if(recovering){
    const failed=read(path.join(run,"acl-supplement-01","report.json"));
    assert.equal(failed.status,"FAILED");
    assert.equal(failed.checks.find(c=>c.name==="real-denial-no-partial-file-no-fallback-no-success")?.status,"PASS");
    report.originalEvidence={path:path.join(run,"acl-supplement-01","report.json"),
      sha256:A.sha256(fs.readFileSync(path.join(run,"acl-supplement-01","report.json")))};
    report.restoration=acl("restore");save();
    const before=ownFiles(project.directory);
    await page.locator('[data-workspace-surface="edit"]:visible').click();await A.settleEditor(page);
    await page.getByRole("button",{name:"保存工程",exact:true}).click();
    const confirmation=page.getByTestId("project-save-confirmation");await confirmation.waitFor();
    const added=ownFiles(project.directory).filter(f=>!before.some(b=>b.path===f.path));assert.equal(added.length,1);
    assert((await confirmation.innerText()).includes(added[0].path));
    for(const f of before)assert.equal(A.sha256(fs.readFileSync(f.path)),f.sha256);
    report.retryPackage=added[0];report.checks.push({name:"same-directory-retry-after-real-acl-restoration",status:"PASS"});
    await confirmation.getByRole("button",{name:"OK",exact:true}).click();
    report.status="PASS";return;
  }
  const settings=page.getByRole("region",{name:"工程保存目录",exact:true});
  assert((await settings.innerText()).includes(project.directory));
  const downloads=path.join(process.env.USERPROFILE,"Downloads"),beforeDownloads=ownFiles(downloads),before=ownFiles(project.directory);
  const errorRoot=path.join(path.dirname(launch.executable.path),"error_log"),old=new Set(fs.readdirSync(errorRoot));
  denied=true;report.denial=acl("deny");save();
  try{
    await page.locator('[data-workspace-surface="edit"]:visible').click();await A.settleEditor(page);
    await page.getByRole("button",{name:"保存工程",exact:true}).click();
    await page.locator(".toast-status.is-error:visible").waitFor();
    report.notice=await page.locator(".toast-status.is-error:visible").innerText();
    const raw=await until(()=>{
      for(const name of fs.readdirSync(errorRoot)){
        if(old.has(name)||!/^AgentVN-Error-\d+\.txt$/.test(name))continue;
        const file=path.join(errorRoot,name),text=fs.readFileSync(file,"utf8");
        if(text.includes(project.projectId)&&text.includes("Source: 保存工程"))return {file,text};
      }
    },"new actual ACL-denied save report");
    assert(/无法创建工程包临时文件|拒绝访问|Access is denied/.test(raw.text));
    report.errorReport={source:raw.file,path:path.join(out,"native-save-error.txt")};
    fs.copyFileSync(raw.file,report.errorReport.path,fs.constants.COPYFILE_EXCL);
    report.errorReport.sha256=A.sha256(fs.readFileSync(report.errorReport.path));
    report.summary=raw.text.split("== Developer Diagnosis ==")[0];
    assert.equal(await page.getByTestId("project-save-confirmation").count(),0);
    assert.deepEqual(ownFiles(downloads),beforeDownloads);assert.deepEqual(ownFiles(project.directory),before);
    report.checks.push({name:"real-denial-no-partial-file-no-fallback-no-success",status:"PASS"});
    // Assess the original error and suggested action, not incidental context.
    const summary=report.summary;
    const actionable=summary.includes(project.directory)&&/重新选择|保存目录/.test(summary);
    report.checks.push({name:"denial-identifies-selected-path-and-directory-recovery",
      status:actionable?"PASS":"FAILED",summary});
    save();
  }finally{report.restoration=acl("restore");denied=false;save();}
  await page.getByRole("button",{name:"保存工程",exact:true}).click();
  const confirmation=page.getByTestId("project-save-confirmation");await confirmation.waitFor();
  const added=ownFiles(project.directory).filter(f=>!before.some(b=>b.path===f.path));assert.equal(added.length,1);
  assert((await confirmation.innerText()).includes(added[0].path));
  report.retryPackage=added[0];report.checks.push({name:"same-directory-retry-after-real-acl-restoration",status:"PASS"});
  await confirmation.getByRole("button",{name:"OK",exact:true}).click();
  report.status=report.checks.every(c=>c.status==="PASS")?"PASS":"FAILED";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);})
  .finally(async()=>{
    try{if(denied&&fs.existsSync(receipt)){report.restoration=acl("restore");denied=false;}}
    catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";}
    await browser?.close().catch(()=>{});
    report.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({status:report.status,out,checks:report.checks,error:report.error,cleanupError:report.cleanupError}));
    if(report.status!=="PASS")process.exitCode=1;
  });
