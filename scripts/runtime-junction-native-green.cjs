"use strict";
// Real built Player and real UI consumption under the formerly failing profile.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const JSZip=require("../editor/node_modules/jszip");
const {NarrativePlayer}=require("./lib/dev-narrative-player.cjs");
const {rows,listeners,until}=require("./lib/current-native-editor-session.cjs");
const {settleRuntime}=require("./lib/installed-acceptance.cjs");
const root=path.resolve(__dirname,".."),attempt=process.argv[2]||"01";assert.match(attempt,/^\d{2}$/);
const out=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/junction-green-${attempt}`;
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc=p=>({path:path.resolve(p),sha256:sha(p),bytes:fs.statSync(p).size});
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const buildPath="F:/AgentVN/QA/Runtime-Junction-20261024-01/build-01/report.json";
const exportPath="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json";
const build=read(buildPath),exported=read(exportPath);
const prep={scope:"CURRENT_DEV_JUNCTION_STORAGE_NOT_RELEASE_OR_ANDROID",sessionRoot:out,
 executable:build.player,build:desc(buildPath),exported:desc(exportPath),cartridges:exported.cartridges,
 fixture:exported.fixture,webview:path.join(out,"webview"),temporary:path.join(out,"temporary")};
function validate(p){
 assert.equal(build.status,"PASS");assert.equal(build.commands.length,4);assert(build.commands.every(c=>c.status==="PASS"));
 assert.equal(exported.status,"PASS");assert.equal(path.resolve(p.sessionRoot),path.resolve(out));
 for(const f of [p.executable,p.build,p.exported,...p.cartridges,...build.sources])assert.equal(sha(f.path),f.sha256);
 assert.equal(sha(p.fixture.input),p.fixture.inputSha256);
 assert.equal(path.resolve(p.executable.path),path.resolve(root,"editor/src-tauri/binaries/agentvn-player.exe"));
}
validate(prep);fs.mkdirSync(prep.temporary);
const r={status:"RUNNING",startedAt:new Date().toISOString(),scope:prep.scope,prep,
 modelRequests:0,cells:[],nativeCases:[],launches:[],screenshots:[],pageErrors:[],knownProcesses:[],commands:[],
 tools:[__filename,"scripts/lib/dev-narrative-player.cjs","scripts/native-dev-preview-profile.ps1"].map(desc),
 limitations:["Native WebView simulated viewports, not physical 4K display",
  "Historical real UI-exported isolated cartridges; public native import preparation, not fresh Editor export",
  "Current built Player library; not a new installation, standalone/setup, Android or final user project",
  "Attributed process cleanup is not normal-close acceptance"]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(r,null,2));
const p=new NarrativePlayer(prep,r,save,validate);let prepared=false,physicalProfile;
function profile(action){
 const args=["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"scripts/native-dev-preview-profile.ps1"),
  "-Action",action,"-RunDirectory",out,"-CodexCacheView"];
 const result=spawnSync("powershell.exe",args,{cwd:root,windowsHide:true,encoding:"utf8",timeout:30000});
 fs.writeFileSync(path.join(out,`profile-${action}.log`),(result.stdout||"")+"\n"+(result.stderr||""),{flag:"wx"});
 r.commands.push({exe:"powershell.exe",args,exitCode:result.status});save();assert.equal(result.status,0);
}
const disk=id=>path.join(physicalProfile,"saves",id);
function files(id){return fs.existsSync(disk(id))?fs.readdirSync(disk(id)).sort().map(n=>({
 ...desc(path.join(disk(id),n)),data:read(path.join(disk(id),n))})):[];}
async function hit(locator){
 await locator.waitFor({state:"visible"});
 const rect=await locator.evaluate(e=>{
  const q=e.getBoundingClientRect(),cx=q.x+q.width/2,cy=q.y+q.height/2;
  return {x:q.x,y:q.y,width:q.width,height:q.height,viewport:[innerWidth,innerHeight],
   enabled:!e.disabled,hit:e.contains(document.elementFromPoint(cx,cy)),overflow:document.documentElement.scrollWidth>innerWidth+1};
 });
 assert(rect.width>0&&rect.height>0&&rect.x>=-1&&rect.y>=-1&&rect.x+rect.width<=rect.viewport[0]+1
  &&rect.y+rect.height<=rect.viewport[1]+1&&rect.hit&&rect.enabled&&!rect.overflow,JSON.stringify(rect));
 await locator.click();return rect;
}
async function position(){
 await p.page.waitForFunction(()=>document.querySelector(".dialog-box")?.dataset.dialogPageDone==="true");
 return p.page.locator('[data-testid="game-state-playing"]').evaluate(e=>({
  scene:e.dataset.currentSceneId,command:Number(e.dataset.currentCommandIndex),text:document.querySelector(".dialog-text")?.textContent}));
}
async function menu(){
 await p.page.keyboard.press("Escape");await p.ready("main_menu");
}
async function manual(){
 await menu();await hit(p.page.getByTestId("open-save-load"));await p.ready("save_load");
 await hit(p.page.getByRole("tab",{name:"手动",exact:true}));await settleRuntime(p.page);
 await hit(p.page.getByRole("button",{name:"保存",exact:true}));
}
(async()=>{
 save();assert(!rows().some(q=>/^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(q.Name)));
 prepared=true;profile("Prepare");
 const journal=read(path.join(out,"profile-protection.json"));r.profileJournal=desc(path.join(out,"profile-protection.json"));
 physicalProfile=journal.records.find(q=>q.original.includes("\\Roaming\\")).target;
 r.physicalProfile=physicalProfile;
 assert.equal(path.resolve(fs.realpathSync.native("C:/Users/1/AppData/Roaming/com.agentvn.player")),path.resolve(physicalProfile));
 const matrix=[];
 for(const dpr of [1,2])for(const reduced of [false,true])for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])
  matrix.push({width,height,dpr,reduced});
 for(const layout of ["agentvn","renpy"]){
  const installId=`qa_junction_green_${attempt}_${layout}`;
  const cartridge=prep.cartridges.find(c=>c.layout===layout);
  const zip=await JSZip.loadAsync(fs.readFileSync(cartridge.path));
  const script=JSON.parse(await zip.file("script.json").async("string"));
  const entry=script.scenes.find(s=>s.scene_id===script.entry_scene_id);
  const firstDialog=entry.commands.findIndex(c=>c.type==="dialog"||c.type==="narration");
  assert(firstDialog>=0);
  await p.start({layout,installId,cell:layout,viewport:matrix[0]});
  const nativeId=installId+"_api";
  for(const kind of ["manual","auto","quick"]){
   const row={layout,kind,installId:nativeId,status:"RUNNING",writes:[]};r.nativeCases.push(row);save();
   for(const suffix of ["first","replacement"]){
    const value={save_id:`${layout}-${kind}-${suffix}`,game_id:"junction-native-regression",save_kind:kind,slot:1,
     scene_id:"fixture",command_index:0};
    await p.native("write_save",{installId:nativeId,kind,slot:1,save:value});
    const actual=await p.native("read_save",{installId:nativeId,kind,slot:1});assert.deepEqual(actual,value);
    row.writes.push({value,actual,files:files(nativeId)});save();
   }
   row.status="PASS";save();
  }
  assert.equal(files(nativeId).length,3);
  await hit(p.page.getByTestId("open-settings"));await p.ready("settings");
  await hit(p.page.locator(".settings-tabs").getByRole("button",{name:"系统",exact:true}));
  await p.page.getByRole("checkbox",{name:"自动存档",exact:true}).setChecked(true);
  await hit(p.page.locator(".settings-tabs").getByRole("button",{name:"文字",exact:true}));
  await p.page.getByRole("slider",{name:"Text speed",exact:true}).focus();await p.page.keyboard.press("Home");
  await hit(p.page.getByTestId("settings-finish"));await p.ready("title_menu");
  await hit(p.page.getByTestId("start-new-game"));await p.ready("playing");
  const original=await position();
  assert.equal(original.scene,script.entry_scene_id);assert.equal(original.command,firstDialog);
  assert.equal(original.text,entry.commands[firstDialog].text);
  for(const viewport of matrix){
   const cell={layout,...viewport,status:"RUNNING"};r.cells.push(cell);save();await p.metrics(viewport);
   await manual();
   const before=(await p.saves()).find(s=>s.save_kind==="manual"&&s.slot===1);
   cell.hit=await hit(p.page.getByTestId("save-slot-manual-1").locator("button").first());
   await until(async()=>{
    const s=(await p.saves()).find(s=>s.save_kind==="manual"&&s.slot===1);
    return s&&(!before||s.save_id!==before.save_id||s.created_at!==before.created_at)&&s.scene_id===original.scene&&s.command_index===original.command;
   },"actual manual snapshot committed");
   assert.equal(await p.page.locator(".save-operation-error").count(),0);
   cell.disk=files(installId);assert(!cell.disk.some(f=>f.path.endsWith(".tmp")));
   cell.screenshot=await p.shot(`${viewport.width}x${viewport.height}-dpr${viewport.dpr}-${viewport.reduced?"reduced":"normal"}`);
   await p.page.keyboard.press("Escape");await p.ready("main_menu");
   await hit(p.page.getByTestId("continue-game"));await p.ready("playing");
   assert.deepEqual(await position(),original);
   cell.status="PASS";save();
  }
  if(layout==="renpy"){
   const before=(await p.saves()).filter(s=>s.save_kind==="quick").length;
   await hit(p.page.getByTestId("renpy-quick-save"));
   await until(async()=>(await p.saves()).filter(s=>s.save_kind==="quick").length===before+1,"real quick snapshot");
  }
  const saved=(await p.saves()).find(s=>s.save_kind==="manual"&&s.slot===1);assert(saved);
  // The product checkpoints auto-save; merely opening the first line does not
  // promise a new snapshot. Use the actual confirmed-exit flush as the trigger.
  await menu();await hit(p.page.getByTestId("open-settings"));await p.ready("settings");
  await hit(p.page.getByTestId("open-exit-confirmation"));
  await p.page.getByRole("dialog",{name:"退出游戏？",exact:true}).waitFor();
  const child=p.child;
  try{await p.page.getByTestId("confirm-exit-game").click();}
  catch(e){if(child.exitCode===null||!/closed/i.test(String(e)))throw e;}
  await until(()=>child.exitCode!==null||child.signalCode!==null,"confirmed native save then exit",15000);
  assert.equal(child.exitCode,0);assert.equal(child.signalCode,null);
  const automatic=files(installId).filter(f=>f.data.save_kind==="auto");
  assert(automatic.some(f=>f.data.scene_id===original.scene&&f.data.command_index===original.command));
  r.launches.at(-1).automatic=automatic;r.launches.at(-1).confirmedExit={code:child.exitCode,forceStopBeforeExit:false};save();
  await p.stop();
  assert.equal(r.launches.at(-1).cleanup.method,"PROCESS_ALREADY_EXITED_BEFORE_CLEANUP");
  // Start a fresh native process; reload via the visible save slot, not restore APIs.
  await p.start({layout,installId,cell:`${layout}-restart`,viewport:matrix[0],restart:true});
  await hit(p.page.getByTestId("open-save-load"));await p.ready("save_load");
  await hit(p.page.getByRole("tab",{name:"手动",exact:true}));await settleRuntime(p.page);
  await hit(p.page.getByRole("button",{name:"读取",exact:true}));
  await hit(p.page.getByTestId("save-slot-manual-1").locator("button").first());await p.ready("playing");
  assert.deepEqual(await position(),original);r.launches.at(-1).restored={expected:original,actual:await position(),saved};
  await p.stop();
 }
 assert.equal(r.nativeCases.length,6);assert.equal(r.cells.length,24);assert.equal(r.screenshots.length,24);
 assert(r.nativeCases.every(c=>c.status==="PASS"&&c.writes.length===2));assert(r.cells.every(c=>c.status==="PASS"));
 assert.equal(r.pageErrors.length,0);assert(!r.observerError);r.status="PASS";
})().catch(async e=>{
 r.status="FAILED";r.error=String(e.stack||e);process.exitCode=1;
 if(p.page){r.failureText=await p.page.locator("body").innerText().catch(()=>null);await p.shot("failure").catch(()=>{});}
}).finally(async()=>{
 try{await p.stop();}catch(e){r.status="FAILED";r.cleanupError=String(e.stack||e);process.exitCode=1;}
 if(prepared&&fs.existsSync(path.join(out,"profile-protection.json")))try{
  profile("Restore");r.restoration=desc(path.join(out,"profile-restoration.json"));assert.equal(read(r.restoration.path).status,"PASS");
 }catch(e){r.status="FAILED";r.cleanupError=String(e.stack||e);process.exitCode=1;}
 for(const f of [prep.executable,...r.tools])assert.equal(sha(f.path),f.sha256);
 r.cleanup={survivors:r.knownProcesses.filter(q=>rows().some(a=>a.ProcessId===q.ProcessId&&a.Created===q.Created)),
  listeners:listeners(r.launches.map(q=>q.port))};assert.equal(r.cleanup.survivors.length,0);assert.equal(r.cleanup.listeners.length,0);
 r.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({
  status:r.status,out,cells:r.cells.length,nativeCases:r.nativeCases.length,error:r.error,cleanupError:r.cleanupError}));
});
