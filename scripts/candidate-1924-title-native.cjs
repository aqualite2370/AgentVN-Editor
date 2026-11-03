"use strict";
// New receipt-bound authoring run. The previously sealed 1.9.23 tool is unchanged.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),JSZip=require("../editor/node_modules/jszip");
const {installedReleaseSession}=require("./lib/installed-release-session.cjs");
const {settleEditor}=require("./lib/installed-acceptance.cjs");
const attempt=process.argv[2];assert(/^\d{2}$/.test(attempt||""));
const base="F:/AgentVN/QA/Editor-1.9.24-20261024-01",out=path.join(base,`title-${attempt}`);
const installationFile=path.join(base,"installation.json");
assert(!fs.existsSync(out));fs.mkdirSync(out);
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc=f=>({path:path.resolve(f),sha256:sha(f)});
const installed=read(installationFile),packageReport=read(path.join(base,"package-01/report.json"));
function verify(){
  assert.equal(installed.status,"PASS");assert.equal(installed.metadataRestoration,"PASS");
  assert.equal(installed.executable.version,"1.9.24");assert.equal(packageReport.status,"PASS");
  assert.equal(installed.package.sha256,packageReport.installer.sha256);
  for(const f of [installed.executable,...installed.resources,...installed.protectedFiles,
    packageReport.installer])assert.equal(sha(f.path),f.sha256,f.path);
}
const priorFile="F:/AgentVN/QA/Renpy-Title-Text-20261024-01/green-06/1920x1080-dpr2-reduced/report.json";
const prior=read(priorFile);assert.equal(prior.status,"PASS");assert.equal(sha(prior.portable.path),prior.portable.sha256);
const report={status:"RUNNING",startedAt:new Date().toISOString(),modelRequests:0,
  scope:"INSTALLED_1_9_24_EDITOR_AUTHOR_SAVE_RESTART_AND_BUNDLED_IFRAME_NOT_STANDALONE_OR_ANDROID",
  boundaries:["Public API fixture preparation, not a native import picker",
    "Real installed WebView viewport simulation, not physical 4K",
    "Exact process teardown, not normal native close acceptance"],
  installation:desc(installationFile),input:prior.portable,cases:[],matrix:[],launches:[],knownProcesses:[],
  cleanups:[],screenshots:[],errors:[],
  tools:[__filename,"scripts/lib/installed-release-session.cjs","scripts/lib/current-native-capture.cjs",
    "scripts/lib/current-native-editor-session.cjs","scripts/lib/installed-acceptance.cjs"].map(desc)};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const session=installedReleaseSession({installationFile,out,input:prior.portable.path,report,save});
let page;
async function step(name,fn){
  const row={name,status:"RUNNING"};report.cases.push(row);save();
  try{row.detail=await fn();row.status="PASS";}
  catch(error){row.status="FAILED";row.error=String(error.stack||error);throw error;}
  finally{save();console.log(`${row.status} ${name}`);}
}
async function openRecent(){
  await page.locator(".project-home").waitFor();
  await page.locator(".recent-project-open:not(:disabled):visible").filter({hasText:report.fixtureSetup.title}).click();
}
async function openLayout(){
  await page.locator(".editor-toolbar").waitFor();await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.getByTestId("renpy-title-editor").waitFor();await settleEditor(page);
  await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_hero"]').click();
}
async function actualFrame(){
  const button=page.getByTestId("renpy-title-runtime-preview-toggle");
  if(await button.getAttribute("aria-pressed")!=="true")await button.click();
  await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
  return page.frameLocator(".renpy-editor-runtime-viewport iframe");
}
async function content(title,version){
  const frame=await actualFrame();await frame.locator(".renpy-title-view").waitFor();
  for(const [selector,text]of [["h1",title],["p",version]]){
    const item=frame.locator(`.renpy-title-heading ${selector}`);
    if(text===undefined)assert.equal(await item.count(),0);else assert.equal(await item.innerText(),text);
  }
  assert.equal(await frame.getByTestId("open-help").innerText(),"操作说明");
}
(async()=>{
  save();verify();page=await session.start();
  await step("Native project UI loads independent title/version configuration and real Runtime",async()=>{
    const zip=await JSZip.loadAsync(fs.readFileSync(prior.portable.path),{checkCRC32:true});
    const project=JSON.parse(await zip.file("project.json").async("string"));
    const response=await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`,{
      method:"POST",headers:{"content-type":"application/octet-stream","X-AgentVN-Filename":"title-text.vnproj"},
      body:fs.readFileSync(prior.portable.path),signal:AbortSignal.timeout(30000)});
    assert(response.ok&&(await response.json()).ok);
    const stored=(await session.rawApi(`/api/project/projects/${project.project_id}`)).data;
    assert.deepEqual(stored.editor_settings.runtimeUILayout.renpyTitleText,prior.portable.expected);
    report.fixtureSetup={projectId:project.project_id,title:project.title};save();
    await page.reload();await openRecent();await openLayout();await content(undefined,"特别版 · 第一卷");
  });
  await step("Ordinary controls independently hide title and version while preserving text and native menu actions",async()=>{
    await page.getByRole("checkbox",{name:"显示标题",exact:true}).check();
    await content("标题显隐隔离工程","特别版 · 第一卷");
    await page.getByRole("checkbox",{name:"显示版本",exact:true}).uncheck();
    await content("标题显隐隔离工程",undefined);
    await page.getByRole("checkbox",{name:"显示标题",exact:true}).uncheck();await content(undefined,undefined);
    await page.getByRole("checkbox",{name:"显示版本",exact:true}).check();await content(undefined,"特别版 · 第一卷");
    await page.locator('[data-help-key="layout.save"]:visible').click();
    await page.waitForFunction(()=>document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
  });
  await step("Real saved backend state and native reload retain title text choices",async()=>{
    const stored=(await session.rawApi(`/api/project/projects/${report.fixtureSetup.projectId}`)).data;
    assert.deepEqual(stored.editor_settings.runtimeUILayout.renpyTitleText,prior.portable.expected);
    await page.reload();await openRecent();await openLayout();await content(undefined,"特别版 · 第一卷");
  });
  await step("Actual new host/backend process restores project across 12 native display conditions",async()=>{
    await session.stop("Owned restart; not normal native close acceptance");page=await session.start();
    await openRecent();await openLayout();
    for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])
      for(const dpr of [1,2])for(const reduced of [false,true]){
        const params={width,height,dpr,reduced};await session.metrics(params);await settleEditor(page);
        await content(undefined,"特别版 · 第一卷");
        const geometry=await page.locator(".renpy-editor-runtime-viewport iframe").evaluate(n=>{
          const r=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();
          return {frame:r.toJSON(),container:p.toJSON(),overflow:document.documentElement.scrollWidth-innerWidth};
        });
        const g=geometry;assert(g.overflow<=1&&g.frame.width>0&&g.frame.height>0);
        assert(g.frame.left>=g.container.left-1&&g.frame.top>=g.container.top-1
          &&g.frame.right<=g.container.right+1&&g.frame.bottom<=g.container.bottom+1);
        const screenshot=await session.shot(`${width}-${dpr}-${reduced}`);
        report.matrix.push({params,geometry,screenshot:screenshot.path,status:"PASS"});save();
      }
  });
  assert.equal(report.cases.length,4);assert.equal(report.matrix.length,12);
  assert.deepEqual(report.errors,[]);verify();report.status="PASS";
})().catch(error=>{
  report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;
}).finally(async()=>{
  try{
    await session.stop("Terminal exact owned cleanup");
    assert.equal(report.cleanups.length,report.launches.length);assert(report.cleanups.every(c=>c.status==="PASS"));
    for(const f of report.tools)assert.equal(sha(f.path),f.sha256);verify();
  }catch(error){report.status="FAILED";report.cleanupError=String(error.stack||error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,out,error:report.error,cleanupError:report.cleanupError}));
});
