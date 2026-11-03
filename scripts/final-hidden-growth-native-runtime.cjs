"use strict";
// Final canonical project only. Native player, real UI input, no engine injection.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const { renderedDialogGlyphs } = require("./lib/rendered-dialog-glyphs.cjs");
const { measureSettingsIconProportions, assertSettingsIconProportions } = require("./lib/runtime-settings-proportions.cjs");
assert.equal(process.argv.length, 4, "node runtime <Windows-resource-audit.json> <fresh-output>");
const [auditFile, out] = process.argv.slice(2).map(p => path.resolve(p));
const read = f => JSON.parse(fs.readFileSync(f, "utf8")), audit = read(auditFile);
assert.equal(audit.status, "INSTALLED_FINAL_WINDOWS_EXPORT_AUDIT_PASS_RUNTIME_PENDING");
assert.equal(audit.assets.length, 143);
const exe = audit.executable.path, portable = path.dirname(exe);
assert.equal(A.sha256(fs.readFileSync(exe)), audit.executable.sha256);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "Final canonical project, actual installed-editor Windows export, native WebView CSS viewport/DPR emulation; not a physical 4K display",
  coverage: "Title, all settings categories, actual branch into first chapter, representative authored dialogue/sprite, seven menu actions, native manual save/load and returns. Not every story line or every route.",
  artifactAudit: { path: auditFile, sha256: A.sha256(fs.readFileSync(auditFile)) },
  executable: audit.executable, cases: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const delay = ms => new Promise(r => setTimeout(r, ms));
let player, browser, page, cdp, current;
async function idle(screen) {
  await page.waitForFunction(expected => {
    const nav = document.querySelector("[data-runtime-screen-transition]");
    return nav?.dataset.runtimeScreenTransition === "idle"
      && (!expected || nav.dataset.runtimePresentedScreen === expected && nav.dataset.runtimeCommittedScreen === expected)
      && !document.querySelector(".boot-overlay, [data-testid='game-launch-blackout']");
  }, screen);
}
async function screenshot(name) {
  const captured = await captureInstalledWebview(page, cdp, path.join(current.output, `${name}.png`), current.viewport);
  current.screenshots.push(captured); save();
}
async function metrics(selector) {
  return page.locator(selector).evaluateAll(nodes => nodes.filter(n => {
    const s = getComputedStyle(n), r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }).map(n => { const r = n.getBoundingClientRect(); return { text: n.textContent.trim(),
    rect: r.toJSON(), disabled: !!n.disabled, hit: n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
    viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth-innerWidth }; }));
}
function assertBounds(rows, label, hit = true) {
  assert(rows.length, `${label}: no controls`);
  for (const row of rows) {
    const r = row.rect, v = row.viewport;
    assert(r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= v.width+1 && r.bottom <= v.height+1,
      `${label}: clipped ${row.text}`);
    assert(row.overflow <= 1, `${label}: horizontal overflow`);
    if (hit && !row.disabled) assert(row.hit, `${label}: cannot hit ${row.text}`);
  }
  for (let i=0;i<rows.length;i++) for (const earlier of rows.slice(0,i)) {
    const a=rows[i].rect,b=earlier.rect;
    assert(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1 ||
      Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1, `${label}: overlapping controls`);
  }
}
async function state() {
  await idle("playing");
  return page.evaluate(async () => {
    for (let i=0;i<3;i++) await new Promise(r=>requestAnimationFrame(r));
    const p=document.querySelector(".story-player"),d=document.querySelector(".dialog-box");
    return { scene:p?.dataset.currentSceneId, command:p?.dataset.currentCommandIndex,
      waiting:p?.dataset.waitingChoice==="true", page:Number(d?.dataset.dialogPage), pages:Number(d?.dataset.dialogPages),
      done:d?.dataset.dialogPageDone==="true", text:d?.querySelector(".dialog-text")?.textContent??"" };
  });
}
async function reveal() {
  const before=await state();
  if (!before.done && !before.waiting) {
    await page.locator(".dialog-box").press("Enter");
    await page.waitForFunction(()=>document.querySelector(".dialog-box")?.dataset.dialogPageDone==="true");
  }
  const after=await state();
  assert.equal(after.scene,before.scene); assert.equal(after.command,before.command);
  assert.equal(after.page,before.page,"Reveal must not advance dialogue pages");
  return after;
}
async function next() {
  const before=await reveal();
  assert(!before.waiting,"Select a real branch instead of advancing over it");
  await page.locator(".dialog-box").press("Enter");
  await page.waitForFunction(before=>{
    const p=document.querySelector(".story-player"),d=document.querySelector(".dialog-box");
    return p?.dataset.currentSceneId!==before.scene || p?.dataset.currentCommandIndex!==before.command ||
      Number(d?.dataset.dialogPage)!==before.page || p?.dataset.waitingChoice==="true";
  },before);
  return state();
}
async function dialogueGeometry() {
  await reveal();
  const value=await page.locator(".dialog-box").evaluate((dialog,collectSource)=>{
    const text=dialog.querySelector(".dialog-text"), collect=new Function(`return (${collectSource})`)();
    return { dialog:dialog.getBoundingClientRect().toJSON(),glyphs:collect(text),
      overflowX:text.scrollWidth-text.clientWidth,overflowY:text.scrollHeight-text.clientHeight,
      fontMode:dialog.dataset.dialogFontMode,fontScale:dialog.dataset.dialogFontScale,pages:dialog.dataset.dialogPages,
      width:innerWidth,height:innerHeight };
  },renderedDialogGlyphs.toString());
  const b=value.dialog;
  assert(b.left>=-1 && b.top>=-1 && b.right<=value.width+1 && b.bottom<=value.height+1);
  assert(value.glyphs.length>0); assert(value.overflowX<=1 && value.overflowY<=1,"Dialogue is cropped/scrolling");
  for (const g of value.glyphs) assert(g.left>=b.left-1 && g.right<=b.right+1 && g.top>=b.top-1 && g.bottom<=b.bottom+1,
    "Painted dialogue glyphs leave their panel");
  return value;
}
async function expand() {
  const toggle=page.getByTestId("quick-menu-toggle");
  if (await toggle.getAttribute("aria-expanded")!=="true") await toggle.click();
  await page.locator(".playback-controls.is-expanded").waitFor(); await A.settleRuntime(page);
}
async function menuGeometry() {
  await expand();
  const buttons=await metrics(".playback-controls button");
  assert.equal(buttons.length,8); assertBounds(buttons,"Single-column seven actions and collapse");
  const result=await page.locator(".playback-controls").evaluate(n=>({
    rect:n.getBoundingClientRect().toJSON(),columns:n.dataset.quickMenuColumns,scrollable:n.dataset.quickMenuScrollable,
    rootOverflowX:n.scrollWidth-n.clientWidth,rootOverflowY:n.scrollHeight-n.clientHeight,
    layoutSource:n.dataset.uiLayoutSource,anchor:n.dataset.quickMenuAnchor,
  }));
  assert.equal(result.columns,"1"); assert.equal(result.scrollable,"false");
  assert(result.rootOverflowX<=1 && result.rootOverflowY<=1,"Quick menu has internal overflow");
  return { buttons,root:result };
}
async function transition(action,screen) {
  await page.evaluate(()=>{
    window.__finalMotionActive=true;window.__finalMotion=[];
    const sample=()=>{
      const n=document.querySelector("[data-runtime-screen-transition]"), launch=document.querySelector("[data-testid='game-launch-blackout']");
      if(n) window.__finalMotion.push({at:performance.now(),phase:n.dataset.runtimeTransitionPhase,
        presented:n.dataset.runtimePresentedScreen,committed:n.dataset.runtimeCommittedScreen,
        black:Number(getComputedStyle(n,"::before").opacity),
        launch:launch?Number(getComputedStyle(launch).opacity):null,
        overflow:document.documentElement.scrollWidth-innerWidth});
      if(window.__finalMotionActive)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  });
  await action();await idle(screen);
  const frames=await page.evaluate(()=>{window.__finalMotionActive=false;return window.__finalMotion;});
  assert(frames.some(f=>(f.black>0 && f.black<1)||(f.launch>0 && f.launch<1)),
    `Missing actual transition middle frames to ${screen}`);
  assert(frames.every(f=>f.overflow<=1));
  current.transitions.push({screen,frames});save();
}
async function test(name,action) {
  const row={name,status:"RUNNING"};current.checks.push(row);save();
  try {row.evidence=await action();row.status="PASS";console.log(`PASS: ${current.key} ${name}`);}
  catch(error){row.status="FAILED";throw error;} finally{save();}
}
function saveFiles() {
  const base=path.join(portable,"saves"),files=[];
  const walk=dir=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    assert(!e.isSymbolicLink(),"Save path must not redirect");
    const v=path.join(dir,e.name);if(e.isDirectory())walk(v);else files.push(v);
  }};walk(base);return files;
}
async function runCase(viewport) {
  const key=`${viewport.width}x${viewport.height}-dpr${viewport.dpr}-${viewport.reduced?"reduced":"normal"}`;
  current={key,viewport,status:"RUNNING",output:path.join(out,key),checks:[],screenshots:[],transitions:[]};
  fs.mkdirSync(current.output);report.cases.push(current);save();
  const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);
    s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const profile=path.join(current.output,"webview");
  player=spawn(exe,[],{cwd:portable,windowsHide:true,stdio:"ignore",env:{...process.env,
    WEBVIEW2_USER_DATA_FOLDER:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
  current.owner={pid:player.pid,port,profile};save();
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    assert.equal(player.exitCode,null);
    try{if((await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}
    await delay(150);
  }
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  while(!page && Date.now()<deadline){
    page=browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri\.localhost|tauri:/.test(p.url()));
    if(!page)await delay(100);
  }
  assert(page);page.setDefaultTimeout(30000);
  page.on("pageerror",e=>{report.errors.push(String(e));save();});
  cdp=await page.context().newCDPSession(page);
  await page.setViewportSize({width:viewport.width,height:viewport.height});
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:viewport.width,height:viewport.height,
    deviceScaleFactor:viewport.dpr,mobile:false});
  await page.emulateMedia({reducedMotion:viewport.reduced?"reduce":"no-preference"});
  await idle("title_menu");await page.getByTestId("start-new-game").click({trial:true});
  current.actualViewport=await readInstalledViewport(page,viewport);
  await test("title and about actual navigation",async()=>{
    const buttons=await metrics(".main-menu button");assertBounds(buttons,"Title");
    await screenshot("title");
    await transition(()=>page.getByTestId("open-about").click(),"about");
    await page.getByTestId("about-screen").waitFor();await screenshot("about");
    await transition(()=>page.getByTestId("back-to-main-menu").click(),"title_menu");
    return {buttons};
  });
  await test("five settings categories, icon proportions and return",async()=>{
    await transition(()=>page.getByTestId("open-settings").click(),"settings");
    const proportions=await page.evaluate(measureSettingsIconProportions);assertSettingsIconProportions(proportions);
    const tabs=await metrics(".settings-tabs button");assert.equal(tabs.length,5);assertBounds(tabs,"Settings categories");
    for(const name of ["显示","文字","音频","跳过","系统"]){
      await page.locator(".settings-tabs").getByRole("button",{name,exact:true}).click();
      await A.settleRuntime(page);
      assertBounds(await metrics(".settings-tabs button"),`Settings ${name}`);
    }
    await page.getByRole("checkbox",{name:"自动存档",exact:true}).uncheck();
    await screenshot("settings");
    await transition(()=>page.getByTestId("settings-finish").click(),"title_menu");
    return {tabs,proportions};
  });
  await test("authored intro, real branch and original first-chapter images",async()=>{
    await transition(()=>page.getByTestId("start-new-game").click(),"playing");
    for(let i=0;i<12;i++){const s=await state();if(s.waiting)break;await next();}
    await page.getByRole("button",{name:"选择：白线第一部分",exact:true}).click();
    await idle("playing");
    await page.waitForFunction(()=>document.querySelector(".story-player")?.dataset.currentSceneId==="scene_opening");
    const seen=[];
    for(let i=0;i<25;i++){
      const s=await reveal();seen.push({scene:s.scene,command:s.command,page:s.page,pages:s.pages,text:s.text});
      await dialogueGeometry();
      const sprite=await page.locator(".sprite-slot img").evaluateAll(images=>images.some(i=>i.complete && i.naturalWidth>0));
      if(sprite)break;
      await next();
    }
    assert(seen.some(s=>s.text.includes("皮瑟鲁斯")),"Canonical first-chapter text not shown");
    const images=await page.locator(".sprite-slot img").evaluateAll(items=>items.map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight})));
    assert(images.some(i=>i.complete && i.width>0 && i.height>0),"No decoded original sprite");
    await screenshot("authored-sprite-dialogue");return {seen,images,geometry:await dialogueGeometry()};
  });
  let saved;
  await test("single column eight visible controls and native save/load beside EXE",async()=>{
    const menu=await menuGeometry();await screenshot("quick-menu");
    saved=await reveal();
    await page.getByRole("button",{name:"打开存档读档",exact:true}).click();await idle("save_load");
    const slot=page.getByTestId("save-slot-manual-1");
    await slot.getByRole("button",{name:/保存到手动存档 1|覆盖手动存档 1/}).click();
    await page.getByRole("status").filter({hasText:"存档已保存"}).waitFor();
    const files=saveFiles();assert(files.length>0,"No real files in EXE/saves");
    const saveDir=path.join(current.output,"native-save-evidence");fs.mkdirSync(saveDir);
    const evidence=[];
    for(const [i,file] of files.entries()){
      const bytes=fs.readFileSync(file),copy=path.join(saveDir,`${i}-${path.basename(file)}`);fs.writeFileSync(copy,bytes,{flag:"wx"});
      evidence.push({actualPath:file,copy,sha256:A.sha256(bytes),bytes:bytes.length});
    }
    await screenshot("manual-save");
    await page.locator(".save-mode-switch").getByRole("button",{name:"读取",exact:true}).click();
    await slot.getByRole("button",{name:"读取手动存档 1",exact:true}).click();await idle("playing");
    const loaded=await reveal();assert.equal(loaded.scene,saved.scene);assert.equal(loaded.command,saved.command);
    assert.equal(loaded.page,saved.page);return {menu,saved,loaded,files:evidence};
  });
  await test("history, hidden UI, main menu and settings return preserve position",async()=>{
    await expand();await page.getByRole("button",{name:"打开历史记录",exact:true}).click();await idle("history");
    assert(await page.locator(".history-list article").count()>0);
    await screenshot("history");await page.getByTestId("back-to-player").click();await idle("playing");
    await expand();await page.getByRole("button",{name:"隐藏界面",exact:true}).click();
    await page.locator(".dialog-box").waitFor({state:"detached"});
    await page.locator(".story-player").click({position:{x:20,y:20}});await page.locator(".dialog-box").waitFor();
    await expand();await page.getByTestId("open-main-menu").click();await idle("main_menu");
    await page.getByTestId("open-settings").click();await idle("settings");
    await page.getByTestId("settings-finish").click();await idle("main_menu");
    await page.getByTestId("continue-game").click();await idle("playing");
    const after=await reveal();assert.equal(after.scene,saved.scene);assert.equal(after.command,saved.command);
    await screenshot("menu-return");return {after};
  });
  await test("rollback, auto and skip controls execute",async()=>{
    const before=await reveal();await next();await reveal();await expand();
    await page.getByRole("button",{name:"回退",exact:true}).click();await idle("playing");
    const rolled=await reveal();assert.equal(rolled.scene,before.scene);assert.equal(rolled.command,before.command);
    await expand();await page.getByRole("button",{name:"开启自动播放",exact:true}).click();
    await page.getByRole("button",{name:"关闭自动播放",exact:true}).click();
    await page.getByRole("button",{name:"开启快进",exact:true}).click();
    await page.getByRole("button",{name:"关闭快进",exact:true}).click();
    await page.getByTestId("quick-menu-toggle").click();await A.settleRuntime(page);
    assert.equal(await page.getByTestId("quick-menu-toggle").getAttribute("aria-expanded"),"false");
    await screenshot("controls-return");return {before,rolled};
  });
  current.finalViewport=await readInstalledViewport(page,viewport);
  current.status="PASS";save();
}
(async()=>{
  save();
  for(const [width,height] of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])for(const reduced of [false,true]){
    try{await runCase({width,height,dpr,reduced});}
    catch(error){
      if(current){current.status="FAILED";current.error=String(error.stack||error);
        if(page){current.failureText=await page.locator("body").innerText().catch(()=>"");await screenshot("failure").catch(()=>{});}}
      throw error;
    }finally{
      await browser?.close().catch(()=>{});browser=undefined;page=undefined;cdp=undefined;
      if(player?.pid && player.exitCode===null){
        const result=spawnSync("taskkill.exe",["/PID",String(player.pid),"/T","/F"],{windowsHide:true,encoding:"utf8"});
        current.cleanup={pid:player.pid,exitCode:result.status};
        assert.equal(result.status,0,"Owned native player cleanup failed");
      }else if(player)current.cleanup={pid:player.pid,alreadyExited:true,exitCode:player.exitCode};
      player=undefined;save();
    }
  }
  assert.equal(report.cases.length,12);assert(report.cases.every(c=>c.status==="PASS" && c.checks.length===6 && c.checks.every(x=>x.status==="PASS")));
  assert.deepEqual(report.errors,[]);assert.equal(A.sha256(fs.readFileSync(exe)),audit.executable.sha256);
  report.status="INSTALLED_FINAL_WINDOWS_NATIVE_MATRIX_PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,cases:report.cases.length,out,error:report.error}));});
