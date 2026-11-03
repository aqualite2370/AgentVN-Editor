"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const JSZip=require("../editor/node_modules/jszip");
const {chromium}=require("../editor/node_modules/playwright");
const {fixture,startEditorAcceptance}=require("./lib/editor-ui-acceptance.cjs");
const attempt=process.argv[2]||"red-01";assert.match(attempt,/^(?:red|green|matrix)-\d{2}$/);
const out=`F:/AgentVN/QA/Asset-Audit-20261021-01/ui-${attempt}`;
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const f=fixture(`asset-audit-${attempt}`);
f.nodes[1].data.scene.commands=[
 ...Array.from({length:11},(_,i)=>({type:"background",background_id:`missing_${i}`})),
 {type:"dialog",character_id:"alice",text:"这是没有头像和立绘的合法对白。"},
 {type:"video",video_id:"movie_missing"},
 {type:"dialog",character_id:"bob",text:"有引用的资源",portrait:"portrait_missing",voice:"voice_missing",font_asset_id:"font_missing"},
 {type:"bgm",action:"play",bgm_id:"music_missing"},
 {type:"sfx",sfx_id:"sfx_missing"},
 {type:"show_image",image_id:"image_missing"},
 {type:"gallery_anchor",asset_id:"gallery_missing",anchor_id:"test",title:"图"},
 {type:"sprite",character_id:"carol",sprite_id:"sprite_missing",visible:true},
 {type:"narration",text:"对白框资源",dialog_style:{background_asset_id:"box_missing"}},
];
const imageBytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=","base64");
f.asset_manifest=[{asset_id:"valid_background",asset_type:"background",metadata:{
 filename:"有效背景.png",display_name:"有效背景",mime_type:"image/png",data_url:`data:image/png;base64,${imageBytes.toString("base64")}`,
}}];
f.nodes.push({...f.nodes[1],id:"other",position:{x:620,y:180},data:{...f.nodes[1].data,label:"另一场景",
 scene:{...f.nodes[1].data.scene,scene_id:"other_scene",commands:[{type:"narration",text:"无需新增素材的合法场景"}]}}});
const input=path.join(out,"素材检查隔离工程.vnproj");fs.writeFileSync(input,JSON.stringify(f),{flag:"wx"});
process.env.AGENTVN_TEST_PROJECT=input;process.env.AGENTVN_WORKSPACE_OUTPUT=path.join(out,"services");
const report={status:"RUNNING",scope:"SOURCE_REAL_BROWSER_CONTROLLED_FIXTURE",modelRequests:0,cases:[],errors:[],consoleErrors:[],startedAt:new Date().toISOString()};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const requiredCount=21;
const jumps=[[0,"background_id"],[10,"background_id"],[12,"video_id"],[13,"portrait"],[13,"voice"],[13,"font_asset_id"],
 [14,"bgm_id"],[15,"sfx_id"],[16,"image_id"],[17,"asset_id"],[18,"sprite_id"],[19,"dialog_style.background_asset_id"]];
function controlFor(page,index,field){return page.locator(`.command-card[data-command-index="${index}"] [data-asset-field="${field}"] .asset-picker-trigger`);}
async function snapshot(page){
 return page.evaluate(async()=>{
  const {useEditorStore}=await import("/src/store/editorStore.ts");
  // Compare portable graph data; JSON intentionally omits undefined optionals.
  return JSON.parse(JSON.stringify(useEditorStore.getState().nodes.map(({id,type,position,data})=>({id,type,position,data}))));
 });
}
async function assertTarget(page,index,field){
 const selector=`.command-card[data-command-index="${index}"] [data-asset-field="${field}"] .asset-picker-trigger`;
 await page.waitForFunction(selector=>document.querySelector(selector)===document.activeElement,selector);
 await page.waitForFunction(selector=>{
  const e=document.querySelector(selector);if(!e)return false;const r=e.getBoundingClientRect();
  if(r.x<0||r.y<0||r.right>innerWidth||r.bottom>innerHeight)return false;
  for(let n=e.parentElement;n;n=n.parentElement){
   const s=getComputedStyle(n),b=n.getBoundingClientRect();
   if(/auto|scroll|hidden|clip/.test(s.overflowX)&&(r.left<b.left-1||r.right>b.right+1))return false;
   if(/auto|scroll|hidden|clip/.test(s.overflowY)&&(r.top<b.top-1||r.bottom>b.bottom+1))return false;
   if(n.inert||s.visibility==="hidden")return false;
  }
  return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
 },selector);
 return controlFor(page,index,field).evaluate(e=>({
  r:e.getBoundingClientRect().toJSON(),focus:e===document.activeElement,
  overflow:document.documentElement.scrollWidth-innerWidth,
  actual:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches},
 }));
}
async function optionalTransition(page,audit,expand){
 await page.evaluate(()=>{
  window.__assetAuditFrames=[];window.__assetAuditSampling=true;
  function sample(){
   const e=document.querySelector(".asset-audit-optional");if(!e||!window.__assetAuditSampling)return;
   window.__assetAuditFrames.push({t:performance.now(),opacity:Number(getComputedStyle(e).opacity),height:e.getBoundingClientRect().height,inert:e.inert});
   requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
 });
 await audit.getByRole("button",{name:expand?/展开可选建议/:/收起可选建议/}).click();
 if(!expand)assert.equal(await audit.locator(".asset-audit-optional").evaluate(e=>e.inert),true);
 await page.waitForFunction(expand=>{
  const e=document.querySelector(".asset-audit-optional");
  return e&&!e.getAnimations().some(a=>a.playState==="running")&&Number(getComputedStyle(e).opacity)===(expand?1:0)
   &&(expand?e.querySelectorAll("article").length>0:e.querySelectorAll("article").length===0);
 },expand);
 const frames=await page.evaluate(()=>{window.__assetAuditSampling=false;return window.__assetAuditFrames;});
 assert(frames.some(f=>f.opacity>0&&f.opacity<1),"Continuous optional disclosure also in reduced-motion mode");
 return frames;
}
let env,browser;
(async()=>{
 save();env=await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT,{isolateBackendWorkingDirectory:true});
 report.owner={pid:env.server.pid,backendPid:env.backendPid,url:env.url,backendUrl:env.backendUrl};
 browser=await chromium.launch({args:["--use-angle=d3d11"]});
 const matrix=process.env.ASSET_AUDIT_MATRIX==="1"
  ?[[1920,1080],[2560,1440],[3840,2160]].flatMap(([width,height])=>[1,2].flatMap(dpr=>[false,true].map(reduced=>({width,height,dpr,reduced}))))
  :[{width:1920,height:1080,dpr:1,reduced:false}];
 for(const m of matrix){
  const context=await browser.newContext({viewport:{width:m.width,height:m.height},deviceScaleFactor:m.dpr,reducedMotion:m.reduced?"reduce":"no-preference"});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  page.on("pageerror",e=>report.errors.push(String(e)));
  page.on("console",e=>{if(e.type()==="error")report.consoleErrors.push(e.text());});
  await env.server.run(async()=>{
   await env.open(page);await page.locator('.react-flow__node[data-id="scene"]').click();
   const audit=page.locator(".inspector-asset-audit");await audit.waitFor();
   await page.getByRole("button",{name:"定位：需要补充背景图"}).first().waitFor({timeout:8000});
   assert.equal(await audit.locator('article:not(.is-optional)').count(),requiredCount,"All required assets, no slice truncation or fabricated portrait");
   assert.equal(await audit.locator("article.is-optional:visible").count(),0,"Optional assets initially collapsed");
   const opening=await optionalTransition(page,audit,true);
   assert((await audit.locator("article.is-optional:visible").count())>=3);
   const closing=await optionalTransition(page,audit,false);
   // Leaving content stays mounted while its real CSS transition finishes, inert.
   assert.equal(await audit.locator(".asset-audit-optional").getAttribute("aria-hidden"),"true");
   assert.equal(await audit.locator(".asset-audit-optional").evaluate(e=>e.inert),true);
   await page.waitForFunction(()=>document.querySelectorAll(".inspector-asset-audit article.is-optional").length===0);
   assert.equal(await audit.locator("article.is-optional:visible").count(),0);
   const initialGraph=await snapshot(page);
   report.cases.push({...m,name:"required-optional-continuous-disclosure",status:"PASS",opening,closing});save();
   for(const[index,field]of jumps){
    const article=audit.locator(`article[data-command-index="${index}"][data-field="${field}"]`);
    const text=await article.innerText();assert.match(text,/第 \d+ 条/);assert.match(text,/素材库|文件|占位|类型/);
    await article.getByRole("button",{name:/定位/}).click();
    const geometry=await assertTarget(page,index,field);
    assert(geometry.focus&&geometry.overflow<=1);
    assert.deepEqual(geometry.actual,m);
    assert.equal(await audit.count(),1,"One live resource audit panel, no duplicated React children");
    report.cases.push({...m,index,field,status:"PASS",geometry});save();
   }
   // Rapid redirect: only the final field may own focus.
   await audit.locator('article[data-command-index="0"][data-field="background_id"]').getByRole("button",{name:/定位/}).click();
   await audit.locator('article[data-command-index="13"][data-field="voice"]').getByRole("button",{name:/定位/}).click();
   await assertTarget(page,13,"voice");
   const textInput=page.locator('.command-card[data-command-index="13"] textarea[data-help-key="command.dialog.text"]');
   await textInput.fill("编辑后焦点不得被旧定位请求夺回");
   await page.waitForFunction(()=>document.activeElement?.matches('textarea[data-help-key="command.dialog.text"]'));
   // Wait for the real derived audit, not a fixed delay.
   await page.waitForFunction(async()=>{
    const {useEditorStore}=await import("/src/store/editorStore.ts");
    return useEditorStore.getState().nodes.find(n=>n.id==="scene").data.scene.commands[13].text==="编辑后焦点不得被旧定位请求夺回";
   });
   assert(await textInput.evaluate(e=>e===document.activeElement));
   const expectedGraph=structuredClone(initialGraph);
   expectedGraph.find(n=>n.id==="scene").data.scene.commands[13].text="编辑后焦点不得被旧定位请求夺回";
   assert.deepEqual(await snapshot(page),expectedGraph);
   report.cases.push({...m,name:"rapid-redirect-edit-no-focus-steal",status:"PASS"});save();
   // Rebinding a missing background must recompute the live audit and persist.
   await audit.locator('article[data-command-index="0"][data-field="background_id"]').getByRole("button",{name:/定位/}).click();
   await assertTarget(page,0,"background_id");
   await controlFor(page,0,"background_id").click();
   await page.keyboard.press("Escape");
   assert.equal(await audit.locator('article:not(.is-optional)').count(),requiredCount,"Cancel must not change commands");
   await controlFor(page,0,"background_id").click();
   await page.getByRole("dialog",{name:"背景素材选择",exact:true}).locator('[data-asset-id="valid_background"]').click();
   await page.waitForFunction(()=>!document.querySelector('.inspector-asset-audit article[data-command-index="0"][data-field="background_id"]'));
   assert.equal(await audit.locator('article:not(.is-optional)').count(),requiredCount-1);
   // Unconfigured required backgrounds remain required; clearing is never silently "resolved".
   await page.locator('.command-card[data-command-index="0"] [data-asset-field="background_id"]').getByRole("button",{name:/清空/}).click();
   await audit.locator('article[data-command-index="0"][data-field="background_id"]').waitFor();
   assert.match(await audit.locator('article[data-command-index="0"]').innerText(),/尚未配置/);
   await controlFor(page,0,"background_id").click();
   await page.getByRole("dialog",{name:"背景素材选择",exact:true}).locator('[data-asset-id="valid_background"]').click();
   await page.waitForFunction(()=>!document.querySelector('.inspector-asset-audit article[data-command-index="0"][data-field="background_id"]'));
   await audit.getByRole("button",{name:/展开可选建议/}).click();
   await audit.locator('article.is-optional[data-field="sprite_id"]').first().getByRole("button",{name:/定位/}).click();
   const workbench=page.getByRole("complementary",{name:"事件工作台"});
   await workbench.locator('.workbench-type-button[data-command-type="sprite"].is-active').waitFor();
   await page.waitForFunction(()=>document.querySelector(".workbench-detail-card>header")?.textContent.includes("立绘"));
   await workbench.locator('[data-help-key="command.sprite.characterId"]').waitFor();
   assert.equal(await workbench.locator('[data-help-key="command.sprite.characterId"]').inputValue(),"alice");
   await audit.locator('article.is-optional[data-field="sprite_id"]').filter({hasText:"bob"}).getByRole("button",{name:/定位/}).click();
   await page.waitForFunction(()=>document.querySelector('[data-help-key="command.sprite.characterId"]')?.value==="bob");
   await audit.locator('article.is-optional[data-field="portrait"]').getByRole("button",{name:/定位/}).click();
   await assertTarget(page,11,"portrait");
   expectedGraph.find(n=>n.id==="scene").data.scene.commands[0].background_id="valid_background";
   assert.deepEqual(await snapshot(page),expectedGraph,"Optional suggestions must never create commands");
   report.cases.push({...m,name:"real-rebinding-clear-optional-targets-no-auto-insertion",status:"PASS"});save();
   // The optional disclosure must survive reversal with one live panel.
   await audit.getByRole("button",{name:/收起可选建议/}).click();
   assert(await audit.locator(".asset-audit-optional").evaluate(e=>e.inert));
   await audit.getByRole("button",{name:/展开可选建议/}).click();
   await page.waitForFunction(()=>document.querySelector(".asset-audit-optional")?.getAttribute("aria-hidden")==="false"
    &&document.querySelectorAll(".asset-audit-optional article").length>=3);
   assert.equal(await audit.count(),1);
   // Switch nodes while a target is being prepared; old focus must not cross scene ownership.
   await workbench.getByRole("button",{name:"最小化事件工作台",exact:true}).click();
   await audit.locator('article[data-command-index="10"]').getByRole("button",{name:/定位/}).click();
   await page.locator('.react-flow__node[data-id="other"]').click();
   await page.locator('input[data-help-key="field.scene_id"][value="other_scene"]').waitFor();
   await page.waitForFunction(()=>document.querySelector(".inspector-asset-audit header")?.textContent.includes("0 项必补"));
   assert.equal(await audit.locator("article:not(.is-optional)").count(),0);
   assert(!(await page.evaluate(()=>document.activeElement?.closest('.command-card[data-command-index="10"]')!=null)));
   await workbench.getByRole("button",{name:"最小化事件工作台",exact:true}).click();
   await page.locator('.react-flow__node[data-id="scene"]').click();
   await audit.locator('article[data-command-index="10"]').waitFor();
   assert.equal(await audit.locator("article:not(.is-optional)").count(),requiredCount-1);
   assert.equal(await audit.locator("article.is-optional:visible").count(),0,"Different scene resets disclosure");
   report.cases.push({...m,name:"disclosure-reverse-node-ownership",status:"PASS"});save();
   const downloaded=page.waitForEvent("download");
   await page.getByRole("button",{name:"保存工程",exact:true}).click();
   const download=await downloaded,packagePath=path.join(out,`saved-${m.width}-dpr${m.dpr}-${m.reduced?"reduce":"normal"}.vnproj`);
   await download.saveAs(packagePath);
   await page.getByTestId("project-save-confirmation").getByRole("button",{name:"OK",exact:true}).click();
   const zip=await JSZip.loadAsync(fs.readFileSync(packagePath));
   const savedProject=JSON.parse(await zip.file("project.json").async("string"));
   assert.deepEqual(savedProject.nodes.map(({id,type,position,data})=>({id,type,position,data})),expectedGraph);
   const savedAsset=savedProject.asset_manifest.find(a=>a.asset_id==="valid_background");
   assert.deepEqual(await zip.file(savedAsset.metadata.project_path).async("nodebuffer"),imageBytes);
   const reloadContext=await browser.newContext({viewport:{width:m.width,height:m.height},deviceScaleFactor:m.dpr,reducedMotion:m.reduced?"reduce":"no-preference"});
   try{
    const reopened=await reloadContext.newPage();
    await reopened.goto(env.url);
    await reopened.waitForFunction(()=>[...document.querySelectorAll(".project-import-button input")].some(e=>!e.disabled));
    await reopened.locator(".project-import-button input").first().setInputFiles(packagePath);
    await reopened.waitForFunction(()=>document.querySelector(".editor-toolbar")&&!document.querySelector(".project-entry-loading-overlay"));
    await reopened.locator('.react-flow__node[data-id="scene"]').click();
    await reopened.waitForFunction(()=>document.querySelectorAll(".inspector-asset-audit article:not(.is-optional)").length===20);
    assert.deepEqual(await snapshot(reopened),expectedGraph);
   }catch(error){
    const reopened=reloadContext.pages()[0];
    if(reopened){
     report.reopenDiagnostics=await reopened.locator("body").innerText();
     await reopened.screenshot({path:path.join(out,`reopen-failure-${m.width}-dpr${m.dpr}.png`)});
    }
    throw error;
   }finally{await reloadContext.close();}
   const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
   assert.deepEqual(actual,m);
   const screenshotPath=path.join(out,`audit-${m.width}-dpr${m.dpr}-${m.reduced?"reduce":"normal"}.png`);
   await page.screenshot({path:screenshotPath});
   const png=fs.readFileSync(screenshotPath);
   assert.equal(png.readUInt32BE(16),m.width*m.dpr);assert.equal(png.readUInt32BE(20),m.height*m.dpr);
   report.cases.push({...m,name:"real-save-bundle-bytes-reopen",status:"PASS",actual,packagePath,
    sha256:crypto.createHash("sha256").update(fs.readFileSync(packagePath)).digest("hex"),screenshotPath});save();
  });
  await context.close();
 }
 assert.equal(report.cases.length,(process.env.ASSET_AUDIT_MATRIX==="1"?12:1)*17);
 assert.deepEqual(report.errors,[]);
 assert(!report.consoleErrors.some(e=>/same key|unmounted|maximum update/i.test(e)),JSON.stringify(report.consoleErrors));
 report.status="PASS";
})().catch(async e=>{report.status="FAILED";report.error=String(e.stack);process.exitCode=1;
 const page=browser?.contexts()[0]?.pages()[0];if(page)try{
  report.domDiagnostics=await page.locator('.inspector-asset-audit article[data-command-index="10"]').evaluateAll(items=>items.map(e=>{
   const ancestors=[];for(let n=e;n;n=n.parentElement)ancestors.push({
    tag:n.tagName,class:n.className,hidden:n.getAttribute("aria-hidden"),inert:n.inert,
    pointerEvents:getComputedStyle(n).pointerEvents,rect:n.getBoundingClientRect().toJSON(),
   });
   return {text:e.textContent,ancestors};
  }));
  await page.screenshot({path:path.join(out,"failure.png")});
 }catch{}
}).finally(async()=>{
 await browser?.close();
 try{await env?.stop();if(env){const responding=await Promise.all([env.url,`${env.backendUrl}/api/health`].map(async u=>{
  try{await fetch(u,{signal:AbortSignal.timeout(600)});return u;}catch{return null;}}));
  assert(!responding.some(Boolean));report.cleanup={status:"PASS"};}}
 catch(e){report.status="FAILED";report.cleanupError=String(e);process.exitCode=1;}
 report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,out,error:report.error}));
});
