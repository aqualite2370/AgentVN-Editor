"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawnSync}=require("node:child_process");
const JSZip=require("../editor/node_modules/jszip"),{buildSync}=require("../editor/node_modules/esbuild");
const {saveGridBuildEvidence,saveGridNativeSession}=require("./lib/save-grid-native-session.cjs");
const {readInstalledViewport}=require("./lib/current-native-capture.cjs");
const root=path.resolve(__dirname,".."),attempt=process.argv[2];assert(/^\d{2}$/.test(attempt||""));
const out=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/save-grid-native02-${attempt}`;
const buildFile="F:/AgentVN/QA/Runtime-Save-Grid-Fit-20261024-01/build-02/report.json";
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc=file=>({path:path.resolve(file),sha256:sha(file)});
const evidence=saveGridBuildEvidence(buildFile,out);
const report={status:"RUNNING",startedAt:new Date().toISOString(),modelRequests:0,
  scope:"CURRENT_DEV_NATIVE_PLAYER_PREVIEW_NOT_INSTALLATION_AUTHOR_EXPORT_STANDALONE_OR_ANDROID",
  boundaries:["Synthetic complete cartridges loaded through public preview messages",
    "Saves created only by actual UI; no store injection or source server",
    "WebView viewport simulation, not physical 4K; exact process teardown, not normal close"],
  build:evidence.receipt,player:evidence.player,cases:[],screenshots:[],launches:[],fixtures:[],writes:[],profiles:[],
  tools:[__filename,"scripts/lib/save-grid-native-session.cjs","scripts/lib/current-native-capture.cjs",
    "scripts/native-dev-preview-profile.ps1"].map(desc)};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let session,profileRun,profileRecord;
function profile(action){
  const r=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(root,"scripts/native-dev-preview-profile.ps1"),"-Action",action,"-RunDirectory",profileRun,"-CodexCacheView"],
    {encoding:"utf8",windowsHide:true,timeout:45000});
  fs.writeFileSync(path.join(profileRun,`profile-${action}.log`),r.stdout+r.stderr,{flag:"wx"});
  assert.equal(r.status,0,r.stdout+r.stderr);
}
const compiled={exports:{}};
new Function("module","exports",buildSync({stdin:{resolveDir:root,loader:"ts",contents:
  'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";'},
  bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text)(compiled,compiled.exports);
async function fixture(layout){
  const now=new Date().toISOString(),id=`qa-native-grid-${layout}`;
  const manifest={manifest_version:"1.0.0",cartridge_version:"1.0.0",runtime_version:"0.25.0",
    game_id:id,title:"六槽完整显示隔离小工程",author:"QA",version:"0.1.0",language:"zh-CN",
    entry_script:"script.json",entry_scene_id:"main",created_at:now,updated_at:now,assets:[],
    ui_skin:{path:"ui/layout.json",version:"1.0.0",name:"QA"}};
  const script={schema_version:"1.10.0",game_id:id,title:manifest.title,entry_scene_id:"main",
    characters:[],scenes:[{scene_id:"main",title:"六槽标题与时间完整显示",chapter:1,tags:[],
      commands:Array.from({length:20},(_,i)=>({type:"narration",text:`第${i+1}句，临时工程原生存档验收。`}))}]};
  const files=new Map([["manifest.json",Buffer.from(JSON.stringify(manifest))],
    ["script.json",Buffer.from(JSON.stringify(script))],
    ["ui/layout.json",Buffer.from(JSON.stringify(layout==="renpy"?compiled.exports.createRenpyUILayout():compiled.exports.getDefaultUISkinLayout()))]]);
  const zip=new JSZip();for(const [name,bytes]of files)zip.file(name,bytes);
  zip.file("checksum.json",JSON.stringify({checksum_version:"1.0.0",algorithm:"sha256",generated_at:now,
    files:[...files].map(([name,bytes])=>({path:name,size_bytes:bytes.length,hash_sha256:createHash("sha256").update(bytes).digest("hex")}))}));
  const file=path.join(out,`${layout}.vncart`);
  fs.writeFileSync(file,await zip.generateAsync({type:"nodebuffer"}),{flag:"wx"});
  report.fixtures.push(desc(file));save();return file;
}
async function idle(page,target){
  await page.waitForFunction(target=>{const n=document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-screen-transition")==="idle"&&n.getAttribute("data-runtime-presented-screen")===target
      &&!document.querySelector(".game-launch-blackout");},target);
}
async function geometry(layout,params,state){
  const page=session.page,row={layout,...params,state,status:"RUNNING"};report.cases.push(row);save();
  try{
    row.before=await session.setViewport(params);
    // Let resize observers consume the new simulated viewport, without a
    // fixed delay or changing the production transition clocks.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForFunction(()=>[...document.querySelectorAll(".save-preview-frame img")].every(i=>i.complete&&i.naturalWidth>0));
    row.geometry=await page.getByTestId("save-slot-grid").evaluate(grid=>{
      const rect=n=>n.getBoundingClientRect().toJSON();
      const hit=n=>{const r=rect(n);return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));};
      return {grid:rect(grid),clientHeight:grid.clientHeight,scrollHeight:grid.scrollHeight,overflow:document.documentElement.scrollWidth-innerWidth,
        cards:[...grid.querySelectorAll(".save-slot")].map(card=>{
          const image=card.querySelector(".save-preview-frame img");
          return {rect:rect(card),button:rect(card.querySelector(".save-card-main")),copy:rect(card.querySelector(".save-card-copy")),
            text:[...card.querySelectorAll(".save-card-copy strong,.save-card-copy>span,.save-card-copy small")].map(rect),
            populated:card.classList.contains("has-save"),hit:hit(card.querySelector(".save-card-main")),
            preview:rect(card.querySelector(".save-preview-frame")),image:image?{rect:rect(image),fit:getComputedStyle(image).objectFit,
              complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight}:null};
        })};
    });
    report.screenshots.push(await session.shot(path.join(out,`${layout}-${state}-${params.width}-${params.dpr}-${params.reduced}.png`)));
    save();const g=row.geometry;
    assert.equal(g.cards.length,6);assert(g.scrollHeight<=g.clientHeight+1);assert.equal(g.overflow,0);
    const inside=(a,b)=>a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
    assert(g.cards.every(c=>c.hit&&c.preview.height>0&&c.populated===(state==="populated")
      &&[c.rect,c.button,c.copy,...c.text].every(r=>inside(r,g.grid))
      &&[c.preview,c.copy,...c.text].every(r=>inside(r,c.rect))));
    if(state==="populated")assert(g.cards.every(c=>c.image?.complete&&c.image.naturalWidth>0
      &&c.image.fit==="contain"&&inside(c.image.rect,c.preview)),"Native saved previews must fit fully");
    row.after=await readInstalledViewport(page,params);assert.deepEqual(row.after,row.before);row.status="PASS";
  }catch(error){row.status="FAILED";row.error=String(error.stack||error);throw error;}
  finally{save();console.log(`${row.status} ${layout} ${state} ${params.width} DPR${params.dpr} reduced=${params.reduced}`);}
}
function savedFiles(){
  const protection=JSON.parse(fs.readFileSync(path.join(profileRun,"profile-protection.json"),"utf8").replace(/^\uFEFF/,""));
  const files=[];
  for(const record of protection.records){
    const target=path.join(record.target,"saves");if(!fs.existsSync(target))continue;
    const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const file=path.join(dir,entry.name);assert(!fs.lstatSync(file).isSymbolicLink());
      if(entry.isDirectory())visit(file);
      else if(entry.name.endsWith(".json"))files.push({...desc(file),save:JSON.parse(fs.readFileSync(file,"utf8"))});
    }};visit(target);
  }
  return files;
}
(async()=>{
  save();
  const matrix=[1,2].flatMap(dpr=>[false,true].flatMap(reduced=>
    [[1920,1080],[2560,1440],[3840,2160]].map(([width,height])=>({width,height,dpr,reduced}))));
  for(const layout of ["agentvn","renpy"]){
    profileRun=`${out}-profile-${layout}`;assert(!fs.existsSync(profileRun));fs.mkdirSync(profileRun);
    profileRecord={layout,path:profileRun,status:"PREPARING"};report.profiles.push(profileRecord);save();
    profile("Prepare");profileRecord.protection=desc(path.join(profileRun,"profile-protection.json"));
    profileRecord.status="PREPARED";save();
    const input=await fixture(layout),errors=[];
    session=await saveGridNativeSession({file:buildFile,out,input,layout,report,save});
    const page=session.page;page.setDefaultTimeout(20000);page.on("pageerror",e=>errors.push(String(e)));
    try{
      await session.setViewport(matrix[0]);await page.locator(".boot-card .project-entry-loader").waitFor();
      await page.evaluate(cartridgeBase64=>window.postMessage({type:"agentvn.runtime.preview",cartridgeBase64,
        fileName:"grid.vncart",previewNonce:"grid-native02"},"*"),fs.readFileSync(input).toString("base64"));
      await page.getByTestId("game-state-title").waitFor();await idle(page,"title_menu");
      await page.getByTestId("open-save-load").click();await idle(page,"save_load");
      for(const params of matrix)await geometry(layout,params,"empty");
      await page.getByTestId(layout==="renpy"?"renpy-menu-return":"back-to-player").click();await idle(page,"title_menu");
      await page.getByTestId("start-new-game").click();await idle(page,"playing");
      await page.keyboard.press("Escape");await idle(page,"main_menu");
      await page.getByTestId("open-save-load").click();await idle(page,"save_load");
      await page.locator(".save-mode-switch").getByRole("button",{name:"保存",exact:true}).click();
      for(let slot=1;slot<=6;slot++){
        await page.getByTestId(`save-slot-manual-${slot}`).getByRole("button",{name:`保存到手动存档 ${slot}`,exact:true}).click();
        await page.waitForFunction(slot=>document.querySelector(`[data-testid="save-slot-manual-${slot}"]`)?.classList.contains("has-save"),slot);
      }
      const files=savedFiles().filter(f=>f.save.save_kind==="manual"
        &&f.save.game_id===`qa-native-grid-${layout}`&&f.save.install_id==="preview_gamecli");
      assert.equal(files.length,6,"Six actual native JSON saves required");
      assert.deepEqual(files.map(f=>f.save.slot).sort((a,b)=>a-b),[1,2,3,4,5,6]);
      assert(files.every(f=>typeof f.save.preview_image==="string"&&f.save.preview_image.startsWith("data:image/")));
      report.writes.push({layout,files:files.map(f=>({path:f.path,sha256:f.sha256,slot:f.save.slot,
        gameId:f.save.game_id,previewBytes:f.save.preview_image.length}))});save();
      for(const params of matrix)await geometry(layout,params,"populated");
      assert.deepEqual(errors,[]);
    }finally{
      await session.close();session=undefined;profile("Restore");
      profileRecord.restoration=desc(path.join(profileRun,"profile-restoration.json"));
      profileRecord.status="RESTORED";profileRun=undefined;save();
    }
  }
  assert.equal(report.cases.length,48);assert.equal(report.screenshots.length,48);
  assert(report.cases.every(c=>c.status==="PASS"));assert.equal(report.writes.length,2);
  saveGridBuildEvidence(buildFile,out);report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(async()=>{
  try{await session?.close();if(profileRun&&fs.existsSync(path.join(profileRun,"profile-protection.json"))
    &&!fs.existsSync(path.join(profileRun,"profile-restoration.json"))){
    profile("Restore");profileRecord.restoration=desc(path.join(profileRun,"profile-restoration.json"));
    profileRecord.status="RESTORED";
  }}catch(error){report.status="FAILED";report.cleanupError=String(error.stack||error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,out,cases:report.cases.length,error:report.error}));
});
