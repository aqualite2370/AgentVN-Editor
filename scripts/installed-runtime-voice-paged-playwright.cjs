"use strict";
// Real installed library Player; only the library seed uses a public native
// command. All progression/save/load/quick-load actions use visible controls.
const fs=require("node:fs"),path=require("node:path"),net=require("node:net");
const assert=require("node:assert/strict"),{spawn,execFileSync}=require("node:child_process");
const {chromium}=require("../editor/node_modules/playwright");
const {sha256,settleRuntime}=require("./lib/installed-acceptance.cjs");
const {captureInstalledWebview,readInstalledViewport}=require("./lib/installed-webview-capture.cjs");
const {installActualVoiceObserver}=require("./lib/voice-runtime-observer.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-paged-20261019-01";
const work="F:/AgentVN/QA/Runtime-Voice-Paged-20261019-01";
const attempt=process.argv[2]||"01";assert(/^\d{2}$/.test(attempt));
const only=process.argv.find(s=>s.startsWith("--only-cell="))?.slice(12);
if(only)assert(/^(1920x1080|2560x1440|3840x2160)-dpr[12]-(normal|reduced)$/.test(only));
const out=path.join(base,`player-${attempt}`),artifacts=path.join(work,`player-${attempt}`);
assert(!fs.existsSync(out)&&!fs.existsSync(artifacts));fs.mkdirSync(out);fs.mkdirSync(artifacts);
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sha=p=>sha256(fs.readFileSync(p)),prep=read(path.join(base,"preparation.json"));
const fixture=read(path.join(base,"fixtures.json")),exported=read(path.join(base,"export-01/report.json"));
const exe=path.join(prep.installRoot,"agentvn-player.exe");
assert.equal(exported.status,"PASS");assert.equal(exported.cartridges.length,2);
assert(prep.profiles.every(p=>fs.existsSync(p.held)));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT),path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT),path.resolve(base));
assert.equal(sha(exe),"71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
const report={status:"RUNNING",at:new Date().toISOString(),onlyCell:only||null,expectedFlows:only?2:24,
  cells:[],launches:[],screenshots:[],nativeSaves:[],pageErrors:[],error:null,cleanupError:null,
  scope:"INSTALLED_LIBRARY_PLAYER_VOICED_PAGINATION_AND_ACTUAL_PROCESS_RESTART_NOT_STANDALONE_ANDROID_OR_LISTENING",
  sources:[{path:exe,sha256:sha(exe)},{path:__filename,sha256:sha(__filename)},
    {path:fixture.input,sha256:sha(fixture.input)},{path:path.join(base,"export-01/report.json"),
      sha256:sha(path.join(base,"export-01/report.json"))}],productChanges:0,modelRequests:0,newBuilds:0};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let browser,page,cdp,child,owned,cell,current,installId,expected;
function identity(pid){
  const s=execFileSync("powershell.exe",["-NoProfile","-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate|ConvertTo-Json`],
    {encoding:"utf8",windowsHide:true});
  return s.trim()?JSON.parse(s.replace(/^\uFEFF/,"")):null;
}
const native=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const saves=()=>native("list_saves",{installId});
async function ready(screen){
  await page.waitForFunction(s=>{
    const n=document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen")===s&&
      n.getAttribute("data-runtime-screen-transition")==="idle"&&!document.querySelector('[data-testid="game-launch-blackout"]');
  },screen);await settleRuntime(page);
}
async function snapshot(){
  return page.locator(".dialog-box").evaluate(el=>{
    const text=el.querySelector('[data-nvl-current="true"] .nvl-page-text')||el.querySelector(".dialog-text");
    const region=el.querySelector(".nvl-page")||text,r=el.getBoundingClientRect(),t=region?.getBoundingClientRect();
    const range=document.createRange();if(text)range.selectNodeContents(text);
    return {command:Number(document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index")),
      mode:el.dataset.dialogueLayoutMode,page:Number(el.dataset.dialogPage),pages:Number(el.dataset.dialogPages),
      done:el.dataset.dialogPageDone,fontMode:el.dataset.dialogFontMode,scale:Number(el.dataset.dialogFontScale),
      font:text&&parseFloat(getComputedStyle(text).fontSize),text:text?.textContent,
      nvl:Array.from(el.querySelectorAll("[data-nvl-line]")).map(n=>n.textContent),
      rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},
      textRect:t&&{x:t.x,y:t.y,right:t.right,bottom:t.bottom},
      lines:text?Array.from(range.getClientRects()).filter(r=>r.width>0&&r.height>0)
        .map(r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom})):[],
      scroll:region&&{client:region.clientHeight,actual:region.scrollHeight,width:region.clientWidth,actualWidth:region.scrollWidth},
      overflow:document.documentElement.scrollWidth-innerWidth};
  });
}
async function reveal(){
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const before=await snapshot();
  if(before.done!=="true"&&(before.text?.length||0)>400){
    await page.locator(".dialog-box").click();
    const after=await snapshot();assert.equal(after.page,before.page,"Reveal must not consume a page");
    assert.equal(after.command,before.command,"Reveal must not advance a command");
  }else if(before.done!=="true"){
    // Full text isn't exposed before typewriter finishes. aria-label includes
    // the original length, while the visible text can still be very short.
    const length=await page.locator(".dialog-box").evaluate(n=>n.getAttribute("aria-label")?.length||0);
    if(length>400){
      await page.locator(".dialog-box").click();
      const after=await snapshot();assert.equal(after.page,before.page);assert.equal(after.command,before.command);
    }
  }
  await page.waitForFunction(()=>document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done")==="true");
}
async function at(command){
  await page.waitForFunction(i=>Number(document.querySelector('[data-testid="game-state-playing"]')
    ?.getAttribute("data-current-command-index"))===i,command);await reveal();
  const s=await snapshot();assert.equal(s.command,command);assert.equal(s.mode,fixture.voice.dialogs[command].mode);return s;
}
async function turn(){
  await reveal();const before=await snapshot();await page.locator(".dialog-box").click();
  await page.waitForFunction(b=>{
    const n=document.querySelector(".dialog-box"),c=document.querySelector('[data-testid="game-state-playing"]');
    return Number(n?.getAttribute("data-dialog-page"))!==b.page||Number(c?.getAttribute("data-current-command-index"))!==b.command;
  },before);await reveal();return snapshot();
}
const observed=()=>page.evaluate(()=>({calls:window.__QA_VOICE__.calls,events:window.__QA_VOICE__.events}));
async function plays(n){
  await page.waitForFunction(n=>{
    const q=window.__QA_VOICE__;return q.calls.length>=n&&q.calls.slice(0,n).every(c=>c.settlement==="resolved"&&
      q.events.some(e=>e.id===c.id&&e.event==="playing")&&q.events.some(e=>e.id===c.id&&e.event==="timeupdate"&&e.time>0));
  },n);
  const q=await observed();assert.equal(q.calls.length,n);assert(!q.events.some(e=>e.event==="error"));return q;
}
async function silent(n,label){
  const from=Date.now();await pause(2200);const q=await observed();
  assert.equal(q.calls.length,n,label);assert(!q.events.some(e=>e.event==="error"));
  const result={label,expected:n,observed:q.calls.length,windowMs:Date.now()-from};
  cell.negativeWindows.push(result);save();return result;
}
function geometry(s){
  assert(s.rect.x>=-1&&s.rect.y>=-1&&s.rect.right<=expected.width+1&&s.rect.bottom<=expected.height+1);
  assert(s.overflow<=1);assert(s.scroll.actualWidth<=s.scroll.width+1,"No horizontal text clipping");
  assert(s.scroll.actual<=s.scroll.client+2,"No vertical text clipping");
  assert(s.lines.length>0);
  assert(s.lines.every(r=>r.x>=s.textRect.x-2&&r.right<=s.textRect.right+2&&r.y>=s.textRect.y-2&&r.bottom<=s.textRect.bottom+2),
    "Actual glyph rectangles must fit their rendered text region");
}
async function step(name,fn){
  const r={name,status:"RUNNING"};cell.checks.push(r);save();
  try{r.detail=await fn();r.status="PASS"}catch(e){r.status="FAILED";r.error=String(e.stack||e);throw e}
  finally{save();console.log(`${r.status} ${cell.name} ${name}`)}
}
async function shot(label){
  report.screenshots.push(await captureInstalledWebview(page,cdp,path.join(artifacts,`${cell.name}-${label}.png`),expected));save();
}
async function openSaves(){
  if(current==="renpy")await page.getByTestId("renpy-quick-save-load").click();
  else{await page.getByTestId("quick-menu-toggle").click();await page.getByRole("button",{name:"打开存档读档",exact:true}).click()}
  await ready("save_load");
}
async function retain(stored,label){
  const info=await native("get_save_storage_info",{installId});assert.equal(info.portable,false);
  const source=fs.readdirSync(info.targetDirectory).filter(f=>f.endsWith(".json")).map(f=>path.join(info.targetDirectory,f))
    .find(f=>read(f).save_id===stored.save_id);assert(source);
  const retained=path.join(artifacts,`${cell.name}-${label}.json`);
  fs.copyFileSync(source,retained,fs.constants.COPYFILE_EXCL);assert.equal(sha(source),sha(retained));
  report.nativeSaves.push({source,retained,sha256:sha(source),saveId:stored.save_id,cell:cell.name});
}
async function manualSave(slot){
  await openSaves();await page.getByRole("tab",{name:"手动",exact:true}).click();
  await page.getByTestId(`save-slot-manual-${slot}`).locator(".save-card-main").click();
  await page.waitForFunction(()=>document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
  const stored=(await saves()).find(s=>(s.save_kind||"manual")==="manual"&&s.slot===slot);assert(stored);
  await retain(stored,`manual-${slot}`);await page.keyboard.press("Escape");await ready("playing");await reveal();return stored;
}
async function loadFromMenu(kind,slot,fromTitle=false){
  if(!fromTitle){await page.keyboard.press("Escape");await ready("main_menu")}
  await page.getByTestId("open-save-load").click();await ready("save_load");
  await page.getByRole("tab",{name:kind==="quick"?"快存":"手动",exact:true}).click();
  if(kind==="manual")await page.getByRole("button",{name:"读取",exact:true}).click();
  await page.getByTestId(`save-slot-${kind}-${slot}`).locator(".save-card-main").click();await ready("playing");await reveal();
}
async function quickSave(mode){
  const before=(await saves()).map(s=>s.save_id);await page.getByTestId("renpy-quick-save").click();
  let stored;const deadline=Date.now()+15000;
  while(Date.now()<deadline){stored=(await saves()).find(s=>s.save_kind==="quick"&&!before.includes(s.save_id));if(stored)break;await pause(80)}
  assert(stored);await page.waitForFunction(()=>document.querySelector('[data-testid="renpy-quick-save"]')?.getAttribute("aria-busy")!=="true");
  await retain(stored,`quick-${mode}`);return stored;
}
async function start(cartridge,restart=false){
  const port=await new Promise(r=>{const s=net.createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>r(p))})});
  const env={...process.env};for(const k of Object.keys(env))if(/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(k))delete env[k];
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=`--remote-debugging-port=${port}`;
  child=spawn(exe,["--mode","library"],{cwd:prep.installRoot,env,windowsHide:true,stdio:"ignore"});
  owned=identity(child.pid);assert(owned&&path.resolve(owned.ExecutablePath).toLowerCase()===path.resolve(exe).toLowerCase());
  const launch={cell:cell.name,pid:child.pid,cdpPort:port,identity:owned,restart};report.launches.push(launch);save();
  let online=false;const deadline=Date.now()+45000;
  while(Date.now()<deadline&&child.exitCode===null){
    try{online=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok}catch{}
    if(online)break;await pause(100);
  }assert(online);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx=browser.contexts()[0];page=ctx.pages().find(p=>p.url().includes("tauri.localhost"));assert(page);page.setDefaultTimeout(30000);
  page.on("pageerror",e=>report.pageErrors.push({cell:cell.name,error:String(e)}));
  await ctx.addInitScript(installActualVoiceObserver);
  // addInitScript applies to future navigations only. A restarted Player is
  // already at its library before CDP attaches and need not reload/reseed.
  await page.evaluate(installActualVoiceObserver);
  assert.equal(await page.evaluate(()=>window.__QA_VOICE__.calls.length),0);
  cdp=await ctx.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:expected.width,height:expected.height,deviceScaleFactor:expected.dpr,mobile:false});
  await page.emulateMedia({reducedMotion:expected.reduced?"reduce":"no-preference"});
  await readInstalledViewport(page,expected);await page.getByTestId("game-state-library").waitFor();
  if(!restart){
    const now=new Date().toISOString(),record=await native("import_cartridge_from_path",{sourcePath:cartridge.path,
      record:{installId,gameId:fixture.projectId,title:fixture.title,author:"QA",version:"1.0.0",language:"zh-CN",
        description:"Controlled voiced pagination/restart",sourceFileName:path.basename(cartridge.path),
        installedAt:now,updatedAt:now,cartridgePath:""}});
    assert.equal(sha(record.cartridgePath),cartridge.sha256);launch.controlledLibraryImport={record,normalFilePickerClaim:false};save();
    await page.reload({waitUntil:"domcontentloaded"});
  }
  const ordered=await native("list_installed_cartridges"),record=ordered.find(r=>r.installId===installId);assert(record);
  assert.equal(sha(record.cartridgePath),cartridge.sha256);launch.persistedLibraryRecord=record;save();
  await page.waitForFunction(n=>document.querySelectorAll(".cartridge-spine").length===n,ordered.length);
  await page.locator(".cartridge-spine").nth(ordered.findIndex(r=>r.installId===installId)).click();
  await page.getByRole("button",{name:"启动卡带",exact:true}).click();await ready("title_menu");
  assert.equal((await observed()).calls.length,0);
}
async function stop(){
  if(page)report.launches.at(-1).audio=await observed().catch(()=>null);
  await browser?.close().catch(()=>{});browser=null;page=null;cdp=null;
  if(!child)return;const row=report.launches.at(-1);row.cleanup={status:"RUNNING",method:"ATTRIBUTED_PROCESS_TERMINATION_NOT_NORMAL_EXIT"};save();
  if(child.exitCode===null){assert.deepEqual(identity(child.pid),owned);child.kill();await new Promise(r=>child.exitCode!==null?r():child.once("exit",r))}
  let listening=true;const deadline=Date.now()+10000;
  while(Date.now()<deadline){try{await fetch(`http://127.0.0.1:${row.cdpPort}/json/version`,{signal:AbortSignal.timeout(250)})}
    catch{listening=false;break}await pause(100)}
  assert(!identity(row.pid)&&!listening);row.cleanup.status="PASS";child=null;owned=null;save();
}
(async()=>{
  for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])for(const reduced of [false,true]){
    const cellKey=`${width}x${height}-dpr${dpr}-${reduced?"reduced":"normal"}`;if(only&&only!==cellKey)continue;
    for(const cartridge of exported.cartridges){
      current=cartridge.layout;expected={width,height,dpr,reduced};
      cell={name:`${cellKey}-${current}`,layout:current,viewport:expected,status:"RUNNING",checks:[],negativeWindows:[],saved:[]};
      installId=`qa_paged_${attempt}_${cell.name}`.replace(/\W/g,"_");report.cells.push(cell);save();
      try{
        await start(cartridge);await page.getByTestId("start-new-game").click();await ready("playing");let count=0;
        for(let mode=0;mode<3;mode++){
          const index=mode*2,label=["dialog","nvl","bubble"][mode];
          await at(index);await plays(++count);
          await step(`${label}: every voiced page preserves all text and does not replay; interior-page save/load`,async()=>{
            const first=await snapshot();assert(first.pages>1&&first.pages<1000,"Fixture must actually paginate");
            const text=[],pages=[];let stored,quick;
            for(let i=1;i<=first.pages;i++){
              const s=await snapshot();assert.equal(s.page,i);assert.equal(s.command,index);geometry(s);
              text.push(s.text);pages.push(s);
              if(i===2){
                stored=await manualSave(mode+1);assert.equal(stored.command_index,index);
                assert.equal(stored.dialog_page_index,1);assert.equal(stored.dialog_page_count,s.pages);
                if(current==="renpy"){quick=await quickSave(label);assert.equal(quick.dialog_page_index,1)}
                await silent(count,`${label} page2 save/menu must not replay`);
                cell.saved.push({mode:label,index,manual:stored,quick,page:s});save();await shot(`${label}-saved-page2`);
              }
              if(i<first.pages){await turn();assert.equal((await snapshot()).page,i+1)}
            }
            assert.equal(text.join(""),fixture.voice.dialogs[index].text,"Every character must appear exactly once");
            await silent(count,`${label} all page turns must not replay`);
            await loadFromMenu("manual",mode+1);const loaded=await at(index);
            assert.equal(loaded.page,2);assert.equal(loaded.text,pages[1].text);assert.deepEqual(loaded.nvl,pages[1].nvl);
            await silent(count,`${label} interior-page load must be silent`);
            // Finish from the loaded interior page, then verify new commands
            // are not suppressed by the silent restoration behavior.
            while((await snapshot()).page<first.pages)await turn();
            await turn();await at(index+1);await plays(++count);
            if(mode<2){await turn();await at(index+2)}
            return {pages,preservedCharacters:text.join("").length,storedId:stored.save_id,loaded,count};
          });
        }
        const before=await saves();const oldPid=child.pid;await stop();
        await step("Actual process restart keeps library/save identity without reseeding or touching save bytes",async()=>{
          await start(cartridge,true);assert.notEqual(child.pid,oldPid);assert.deepEqual(await saves(),before);
          return {oldPid,newPid:child.pid,saveIds:before.map(s=>s.save_id),reseeded:false};
        });
        for(let mode=0;mode<3;mode++){
          const saved=cell.saved[mode];
          await step(`${saved.mode}: restart manual load restores exact interior page silently; next new command still plays`,async()=>{
            await loadFromMenu("manual",mode+1,mode===0);const s=await at(saved.index);
            assert.equal(s.page,2);assert.equal(s.text,saved.page.text);assert.deepEqual(s.nvl,saved.page.nvl);geometry(s);
            await silent(mode,`${saved.mode} process restart manual restoration must not play`);
            await shot(`${saved.mode}-restart-restored`);
            while((await snapshot()).page<s.pages)await turn();
            await turn();await at(saved.index+1);await plays(mode+1);
            return {restored:s,plays:mode+1};
          });
        }
        if(current==="renpy"){
          for(const saved of cell.saved)await step(`${saved.mode}: persisted quick-category slot restores original page without voice`,async()=>{
            await loadFromMenu("quick",saved.quick.slot);const s=await at(saved.index);
            assert.equal(s.page,2);assert.equal(s.text,saved.page.text);assert.deepEqual(s.nvl,saved.page.nvl);
            await silent(3,`${saved.mode} persisted quick-category load must not play`);return s;
          });
          await step("Restarted latest quick-load cancel and confirmation preserve exact page and remain silent",async()=>{
            await page.getByTestId("renpy-quick-load").click();await page.getByTestId("confirm-quick-load").waitFor();
            const before=await snapshot();await page.getByRole("dialog").getByRole("button",{name:"取消",exact:true}).click();
            assert.deepEqual(await snapshot(),before);
            await page.getByTestId("renpy-quick-load").click();await page.getByTestId("confirm-quick-load").click();await ready("playing");
            const s=await at(4);assert.equal(s.page,2);assert.equal(s.text,cell.saved[2].page.text);
            await silent(3,"Confirmed latest quick-load after process restart must not replay");return s;
          });
        }
        cell.status="PASS";
      }catch(e){cell.status="FAILED";cell.error=String(e.stack||e);
        if(page){cell.body=(await page.locator("body").innerText().catch(()=>"")).slice(-3000);await shot("failure").catch(()=>{})}}
      finally{await stop();save()}
    }
  }
  assert.equal(report.cells.length,report.expectedFlows);assert.deepEqual(report.pageErrors,[]);
  report.status=report.cells.every(c=>c.status==="PASS")?"PASS":"FAILED";if(report.status!=="PASS")process.exitCode=1;
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1})
.finally(async()=>{
  try{await stop()}catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,flows:report.cells.length,passed:report.cells.filter(c=>c.status==="PASS").length,out}));
});
