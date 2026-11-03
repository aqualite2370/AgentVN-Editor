"use strict";
// New installed Editor -> real Windows UI export -> actual native game.
// No Runtime store access, no Tauri command mocks, no user project.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const net = require("node:net");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const root = path.resolve(__dirname,".."), audit = path.resolve(process.argv[2] || ""),
  out = path.resolve(process.argv[3] || "");
assert(process.argv[2] && process.argv[3]); assert(A.inside(path.join(root,"output"),out));
assert(!fs.existsSync(out)); assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""),out);
const input = path.resolve(process.env.AGENTVN_TEST_PROJECT || "");
assert(A.inside(out,input)); assert(!process.env.E5_LIFECYCLE_SOURCE);
fs.mkdirSync(out,{recursive:true}); fs.copyFileSync(audit,path.join(out,"installer-resource-report.json"));
process.env.PSModulePath = [path.join(process.env.USERPROFILE,"Documents/WindowsPowerShell/Modules"),
  path.join(process.env.ProgramFiles,"WindowsPowerShell/Modules"),
  path.join(process.env.SystemRoot,"System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter);
const runId = `portable_save_${Date.now()}`, title = `存档隔离验收 ${Date.now()}`;
const report = {status:"RUNNING",startedAt:new Date().toISOString(),runId,title,cases:[],errors:[],launches:[],ownedLegacy:[],cleanup:[]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let owner, editorBrowser, player, playerBrowser, page;
let aclTarget, aclReceipt;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort() {
  return new Promise((resolve,reject)=>{
    const probe=net.createServer();probe.once("error",reject);probe.listen(0,"127.0.0.1",()=>{
      const port=probe.address().port;probe.close(error=>error?reject(error):resolve(port));
    });
  });
}
async function step(name,fn) {
  const row={name,status:"RUNNING"};report.cases.push(row);save();console.log(`START ${name}`);
  try{row.result=await fn();row.status="PASS";console.log(`PASS ${name}`);}
  catch(error){row.status="FAILED";row.error=String(error.stack||error);throw error;}
  finally{save();}
}
async function command(name,cmd,args,env={}) {
  const log=fs.createWriteStream(path.join(out,`${name}.log`),{flags:"wx"});
  const child=spawn(cmd,args,{cwd:root,windowsHide:true,env:{...process.env,...env},stdio:["ignore","pipe","pipe"]});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
  log.end();assert.equal(code,0,`Inspect ${name}.log`);return{pid:child.pid,exitCode:code};
}
async function startPlayer(exe) {
  assert(!player);const port=await freePort();
  const cwd=path.join(out,"unrelated-cwd");fs.mkdirSync(cwd,{recursive:true});
  player=spawn(exe,[],{cwd,windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,
    WEBVIEW2_USER_DATA_FOLDER:path.join(out,"player-webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
  const log=fs.createWriteStream(path.join(out,`player-${player.pid}.log`),{flags:"wx"});
  player.stdout.pipe(log);player.stderr.pipe(log);player.once("close",()=>log.end());
  report.launches.push({pid:player.pid,port,exe,sha256:A.sha256(fs.readFileSync(exe)),cwd});save();
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){assert.equal(player.exitCode,null);try{
    if((await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)})).ok)break;
  }catch{}await pause(150);}
  playerBrowser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page=playerBrowser.contexts()[0].pages()[0];page.setDefaultTimeout(60000);
  page.on("pageerror",e=>report.errors.push(String(e)));
  await page.setViewportSize({width:1920,height:1080});
  await page.getByTestId("game-state-title").waitFor();await A.settleRuntime(page);
}
async function exitPlayer() {
  if(!(await page.getByTestId("renpy-menu-exit").isVisible().catch(()=>false))) {
    await page.keyboard.press("Escape");await page.getByTestId("renpy-menu-exit").waitFor();await A.settleRuntime(page);
  }
  const exited=new Promise(resolve=>player.once("close",resolve));
  await page.getByTestId("renpy-menu-exit").click();
  await page.getByRole("dialog",{name:"退出游戏？",exact:true}).waitFor();
  await page.getByTestId("confirm-exit-game").click();
  await Promise.race([exited,pause(20000).then(()=>{throw new Error("Native game did not exit normally");})]);
  await playerBrowser.close();playerBrowser=undefined;page=undefined;player=undefined;
}
async function savePage() {
  if(await page.getByTestId("renpy-quick-save-load").isVisible().catch(()=>false))
    await page.getByTestId("renpy-quick-save-load").click();
  else await page.getByTestId("open-save-load").click();
  await page.getByTestId("save-storage-open").waitFor();await A.settleRuntime(page);
}
const sha=file=>A.sha256(fs.readFileSync(file));
(async()=>{
  let portable,exe,sourceDir,targetDir,manualSlot,copySlot,manualFile,manualBytes;
  await step("actual-installed-editor-isolated-small-project",async()=>{
    owner=await startInstalledEditor(out);
    const verified=A.readInstalledSession(out);
    report.installation={root:owner.state.installRoot,exeSha256:verified.exeSha256};
    editorBrowser=await chromium.connectOverCDP(`http://127.0.0.1:${owner.state.cdpPort}`);
    const editor=editorBrowser.contexts()[0].pages().find(p=>p.url().startsWith("http://tauri.localhost"));
    assert(editor);
    const compiled={exports:{}};
    new Function("module","exports",require("../editor/node_modules/esbuild").buildSync({
      stdin:{resolveDir:root,loader:"ts",contents:'export * from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";'},
      bundle:true,platform:"node",format:"cjs",write:false,
    }).outputFiles[0].text)(compiled,compiled.exports);
    const project=fixture(runId);project.title=title;
    const renpy=compiled.exports.createRenpyUILayout();
    project.editor_settings={runtimeUILayout:renpy,runtimeUILayoutProfiles:{version:1,activeType:"renpy",
      profiles:{agentvn:compiled.exports.getDefaultUISkinLayout(),renpy}}};
    fs.writeFileSync(input,JSON.stringify(project,null,2),{flag:"wx"});
    const response=await fetch(`http://127.0.0.1:${owner.state.backendPort}/api/project/projects/import`,{
      method:"POST",headers:{"Content-Type":"application/octet-stream","X-AgentVN-Filename":encodeURIComponent(path.basename(input))},
      body:fs.readFileSync(input)});
    assert(response.ok,await response.text());
    await editor.reload({waitUntil:"domcontentloaded"});
    await editor.locator(".recent-project-open:not(:disabled):visible").filter({hasText:title}).first().click();
    await editor.locator(".editor-toolbar").waitFor();await A.settleEditor(editor);
    assert.equal((await A.projectSnapshot(owner.state.backendPort)).projectId,runId);
    report.fixture={path:input,sha256:sha(input),projectId:runId};
    return report.fixture;
  });
  await step("real-installed-windows-export-and-native-picker",async()=>{
    await command("windows-export",process.execPath,[path.join(root,"scripts/installed-editor-windows-export-playwright.cjs"),
      out,path.join(out,"windows-export")],{INSTALLED_ACCEPTANCE_PROJECT_TITLE:title});
    const exportDir=fs.readdirSync(out).filter(n=>n.startsWith("windows-export-ui-")).sort().at(-1);
    const exportReport=path.join(out,exportDir,"report.json"),value=JSON.parse(fs.readFileSync(exportReport));
    assert.equal(value.status,"RESULT_READY");assert.match(value.result,/Windows 软件构建成功/);
    portable=path.join(out,"windows-export/portable");const names=fs.readdirSync(portable).filter(n=>n.endsWith(".exe"));
    assert.equal(names.length,1);exe=path.join(portable,names[0]);
    const manifest=JSON.parse(fs.readFileSync(path.join(portable,"embedded-cartridge/manifest.json")));
    assert.equal(manifest.game_id,runId);assert.equal(manifest.title,title);
    report.windowsExport={report:exportReport,sha256:sha(exportReport),exe,exeSha256:sha(exe)};
    return report.windowsExport;
  });
  await editorBrowser.close();editorBrowser=undefined;
  report.cleanup.push(await owner.stop());owner=undefined;
  await step("actual-native-exe-side-location-and-new-save-bytes",async()=>{
    await startPlayer(exe);await savePage();
    await page.getByTestId("save-storage-open").click();
    const dialog=page.getByRole("dialog",{name:"复制旧存档到游戏目录？",exact:true});
    await dialog.waitFor();
    const paths=await dialog.locator("dd").allTextContents();
    [targetDir,sourceDir]=paths.map(p=>path.resolve(p));
    assert.equal(targetDir,path.join(portable,"saves",runId,"preview_gamecli"));
    assert(!A.inside(portable,sourceDir),"Legacy source must not be the new save root");
    // Only ever create our own previously absent slot files. Never overwrite user AppData.
    const freeManual=Array.from({length:12},(_,i)=>i+1).filter(i=>!fs.existsSync(path.join(sourceDir,`slot-${String(i).padStart(2,"0")}.json`)));
    assert(freeManual.length>=2,"BLOCKED: no independent free legacy test slots; no user save overwritten");
    [manualSlot,copySlot]=freeManual;
    await dialog.getByRole("button",{name:"关闭",exact:true}).click();
    await page.getByTestId("renpy-menu-settings").click();await A.settleRuntime(page);
    await page.locator(".settings-tabs").getByRole("button",{name:"系统",exact:true}).click();
    const auto=page.getByRole("checkbox",{name:"自动存档",exact:true});if(await auto.isChecked())await auto.uncheck();
    await page.getByTestId("settings-finish").click();await A.settleRuntime(page);
    // Returning from settings opened at title goes back to title.
    await page.getByTestId("start-new-game").click();await page.getByTestId("game-state-playing").waitFor();
    await A.settleRuntime(page);
    await page.getByTestId("renpy-quick-save-load").click();await A.settleRuntime(page);
    if(manualSlot>6)await page.getByTestId("save-page-next").click();
    await page.getByTestId(`save-slot-manual-${manualSlot}`).locator(".save-card-main").click();
    manualFile=path.join(targetDir,`slot-${String(manualSlot).padStart(2,"0")}.json`);
    const until=Date.now()+10000;while(!fs.existsSync(manualFile)&&Date.now()<until)await pause(100);
    manualBytes=fs.readFileSync(manualFile);assert.equal(JSON.parse(manualBytes).game_id,runId);
    assert(!fs.existsSync(path.join(sourceDir,path.basename(manualFile))),"Normal saves must not fall back to AppData");
    return{targetDir,sourceDir,path:manualFile,sha256:sha(manualFile)};
  });
  await step("consent-only-copy-native-bytes-and-conflict-preservation",async()=>{
    const original=JSON.parse(manualBytes), files=[
      [`slot-${String(manualSlot).padStart(2,"0")}.json`,"manual",manualSlot],
      [`slot-${String(copySlot).padStart(2,"0")}.json`,"manual",copySlot],
    ];
    for(const [prefix,kind,count] of [["auto","auto",8],["quick","quick",6]]) {
      const slot=Array.from({length:count},(_,i)=>i+1).find(i=>!fs.existsSync(path.join(sourceDir,`${prefix}-${String(i).padStart(2,"0")}.json`))
        && !fs.existsSync(path.join(targetDir,`${prefix}-${String(i).padStart(2,"0")}.json`)));
      assert(slot,`BLOCKED: no independent ${kind} legacy slot`);
      files.push([`${prefix}-${String(slot).padStart(2,"0")}.json`,kind,slot]);
    }
    fs.mkdirSync(sourceDir,{recursive:true});
    for(const [name,kind,slot] of files) {
      const file=path.join(sourceDir,name),bytes=Buffer.from(JSON.stringify({...original,save_kind:kind,slot,
        save_id:`${runId}-legacy-${name}`,created_at:"2025-01-01T00:00:00.000Z"},null,2));
      fs.writeFileSync(file,bytes,{flag:"wx"});
      const evidence=path.join(out,"legacy-byte-evidence",name);
      fs.mkdirSync(path.dirname(evidence),{recursive:true});fs.copyFileSync(file,evidence,fs.constants.COPYFILE_EXCL);
      report.ownedLegacy.push({path:file,sha256:sha(file),evidence,target:path.join(targetDir,name),isConflict:slot===manualSlot&&kind==="manual"});
      save();
    }
    await page.getByTestId("save-storage-open").click();
    const dialog=page.getByRole("dialog",{name:"复制旧存档到游戏目录？",exact:true});await dialog.waitFor();
    assert.match(await dialog.innerText(),/可复制 3 个旧存档/);
    await dialog.getByRole("button",{name:"暂不迁移",exact:true}).click();
    for(const file of report.ownedLegacy.filter(f=>!f.isConflict))assert(!fs.existsSync(file.target));
    await page.getByTestId("save-storage-open").click();await dialog.waitFor();
    await dialog.getByRole("button",{name:"确认复制",exact:true}).click();await dialog.waitFor({state:"detached"});
    for(const file of report.ownedLegacy){
      assert.equal(sha(file.path),file.sha256,"Legacy original must survive byte-for-byte");
      assert.equal(sha(file.target),file.isConflict?A.sha256(manualBytes):file.sha256);
    }
    await page.screenshot({path:path.join(out,"native-migration-result-1080p.png")});
    return{copied:3,conflictsPreserved:1,sourceFilesPreserved:4};
  });
  await step("installed-native-path-modal-landscape-dpr-motion-matrix",async()=>{
    const cdp=await page.context().newCDPSession(page);
    report.nativeMatrix=[];
    for(const [width,height] of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])for(const reduced of [false,true]){
      await cdp.send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:dpr,mobile:false});
      await page.emulateMedia({reducedMotion:reduced?"reduce":"no-preference"});
      await page.getByTestId("save-storage-open").click();
      const dialog=page.getByRole("dialog",{name:"复制旧存档到游戏目录？",exact:true});await dialog.waitFor();
      const close=dialog.getByRole("button",{name:"关闭",exact:true});await close.click({trial:true});
      const geometry=await dialog.evaluate(node=>{
        const r=node.getBoundingClientRect(),buttons=[...node.querySelectorAll("button:not([disabled])")].map(button=>{
          const b=button.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
          return{rect:b.toJSON(),hit:hit===button||button.contains(hit)};
        });
        return{rect:r.toJSON(),buttons,focused:node.contains(document.activeElement),viewport:{width:innerWidth,height:innerHeight},
          dpr:devicePixelRatio,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches,
          overflow:document.documentElement.scrollWidth-innerWidth};
      });
      assert.deepEqual(geometry.viewport,{width,height});assert.equal(geometry.dpr,dpr);assert.equal(geometry.reduced,reduced);
      assert(geometry.focused&&geometry.buttons.every(b=>b.hit)&&geometry.overflow<=1);
      assert(geometry.rect.x>=0&&geometry.rect.y>=0&&geometry.rect.right<=width&&geometry.rect.bottom<=height);
      await page.keyboard.press("Tab");await page.keyboard.press("Shift+Tab");
      assert(await dialog.evaluate(node=>node.contains(document.activeElement)));
      await page.screenshot({path:path.join(out,`native-location-${width}-dpr${dpr}-${reduced?"reduced":"normal"}.png`)});
      await close.click();await dialog.waitFor({state:"detached"});
      assert(await page.getByTestId("save-storage-open").evaluate(node=>node===document.activeElement));
      report.nativeMatrix.push({width,height,dpr,reduced,geometry,status:"PASS"});save();
    }
    await cdp.send("Emulation.setDeviceMetricsOverride",{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
    await page.emulateMedia({reducedMotion:"no-preference"});
    return{cases:report.nativeMatrix.length,scope:"Actual exported native WebView; logical CDP viewport emulation, not physical 4K display"};
  });
  await step("normal-game-exit-new-process-and-real-native-load",async()=>{
    await exitPlayer();await startPlayer(exe);await savePage();
    if(manualSlot>6)await page.getByTestId("save-page-next").click();
    const slot=page.getByTestId(`save-slot-manual-${manualSlot}`);
    await slot.getByRole("button",{name:`读取手动存档 ${manualSlot}`,exact:true}).click();
    await page.getByTestId("game-state-playing").waitFor();await A.settleRuntime(page);
    assert.match(await page.locator(".dialog-box").innerText(),/本轮独立 UI 验收/);
    await page.screenshot({path:path.join(out,"native-restarted-load-1080p.png")});
    await exitPlayer();return{normalRestarts:1,realLoad:true};
  });
  await step("actual-windows-write-denied-no-fallback-and-retry",async()=>{
    aclTarget=targetDir;aclReceipt=path.join(out,"readonly-acl.json");
    const before=Object.fromEntries(fs.readdirSync(targetDir).filter(n=>n.endsWith(".json")).map(n=>[n,sha(path.join(targetDir,n))]));
    try{
      await command("deny-save-write","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
        path.join(root,"scripts/portable-save-test-acl.ps1"),"-Mode","Block","-Target",targetDir,"-RunRoot",out,"-ReportPath",aclReceipt]);
      await startPlayer(exe);await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-state-playing").waitFor();await A.settleRuntime(page);
      await page.getByTestId("renpy-quick-save").click();
      const error=page.getByRole("status").filter({hasText:/快存失败/});await error.waitFor();
      report.writeDeniedMessage=await error.innerText();
      assert(report.writeDeniedMessage.includes(targetDir),"Error must identify the actual save directory");
      assert.match(report.writeDeniedMessage,/不会回退/);
      assert.deepEqual(Object.fromEntries(fs.readdirSync(targetDir).filter(n=>n.endsWith(".json")).map(n=>[n,sha(path.join(targetDir,n))])),before);
      for(const file of report.ownedLegacy)assert.equal(sha(file.path),file.sha256,"Denied write cannot alter AppData originals");
      await page.screenshot({path:path.join(out,"native-write-denied-1080p.png")});
    }finally{
      if(fs.existsSync(aclReceipt)){
        await command("restore-save-write","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
          path.join(root,"scripts/portable-save-test-acl.ps1"),"-Mode","Restore","-Target",targetDir,"-RunRoot",out,"-ReportPath",aclReceipt]);
        aclTarget=undefined;
      }
    }
    await page.getByTestId("renpy-quick-save").click();
    await page.getByRole("status").filter({hasText:"快存已保存"}).waitFor();
    await exitPlayer();return{actualAclDenial:true,noFallback:true,realRetry:true};
  });
  assert.deepEqual(report.errors,[]);
  report.status="INSTALLED_PORTABLE_SAVE_FLOW_PASS";
})().catch(async error=>{
  report.status=String(error).includes("BLOCKED:")?"BLOCKED":"FAILED";report.error=String(error.stack||error);
  if(page)await page.screenshot({path:path.join(out,"failure.png")}).catch(()=>{});
  console.error(report.error);process.exitCode=1;
}).finally(async()=>{
  if(aclTarget && fs.existsSync(aclReceipt))try{
    await command("finally-restore-save-write","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
      path.join(root,"scripts/portable-save-test-acl.ps1"),"-Mode","Restore","-Target",aclTarget,"-RunRoot",out,"-ReportPath",aclReceipt]);
    aclTarget=undefined;
  }catch(error){report.status="FAILED";report.aclCleanupError=String(error);process.exitCode=1;}
  if(player){await playerBrowser?.close().catch(()=>{});const {spawnSync}=require("node:child_process");
    const result=spawnSync("taskkill.exe",["/PID",String(player.pid),"/T","/F"],{windowsHide:true});report.cleanup.push({playerPid:player.pid,forced:true,exitCode:result.status});}
  await editorBrowser?.close().catch(()=>{});
  if(owner)report.cleanup.push(await owner.stop());
  for(const file of report.ownedLegacy)try{
    assert.equal(sha(file.path),file.sha256,"Changed legacy test file is preserved, not deleted");
    fs.unlinkSync(file.path);file.testCleanup="REMOVED_OWNED_FILE";
  }catch(error){file.testCleanup="FAILED";file.cleanupError=String(error);report.status="FAILED";process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();console.log(`Evidence: ${out}`);
});
