"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require("../editor/node_modules/playwright");
const {buildSync}=require("../editor/node_modules/esbuild");
const A=require("./lib/installed-acceptance.cjs");
const {fixture}=require("./lib/editor-ui-acceptance.cjs");
const {desktopViewports}=require("./lib/current-acceptance-viewports.cjs");
const {controlledAssistantProvider}=require("./lib/controlled-assistant-provider.cjs");
const {startInstalledEditor}=require("./lib/owned-installed-editor.cjs");
assert(process.argv[2]&&process.argv[3],"Pass verified actual installation report and fresh run root");
const auditFile=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
assert(!fs.existsSync(out));assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT||""),out);
assert(process.env.AGENTVN_TEST_PROJECT&&A.inside(out,path.resolve(process.env.AGENTVN_TEST_PROJECT)));
fs.mkdirSync(out,{recursive:true});fs.copyFileSync(auditFile,path.join(out,"installer-resource-report.json"));
const report={status:"RUNNING",startedAt:new Date().toISOString(),scope:"Actual installed Editor/backend; controlled external model HTTP, no paid model and no API/store mocks",cases:[],matrix:[],lockMatrix:[],errors:[],submissions:[],launches:[],cleanup:[]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let owner,provider,browser,page,session,state,projects,before,sourceStorage,peerBrowser,peerOwner,peerContext;
async function read(route){const response=await fetch(`http://127.0.0.1:${state.backendPort}${route}`,{signal:AbortSignal.timeout(10000)});assert(response.ok,`HTTP ${response.status} ${route}`);return response.json();}
async function processes(){return(await read("/api/assistant/creation/processes")).processes;}
async function waitModel(marker){const deadline=Date.now()+15000;while(Date.now()<deadline){if(provider.requests.some(item=>item.marker===marker))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Controlled model did not receive ${marker}`);}
async function waitProcess(id,predicate,timeout=20000){const deadline=Date.now()+timeout;let latest;while(Date.now()<deadline){latest=await read(`/api/assistant/creation/processes/${id}`);if(predicate(latest))return latest;await new Promise(resolve=>setTimeout(resolve,150));}report.lastProcess=latest;throw new Error(`Process condition failed ${id}: ${latest?.status}`);}
async function stage(name,operation){report.stage=name;save();console.log(`START ${name}`);await operation();report.cases.push({name,status:"PASS"});save();console.log(`PASS ${name}`);}
async function installedPage(connection){const deadline=Date.now()+45000;while(Date.now()<deadline){const candidate=connection.contexts().flatMap(context=>context.pages()).find(p=>/tauri\.localhost/.test(p.url()));if(candidate)return candidate;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error("Owned installed WebView never navigated to tauri.localhost");}
async function connect(){
 state=owner.state;
 if(state.source){
   report.scope="Source full Editor/backend repair regression with controlled external HTTP; NOT installed Release evidence";
   report.launches.push(state);browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1920,height:1080},storageState:sourceStorage});page=await context.newPage();await page.goto(state.sourceUrl,{waitUntil:"domcontentloaded"});
 }else{const verified=A.readInstalledSession(out);report.launches.push({...state,exeSha256:verified.exeSha256});browser=await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);page=await installedPage(browser);}
 assert(page);page.setDefaultTimeout(30000);
 page.on("pageerror",error=>report.errors.push(String(error)));session=await browser.contexts()[0].newCDPSession(page);
 page.on("request",request=>{if(request.method()==="POST"&&request.url().endsWith("/api/assistant/creation/processes")){const payload=request.postDataJSON();report.submissions.push({id:payload.id,projectId:payload.project_id,conversationId:payload.conversation_id,userRequest:payload.request.user_request,keys:Object.keys(payload.request)});save();}});
 await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
}
async function goHome(){
 const lock=page.getByTestId("assistant-project-lock-dialog");
 if(await lock.isVisible().catch(()=>false))await lock.getByRole("button",{name:"返回工程列表",exact:true}).click();
 else{await page.locator('[data-workspace-surface="edit"]:visible').click();await A.settleEditor(page);await page.getByRole("button",{name:"返回首页",exact:true}).click();}
 await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
 await page.waitForFunction(()=>!document.querySelector(".app-transition-stage.is-switching"));
}
async function openProject(project){await page.locator(".recent-project-open:not(:disabled):visible").filter({hasText:project.title}).first().click();await page.locator(".editor-toolbar").waitFor();await A.settleEditor(page);assert.equal((await A.projectSnapshot(state.backendPort)).projectId,project.project_id);}
async function assistant(mode){
 await page.locator('[data-workspace-surface="assistant"]:visible').click();await A.settleEditor(page);
 const panel=page.locator(".workspace-task-panel.is-open .assistant-chat-panel");await panel.waitFor();assert.equal(await panel.count(),1);
 await panel.getByRole("button",{name:mode==="creation"?"创造模式":"问询模式",exact:true}).click();
 await panel.locator('textarea[aria-label="向大模型助手提问"]:not(:disabled)').waitFor();return panel;
}
async function submit(panel,text){await panel.getByLabel("向大模型助手提问",{exact:true}).fill(text);const previous=report.submissions.length;await panel.getByRole("button",{name:"生成创作提案",exact:true}).click();const deadline=Date.now()+10000;while(report.submissions.length===previous&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));assert.equal(report.submissions.length,previous+1);return report.submissions.at(-1);}
async function openHistory(panel){const details=panel.locator(".assistant-history-popover");if(!await details.evaluate(n=>n.open))await details.locator("summary").click();return details;}
async function restart(){
 if(state.source)sourceStorage=await browser.contexts()[0].storageState({indexedDB:true});
 await browser.close();browser=undefined;report.cleanup.push(await owner.stop());owner=undefined;
 owner=await startInstalledEditor(out,{restart:true});await connect();
}
async function unchanged(){for(const project of projects){const current=(await read(`/api/project/projects/${project.project_id}`)).data;assert.deepEqual(current.editor_settings,before[project.project_id].editor_settings);
  // ReactFlow measured width/height is viewport presentation, not authored graph.
  const authored=nodes=>nodes.map(({measured,...node})=>node);
  assert.deepEqual(authored(current.nodes),authored(before[project.project_id].nodes));assert.deepEqual(current.edges,before[project.project_id].edges);}}
async function main(){
 provider=await controlledAssistantProvider();provider.hold("QUEUE_A");provider.hold("INTERRUPTED_A");
 owner=await startInstalledEditor(out);state=owner.state;
 const compiled=buildSync({stdin:{resolveDir:path.resolve(__dirname,".."),loader:"ts",contents:'export {switchRuntimeUILayoutType} from "./shared/cartridge/uiLayoutProfiles"; export {useProjectStore} from "./editor/src/store/projectStore";'},bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text;
 const exports={exports:{}};new Function("module","exports",compiled)(exports,exports.exports);
 projects=["a","b"].map(suffix=>{const p=fixture(`installed_lifecycle_${suffix}_20261014`);p.title=`安装版会话工程 ${suffix.toUpperCase()}`;const defaults=structuredClone(exports.exports.useProjectStore.getState().settings);p.editor_settings={...defaults,...exports.exports.switchRuntimeUILayoutType(defaults,"renpy")};p.nodes[0].data.loadingAnimation={kind:"default"};p.nodes[0].data.openingAudio=[];return p;});
 before={};for(const project of projects){const file=project===projects[0]?path.resolve(process.env.AGENTVN_TEST_PROJECT):path.join(out,"隔离工程 B.vnproj");fs.writeFileSync(file,JSON.stringify(project,null,2),{flag:"wx"});const response=await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`,{method:"POST",headers:{"content-type":"application/octet-stream","X-AgentVN-Filename":encodeURIComponent(path.basename(file))},body:fs.readFileSync(file)});assert(response.ok);before[project.project_id]=(await read(`/api/project/projects/${project.project_id}`)).data;}
 const configured=await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
  provider_connections:[{connection_id:"controlled-lifecycle",provider_type:"openai_compatible",display_name:"生命周期受控外部服务",base_url:provider.url,api_key_storage:"local",enabled:true}],
  provider_models:[{provider_id:"controlled-lifecycle-model",connection_id:"controlled-lifecycle",model_id:"controlled-model",model_name:"controlled-model",enabled:true,display_name:"生命周期受控外部服务",capabilities:["text_generation"],default_parameters:{structured_mode:"tools",request_timeout_seconds:120}}],
  provider_selections:{text_generation:"controlled-lifecycle-model"},provider_secrets:{"controlled-lifecycle":"test-only-secret"}})});assert(configured.ok);
 await connect();await page.reload({waitUntil:"domcontentloaded"});
 let a,b,c;
 await stage("installed-actual-inquiry-stream-history-with-no-writing-tool",async()=>{
  await openProject(projects[0]);const panel=await assistant("inquiry");await panel.getByLabel("向大模型助手提问",{exact:true}).fill("HISTORY_A 说明会话如何保存");await panel.getByRole("button",{name:"发送",exact:true}).click();await panel.getByText("HISTORY_A 这是安装版历史验收回答。",{exact:true}).waitFor();
  const inquiry=provider.requests.find(item=>item.marker==="HISTORY_A");assert(inquiry&&!inquiry.creation&&inquiry.tools.length===0);report.inquiryExternalTransport=inquiry.stream?"provider SSE":"provider non-stream wrapped by actual AgentVN SSE";assert.equal(report.submissions.length,0);await unchanged();
 });
 await stage("running-project-locked-and-other-project-entry-remains-usable",async()=>{
  const panel=await assistant("creation");a=await submit(panel,"QUEUE_A 构建一个标题关于按钮");await waitProcess(a.id,p=>p.status==="running");
  await page.getByTestId("assistant-project-lock-dialog").waitFor();assert.equal(await page.getByTestId("locked-project-content").evaluate(n=>n.inert),true);
  const lock=page.getByTestId("assistant-project-lock-dialog");
  for(const [width,height] of desktopViewports)for(const dpr of [1,2])for(const reduced of [false,true]){
    await session.send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:dpr,mobile:false});await page.emulateMedia({reducedMotion:reduced?"reduce":"no-preference"});
    await lock.getByRole("button",{name:"返回工程列表",exact:true}).focus();
    const geometry=await lock.evaluate(node=>{const rect=node.getBoundingClientRect(),button=node.querySelector('[aria-label="返回工程列表"]'),r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{rect:rect.toJSON(),hit:hit===button||button.contains(hit),focus:node.contains(document.activeElement),inert:document.querySelector('#root').inert,overflow:document.documentElement.scrollWidth-innerWidth};});
    assert(geometry.hit&&geometry.focus&&geometry.inert&&geometry.overflow<=1&&geometry.rect.left>=0&&geometry.rect.top>=0&&geometry.rect.right<=width+1&&geometry.rect.bottom<=height+1);
    await page.keyboard.press("Tab");assert.equal(await lock.evaluate(n=>n.contains(document.activeElement)),true);await page.keyboard.press("Shift+Tab");assert.equal(await lock.evaluate(n=>n.contains(document.activeElement)),true);
    report.lockMatrix.push({width,height,dpr,reduced,geometry});
  }assert.equal(report.lockMatrix.length,12);await session.send("Emulation.clearDeviceMetricsOverride");await page.emulateMedia({reducedMotion:"no-preference"});
  await goHome();await openProject(projects[1]);assert.equal(await page.getByTestId("assistant-project-lock-dialog").count(),0);
  const other=await assistant("creation");await other.getByTestId("assistant-process-monitor").locator('li[data-status="running"]').filter({hasText:projects[0].title}).waitFor();assert(!await other.innerText().then(text=>text.includes("QUEUE_A组件")));
 });
 await stage("queued-project-lock-cancel-does-not-call-model-and-preserves-original-engine",async()=>{
  const panel=page.locator(".workspace-task-panel.is-open .assistant-chat-panel");b=await submit(panel,"QUEUE_B 构建标题按钮");await waitProcess(b.id,p=>p.status==="queued");const lock=page.getByTestId("assistant-project-lock-dialog");await lock.waitFor();assert.equal(provider.requests.filter(item=>item.marker==="QUEUE_B").length,0);
  await lock.getByRole("button",{name:"取消此创造任务",exact:true}).click();await waitProcess(b.id,p=>p.status==="cancelled");await lock.waitFor({state:"detached"});assert.equal(provider.requests.filter(item=>item.marker==="QUEUE_B").length,0);await unchanged();
 });
 await stage("global-fifo-completion-belongs-to-own-project-without-automerge",async()=>{
  let panel=await assistant("creation");await panel.getByTestId("assistant-new-conversation").click();c=await submit(panel,"QUEUE_C 构建标题按钮");await waitProcess(c.id,p=>p.status==="queued");assert.equal(provider.requests.filter(item=>item.marker==="QUEUE_C").length,0);
  provider.release("QUEUE_A");await waitProcess(a.id,p=>p.status==="completed");await waitProcess(c.id,p=>p.status==="completed");await page.getByTestId("assistant-project-lock-dialog").waitFor({state:"detached"});
  panel=await assistant("creation");await panel.getByTestId("assistant-creation-draft").getByRole("heading",{name:"QUEUE_C组件",exact:true}).waitFor();assert.equal(provider.maxConcurrentCreation,1);assert.deepEqual(provider.requests.filter(item=>item.creation).map(item=>item.marker),["QUEUE_A","QUEUE_C"]);
  await unchanged();await goHome();await openProject(projects[0]);panel=await assistant("creation");await panel.getByTestId("assistant-creation-draft").getByRole("heading",{name:"QUEUE_A组件",exact:true}).waitFor();assert(!await panel.innerText().then(text=>text.includes("QUEUE_C组件")));
 });
 await stage("high-resolution-history-hit-focus-archive-restore-and-cancelled-delete",async()=>{
  const panel=page.locator(".workspace-task-panel.is-open .assistant-chat-panel");const history=await openHistory(panel);
  for(const [width,height] of desktopViewports)for(const dpr of [1,2])for(const reduced of [false,true]){
   await session.send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:dpr,mobile:false});await page.emulateMedia({reducedMotion:reduced?"reduce":"no-preference"});
   const button=history.getByRole("button",{name:/^归档 QUEUE_A/});await button.scrollIntoViewIfNeeded();
   const geometry=await button.evaluate(node=>{const r=node.getBoundingClientRect(),menu=node.closest(".assistant-history-menu").getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{rect:r.toJSON(),menu:menu.toJSON(),hit:hit===node||node.contains(hit),overflow:document.documentElement.scrollWidth-innerWidth};});
   assert(geometry.hit&&geometry.overflow<=1&&geometry.menu.left>=0&&geometry.menu.top>=0&&geometry.menu.right<=width+1&&geometry.menu.bottom<=height+1);report.matrix.push({width,height,dpr,reduced,geometry});
  }
  assert.equal(report.matrix.length,12);await history.getByRole("button",{name:/^归档 QUEUE_A/}).click();await history.locator(".assistant-history-item.is-archived").waitFor();await history.locator(".assistant-history-item.is-archived .assistant-history-select").click();await panel.getByText("已归档 · 只读历史",{exact:true}).waitFor();assert.equal(await panel.locator('[data-help-key="assistant.send"]').isEnabled(),false);
  await openHistory(panel);await history.getByRole("button",{name:/^恢复 QUEUE_A/}).click();await panel.getByText("已载入本机历史",{exact:true}).waitFor();await openHistory(panel);
  await history.getByRole("button",{name:/^永久删除 QUEUE_A/}).click();const confirmation=page.getByTestId("editor-delete-confirmation");await confirmation.waitFor();await confirmation.getByRole("button",{name:"取消",exact:true}).click();await confirmation.waitFor({state:"detached"});await openHistory(panel);assert.equal(await history.getByRole("button",{name:/^永久删除 QUEUE_A/}).count(),1);
  await page.screenshot({path:path.join(out,"installed-lifecycle-history.png")});
 });
 await stage("real-editor-backend-process-restart-keeps-mode-project-history-and-drafts",async()=>{
  await restart();await openProject(projects[0]);let panel=await assistant("creation");await panel.getByTestId("assistant-creation-draft").getByRole("heading",{name:"QUEUE_A组件",exact:true}).waitFor();
  const inquiry=await assistant("inquiry");await inquiry.getByText("HISTORY_A 这是安装版历史验收回答。",{exact:true}).waitFor();assert(!await inquiry.innerText().then(text=>text.includes("QUEUE_A组件")));await goHome();await openProject(projects[1]);panel=await assistant("creation");await panel.getByTestId("assistant-creation-draft").getByRole("heading",{name:"QUEUE_C组件",exact:true}).waitFor();const otherInquiry=await assistant("inquiry");assert.equal(await otherInquiry.getByText("HISTORY_A 这是安装版历史验收回答。",{exact:true}).count(),0);assert.equal(provider.requests.length,3,"Restart must not call the external model again");await unchanged();
 });
 let interrupted;
 await stage("editor-only-restart-reattaches-completed-proposal-without-resubmission",async()=>{
  await goHome();await openProject(projects[0]);let panel=await assistant("creation");await panel.getByTestId("assistant-new-conversation").click();provider.hold("RESUME_A");const pending=await submit(panel,"RESUME_A 构建标题按钮");await waitProcess(pending.id,p=>p.status==="running");await waitModel("RESUME_A");
  if(state.source)sourceStorage=await browser.contexts()[0].storageState({indexedDB:true});
  await browser.close();browser=undefined;if(!state.source)report.frontendRestart=await owner.restartFrontend();await connect();await openProject(projects[0]);
  provider.release("RESUME_A");await waitProcess(pending.id,p=>p.status==="completed");await page.getByTestId("assistant-project-lock-dialog").waitFor({state:"detached"});
  panel=await assistant("creation");await panel.getByTestId("assistant-creation-draft").getByRole("heading",{name:"RESUME_A组件",exact:true}).waitFor();
  assert.equal(provider.requests.filter(item=>item.marker==="RESUME_A").length,1);await unchanged();
 });
 await stage("interrupted-worker-does-not-leave-project-permanently-locked-or-repeat-request",async()=>{
  await goHome();await openProject(projects[0]);const panel=await assistant("creation");await panel.getByTestId("assistant-new-conversation").click();interrupted=await submit(panel,"INTERRUPTED_A 构建标题按钮");await waitProcess(interrupted.id,p=>p.status==="running");await waitModel("INTERRUPTED_A");await page.getByTestId("assistant-project-lock-dialog").waitFor();
  await goHome();await openProject(projects[1]);const queuedPanel=await assistant("creation");await queuedPanel.getByTestId("assistant-new-conversation").click();
  const queued=await submit(queuedPanel,"INTERRUPTED_B 构建标题按钮");await waitProcess(queued.id,p=>p.status==="queued");assert.equal(provider.requests.filter(item=>item.marker==="INTERRUPTED_B").length,0);
  if(state.source)sourceStorage=await browser.contexts()[0].storageState({indexedDB:true});
  await browser.close();browser=undefined;report.cleanup.push(await owner.stop());owner=undefined;provider.release("INTERRUPTED_A");
  owner=await startInstalledEditor(out,{restart:true});await connect();await openProject(projects[0]);
  const recovered=await waitProcess(interrupted.id,p=>["failed","cancelled"].includes(p.status),15000);assert.equal(recovered.errorCode,"worker_lost");await page.getByTestId("assistant-project-lock-dialog").waitFor({state:"detached"});assert.equal(provider.requests.filter(item=>item.marker==="INTERRUPTED_A").length,1);report.interrupted=recovered;
  const recoveredQueue=await waitProcess(queued.id,p=>p.status==="failed",45000);assert.equal(recoveredQueue.errorCode,"worker_lost");assert.equal(provider.requests.filter(item=>item.marker==="INTERRUPTED_B").length,0);report.interruptedQueue=recoveredQueue;
 });
 await stage("permanent-delete-confirm-and-restart-do-not-resurrect-history",async()=>{
  const panel=await assistant("inquiry");const history=await openHistory(panel);await history.getByRole("button",{name:/^永久删除 HISTORY_A/}).click();const confirmation=page.getByTestId("editor-delete-confirmation");await confirmation.waitFor();await confirmation.getByRole("button",{name:"确认删除",exact:true}).click();await confirmation.waitFor({state:"detached"});await panel.getByText("已永久删除该对话",{exact:true}).waitFor();
  await restart();await openProject(projects[0]);const inquiry=await assistant("inquiry");await openHistory(inquiry);assert.equal(await inquiry.getByRole("button",{name:/^永久删除 HISTORY_A/}).count(),0);await unchanged();
 });
 await stage("second-real-editor-process-sees-and-cancels-global-work-from-other-project",async()=>{
  const panel=await assistant("creation");await panel.getByTestId("assistant-new-conversation").click();provider.hold("PEER_A");const task=await submit(panel,"PEER_A 构建标题按钮");await waitProcess(task.id,p=>p.status==="running");await waitModel("PEER_A");
  let observer;
  if(state.source){peerContext=await browser.newContext({viewport:{width:1920,height:1080}});observer=await peerContext.newPage();await observer.goto(state.sourceUrl,{waitUntil:"domcontentloaded"});report.peerScope="second source Chromium context, not actual native peer";}
  else{peerOwner=await owner.startPeer();report.peer={pid:peerOwner.pid,backendPid:peerOwner.backendPid,cdpPort:peerOwner.cdpPort,webviewRoot:peerOwner.webviewRoot};peerBrowser=await chromium.connectOverCDP(`http://127.0.0.1:${peerOwner.cdpPort}`);observer=await installedPage(peerBrowser);report.peerScope="second actual installed editor.exe process, separate isolated profile, same owned backend/database";}
  observer.setDefaultTimeout(30000);observer.on("pageerror",error=>report.errors.push(`peer:${error}`));
  await observer.locator(".recent-project-open:not(:disabled):visible").filter({hasText:projects[1].title}).first().click();await observer.locator(".editor-toolbar").waitFor();await A.settleEditor(observer);
  assert.equal(await observer.getByTestId("assistant-project-lock-dialog").count(),0);await observer.locator('[data-workspace-surface="assistant"]:visible').click();await observer.locator(".assistant-chat-panel").waitFor();
  const monitor=observer.getByTestId("assistant-process-monitor");await monitor.locator(`li[data-process-id="${task.id}"][data-status="running"]`).waitFor();assert.equal(await observer.getByText("PEER_A组件",{exact:true}).count(),0);
  await monitor.getByRole("button",{name:`取消 ${projects[0].title} 的创作进程`,exact:true}).click();await waitProcess(task.id,p=>p.status==="cancelling");provider.release("PEER_A");await waitProcess(task.id,p=>p.status==="cancelled");await page.getByTestId("assistant-project-lock-dialog").waitFor({state:"detached"});
  assert.equal(provider.requests.filter(item=>item.marker==="PEER_A").length,1);await unchanged();await observer.screenshot({path:path.join(out,"peer-process-monitor.png")});
  await peerBrowser?.close();peerBrowser=undefined;if(peerOwner){report.peerCleanup=peerOwner.stop();assert.equal(report.peerCleanup.exitCode,0);peerOwner=undefined;}await peerContext?.close();peerContext=undefined;
 });
 await stage("two-approved-candidates-merge-atomically-and-survive-actual-process-restart",async()=>{
  const panel=await assistant("creation");await panel.getByTestId("assistant-new-conversation").click();
  await panel.getByRole("button",{name:"在独立窗口打开创造工作台",exact:true}).click();const workbench=page.getByTestId("assistant-creation-workbench-window");
  await workbench.getByTestId("assistant-new-conversation").click();
  const task=await submit(workbench,"BATCH_A 构建两个独立标题组件");await waitProcess(task.id,p=>p.status==="completed");await page.getByTestId("assistant-project-lock-dialog").waitFor({state:"detached"});
  const review=workbench.getByTestId("assistant-creation-review-batch");await review.waitFor();assert.equal(await review.locator("li").count(),2);
  for(const [index,name] of ["BATCH_A关于","BATCH_A帮助"].entries()){
    await review.getByRole("checkbox",{name:`应用候选 ${name}`,exact:true}).check();
    for(const [key,value] of Object.entries({x:45,y:12+index*38,width:30,height:28}))await review.getByLabel(`${name} ${key}`,{exact:true}).fill(String(value));
  }
  await review.getByRole("button",{name:"预览所选候选组合",exact:true}).click();await review.locator('[data-preview-phase="ready"]').waitFor();const frame=await(await review.locator("iframe").elementHandle()).contentFrame();assert(frame);await A.settleRuntime(frame);assert.equal(await frame.getByTestId("runtime-custom-component").count(),2);
  await unchanged();await review.getByTestId("assistant-creation-merge-batch").click();await review.getByRole("status").filter({hasText:/已将 2 个候选一次性应用/}).waitFor();
  const deadline=Date.now()+15000;let current;while(Date.now()<deadline){current=(await read(`/api/project/projects/${projects[0].project_id}`)).data;if(current.editor_settings.runtimeUILayout.screens.find(s=>s.screen_id==="title").components.filter(c=>c.component_type==="custom_component").length===2)break;await new Promise(r=>setTimeout(r,150));}
  const additions=current.editor_settings.runtimeUILayout.screens.find(s=>s.screen_id==="title").components.filter(c=>c.component_type==="custom_component");assert.deepEqual(additions.map(c=>c.label).sort(),["BATCH_A关于","BATCH_A帮助"].sort());
  assert.deepEqual(current.editor_settings.runtimeUILayoutProfiles.profiles.agentvn,before[projects[0].project_id].editor_settings.runtimeUILayoutProfiles.profiles.agentvn);
  before[projects[0].project_id].editor_settings=current.editor_settings;await unchanged();await page.screenshot({path:path.join(out,"installed-two-candidate-merge.png")});
  await restart();await openProject(projects[0]);await unchanged();report.batchMergedComponents=additions;
 });
 assert.equal(report.cases.length,11);assert.deepEqual(report.errors,[]);report.status="PASS";
}
main().catch(async error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;if(page){report.failureText=(await page.locator("body").innerText().catch(()=>"")).slice(-5000);await page.screenshot({path:path.join(out,"failure.png")}).catch(()=>{});}}).finally(async()=>{
 if(state&&owner)try{const response=await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider_secrets:{}}),signal:AbortSignal.timeout(10000)});assert(response.ok);report.credentialCleanup="CLEARED";}catch(error){report.status="FAILED";report.credentialCleanup=String(error);process.exitCode=1;}
 await peerBrowser?.close().catch(()=>{});await peerContext?.close().catch(()=>{});if(peerOwner)report.peerCleanup=peerOwner.stop();await browser?.close().catch(()=>{});if(owner)report.cleanup.push(await owner.stop());if(provider){report.modelBoundary=provider.requests;report.providerCleanup=await provider.stop();}
 delete report.browserStorage;
 if(report.cleanup.some(item=>item.editor.exitCode!==0||item.backend.exitCode!==0||(item.peers??[]).some(peer=>peer.exitCode!==0))){report.status="FAILED";process.exitCode=1;}
 report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,cases:report.cases.length,matrix:report.matrix.length,cleanup:report.cleanup,out,error:report.error}));
});
