"use strict";
// Existing actual NSIS installations, real environment checks and native picker.
// No APK build, environment repair, model request or cache-version injection.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process");
const {installedReleaseSession}=require("./lib/installed-release-session.cjs");
const {until,rows,listeners}=require("./lib/current-native-editor-session.cjs");
const {sha256,settleEditor}=require("./lib/installed-acceptance.cjs");
const {fixture}=require("./lib/editor-ui-acceptance.cjs");
const out="F:/AgentVN/QA/Android-Environment-1924-20261025-04";
const installationFile="F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const oldFile="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const hash=f=>sha256(fs.readFileSync(f));
const current=read(installationFile),old=read(oldFile);
assert.equal(current.executable.version,"1.9.24");assert.equal(old.version,"1.9.22");
for(const r of [current,old])for(const f of [r.executable,...r.resources])assert.equal(hash(f.path),f.sha256);
function command(action){
  const r=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    "scripts/candidate-1924-android-environment-cache.ps1","-Action",action],
    {encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:4e6});
  assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout.trim();
}
function validCache(value,version){
  assert.equal(value.status,"PASS");assert.equal(value.ok,true);
  assert.equal(value.cachePlatform,"android");assert.equal(value.cacheEditorVersion,version);
  assert.equal(value.cacheSchemaVersion,1);
  assert(Array.isArray(value.checks)&&value.checks.length>=10&&value.checks.every(c=>c.status==="PASS"));
}
function validPicker(receipt,request){
  assert.equal(receipt.method,"Computer Use");assert.equal(receipt.pid,request.pid);
  assert.equal(receipt.label,request.label);assert.equal(receipt.action,request.action);
  assert(Date.parse(receipt.completedAt)>=Date.parse(request.requestedAt));
}
if(process.argv[2]==="--self-test"){
  command("SelfTest");
  const value={status:"PASS",ok:true,cachePlatform:"android",cacheEditorVersion:"1.9.24",cacheSchemaVersion:1,
    checks:Array.from({length:10},()=>({status:"PASS"}))};validCache(value,"1.9.24");
  const bad=[v=>v.status="BLOCKED",v=>v.ok=false,v=>v.cachePlatform="windows",
    v=>v.cacheEditorVersion="1.9.22",v=>v.cacheSchemaVersion=0,v=>v.checks=[],v=>v.checks[0].status="BLOCKED"];
  for(const mutate of bad){const v=structuredClone(value);mutate(v);assert.throws(()=>validCache(v,"1.9.24"));}
  const request={pid:123,label:"cancel",action:"cancel",requestedAt:"2026-10-25T06:00:00Z"};
  const receipt={...request,method:"Computer Use",completedAt:"2026-10-25T06:00:01Z"};
  validPicker(receipt,request);
  for(const delta of [{pid:12},{label:"other"},{action:"select"},{method:"injected"},
    {completedAt:"2026-10-25T05:59:59Z"}])assert.throws(()=>validPicker({...receipt,...delta},request));
  console.log("PASS: actual frozen resources, cache boundaries, seven false-cache and five false-picker receipts rejected; no launch");
}else{
  assert.deepEqual(process.argv.slice(2),["run"]);assert(!fs.existsSync(out));
  const report={status:"RUNNING",at:new Date().toISOString(),scope:"TWO_EXISTING_NSIS_INSTALLS_ANDROID_CACHE_AND_NATIVE_PICKER",
    productChanges:0,modelRequests:0,launches:[],cleanups:[],screenshots:[],errors:[],steps:[],matrix:[],
    limitations:["Development host; not a clean machine","Explicit isolated DB/WebView; not default database validation",
      "No APK build/install/device test","No full valid .avnenv available; complete deployment NOT_RUN",
      "Current import uses explicit picker, not automatic archive discovery"]};
  const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
  let session,page,prepared=false;
  const pass="C:/Users/1/AppData/Local/AgentVN/environment-cache/android-pass.json";
  async function step(name,fn){
    const row={name,status:"RUNNING",at:new Date().toISOString()};report.steps.push(row);save();console.log("START",name);
    try{row.detail=await fn();row.status="PASS";}catch(e){row.status="FAILED";row.error=String(e.stack||e);throw e;}
    finally{row.finishedAt=new Date().toISOString();save();console.log(row.status,name);}
  }
  async function start(which){
    const folder=path.join(out,which),input=path.join(out,"temporary-project.vnproj");
    fs.mkdirSync(folder,{recursive:true});
    session=installedReleaseSession({installationFile:which==="old"?oldFile:installationFile,
      out:folder,report,save,input});
    page=await session.start();
    const resume=page.getByRole("button",{name:"继续上次编辑",exact:true});
    if(await resume.isVisible())await resume.click();
    else await page.getByRole("region",{name:"创建或打开项目",exact:true}).getByRole("button",{name:"新建项目",exact:true}).click();
    await page.locator(".editor-toolbar").waitFor();await settleEditor(page);
    await page.locator('[data-workspace-surface="publish"]:visible').click();await settleEditor(page);
    await finishDialog(false);
    await page.locator('[data-package-stage="settings"]').click();
    const platform=page.locator('[data-help-key="package.platform"]');
    if(!await platform.isVisible()){
      await page.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option",{name:/打包 .+ 单软件/}).click();
      await finishDialog(false);
    }
    if(!/Android/.test(await platform.innerText())){
      await platform.click();await page.getByRole("option",{name:/^Android/}).click();
    }
    await page.locator(".android-env-panel:not(.windows-env-panel)").waitFor();
    await finishDialog(false);
    await page.waitForFunction(()=>["passed","failed"].includes(document.querySelector(".android-env-panel:not(.windows-env-panel)")
      ?.getAttribute("data-environment-verification")),{},{timeout:180000});
    return nativeResult(which+"-entry-"+report.launches.length,which==="old"?"1.9.22":"1.9.24");
  }
  async function finishDialog(required=true){
    const dialog=page.getByTestId("package-environment-operation-dialog");
    await until(async()=>{
      if(await dialog.isVisible()){
        const phase=await dialog.getAttribute("data-environment-phase");
        if(!["completed","failed"].includes(phase))return false;
        (report.dialogs??=[]).push({phase,text:await dialog.innerText()});save();
        await dialog.getByRole("button",{name:phase==="completed"?"完成":"关闭",exact:true}).click();
        await dialog.waitFor({state:"hidden"});return true;
      }
      return !required&&await page.locator('[data-package-stage="settings"]').isVisible();
    },"real environment operation completion",180000);
  }
  function nativeResult(label,version){
    const native="C:/Users/1/AppData/Local/com.agentvn.editor/android-env/android-env-check.json";
    assert(fs.existsSync(native)&&fs.existsSync(pass));
    const value=read(native),cache=read(pass);validCache(cache,version);
    assert.equal(value.status,"PASS");assert.equal(value.ok,true);
    assert(value.checks.length>=10&&value.checks.every(c=>c.status==="PASS"));
    // A fresh PowerShell report precedes host version enrichment. The durable
    // host cache must carry the exact version; cached native results do too.
    if(value.cacheEditorVersion!==undefined)assert.equal(value.cacheEditorVersion,version);
    const evidence=[];
    for(const [source,suffix]of [[native,"native.json"],[pass,"cache.json"],
      ...["logPath","commandLogPath"].filter(k=>value[k]&&fs.existsSync(value[k])).map(k=>[value[k],k+".log"])]){
      const retained=path.join(out,label+"-"+suffix);fs.copyFileSync(source,retained,fs.constants.COPYFILE_EXCL);
      evidence.push({source,retained,sha256:hash(retained)});
    }
    return {value,cache,cacheSha256:hash(pass),evidence};
  }
  async function check(label,version){
    await page.locator('[data-help-key="package.androidEnvCheck"]').click();
    await finishDialog();
    const result=nativeResult(label,version);
    assert.equal(await page.locator(".android-env-panel:not(.windows-env-panel)").getAttribute("data-environment-verification"),"passed");
    return result;
  }
  async function close(label){
    const request={label,pid:session.current.pid,created:session.current.created,exe:session.current.executable.path,
      requestedAt:new Date().toISOString(),completion:path.join(out,label+"-close-completed.json")};
    fs.writeFileSync(path.join(out,"computer-use-close-request.json"),JSON.stringify(request,null,2));
    console.log("COMPUTER_USE_CLOSE",JSON.stringify(request));
    await until(()=>fs.existsSync(request.completion),"Computer Use Alt+F4 receipt",600000);
    const receipt=read(request.completion);assert.equal(receipt.pid,request.pid);assert.equal(receipt.method,"Computer Use Alt+F4");
    await until(()=>!rows().some(p=>p.ProcessId===request.pid&&p.Created===request.created)&&listeners(session.current.ports).length===0,
      "normal host/backend shutdown",30000);
    await session.stop("NORMAL_CLOSE_VERIFIED_"+label);assert.deepEqual(report.cleanups.at(-1).killed,[]);
    session=null;page=null;
  }
  async function picker(label,action){
    const before=hash(pass);
    await page.locator('[data-help-key="package.androidEnvImport"]').click();
    const request={label,action,pid:session.current.pid,requestedAt:new Date().toISOString(),
      selectedFile:action==="select"?path.join(out,"损坏依赖包.avnenv"):null,completion:path.join(out,label+"-picker-completed.json")};
    fs.writeFileSync(path.join(out,"computer-use-picker-request.json"),JSON.stringify(request,null,2));
    console.log("COMPUTER_USE_PICKER",JSON.stringify(request));
    await until(()=>fs.existsSync(request.completion),"real native picker receipt",600000);
    validPicker(read(request.completion),request);
    if(action==="select"){
      const dialog=page.getByTestId("package-environment-operation-dialog");
      await until(async()=>await dialog.getAttribute("data-environment-phase")==="failed","invalid package error");
      const text=await dialog.innerText();assert(/ANDROID_ENV_PACK_(?:INVALID|OPEN_FAILED)|ZIP|zip|压缩/.test(text),text);
      await session.shot(label);
      await dialog.getByRole("button",{name:"关闭",exact:true}).click();
      assert.equal(hash(pass),before,"Invalid preflight must preserve previous valid cache");
      assert(!fs.existsSync(path.join(path.dirname(pass),"android-operation.lock")));
      return {request,text,cacheUnchanged:true};
    }
    await page.getByTestId("package-environment-operation-dialog").waitFor({state:"hidden"});
    assert.equal(hash(pass),before);return {request,cacheUnchanged:true};
  }
  (async()=>{
    command("Prepare");prepared=true;
    const project=fixture("android-environment-1924-20261025-01");
    fs.writeFileSync(path.join(out,"temporary-project.vnproj"),JSON.stringify(project),{flag:"wx"});
    fs.writeFileSync(path.join(out,"损坏依赖包.avnenv"),"Controlled invalid archive; no executable content.",{flag:"wx"});
    report.sources=[installationFile,oldFile,__filename,"scripts/candidate-1924-android-environment-cache.ps1"].map(p=>({path:p,sha256:hash(p)}));
    save();
    await step("real-old-1.9.22-full-check-and-same-version-cache",async()=>{
      const first=await start("old");assert.notEqual(first.value.cacheHit,true);
      const again=await check("old-again","1.9.22");assert.equal(again.value.cacheHit,true);assert.equal(again.cacheSha256,first.cacheSha256);
      await session.shot("old-environment");await close("old");return {first,again};
    });
    await step("actual-1.9.24-rejects-old-version-cache-and-reuses-current",async()=>{
      validCache(read(pass),"1.9.22");
      const first=await start("current");assert.notEqual(first.value.cacheHit,true);
      const again=await check("current-again","1.9.24");assert.equal(again.value.cacheHit,true);assert.equal(again.cacheSha256,first.cacheSha256);
      await session.shot("current-environment");return {first,again};
    });
    await step("native-import-cancel-preserves-environment",()=>picker("cancel","cancel"));
    await step("native-invalid-archive-explicit-error-without-environment-clear",()=>picker("corrupt","select"));
    await step("current-environment-controls-12-real-webview-combinations",async()=>{
      for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])for(const reduced of [false,true]){
        const row={width,height,dpr,reduced,status:"RUNNING"};report.matrix.push(row);save();
        await session.metrics(row);await settleEditor(page);
        const buttons=page.locator(".android-env-panel:not(.windows-env-panel) button");
        row.geometry=await buttons.evaluateAll(nodes=>nodes.map(e=>{
          const r=e.getBoundingClientRect();return {text:e.textContent.trim(),rect:r.toJSON(),
            hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
            clipped:e.scrollWidth>e.clientWidth+1,overflow:document.documentElement.scrollWidth-innerWidth};
        }));
        assert.equal(row.geometry.length,3);
        for(const g of row.geometry)assert(g.hit&&!g.clipped&&g.overflow<=1&&g.rect.x>=0&&g.rect.y>=0
          &&g.rect.right<=width+1&&g.rect.bottom<=height+1,JSON.stringify(g));
        const button=page.locator('[data-help-key="package.androidEnvCheck"]');
        await button.focus();assert(await button.evaluate(e=>document.activeElement===e));
        row.result=await check(`matrix-${width}-${dpr}-${reduced}`,"1.9.24");assert.equal(row.result.value.cacheHit,true);
        await session.shot(`matrix-${width}-${dpr}-${reduced}`);row.status="PASS";save();
      }
      await close("current");return {combinations:report.matrix.length};
    });
    await step("actual-current-restart-retains-android-cache",async()=>{
      const before=hash(pass);const result=await start("current");
      assert.equal(result.value.cacheHit,true);assert.equal(result.cacheSha256,before);
      await session.shot("restart-environment");await close("restart");return result;
    });
    assert.equal(report.steps.length,6);assert.equal(report.matrix.length,12);
    assert(report.steps.every(s=>s.status==="PASS")&&report.matrix.every(r=>r.status==="PASS"));
    assert.equal(report.errors.length,0);assert.equal(report.modelRequests,0);report.status="PASS";
  })().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
    .finally(async()=>{
      try{
        await session?.stop("FINALLY");
        if(prepared||fs.existsSync(path.join(out,"cache-protection.json")))command("Restore");
        report.cleanupStatus="PASS";
      }
      catch(e){report.cleanupStatus="FAILED";report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1;}
      if(fs.existsSync(out)){report.finishedAt=new Date().toISOString();save();}
      console.log(JSON.stringify({status:report.status,error:report.error,cleanupStatus:report.cleanupStatus,out}));
    });
}
