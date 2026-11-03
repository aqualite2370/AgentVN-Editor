"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawnSync}=require("node:child_process"),{gzipSync}=require("node:zlib");
const {candidateOpeningSession,openingCandidateEvidence}=require("./lib/candidate-1924-opening-session.cjs");
const {readInstalledViewport}=require("./lib/current-native-capture.cjs");
const root=path.resolve(__dirname,".."),attempt=process.argv[2];assert(/^\d{2}$/.test(attempt||""));
const out=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/opening-installed-1924-${attempt}`;
const installationFile="F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc=f=>({path:path.resolve(f),sha256:sha(f)});
const priorFile="F:/AgentVN/QA/Native-Runtime-State-20261020-01/opening-native-time02-01/report.json";
const prior=JSON.parse(fs.readFileSync(priorFile,"utf8"));assert.equal(prior.status,"PASS");assert.equal(prior.cases.length,32);
const report={status:"RUNNING",startedAt:new Date().toISOString(),modelRequests:0,launches:[],cases:[],screenshots:[],
  scope:"INSTALLED_1_9_24_BUNDLED_NATIVE_PREVIEW_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID",
  boundaries:["Unchanged synthetic fixture bytes from the prior 32-flow oracle; no authoring/export claim",
    "Real installed Player and WebView viewport emulation, not physical 4K",
    "Owned process teardown, not normal window close; media playback is not listening acceptance"],
  sourceOracle:desc(priorFile),fixtures:[],tools:[
    __filename,"scripts/lib/candidate-1924-opening-session.cjs","scripts/lib/current-native-capture.cjs",
    "scripts/native-dev-preview-profile.ps1"].map(desc)};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let profilePrepared=false;
function profile(action){
  const r=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(root,"scripts/native-dev-preview-profile.ps1"),"-Action",action,"-RunDirectory",out,"-CodexCacheView"],
    {encoding:"utf8",windowsHide:true,timeout:45000});
  fs.writeFileSync(path.join(out,`profile-${action}.log`),r.stdout+r.stderr,{flag:"wx"});
  assert.equal(r.status,0,r.stdout+r.stderr);
}
function fixture(kind,layout){
  const f=report.fixtures.find(f=>f.kind===kind&&f.layout===layout);assert(f);return f.path;
}
async function record(page){
  await page.evaluate(()=>{
    window.__openingFrames=[];window.__openingCapture=true;window.__openingEvents=[];window.__openingMediaEvents=[];
    document.addEventListener("ended",e=>{
      if(e.target instanceof HTMLVideoElement)window.__openingEvents.push({event:"ended",at:performance.now(),time:e.target.currentTime});
    },true);
    for(const type of ["loadedmetadata","loadeddata","canplay","playing"])document.addEventListener(type,e=>{
      if(e.target instanceof HTMLVideoElement)window.__openingMediaEvents.push({
        event:type,at:performance.now(),time:e.target.currentTime,ready:e.target.readyState});
    },true);
    const tick=()=>{
      if(!window.__openingCapture)return;
      const opening=document.querySelector('[data-testid="runtime-opening-screen"]');
      const media=document.querySelector(".custom-loading-animation video,.custom-loading-animation img");
      const clocks=n=>n?.getAnimations().map(a=>({
        currentTime:a.currentTime,playState:a.playState,timing:a.effect.getTiming()}));
      window.__openingFrames.push({at:performance.now(),opening:!!opening,
        opacity:opening?Number(getComputedStyle(opening).opacity):null,
        mediaOpacity:media?Number(getComputedStyle(media.closest(".runtime-opening-media")??media.parentElement).opacity):null,
        time:media instanceof HTMLVideoElement?media.currentTime:null,
        mediaAnimations:clocks(media?.closest(".runtime-opening-media")),stageAnimations:clocks(opening),
        cardMedia:!!media?.closest(".boot-card"),transform:opening?getComputedStyle(opening).transform:null});
      requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  });
}
async function runCase(params,kind,layout){
  const row={...params,kind,layout,status:"RUNNING"};report.cases.push(row);save();
  let session,page;const errors=[];
  try{
    const input=fixture(kind,layout);
    session=await candidateOpeningSession({installationFile,out,report,save,viewport:params,index:report.cases.length,input});
    page=session.page;page.setDefaultTimeout(15000);page.on("pageerror",e=>errors.push(String(e)));
    row.before=await readInstalledViewport(page,params);
    await page.locator(".boot-card .project-entry-loader").waitFor();await record(page);
    await page.evaluate(cartridgeBase64=>window.postMessage({
      type:"agentvn.runtime.preview",cartridgeBase64,fileName:"opening.vncart",previewNonce:"candidate-1924"},"*"),
    fs.readFileSync(input).toString("base64"));
    if(kind==="broken"){
      await page.getByRole("alert").waitFor();assert.match(await page.getByRole("alert").innerText(),/开屏视频.*播放/);
      assert(await page.getByRole("button",{name:"重试",exact:true}).isVisible());row.errorVisible=true;
    }else if(kind!=="default"){
      const media=page.locator(".custom-loading-animation video,.custom-loading-animation img");await media.waitFor();
      row.geometry=await media.evaluate(el=>{
        const r=el.getBoundingClientRect(),css=getComputedStyle(el.parentElement);
        return {media:r.toJSON(),stage:el.closest('[data-testid="runtime-opening-screen"]')?.getBoundingClientRect().toJSON(),
          inCard:!!el.closest(".boot-card"),fit:getComputedStyle(el).objectFit,radius:css.borderRadius,
          border:css.borderWidth,shadow:css.boxShadow,overflow:document.documentElement.scrollWidth-innerWidth};
      });
      const g=row.geometry;assert(!g.inCard&&g.stage);
      assert(Math.abs(g.stage.x)<1&&Math.abs(g.stage.y)<1
        &&Math.abs(g.stage.width-params.width)<1&&Math.abs(g.stage.height-params.height)<1);
      assert(g.media.width>=params.width-1&&g.media.height>=params.height-1);
      assert(g.fit==="contain"&&g.radius==="0px"&&g.border==="0px"&&g.shadow==="none"&&g.overflow<=1);
      await page.keyboard.press("Tab");await page.keyboard.press("Enter");
      assert.equal(await page.getByTestId("game-state-playing").count(),0);
      row.input=await page.evaluate(()=>{
        const stage=document.querySelector('[data-testid="runtime-opening-screen"]');
        const title=document.querySelector('[data-testid="start-new-game"]'),r=title?.getBoundingClientRect();
        return {focused:document.activeElement===stage,backgroundInert:document.querySelector(".runtime-boot-content")?.inert,
          titleBlocked:!r||!title.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
      });
      assert(row.input.focused&&row.input.backgroundInert&&row.input.titleBlocked);
      if(kind==="video"){
        await page.waitForFunction(()=>document.querySelector("video")?.currentTime>.15);
        row.playing=await media.evaluate(v=>({time:v.currentTime,paused:v.paused,duration:v.duration,ready:v.readyState}));
        assert(!row.playing.paused&&row.playing.duration>2);
      }
      if(params.interrupt){
        await media.evaluate(v=>{window.__abandonedOpeningVideo=v;});
        await page.evaluate(cartridgeBase64=>window.postMessage({
          type:"agentvn.runtime.preview",cartridgeBase64,previewNonce:"replacement"},"*"),
        fs.readFileSync(fixture("default",layout)).toString("base64"));
      }
      report.screenshots.push(await session.shot(path.join(out,
        `${params.width}-${params.dpr}-${params.reduced}-${layout}-${kind}${params.interrupt?"-interrupted":""}.png`)));
      await page.getByTestId("runtime-opening-screen").waitFor({state:"detached"});
      const frames=await page.evaluate(()=>window.__openingFrames);
      row.entranceFrames=frames.filter(f=>f.opening&&f.mediaOpacity>.02&&f.mediaOpacity<.98).length;
      row.exitFrames=frames.filter(f=>f.opening&&f.opacity>.02&&f.opacity<.98).length;
      assert(row.entranceFrames>=2,"Media entrance needs real intermediate frames");
      if(!params.interrupt)assert(row.exitFrames>=2,"Completed opening must fade the complete stage");
      assert(frames.filter(f=>f.opening).every(f=>f.transform==="none"&&!f.cardMedia));
      const clocks=frames.flatMap(f=>[...(f.mediaAnimations??[]),...(f.stageAnimations??[])]);
      assert(clocks.length&&clocks.every(a=>a.timing.duration===(params.reduced?180:420)));
      if(kind==="video"){
        row.events=await page.evaluate(()=>window.__openingEvents);
        if(params.interrupt){
          assert.equal(row.events.length,0);
          assert(await page.evaluate(()=>window.__abandonedOpeningVideo.paused&&!window.__abandonedOpeningVideo.hasAttribute("src")));
        }else{
          assert.equal(row.events.filter(e=>e.event==="ended").length,1);
          assert(frames.some(f=>f.time>1&&f.opening));
          const ended=row.events.find(e=>e.event==="ended"),playingFrames=frames.filter(f=>f.opening&&f.at<ended.at);
          assert(playingFrames.length>2&&playingFrames.every(f=>f.opacity>=.999));
          assert(playingFrames.filter(f=>f.mediaOpacity>.02&&f.mediaOpacity<.98).length>=2);
        }
      }
    }
    if(kind!=="broken"){
      await page.locator(".boot-overlay").waitFor({state:"detached"});
      await page.getByTestId("start-new-game").click();await page.getByTestId("game-launch-blackout").waitFor();
      await page.getByTestId("game-state-playing").waitFor();
      await page.getByTestId("game-launch-blackout").waitFor({state:"detached"});
      assert.equal(await page.locator(".custom-loading-animation").count(),0);row.storyBlackoutPreserved=true;
    }
    row.after=await readInstalledViewport(page,params);assert.deepEqual(row.after,row.before);
    assert.deepEqual(errors,[]);row.status="PASS";
  }catch(error){row.status="FAILED";row.error=String(error.stack||error);}
  finally{
    if(page){
      const captured=await page.evaluate(()=>{
        window.__openingCapture=false;
        return {frames:window.__openingFrames??[],events:window.__openingEvents??[],mediaEvents:window.__openingMediaEvents??[]};
      }).catch(error=>{row.captureError=String(error);return null;});
      if(captured){
        const traceFile=path.join(out,`frames-${report.cases.length}.json.gz`);
        fs.writeFileSync(traceFile,gzipSync(JSON.stringify(captured)),{flag:"wx"});row.trace=desc(traceFile);
      }
    }
    try{await session?.close();}
    catch(error){row.status="FAILED";row.cleanupError=String(error.stack||error);}
    row.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({kind,layout,...params,status:row.status,error:row.error}));
  }
}
(async()=>{
  save();report.evidence=openingCandidateEvidence(installationFile,out);
  report.boundaryChecks=[];
  for(const [badFile,badOut]of [
    ["F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json",out],
    [installationFile,"D:/AgentVN"],[installationFile,`${out}/nested`]]){
    assert.throws(()=>openingCandidateEvidence(badFile,badOut));
    report.boundaryChecks.push({file:badFile,out:badOut,status:"EXPECTED_REJECTION"});
  }
  for(const f of prior.fixtures){
    assert.equal(sha(f.path),f.sha256);
    const target=path.join(out,path.basename(f.path));fs.copyFileSync(f.path,target,fs.constants.COPYFILE_EXCL);
    report.fixtures.push({...desc(target),kind:f.kind,layout:f.layout});
  }
  profilePrepared=true;profile("Prepare");
  for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])
    for(const reduced of [false,true])for(const layout of ["agentvn","renpy"])
      await runCase({width,height,dpr,reduced},"video",layout);
  for(const reduced of [false,true])for(const kind of ["image_sequence","default","broken"])
    await runCase({width:1920,height:1080,dpr:1,reduced},kind,"renpy");
  for(const reduced of [false,true])
    await runCase({width:1920,height:1080,dpr:1,reduced,interrupt:true},"video","agentvn");
  assert.equal(report.cases.length,32);assert.equal(report.screenshots.length,28);
  assert(report.cases.every(c=>c.status==="PASS"),"Every required opening flow must pass");
  openingCandidateEvidence(installationFile,out);report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(()=>{
  try{
    if(profilePrepared&&fs.existsSync(path.join(out,"profile-protection.json"))){
      profile("Restore");const f=path.join(out,"profile-restoration.json");
      assert.equal(JSON.parse(fs.readFileSync(f,"utf8")).status,"PASS");report.profileRestoration=desc(f);
    }
    assert.equal(report.launches.length,report.cases.length);
    assert(report.launches.every(l=>l.cleanup?.status==="PASS"&&!l.cleanupError));
    for(const f of report.tools)assert.equal(sha(f.path),f.sha256);
  }catch(error){report.status="FAILED";report.cleanupError=String(error.stack||error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,out,cases:report.cases.length,error:report.error,cleanupError:report.cleanupError}));
});
