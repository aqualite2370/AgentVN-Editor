"use strict";
// Actual installation, prior UI-authored isolated cartridges, redirected profile.
// The generic player receives an explicit sealed-install validator, never its Dev default.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawnSync}=require("node:child_process");
const JSZip=require("../editor/node_modules/jszip");
const {NarrativePlayer}=require("./lib/dev-narrative-player.cjs");
const {rows,listeners,until}=require("./lib/current-native-editor-session.cjs");
const {settleRuntime}=require("./lib/installed-acceptance.cjs");
const root=path.resolve(__dirname,".."),attempt=process.argv[2];assert(/^\d{2}$/.test(attempt||""));
const out=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/junction-installed-1924-${attempt}`;
assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc=f=>({path:path.resolve(f),sha256:sha(f),bytes:fs.statSync(f).size});
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const base="F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const installationFile=path.join(base,"installation.json"),installed=read(installationFile);
const packaged=read(path.join(base,"package-01/report.json"));
const exportFile="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json",exported=read(exportFile);
const executable=installed.resources.find(f=>path.basename(f.path)==="agentvn-player.exe");assert(executable);
const prep={scope:"INSTALLED_1_9_24_JUNCTION_LIBRARY_STORAGE_NOT_AUTHOR_EXPORT_STANDALONE_OR_ANDROID",
  sessionRoot:out,executable,installation:desc(installationFile),exported:desc(exportFile),
  cartridges:exported.cartridges,fixture:exported.fixture,webview:path.join(out,"webview"),temporary:path.join(out,"temporary")};
function validate(p){
  assert.equal(installed.status,"PASS");assert.equal(installed.metadataRestoration,"PASS");
  assert.equal(installed.executable.version,"1.9.24");assert.equal(packaged.status,"PASS");
  assert.equal(installed.package.sha256,packaged.installer.sha256);assert.equal(executable.sha256,packaged.player.sha256);
  assert.equal(path.resolve(executable.path),path.resolve(base,"installed-editor/agentvn-player.exe"));
  assert.equal(exported.status,"PASS");assert.equal(path.resolve(p.sessionRoot),path.resolve(out));
  for(const f of [installed.executable,...installed.resources,...installed.protectedFiles,
    packaged.installer,p.executable,p.installation,p.exported,...p.cartridges])assert.equal(sha(f.path),f.sha256,f.path);
  assert.equal(sha(p.fixture.input),p.fixture.inputSha256);
}
validate(prep);fs.mkdirSync(prep.temporary);
const report={status:"RUNNING",startedAt:new Date().toISOString(),scope:prep.scope,prep,
  modelRequests:0,cells:[],nativeCases:[],launches:[],screenshots:[],pageErrors:[],knownProcesses:[],commands:[],
  tools:[__filename,"scripts/lib/dev-narrative-player.cjs","scripts/native-dev-preview-profile.ps1"].map(desc),
  boundaries:["Actual installed Player library; explicitly supplied sealed-install preparation validator",
    "Historical real UI-authored isolated cartridges, not a fresh 1.9.24 authoring/export claim",
    "Native WebView simulated 1080p/1440p/4K, not physical 4K; no audio listening claim",
    "Public native writer calls are separate from UI save/confirmed exit/restart assertions"]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const player=new NarrativePlayer(prep,report,save,validate);let prepared=false,physicalProfile;
function profile(action){
  const args=["-NoProfile","-ExecutionPolicy","Bypass","-File",path.join(root,"scripts/native-dev-preview-profile.ps1"),
    "-Action",action,"-RunDirectory",out,"-CodexCacheView"];
  const r=spawnSync("powershell.exe",args,{cwd:root,windowsHide:true,encoding:"utf8",timeout:45000});
  fs.writeFileSync(path.join(out,`profile-${action}.log`),r.stdout+r.stderr,{flag:"wx"});
  report.commands.push({exe:"powershell.exe",args,exitCode:r.status});save();assert.equal(r.status,0,r.stdout+r.stderr);
}
function files(id){
  const dir=path.join(physicalProfile,"saves",id);
  return fs.existsSync(dir)?fs.readdirSync(dir).sort().map(name=>{
    const file=path.join(dir,name);assert(!fs.lstatSync(file).isSymbolicLink());
    return {...desc(file),data:read(file)};
  }):[];
}
async function hit(locator){
  await locator.waitFor({state:"visible"});
  const geometry=await locator.evaluate(e=>{
    const r=e.getBoundingClientRect();
    return {rect:r.toJSON(),width:innerWidth,height:innerHeight,enabled:!e.disabled,
      hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
      overflow:document.documentElement.scrollWidth-innerWidth};
  });
  const g=geometry,r=g.rect;assert(r.width>0&&r.height>0&&r.x>=-1&&r.y>=-1&&r.right<=g.width+1
    &&r.bottom<=g.height+1&&g.hit&&g.enabled&&g.overflow<=1,JSON.stringify(g));
  await locator.click();return geometry;
}
async function position(){
  await player.page.waitForFunction(()=>document.querySelector(".dialog-box")?.dataset.dialogPageDone==="true");
  return player.page.getByTestId("game-state-playing").evaluate(e=>({
    scene:e.dataset.currentSceneId,command:Number(e.dataset.currentCommandIndex),text:document.querySelector(".dialog-text")?.textContent}));
}
async function menu(){await player.page.keyboard.press("Escape");await player.ready("main_menu");}
async function manual(){
  await menu();await hit(player.page.getByTestId("open-save-load"));await player.ready("save_load");
  await hit(player.page.getByRole("tab",{name:"手动",exact:true}));await settleRuntime(player.page);
  await hit(player.page.getByRole("button",{name:"保存",exact:true}));
}
(async()=>{
  save();assert(!rows().some(p=>/^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  prepared=true;profile("Prepare");
  const journal=read(path.join(out,"profile-protection.json"));report.profileJournal=desc(path.join(out,"profile-protection.json"));
  physicalProfile=journal.records.find(p=>p.original.includes("\\Roaming\\")).target;report.physicalProfile=physicalProfile;
  assert.equal(path.resolve(fs.realpathSync.native("C:/Users/1/AppData/Roaming/com.agentvn.player")),path.resolve(physicalProfile));
  const matrix=[1,2].flatMap(dpr=>[false,true].flatMap(reduced=>
    [[1920,1080],[2560,1440],[3840,2160]].map(([width,height])=>({width,height,dpr,reduced}))));
  for(const layout of ["agentvn","renpy"]){
    const installId=`qa_junction_installed_1924_${attempt}_${layout}`;
    const cartridge=prep.cartridges.find(c=>c.layout===layout),zip=await JSZip.loadAsync(fs.readFileSync(cartridge.path));
    const script=JSON.parse(await zip.file("script.json").async("string"));
    const entry=script.scenes.find(s=>s.scene_id===script.entry_scene_id);
    const firstDialog=entry.commands.findIndex(c=>c.type==="dialog"||c.type==="narration");assert(firstDialog>=0);
    await player.start({layout,installId,cell:layout,viewport:matrix[0]});
    const nativeId=installId+"_api";
    for(const kind of ["manual","auto","quick"]){
      const row={layout,kind,installId:nativeId,status:"RUNNING",writes:[]};report.nativeCases.push(row);save();
      for(const suffix of ["first","replacement"]){
        const value={save_id:`${layout}-${kind}-${suffix}`,game_id:"junction-native-regression",save_kind:kind,slot:1,
          scene_id:"fixture",command_index:0};
        await player.native("write_save",{installId:nativeId,kind,slot:1,save:value});
        const actual=await player.native("read_save",{installId:nativeId,kind,slot:1});assert.deepEqual(actual,value);
        row.writes.push({value,actual,files:files(nativeId)});save();
      }row.status="PASS";save();
    }
    assert.equal(files(nativeId).length,3);
    await hit(player.page.getByTestId("open-settings"));await player.ready("settings");
    await hit(player.page.locator(".settings-tabs").getByRole("button",{name:"系统",exact:true}));
    await player.page.getByRole("checkbox",{name:"自动存档",exact:true}).setChecked(true);
    await hit(player.page.locator(".settings-tabs").getByRole("button",{name:"文字",exact:true}));
    await player.page.getByRole("slider",{name:"Text speed",exact:true}).focus();await player.page.keyboard.press("Home");
    await hit(player.page.getByTestId("settings-finish"));await player.ready("title_menu");
    await hit(player.page.getByTestId("start-new-game"));await player.ready("playing");
    const original=await position();
    assert.equal(original.scene,script.entry_scene_id);assert.equal(original.command,firstDialog);
    assert.equal(original.text,entry.commands[firstDialog].text);
    for(const viewport of matrix){
      const cell={layout,...viewport,status:"RUNNING"};report.cells.push(cell);save();await player.metrics(viewport);
      await manual();const before=(await player.saves()).find(s=>s.save_kind==="manual"&&s.slot===1);
      cell.hit=await hit(player.page.getByTestId("save-slot-manual-1").locator("button").first());
      await until(async()=>{
        const s=(await player.saves()).find(s=>s.save_kind==="manual"&&s.slot===1);
        return s&&(!before||s.save_id!==before.save_id||s.created_at!==before.created_at)
          &&s.scene_id===original.scene&&s.command_index===original.command;
      },"installed actual manual snapshot");
      assert.equal(await player.page.locator(".save-operation-error").count(),0);
      cell.disk=files(installId);assert(!cell.disk.some(f=>f.path.endsWith(".tmp")));
      cell.screenshot=await player.shot(`${viewport.width}-${viewport.dpr}-${viewport.reduced}`);
      await player.page.keyboard.press("Escape");await player.ready("main_menu");
      await hit(player.page.getByTestId("continue-game"));await player.ready("playing");
      assert.deepEqual(await position(),original);cell.status="PASS";save();
      console.log(`PASS ${layout} ${viewport.width} DPR${viewport.dpr} reduced=${viewport.reduced}`);
    }
    if(layout==="renpy"){
      const before=(await player.saves()).filter(s=>s.save_kind==="quick").length;
      await hit(player.page.getByTestId("renpy-quick-save"));
      await until(async()=>(await player.saves()).filter(s=>s.save_kind==="quick").length===before+1,"installed real quick snapshot");
    }
    const saved=(await player.saves()).find(s=>s.save_kind==="manual"&&s.slot===1);assert(saved);
    await menu();await hit(player.page.getByTestId("open-settings"));await player.ready("settings");
    await hit(player.page.getByTestId("open-exit-confirmation"));
    await player.page.getByRole("dialog",{name:"退出游戏？",exact:true}).waitFor();
    const child=player.child;
    try{await player.page.getByTestId("confirm-exit-game").click();}
    catch(error){if(child.exitCode===null||!/closed/i.test(String(error)))throw error;}
    await until(()=>child.exitCode!==null||child.signalCode!==null,"installed confirmed save then native exit",15000);
    assert.equal(child.exitCode,0);assert.equal(child.signalCode,null);
    const automatic=files(installId).filter(f=>f.data.save_kind==="auto");
    assert(automatic.some(f=>f.data.scene_id===original.scene&&f.data.command_index===original.command));
    report.launches.at(-1).automatic=automatic;
    report.launches.at(-1).confirmedExit={code:child.exitCode,forceStopBeforeExit:false};save();
    await player.stop();assert.equal(report.launches.at(-1).cleanup.method,"PROCESS_ALREADY_EXITED_BEFORE_CLEANUP");
    await player.start({layout,installId,cell:`${layout}-restart`,viewport:matrix[0],restart:true});
    await hit(player.page.getByTestId("open-save-load"));await player.ready("save_load");
    await hit(player.page.getByRole("tab",{name:"手动",exact:true}));await settleRuntime(player.page);
    await hit(player.page.getByRole("button",{name:"读取",exact:true}));
    await hit(player.page.getByTestId("save-slot-manual-1").locator("button").first());await player.ready("playing");
    assert.deepEqual(await position(),original);
    report.launches.at(-1).restored={expected:original,actual:await position(),saved};await player.stop();
  }
  assert.equal(report.cells.length,24);assert.equal(report.nativeCases.length,6);assert.equal(report.screenshots.length,24);
  assert(report.nativeCases.every(c=>c.status==="PASS"&&c.writes.length===2));
  assert(report.cells.every(c=>c.status==="PASS"));assert.deepEqual(report.pageErrors,[]);assert(!report.observerError);
  validate(prep);report.status="PASS";
})().catch(async error=>{
  report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;
  if(player.page){report.failureText=await player.page.locator("body").innerText().catch(()=>null);await player.shot("failure").catch(()=>{});}
}).finally(async()=>{
  try{await player.stop();}
  catch(error){report.status="FAILED";report.cleanupError=String(error.stack||error);process.exitCode=1;}
  if(prepared&&fs.existsSync(path.join(out,"profile-protection.json")))try{
      profile("Restore");report.restoration=desc(path.join(out,"profile-restoration.json"));
      assert.equal(read(report.restoration.path).status,"PASS");
  }catch(error){report.status="FAILED";report.cleanupError=[report.cleanupError,String(error.stack||error)].filter(Boolean).join("\n");process.exitCode=1;}
  try{
    validate(prep);for(const f of report.tools)assert.equal(sha(f.path),f.sha256);
    const current=rows();
    report.cleanup={survivors:report.knownProcesses.filter(p=>current.some(n=>n.ProcessId===p.ProcessId&&n.Created===p.Created)),
      listeners:listeners(report.launches.map(l=>l.port))};
    assert.equal(report.cleanup.survivors.length,0);assert.equal(report.cleanup.listeners.length,0);
  }catch(error){report.status="FAILED";report.cleanupError=String(error.stack||error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,out,cells:report.cells.length,error:report.error,cleanupError:report.cleanupError}));
});
