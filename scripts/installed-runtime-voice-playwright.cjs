"use strict";
// Real installed library Player + actual audio. The observer delegates to the
// original media play() and returns its original promise; it never simulates
// loading, decoding, successful playback, store state or save responses.
const fs=require("node:fs"),path=require("node:path"),net=require("node:net");
const assert=require("node:assert/strict"),{spawn,execFileSync}=require("node:child_process");
const {chromium}=require("../editor/node_modules/playwright");
const {sha256,settleRuntime}=require("./lib/installed-acceptance.cjs");
const {captureInstalledWebview,readInstalledViewport}=require("./lib/installed-webview-capture.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-20261019-01";
const work="F:/AgentVN/QA/Runtime-Voice-20261019-01";
const attempt=process.argv[2]||"01";assert(/^\d{2}$/.test(attempt));
const out=path.join(base,`player-${attempt}`),artifacts=path.join(work,`player-${attempt}`);
assert(!fs.existsSync(out)&&!fs.existsSync(artifacts));fs.mkdirSync(out);fs.mkdirSync(artifacts);
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sha=p=>sha256(fs.readFileSync(p)),prep=read(path.join(base,"preparation.json"));
const fixture=read(path.join(base,"fixtures.json")),exportsFile=path.join(base,"export-01/report.json");
const exported=read(exportsFile),exe=path.join(prep.installRoot,"agentvn-player.exe");
assert.equal(exported.status,"PASS");assert.equal(exported.cartridges.length,2);
assert(prep.profiles.every(p=>fs.existsSync(p.held)));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT),path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT),path.resolve(base));
assert.equal(sha(exe),"71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
const report={status:"RUNNING",at:new Date().toISOString(),cells:[],launches:[],screenshots:[],nativeSaves:[],
  pageErrors:[],sources:[{path:fixture.input,sha256:sha(fixture.input)},{path:exportsFile,sha256:sha(exportsFile)},
    {path:__filename,sha256:sha(__filename)},{path:exe,sha256:sha(exe)}],error:null,cleanupError:null,
  scope:"ACTUAL_INSTALLED_LIBRARY_PLAYER_VOICE_TRIGGER_AND_RESTORATION_NOT_STANDALONE_SETUP_ANDROID_OR_NEW_LISTENING_ACCEPTANCE",
  observation:"Native media play calls, original promises and browser media events; no mocked playback or store",
  syntheticWav:fixture.voice,productChanges:0,modelRequests:0,newBuilds:0};
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
async function ready(screen){
  await page.waitForFunction(s=>{
    const n=document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen")===s&&
      n.getAttribute("data-runtime-screen-transition")==="idle"&&!document.querySelector('[data-testid="game-launch-blackout"]');
  },screen);await settleRuntime(page);
}
async function snapshot(){
  return page.evaluate(()=>{
    const n=document.querySelector('[data-testid="game-state-playing"]'),d=document.querySelector(".dialog-box");
    const r=d?.getBoundingClientRect();
    return {command:Number(n?.getAttribute("data-current-command-index")),scene:n?.getAttribute("data-current-scene-id"),
      mode:d?.getAttribute("data-dialogue-layout-mode"),text:d?.getAttribute("aria-label"),
      nvl:Array.from(d?.querySelectorAll("[data-nvl-line]")||[]).map(e=>e.textContent),
      done:d?.getAttribute("data-dialog-page-done"),page:d?.getAttribute("data-dialog-page"),
      rect:r&&{x:r.x,y:r.y,right:r.right,bottom:r.bottom},overflow:document.documentElement.scrollWidth-innerWidth};
  });
}
async function at(index){
  await page.waitForFunction(i=>{
    const n=document.querySelector('[data-testid="game-state-playing"]');
    return Number(n?.getAttribute("data-current-command-index"))===i&&
      n.getAttribute("data-current-scene-id")==="voice_restore"&&
      document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done")==="true";
  },index);
  const s=await snapshot();assert.equal(s.command,index);assert.equal(s.mode,fixture.voice.dialogs[index].mode);
  assert(s.text?.includes(fixture.voice.dialogs[index].text));
  assert(s.rect.x>=-1&&s.rect.y>=-1&&s.rect.right<=expected.width+1&&s.rect.bottom<=expected.height+1);
  assert(s.overflow<=1);return s;
}
async function advance(index){await at(index-1);await page.locator(".dialog-box").click();return at(index)}
const observed=()=>page.evaluate(()=>({calls:window.__QA_VOICE__.calls,events:window.__QA_VOICE__.events}));
async function count(expectedCount){
  await page.waitForFunction(n=>{
    const q=window.__QA_VOICE__;
    return q.calls.length>=n&&q.calls.slice(0,n).every(c=>c.settlement==="resolved")&&
      q.calls.slice(0,n).every(c=>q.events.some(e=>e.id===c.id&&e.event==="timeupdate"&&e.time>0));
  },expectedCount);
  const q=await observed();assert.equal(q.calls.length,expectedCount,"One actual command execution must issue one media play");
  assert(q.calls.every(c=>c.settlement==="resolved"));
  assert(!q.events.some(e=>e.event==="error"));return q;
}
async function noNewPlay(expectedCount,label){
  const from=Date.now();await settleRuntime(page);
  // Explicit negative-observation window longer than the 2s source clip,
  // not an animation-completion timeout or substituted functional readiness.
  await pause(2200);
  const q=await observed();assert.equal(q.calls.length,expectedCount,label);
  assert(q.calls.every(c=>c.settlement==="resolved"));assert(!q.events.some(e=>e.event==="error"));
  return {label,expectedCount,observedCount:q.calls.length,negativeWindowMs:Date.now()-from};
}
async function step(name,fn){
  const r={name,status:"RUNNING"};cell.checks.push(r);save();
  try{r.detail=await fn();r.status="PASS"}catch(e){r.status="FAILED";r.error=String(e.stack||e);throw e}
  finally{save();console.log(`${r.status} ${cell.name} ${name}`)}
}
async function shot(name){
  report.screenshots.push(await captureInstalledWebview(page,cdp,path.join(artifacts,`${cell.name}-${name}.png`),expected));save();
}
async function saveUI(slot){
  if(current==="renpy")await page.getByTestId("renpy-quick-save-load").click();
  else{await page.getByTestId("quick-menu-toggle").click();await page.getByRole("button",{name:"打开存档读档",exact:true}).click()}
  await ready("save_load");await page.getByRole("tab",{name:"手动",exact:true}).click();
  await page.getByTestId(`save-slot-manual-${slot}`).locator(".save-card-main").click();
  await page.waitForFunction(()=>document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
  const stored=(await native("list_saves",{installId})).find(s=>(s.save_kind||"manual")==="manual"&&s.slot===slot);assert(stored);
  const info=await native("get_save_storage_info",{installId});assert.equal(info.portable,false);
  const files=fs.readdirSync(info.targetDirectory).filter(f=>f.endsWith(".json")).map(f=>path.join(info.targetDirectory,f));
  const source=files.find(f=>read(f).save_id===stored.save_id);assert(source);
  const retained=path.join(artifacts,`${cell.name}-save-${slot}.json`);
  fs.copyFileSync(source,retained,fs.constants.COPYFILE_EXCL);assert.equal(sha(retained),sha(source));
  report.nativeSaves.push({source,retained,sha256:sha(source),saveId:stored.save_id,cell:cell.name});
  await page.keyboard.press("Escape");await ready("playing");return stored;
}
async function loadUI(slot){
  await page.keyboard.press("Escape");await ready("main_menu");
  await page.getByTestId("open-save-load").click();await ready("save_load");
  await page.getByRole("tab",{name:"手动",exact:true}).click();
  await page.getByRole("button",{name:"读取",exact:true}).click();
  await page.getByTestId(`save-slot-manual-${slot}`).locator(".save-card-main").click();await ready("playing");
}
async function start(cartridge){
  const port=await new Promise(r=>{const s=net.createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>r(p))})});
  const env={...process.env};for(const k of Object.keys(env))if(/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(k))delete env[k];
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=`--remote-debugging-port=${port}`;
  child=spawn(exe,["--mode","library"],{cwd:prep.installRoot,env,windowsHide:true,stdio:"ignore"});
  owned=identity(child.pid);assert(owned&&path.resolve(owned.ExecutablePath).toLowerCase()===path.resolve(exe).toLowerCase());
  report.launches.push({cell:cell.name,pid:child.pid,cdpPort:port,identity:owned});save();
  let online=false;const deadline=Date.now()+45000;
  while(Date.now()<deadline&&child.exitCode===null){
    try{online=(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).ok}catch{}
    if(online)break;await pause(100);
  }assert(online);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx=browser.contexts()[0];page=ctx.pages().find(p=>p.url().includes("tauri.localhost"));assert(page);
  page.setDefaultTimeout(25000);page.on("pageerror",e=>report.pageErrors.push({cell:cell.name,error:String(e)}));
  await ctx.addInitScript(()=>{
    if(window.__QA_VOICE__)return;
    const q=window.__QA_VOICE__={calls:[],events:[],elements:[]};
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(...args){
      const audio=this,id=q.calls.length+1;
      const state=document.querySelector('[data-testid="game-state-playing"]');
      const call={id,at:performance.now(),source:audio.currentSrc||audio.src,
        command:state?.getAttribute("data-current-command-index"),
        scene:state?.getAttribute("data-current-scene-id"),settlement:"pending"};
      q.calls.push(call);q.elements.push(audio);
      for(const event of ["play","playing","timeupdate","ended","error","pause"])
        audio.addEventListener(event,()=>q.events.push({id,event,at:performance.now(),time:audio.currentTime,
          duration:Number.isFinite(audio.duration)?audio.duration:null,error:audio.error?.code||null}),{once:false});
      const promise=Reflect.apply(play,audio,args);
      promise.then(()=>{call.settlement="resolved"},e=>{call.settlement="rejected";call.error=String(e)});
      return promise;
    };
  });
  cdp=await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:expected.width,height:expected.height,deviceScaleFactor:expected.dpr,mobile:false});
  await page.emulateMedia({reducedMotion:expected.reduced?"reduce":"no-preference"});
  await readInstalledViewport(page,expected);await page.getByTestId("game-state-library").waitFor();
  const now=new Date().toISOString(),record=await native("import_cartridge_from_path",{
    sourcePath:cartridge.path,record:{installId,gameId:fixture.projectId,title:fixture.title,author:"QA",version:"1.0.0",
      language:"zh-CN",description:"Synthetic voice observation, no listening claim",
      sourceFileName:path.basename(cartridge.path),installedAt:now,updatedAt:now,cartridgePath:""}});
  assert.equal(sha(record.cartridgePath),cartridge.sha256);
  report.launches.at(-1).controlledLibraryImport={record,normalFilePickerClaim:false};save();
  await page.reload({waitUntil:"domcontentloaded"});
  const ordered=await native("list_installed_cartridges");
  await page.waitForFunction(n=>document.querySelectorAll(".cartridge-spine").length===n,ordered.length);
  const index=ordered.findIndex(r=>r.installId===installId);assert(index>=0);
  await page.locator(".cartridge-spine").nth(index).click();
  await page.getByRole("button",{name:"启动卡带",exact:true}).click();await ready("title_menu");
  assert.equal((await observed()).calls.length,0);
}
async function stop(){
  if(page)cell.audio=await observed().catch(()=>null);
  await browser?.close().catch(()=>{});browser=null;page=null;cdp=null;
  if(!child)return;const row=report.launches.at(-1);
  row.cleanup={status:"RUNNING",method:"ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE"};save();
  if(child.exitCode===null){
    assert.deepEqual(identity(child.pid),owned);child.kill();
    await new Promise(r=>child.exitCode!==null?r():child.once("exit",r));
  }
  let listening=true;const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    try{await fetch(`http://127.0.0.1:${row.cdpPort}/json/version`,{signal:AbortSignal.timeout(250)})}
    catch{listening=false;break}await pause(100);
  }
  assert(!identity(row.pid)&&!listening);row.cleanup.status="PASS";child=null;owned=null;save();
}
(async()=>{
  for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])for(const reduced of [false,true])
    for(const cartridge of exported.cartridges){
      current=cartridge.layout;expected={width,height,dpr,reduced};
      const name=`${width}x${height}-dpr${dpr}-${reduced?"reduced":"normal"}-${current}`;
      installId=`qa_voice_${attempt}_${name}`.replace(/\W/g,"_");
      cell={name,layout:current,viewport:expected,status:"RUNNING",checks:[]};report.cells.push(cell);save();
      try{
        await start(cartridge);let plays=0;
        await page.getByTestId("start-new-game").click();await ready("playing");
        for(let mode=0;mode<3;mode++){
          const index=mode*3,label=["dialog","nvl","bubble"][mode];
          await step(`${label}: actual new command plays exported WAV once and browser advances its media clock`,async()=>{
            const state=mode?await advance(index):await at(index);
            await count(++plays);
            const bytes=await page.evaluate(async()=>{
              const audio=window.__QA_VOICE__.elements.at(-1);
              const b=await(await fetch(audio.currentSrc||audio.src)).arrayBuffer();
              return {sha256:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b))).map(n=>n.toString(16).padStart(2,"0")).join(""),
                bytes:b.byteLength};
            });assert.equal(bytes.sha256,fixture.voice.sha256);return {state,bytes,count:plays};
          });
          await step(`${label}: menu and real durable save do not re-execute voice`,async()=>{
            const before=await at(index),stored=await saveUI(mode+1);
            assert.equal(stored.command_index,index);
            assert.deepEqual((await at(index)).nvl,before.nvl);
            return {stored,observation:await noNewPlay(plays,"Menu/save must not replay current voice")};
          });
          await step(`${label}: native load restores exact page without voice replay`,async()=>{
            await advance(index+1);await count(++plays);
            await loadUI(mode+1);const restored=await at(index);
            return {restored,observation:await noNewPlay(plays,"Loading a snapshot must not re-execute voice")};
          });
          await step(`${label}: newly visited lines play once; rollback and forward restore silently without duplicate NVL`,async()=>{
            await advance(index+1);await count(++plays);
            const middle=await at(index+1);await advance(index+2);await count(++plays);
            const last=await at(index+2);
            await page.keyboard.press("PageUp");const back=await at(index+1);
            assert.deepEqual(back.nvl,middle.nvl);
            const backObservation=await noNewPlay(plays,"Rollback must not replay recorded voice");
            await page.keyboard.press("PageDown");const forward=await at(index+2);
            assert.deepEqual(forward.nvl,last.nvl);
            const forwardObservation=await noNewPlay(plays,"Rollforward must not replay recorded voice");
            await shot(`${label}-restored`);return {middle,last,back,forward,backObservation,forwardObservation,count:plays};
          });
        }
        assert.equal(plays,12);assert.equal(cell.checks.length,12);await count(12);cell.status="PASS";
      }catch(e){
        cell.status="FAILED";cell.error=String(e.stack||e);
        if(page){cell.body=(await page.locator("body").innerText().catch(()=>"")).slice(-5000);await shot("failure").catch(()=>{})}
      }finally{await stop();save()}
    }
  assert.equal(report.cells.length,24);report.status=report.cells.every(c=>c.status==="PASS")?"PASS":"FAILED";
  assert.deepEqual(report.pageErrors,[]);
  if(report.status!=="PASS")process.exitCode=1;
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1})
.finally(async()=>{
  try{await stop()}catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,cells:report.cells.length,passed:report.cells.filter(c=>c.status==="PASS").length,out}));
});
