"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawnSync}=require("node:child_process"),{gzipSync}=require("node:zlib");
const {candidateEvidence,candidateRuntimeSession}=require("./lib/candidate-1924-runtime-session.cjs");
const {readInstalledViewport}=require("./lib/current-native-capture.cjs");
const root=path.resolve(__dirname,".."),attempt=process.argv[2];assert(/^\d{2}$/.test(attempt||""));
const options=process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ?require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate():null;
const current=!!options||process.argv.includes("--candidate=1.9.30");
const version=options?.version||(current?"1.9.30":"1.9.24"),stamp=version.replaceAll(".","");
const authorArg=process.argv.slice(3).find(a=>a.startsWith("--authored-export="));
const validateOnly=process.argv.includes("--validate-only");
assert(!authorArg||options,"Author export requires an explicit installed-candidate binding");
assert.deepEqual(process.argv.slice(2),[...(current?[attempt,`--candidate=${version}`,...(authorArg?[authorArg]:[])]:[attempt]),
  ...(validateOnly?["--validate-only"]:[])]);
const out=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/candidate-${stamp}-save-${attempt}`;
const file=options?.installation||(current?"F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json":"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json");
assert(!fs.existsSync(out));
const sha=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc=f=>({path:path.resolve(f),sha256:sha(f)});
const authored=authorArg?JSON.parse(fs.readFileSync(authorArg.slice(18),"utf8")):null;
if(authored){
  assert.equal(path.dirname(path.dirname(path.resolve(authorArg.slice(18)))),
    path.resolve("F:/AgentVN/QA/Installed-Layout-20261021-01"));
  assert.match(path.basename(path.dirname(authorArg.slice(18))),/^editor-\d{2}$/);
  assert.equal(authored.status,"PASS");assert.equal(authored.version,version);
  assert.equal(authored.scope,"CURRENT_INSTALLED_TWO_COLUMN_RENPY_AUTHOR_UI_EXPORT_NOT_PLAYER_SETUP_UPGRADE_OR_ANDROID");
  assert(authored.finishedAt&&!authored.cleanupError&&authored.nativeCacheRestoration==="PASS");
  assert.equal(authored.steps.length,3);assert(authored.steps.every(s=>s.status==="PASS"));
  assert.equal(authored.matrix.length,12);assert(authored.matrix.every(c=>c.status==="PASS"&&c.preview.columns===2));
  assert.equal(authored.cartridges.length,2);assert.equal(authored.modelRequests,0);
  assert.equal(authored.authored.settings.runtimeUILayoutProfiles.profiles.renpy.renpy.save_load.saveColumns,2);
  for(const f of [authored.installation,authored.fixture,authored.portable,authored.tool,...authored.cartridges])
    assert.equal(sha(f.path),f.sha256);
  const declared=JSON.parse(fs.readFileSync(authored.installation.path,"utf8"));
  const candidate=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.deepEqual(declared.executable,candidate.executable);assert.deepEqual(declared.resources,candidate.resources);
}
if(validateOnly){
  const evidence=candidateEvidence(file,out);
  console.log(JSON.stringify({status:"PASS",candidateVersion:version,player:evidence.player,
    authoredExport:authorArg?desc(authorArg.slice(18)):null,productStarts:0,outputCreated:false}));
  return;
}
fs.mkdirSync(out);
const report={status:"RUNNING",startedAt:new Date().toISOString(),modelRequests:0,productChanges:0,builds:0,
  scope:authored?`INSTALLED_${version.replaceAll(".","_")}_AUTHOR_UI_TWO_COLUMN_RENPY_CONSUMPTION_NOT_SETUP_UPGRADE_OR_ANDROID`
    :`INSTALLED_${version.replaceAll(".","_")}_BUNDLED_PLAYER_PREVIEW_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID`,
  ...(authored?{authoredExport:desc(authorArg.slice(18))}:{}),
  boundaries:[authored?"Current installed Editor's real two-column UI export; saves through real UI only"
    :"Synthetic complete cartridges through public preview; saves through real UI only",
    "Real installed WebView simulated viewport; not physical 4K",
    "Owned process teardown is not normal window-close acceptance"],
  cases:[],screenshots:[],launches:[],profiles:[],writes:[],traces:[],fixtures:[],
  tools:[__filename,"scripts/lib/candidate-1924-runtime-session.cjs","scripts/lib/current-native-capture.cjs",
    "scripts/native-dev-preview-profile.ps1",
    ...(options?["scripts/lib/candidate-1924-quick-adapter.cjs","scripts/candidate-1930-exit.cjs"]:[])].map(desc)};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let session,profileRun,profileRecord;
function profile(action){
  const result=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(root,"scripts/native-dev-preview-profile.ps1"),"-Action",action,"-RunDirectory",profileRun,"-CodexCacheView"],
    {encoding:"utf8",windowsHide:true,timeout:45000});
  fs.writeFileSync(path.join(profileRun,`profile-${action}.log`),result.stdout+result.stderr,{flag:"wx"});
  assert.equal(result.status,0,result.stdout+result.stderr);
}
async function idle(page,target){
  await page.waitForFunction(target=>{
    const n=document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-screen-transition")==="idle"
      &&n.getAttribute("data-runtime-presented-screen")===target&&!document.querySelector(".game-launch-blackout");
  },target);
}
async function geometry(layout,params,state){
  const page=session.page,row={kind:"geometry",layout,...params,state,status:"RUNNING"};report.cases.push(row);save();
  try{
    row.before=await session.setViewport(params);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForFunction(()=>[...document.querySelectorAll(".save-preview-frame img")].every(i=>i.complete&&i.naturalWidth>0));
    row.geometry=await page.getByTestId("save-slot-grid").evaluate(grid=>{
      const rect=n=>n.getBoundingClientRect().toJSON();
      const hit=n=>{const r=rect(n);return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));};
      return {grid:rect(grid),clientHeight:grid.clientHeight,scrollHeight:grid.scrollHeight,
        columns:getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        overflow:document.documentElement.scrollWidth-innerWidth,
        cards:[...grid.querySelectorAll(".save-slot")].map(card=>{
          const img=card.querySelector(".save-preview-frame img");
          return {rect:rect(card),button:rect(card.querySelector(".save-card-main")),
            copy:rect(card.querySelector(".save-card-copy")),
            text:[...card.querySelectorAll(".save-card-copy strong,.save-card-copy>span,.save-card-copy small")].map(rect),
            populated:card.classList.contains("has-save"),hit:hit(card.querySelector(".save-card-main")),
            preview:rect(card.querySelector(".save-preview-frame")),
            image:img?{rect:rect(img),fit:getComputedStyle(img).objectFit,naturalWidth:img.naturalWidth}:null};
        })};
    });
    const g=row.geometry,inside=(a,b)=>a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
    assert.equal(g.cards.length,6);assert(g.scrollHeight<=g.clientHeight+1);assert.equal(g.overflow,0);
    if(authored&&layout==="renpy")assert.equal(g.columns,2,"The actual authored two columns must be consumed");
    assert(g.cards.every(c=>c.hit&&c.preview.height>0&&c.populated===(state==="populated")
      &&[c.rect,c.button,c.copy,...c.text].every(r=>inside(r,g.grid))
      &&[c.preview,c.copy,...c.text].every(r=>inside(r,c.rect))));
    if(state==="populated")assert(g.cards.every(c=>c.image?.naturalWidth>0&&c.image.fit==="contain"&&inside(c.image.rect,c.preview)));
    report.screenshots.push(await session.shot(path.join(out,`${layout}-${state}-${params.width}-${params.dpr}-${params.reduced}.png`)));
    row.after=await readInstalledViewport(page,params);assert.deepEqual(row.after,row.before);row.status="PASS";
  }catch(error){row.status="FAILED";row.error=String(error.stack||error);throw error;}
  finally{save();console.log(`${row.status} ${layout} ${state} ${params.width} DPR${params.dpr} reduced=${params.reduced}`);}
}
async function flipIdle(page){
  await page.waitForFunction(()=>{
    const layers=[...document.querySelectorAll("[data-save-page-layer]")];
    return layers.length===1&&!layers[0].getAnimations().some(a=>a.playState==="running");
  });
}
async function transition(layout,params,label,action,leave=false){
  const page=session.page,row={layout,...params,label,status:"RUNNING"};report.traces.push(row);save();
  await page.evaluate(()=>{
    window.__candidateSaveFrames=[];window.__candidateSaveRecording=true;
    const rect=n=>n?.getBoundingClientRect().toJSON();
    const tick=()=>{
      if(!window.__candidateSaveRecording)return;
      const focus=document.activeElement;
      window.__candidateSaveFrames.push({at:performance.now(),
        layers:[...document.querySelectorAll("[data-save-page-layer]")].map(n=>({
          page:n.getAttribute("data-save-page-layer"),inert:n.inert,opacity:Number(getComputedStyle(n).opacity),
          transform:getComputedStyle(n).transform,animations:n.getAnimations().map(a=>({
            duration:a.effect.getTiming().duration,time:a.currentTime}))})),
        viewport:rect(document.querySelector(".save-page-viewport")),screen:rect(document.querySelector(".save-load-screen")),
        navigation:rect(document.querySelector(".save-page-navigation")),
        toolbar:rect(document.querySelector(".save-load-toolbar")),
        back:rect(document.querySelector('[data-testid="renpy-menu-return"],[data-testid="back-to-player"]')),
        grids:document.querySelectorAll('[data-testid="save-slot-grid"]').length,
        unavailableFocus:!!focus?.closest("[inert],[aria-hidden='true']"),
        overflow:document.documentElement.scrollWidth-innerWidth});
      requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  });
  let actionError;
  try{
    await action();if(leave)await idle(page,"main_menu");else await flipIdle(page);
  }catch(error){actionError=error;}
  finally{
    const frames=await page.evaluate(()=>{window.__candidateSaveRecording=false;return window.__candidateSaveFrames;});
    const traceFile=path.join(out,`trace-${report.traces.length}.json.gz`);
    fs.writeFileSync(traceFile,gzipSync(JSON.stringify(frames)),{flag:"wx"});
    row.trace=desc(traceFile);row.frames=frames.length;save();
    try{
      if(actionError)throw actionError;
      const live=frames.filter(f=>f.layers.length);
      row.moving=frames.filter(f=>f.layers.some(l=>l.opacity>.05&&l.opacity<.95&&l.transform!=="none")).length;
      assert(row.moving>=2,"Continuous translated intermediate frames required");
      const clocks=frames.flatMap(f=>f.layers.flatMap(l=>l.animations));
      assert(clocks.length&&clocks.every(a=>a.duration===(params.reduced?220:420)));
      assert(live.length&&live.every(f=>f.layers.filter(l=>!l.inert).length===1&&f.grids===1));
      assert(frames.every(f=>!f.unavailableFocus&&f.overflow===0));
      for(const key of ["viewport","screen","navigation","toolbar","back"]){
        const rects=live.map(f=>f[key]);assert(rects.length&&rects.every(Boolean),key);
        for(const r of rects)for(const prop of ["x","y","width","height"])
          assert(Math.abs(r[prop]-rects[0][prop])<=.25,`${key} geometry must remain stable`);
      }
      assert.equal(frames.at(-1).layers.length,leave?0:1);
      row.status="PASS";
    }catch(error){row.status="FAILED";row.error=String(error.stack||error);throw error;}
    finally{save();}
  }
}
function savedFiles(){
  const protection=JSON.parse(fs.readFileSync(path.join(profileRun,"profile-protection.json"),"utf8").replace(/^\uFEFF/,""));
  const files=[];
  for(const record of protection.records){
    const directory=path.join(record.target,"saves");if(!fs.existsSync(directory))continue;
    const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const f=path.join(dir,entry.name);assert(!fs.lstatSync(f).isSymbolicLink());
      if(entry.isDirectory())visit(f);
      else if(entry.name.endsWith(".json"))files.push({...desc(f),save:JSON.parse(fs.readFileSync(f,"utf8"))});
    }};visit(directory);
  }return files;
}
(async()=>{
  save();report.evidence=candidateEvidence(file,out);
  // Read-only negative boundary checks must reject before opening an application.
  report.boundaryChecks=[];
  for(const bad of ["F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json","D:/AgentVN/installation.json",out]){
    assert.throws(()=>candidateEvidence(bad,out));report.boundaryChecks.push({path:bad,status:"EXPECTED_REJECTION"});
  }
  const priorFile="F:/AgentVN/QA/Native-Runtime-State-20261020-01/save-grid-native02-02/report.json";
  const prior=authored||JSON.parse(fs.readFileSync(priorFile,"utf8"));assert.equal(prior.status,"PASS");
  report.fixtureSource=desc(authored?authorArg.slice(18):priorFile);
  const matrix=[1,2].flatMap(dpr=>[false,true].flatMap(reduced=>
    [[1920,1080],[2560,1440],[3840,2160]].map(([width,height])=>({width,height,dpr,reduced}))));
  for(const layout of ["agentvn","renpy"]){
    const source=authored?prior.cartridges.find(f=>f.layout===layout)
      :prior.fixtures.find(f=>path.basename(f.path)===`${layout}.vncart`);assert(source);assert.equal(sha(source.path),source.sha256);
    const input=path.join(out,`${layout}.vncart`);fs.copyFileSync(source.path,input,fs.constants.COPYFILE_EXCL);
    report.fixtures.push(desc(input));
    profileRun=`${out}-profile-${layout}`;assert(!fs.existsSync(profileRun));fs.mkdirSync(profileRun);
    profileRecord={layout,path:profileRun,status:"PREPARING"};report.profiles.push(profileRecord);save();
    profile("Prepare");profileRecord.status="PREPARED";save();
    session=await candidateRuntimeSession({file,out,input,layout,report,save});
    const page=session.page,errors=[];page.setDefaultTimeout(20000);page.on("pageerror",e=>errors.push(String(e)));
    try{
      await session.setViewport(matrix[0]);await page.locator(".boot-card .project-entry-loader").waitFor();
      await page.evaluate(cartridgeBase64=>window.postMessage({type:"agentvn.runtime.preview",cartridgeBase64,
        fileName:"grid.vncart",previewNonce:"candidate-1924"},"*"),fs.readFileSync(input).toString("base64"));
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
      const files=savedFiles().filter(f=>f.save.save_kind==="manual"&&f.save.game_id===(authored?source.gameId:`qa-native-grid-${layout}`)
        &&f.save.install_id==="preview_gamecli");
      assert.equal(files.length,6);assert.deepEqual(files.map(f=>f.save.slot).sort((a,b)=>a-b),[1,2,3,4,5,6]);
      assert(files.every(f=>f.save.preview_image?.startsWith("data:image/")));
      report.writes.push({layout,...(authored?{gameId:source.gameId}:{}),
        files:files.map(f=>({path:f.path,sha256:f.sha256,slot:f.save.slot}))});save();
      for(const params of matrix){
        await geometry(layout,params,"populated");
        await transition(layout,params,"next",()=>page.getByTestId("save-page-next").click());
        await page.getByTestId("save-slot-manual-7").waitFor();
        assert(await page.getByTestId("save-page-previous").evaluate(n=>n===document.activeElement));
        await transition(layout,params,"rapid-reverse",async()=>{
          await page.getByTestId("save-page-previous").click();
          await page.waitForFunction(()=>[...document.querySelectorAll("[data-save-page-layer]")]
            .some(n=>{const o=Number(getComputedStyle(n).opacity);return o>.1&&o<.9;}));
          await page.getByTestId("save-page-next").click();
        });
        await page.getByTestId("save-slot-manual-7").waitFor();
        await page.getByTestId("save-page-previous").focus();
        await transition(layout,params,"keyboard",()=>page.keyboard.press("Enter"));
        await page.getByTestId("save-slot-manual-1").waitFor();
        await transition(layout,params,"leave-during-flip",async()=>{
          await page.getByTestId("save-page-next").click();
          await page.waitForFunction(()=>[...document.querySelectorAll("[data-save-page-layer]")]
            .some(n=>{const o=Number(getComputedStyle(n).opacity);return o>.1&&o<.9;}));
          await page.keyboard.press("Escape");
        },true);
        assert.equal(await page.locator("[data-save-page-layer]").count(),0);
        await page.getByTestId("open-save-load").click();await idle(page,"save_load");
      }
      assert.deepEqual(errors,[]);
    }finally{
      await session.close();session=undefined;profile("Restore");profileRecord.status="RESTORED";
      profileRecord.restoration=desc(path.join(profileRun,"profile-restoration.json"));profileRun=undefined;save();
    }
  }
  assert.equal(report.cases.length,48);assert.equal(report.screenshots.length,48);assert.equal(report.traces.length,96);
  assert(report.cases.every(c=>c.status==="PASS")&&report.traces.every(t=>t.status==="PASS"));
  candidateEvidence(file,out);report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(async()=>{
  try{
    await session?.close();
    if(profileRun&&fs.existsSync(path.join(profileRun,"profile-protection.json"))
      &&!fs.existsSync(path.join(profileRun,"profile-restoration.json"))){
      profile("Restore");profileRecord.restoration=desc(path.join(profileRun,"profile-restoration.json"));profileRecord.status="RESTORED";
    }
  }catch(error){report.status="FAILED";report.cleanupError=String(error.stack||error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({
    status:report.status,out,cases:report.cases.length,traces:report.traces.length,error:report.error}));
});
