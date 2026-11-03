"use strict";
// Actual NSIS upgrade, real default data/WebView paths. No product or model writes.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawn,spawnSync}=require("node:child_process"),net=require("node:net");
const {chromium}=require("../editor/node_modules/playwright");
const A=require("./lib/installed-acceptance.cjs");
const {rows,listeners,until,ps}=require("./lib/current-native-editor-session.cjs");
const {ownedProcessTree}=require("./lib/owned-process-tree.cjs");
const {stopOwnedProcess}=require("./lib/owned-process-stop.cjs");
const {captureInstalledWebview}=require("./lib/current-native-capture.cjs");
const out="F:/AgentVN/QA/Editor-Upgrade-1924-20261025-05";
const install=path.join(out,"installed-editor"),read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>A.sha256(fs.readFileSync(f));
const file=path.join(out,"report.json");
const report={status:"RUNNING",at:new Date().toISOString(),scope:"REAL_NSIS_1_9_22_TO_1_9_24_DEFAULT_PATHS_ON_DEVELOPMENT_HOST",
  productChanges:0,modelRequests:0,steps:[],launches:[],cleanups:[],screenshots:[],errors:[],
  limitations:["Not a clean machine","Not a 1.7.1/1.9.8 cross-generation upgrade","Windows environment only; Android separate",
    "No old AI session/component data creation in this test"],known:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
function command(action){
  const r=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    "scripts/candidate-1924-editor-upgrade-session.ps1","-Action",action],
    {encoding:"utf8",windowsHide:true,timeout:180000,maxBuffer:5e6});
  if(fs.existsSync(out))fs.writeFileSync(path.join(out,action+".log"),r.stdout+r.stderr,{flag:"wx"});
  assert.equal(r.status,0,r.stdout+r.stderr);
}
async function step(name,fn){
  const s={name,status:"RUNNING",at:new Date().toISOString()};report.steps.push(s);save();console.log("START",name);
  try{s.detail=await fn();s.status="PASS";}catch(e){s.status="FAILED";s.error=String(e.stack||e);throw e;}
  finally{s.finishedAt=new Date().toISOString();save();console.log(s.status,name);}
}
const aliases=[
  "C:/Users/1/AppData/Local/AgentVN/environment-cache",
  "C:/Users/1/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/AgentVN/environment-cache"];
let child,browser,page,cdp,current,prepared=false,installed=false;
function remember(){
  if(child)for(const p of ownedProcessTree(rows(),child.pid,current.created)){
    if(!current.created&&p.ProcessId===child.pid)current.created=p.Created;
    if(!report.known.some(q=>q.ProcessId===p.ProcessId&&q.Created===p.Created))report.known.push(p);
  }
  save();
}
async function launch(label,version){
  assert(!child);assert.equal(listeners([8278]).length,0);
  assert(!rows().some(p=>/^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);
    s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
  const env={...process.env};for(const k of Object.keys(env))if(/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k))delete env[k];
  Object.assign(env,{WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT:path.join(out,"ui-created-project.vnproj"),AGENTVN_WORKSPACE_OUTPUT:out});
  const shortcut="C:/Users/1/Desktop/AgentVN Editor.lnk";
  const actualTarget=ps(`$s=New-Object -ComObject WScript.Shell;$s.CreateShortcut('${shortcut}').TargetPath`);
  assert.equal(path.resolve(actualTarget).toLowerCase(),path.resolve(install,"agentvn-editor.exe").toLowerCase());
  const fd=fs.openSync(path.join(out,label+"-host.log"),"wx");
  // Launch installed binary from its own directory; verify the default shortcut independently.
  child=spawn(path.join(install,"agentvn-editor.exe"),[],{cwd:install,env,windowsHide:true,stdio:["ignore",fd,fd]});fs.closeSync(fd);
  current={label,version,pid:child.pid,ports:[8278,port],exe:path.join(install,"agentvn-editor.exe"),sha256:sha(path.join(install,"agentvn-editor.exe")),
    defaultDataPath:true,defaultWebViewPath:true,backendPortOverride:false,manualBackendSpawn:false,shortcutTarget:actualTarget};
  report.launches.push(current);remember();
  await until(async()=>{assert.equal(child.exitCode,null);remember();try{return (await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(700)})).ok
    &&(await fetch("http://127.0.0.1:8278/api/health",{signal:AbortSignal.timeout(700)})).ok;}catch{return false;}},"installed default host ready",90000);
  const tree=ownedProcessTree(rows(),child.pid,current.created);
  assert(tree.some(p=>p.Name==="creator-backend.exe"&&path.resolve(p.ExecutablePath)===path.resolve(install,"creator-backend.exe")));
  assert(listeners(current.ports).every(p=>tree.some(q=>q.ProcessId===p.OwningProcess)));
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri\.localhost|^tauri:/.test(p.url())),"real installed page");
  page.setDefaultTimeout(30000);page.on("pageerror",e=>{report.errors.push(String(e));save();});
  await page.context().route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/,r=>{
    if(r.request().method()==="POST"){report.modelRequests++;save();return r.abort();}return r.continue();
  });
  cdp=await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.locator(".project-home").waitFor({timeout:60000});
  assert((await page.locator("body").innerText()).includes(version));
}
async function shot(name){
  report.screenshots.push(await captureInstalledWebview(page,cdp,path.join(out,name+".png"),
    {width:1920,height:1080,dpr:1,reduced:false}));save();
}
async function snapshot(){
  const r=await fetch("http://127.0.0.1:8278/api/project/state");assert(r.ok);
  const p=await r.json();assert(p.ok);return {metadata:p.data.project_metadata,graph:p.data.project_graph};
}
function comparable(project){
  const nodes=structuredClone(project.graph.nodes);
  // The new native serializer materializes this documented empty default.
  // Preserve every non-empty value and every other graph field.
  for(const node of nodes)if(Array.isArray(node.data?.openingAudio)&&node.data.openingAudio.length===0)delete node.data.openingAudio;
  return {id:project.metadata.projectId,title:project.metadata.title,
    author:project.metadata.author,nodes,edges:project.graph.edges};
}
async function closeNormally(label){
  remember();const request={status:"WAITING",label,pid:current.pid,created:current.created,exe:current.exe,
    requestedAt:new Date().toISOString(),completion:path.join(out,label+"-close-completed.json")};
  fs.writeFileSync(path.join(out,"computer-use-request.json"),JSON.stringify(request,null,2));
  console.log("COMPUTER_USE_CLOSE",JSON.stringify(request));
  await until(()=>fs.existsSync(request.completion),"actual Computer Use normal close receipt",600000);
  const receipt=read(request.completion);assert.equal(receipt.pid,current.pid);assert.equal(receipt.label,label);
  assert.equal(receipt.method,"Computer Use Alt+F4");
  await until(()=>!rows().some(p=>p.ProcessId===current.pid&&p.Created===current.created)&&listeners(current.ports).length===0,
    "normal Editor and backend exit",30000);
  await browser.close();browser=null;child=null;
  report.cleanups.push({label,status:"PASS",normalClose:true,killed:[],ports:current.ports});save();
}
async function forceCleanup(){
  if(!child)return;remember();await browser?.close().catch(()=>{});browser=null;
  const killed=[];for(const p of report.known.slice().reverse()){
    if(rows().some(q=>q.ProcessId===p.ProcessId&&q.Created===p.Created)){stopOwnedProcess(p,ps);killed.push({pid:p.ProcessId,created:p.Created});}
  }
  await until(()=>!rows().some(p=>report.known.some(q=>q.ProcessId===p.ProcessId&&q.Created===p.Created))&&listeners(current.ports).length===0,
    "owned final cleanup",20000);
  report.cleanups.push({status:"PASS",label:current.label,normalClose:false,killed});child=null;save();
}
async function saveProject(label){
  await page.getByRole("button",{name:"保存工程",exact:true}).click();
  const dialog=page.getByTestId("project-save-confirmation");await dialog.waitFor({timeout:60000});
  const text=await dialog.innerText(),f=text.match(/C:\\Users\\1\\Downloads\\[^\r\n]+\.vnproj/)?.[0];
  assert(f,"Actual native save path missing");assert(fs.existsSync(f));
  const retained=path.join(out,label+".vnproj");fs.copyFileSync(f,retained,fs.constants.COPYFILE_EXCL);
  const before=sha(f);assert.equal(sha(retained),before);
  (report.downloads??=[]).push({source:f,retained,sha256:before,bytes:fs.statSync(f).size,removed:false});save();
  await dialog.getByRole("button",{name:"OK",exact:true}).click();await dialog.waitFor({state:"detached"});
  return snapshot();
}
async function checkEnvironment(label,repeat=false){
  if(!repeat){
    await page.locator('[data-workspace-surface="publish"]:visible').click();await A.settleEditor(page);
    const dialog=page.getByTestId("package-environment-operation-dialog");
    await until(async()=>{
      if(await dialog.isVisible()){
        const phase=await dialog.getAttribute("data-environment-phase");if(!["completed","failed"].includes(phase))return false;
        (report.environmentDialogs??=[]).push({label,phase,text:await dialog.innerText()});save();
        await dialog.getByRole("button",{name:phase==="completed"?"完成":"关闭",exact:true}).click();
      }
      try{await page.locator('[data-package-stage="settings"]').click({timeout:600});}catch{return false;}
      return page.locator('[data-help-key="package.mode"]').isVisible();
    },"publish auto environment operation",180000);
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option",{name:/打包 Windows 单软件/}).click();
  }
  const button=page.locator('[data-help-key="package.windowsEnvCheck"]');
  if(repeat)await button.click();
  const dialog=page.getByTestId("package-environment-operation-dialog");
  await until(async()=>{
    if(await dialog.isVisible()){
      const phase=await dialog.getAttribute("data-environment-phase");if(!["completed","failed"].includes(phase))return false;
      (report.environmentDialogs??=[]).push({label,phase,text:await dialog.innerText()});save();
      await dialog.getByRole("button",{name:phase==="completed"?"完成":"关闭",exact:true}).click();
    }
    return await page.locator('[data-help-key="package.export"]').getAttribute("data-environment-status")==="passed";
  },"actual Windows environment success",180000);
  const caches=aliases.map(p=>path.join(p,"windows-pass.json")).filter(f=>fs.existsSync(f));assert(caches.length);
  const cache=caches[0],value=read(cache);
  const nativePaths=["C:/Users/1/AppData/Local/com.agentvn.editor/windows-env/windows-env-check.json",
    "C:/Users/1/AppData/Local/com.agentvn.editor/cache/windows-env/windows-env-check.json"];
  const native=nativePaths.find(f=>fs.existsSync(f));assert(native);
  const result=read(native);
  for(const [source,suffix]of [[cache,"cache"],[native,"native"]])fs.copyFileSync(source,path.join(out,label+"-"+suffix+".json"),fs.constants.COPYFILE_EXCL);
  assert.equal(value.cacheEditorVersion,current.version);assert.equal(value.status,"PASS");assert.equal(value.cachePlatform,"windows");
  await shot(label);
  return {cache:sha(cache),value,result,nativeSource:native};
}
if(process.argv[2]==="--self-test"){
  command("SelfTest");
  const v={metadata:{projectId:"a",title:"t",author:"a",updatedAt:1},graph:{nodes:[{id:"n",data:{x:1}}],edges:[]}};
  assert.deepEqual(comparable(v),comparable({...v,metadata:{...v.metadata,updatedAt:2}}));
  const emptyDefault=structuredClone(v);emptyDefault.graph.nodes[0].data.openingAudio=[];
  assert.deepEqual(comparable(emptyDefault),comparable(v));
  for(const change of [p=>p.metadata.projectId="b",p=>p.graph.nodes[0].data.x=2,p=>p.graph.edges.push({id:"e"})]){
    const copy=structuredClone(v);change(copy);assert.notDeepEqual(comparable(copy),comparable(v));
  }
  const nonempty=structuredClone(v);nonempty.graph.nodes[0].data.openingAudio=[{asset_id:"audio"}];
  assert.notDeepEqual(comparable(nonempty),comparable(v));
  console.log("PASS: project preservation oracle, exact PS boundaries; no product launch");
}else{
  assert.deepEqual(process.argv.slice(2),["run"]);assert(!fs.existsSync(out));
  (async()=>{
    command("Prepare");prepared=true;save();
    await step("real-old-NSIS-install",async()=>{command("InstallOld");installed=true;return read(path.join(out,"InstallOld.json"));});
    let baseline,oldCache;
    await step("old-real-UI-project-save-and-preference",async()=>{
      await launch("old","1.9.22");
      await page.getByRole("region",{name:"创建或打开项目",exact:true}).getByRole("button",{name:"新建项目",exact:true}).click();
      await page.locator(".editor-toolbar").waitFor();await A.settleEditor(page);
      await page.getByRole("button",{name:"选项",exact:true}).click();await A.settleEditor(page);
      await page.getByRole("textbox",{name:"项目名称",exact:true}).fill("Editor升级1924临时工程");
      await page.getByRole("textbox",{name:"项目作者",exact:true}).fill("隔离真实升级验收");
      await page.getByRole("button",{name:"编辑",exact:true}).click();await A.settleEditor(page);
      const theme=page.locator(".theme-tone-switch:visible");
      if(/切换到深色/.test(await theme.getAttribute("aria-label")))await theme.click();
      baseline=await saveProject("old-project");
      const preference=await page.evaluate(()=>localStorage.getItem("agentvn.themeTone"));
      fs.writeFileSync(path.join(out,"old-baseline.json"),JSON.stringify({status:"PASS",project:baseline,preference},null,2),{flag:"wx"});
      await shot("old-saved");return {projectId:baseline.metadata.projectId,preference};
    });
    await step("old-native-Windows-check-and-cache-reuse",async()=>{
      oldCache=await checkEnvironment("old-first");const repeated=await checkEnvironment("old-repeat",true);
      assert.equal(repeated.result.cacheHit,true);assert.equal(repeated.cache,oldCache.cache);
      await closeNormally("old");return {first:oldCache,repeated};
    });
    await step("real-same-directory-NSIS-upgrade-without-uninstall",async()=>{
      command("InstallNew");return read(path.join(out,"InstallNew.json"));
    });
    await step("new-real-UI-resume-and-native-version-cache-invalidation",async()=>{
      await launch("new","1.9.24");
      await page.getByRole("button",{name:"继续上次编辑",exact:true}).click();
      await page.locator(".editor-toolbar").waitFor();await A.settleEditor(page);
      assert.deepEqual(comparable(await snapshot()),comparable(baseline));
      assert.equal(await page.evaluate(()=>localStorage.getItem("agentvn.themeTone")),read(path.join(out,"old-baseline.json")).preference);
      const fresh=await checkEnvironment("new-first");assert.notEqual(fresh.result.cacheHit,true);
      assert.notEqual(fresh.cache,oldCache.cache);
      const repeated=await checkEnvironment("new-repeat",true);assert.equal(repeated.result.cacheHit,true);assert.equal(repeated.cache,fresh.cache);
      await page.getByRole("button",{name:"关闭发布与打包",exact:true}).click();
      // Exit snapshots are presentational, so never use a strict single-panel
      // locator as a proxy for workspace ownership.
      await A.settleEditor(page);
      await page.getByRole("button",{name:"编辑",exact:true}).click();await A.settleEditor(page);
      const saved=await saveProject("new-project");assert.deepEqual(comparable(saved),comparable(baseline));
      await shot("new-preserved");await closeNormally("new");return {fresh,repeated};
    });
    await step("new-process-restores-old-project-and-current-cache",async()=>{
      await launch("restart","1.9.24");
      await page.getByRole("button",{name:"继续上次编辑",exact:true}).click();await A.settleEditor(page);
      assert.deepEqual(comparable(await snapshot()),comparable(baseline));
      const cached=await checkEnvironment("new-restart");assert.equal(cached.result.cacheHit,true);
      await closeNormally("restart");return cached;
    });
    assert.equal(report.steps.length,6);assert(report.steps.every(s=>s.status==="PASS"));
    assert.equal(report.errors.length,0);assert.equal(report.modelRequests,0);report.status="PASS";
  })().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
    .finally(async()=>{
      try{
        await forceCleanup();
        if(installed){command("Uninstall");installed=false;}
        if(prepared)command("Restore");
        for(const d of report.downloads||[]){
          assert(path.dirname(path.resolve(d.source)).toLowerCase()===path.resolve("C:/Users/1/Downloads").toLowerCase());
          assert.equal(sha(d.source),d.sha256);assert.equal(sha(d.retained),d.sha256);
          fs.unlinkSync(d.source);d.removed=true;
        }
        report.cleanupStatus="PASS";
      }catch(e){report.cleanupStatus="FAILED";report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1;}
      report.finishedAt=new Date().toISOString();if(fs.existsSync(out))save();
      console.log(JSON.stringify({status:report.status,out,error:report.error,cleanupError:report.cleanupError}));
    });
}
