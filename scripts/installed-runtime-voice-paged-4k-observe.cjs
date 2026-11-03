"use strict";
// Passive fixture-capacity observation, not an extra UI acceptance suite.
// Does not click, reload, change metrics, touch stores or delay the main test.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require("../editor/node_modules/playwright");
const {sha256}=require("./lib/installed-acceptance.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-paged-20261019-01";
const retry=process.argv[2]||"";
assert(!retry||/^retry[0-9]{2}$/.test(retry),"Retry must use an independent report name");
const file=path.join(base,`capacity-4k-observation-04${retry?`-${retry}`:""}.json`);assert(!fs.existsSync(file));
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const report={status:"WAITING",at:new Date().toISOString(),scope:"READ_ONLY_FIXTURE_CAPACITY_NOT_PRODUCT_PASS",
  source:{path:__filename,sha256:sha256(fs.readFileSync(__filename))},productChanges:0,modelRequests:0,
  transientIncompleteReads:0,error:null};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
(async()=>{
  save();const deadline=Date.now()+45*60000;let launch;
  while(Date.now()<deadline){
    let raw;
    try{raw=read(path.join(base,"player-04/report.json"))}
    catch(e){
      // The owning runner writes its live report in place. A partial JSON read
      // is not a terminal product result; keep observing without touching it.
      if(!(e instanceof SyntaxError))throw e;
      report.transientIncompleteReads++;await pause(50);continue;
    }
    launch=raw.launches.find(l=>l.cell==="3840x2160-dpr1-normal-agentvn"&&!l.restart);
    if(launch&&!launch.cleanup)break;
    assert.equal(raw.status,"RUNNING","Matrix ended before the intended 4K observation");
    await pause(250);
  }
  assert(launch&&!launch.cleanup,"Intended 4K Player must be live");
  report.status="OBSERVING";report.launch=launch;save();
  let online=false;const connectDeadline=Date.now()+45000;
  while(Date.now()<connectDeadline){
    try{online=(await fetch(`http://127.0.0.1:${launch.cdpPort}/json/version`,{signal:AbortSignal.timeout(500)})).ok}catch{}
    if(online)break;await pause(50);
  }
  assert(online);browser=await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));assert(page);
  const fixture=read(path.join(base,"fixtures.json")),expectedText=fixture.voice.dialogs[2].text;
  // Return the data in the browser-side predicate itself; a separate later
  // snapshot may race the main suite's legitimate process cleanup.
  const snapshot=await page.waitForFunction(text=>{
    const d=document.querySelector(".dialog-box"),n=document.querySelector('[data-testid="game-state-playing"]');
    if(d?.getAttribute("data-dialogue-layout-mode")!=="nvl"||
      n?.getAttribute("data-current-command-index")!=="2"||d.dataset.dialogPageDone!=="true")return false;
    const t=d.querySelector('[data-nvl-current="true"] .nvl-page-text'),region=d.querySelector(".nvl-page");
    if(!t||!region||!t.textContent?.length)return false;
    const r=region.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(t);
    const lines=Array.from(range.getClientRects()).filter(v=>v.width>0&&v.height>0)
      .map(v=>({x:v.x,y:v.y,right:v.right,bottom:v.bottom}));
    return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
        reduced:matchMedia("(prefers-reduced-motion: reduce)").matches},
      command:2,mode:d.dataset.dialogueLayoutMode,page:Number(d.dataset.dialogPage),pages:Number(d.dataset.dialogPages),
      done:d.dataset.dialogPageDone,fontMode:d.dataset.dialogFontMode,
      font:parseFloat(getComputedStyle(t).fontSize),renderedText:t.textContent,originalCharacters:text.length,
      wholeTextMatches:t.textContent===text,scroll:{width:region.clientWidth,actualWidth:region.scrollWidth,
        height:region.clientHeight,actualHeight:region.scrollHeight},
      region:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},lines};
  },expectedText,{timeout:240000,polling:"raf"});
  report.observation=await snapshot.jsonValue();
  const s=report.observation;assert.deepEqual(s.viewport,{width:3840,height:2160,dpr:1,reduced:false});
  assert.equal(s.command,2);assert.equal(s.mode,"nvl");assert(s.pages>=1);
  const allLinesFit=s.lines.every(l=>l.x>=s.region.x-2&&l.right<=s.region.right+2&&l.y>=s.region.y-2&&l.bottom<=s.region.bottom+2);
  report.capacityConclusion=s.pages===1&&s.wholeTextMatches&&allLinesFit&&
    s.scroll.actualWidth<=s.scroll.width+1&&s.scroll.actualHeight<=s.scroll.height+2
    ?"ORIGINAL_FIXTURE_FITS_ONE_PAGE_NEEDS_STRONGER_INPUT_TO_TEST_PAGINATION"
    :s.pages>1?"ORIGINAL_FIXTURE_ACTUALLY_PAGINATES":"UNPROVEN_OR_OVERFLOW_REQUIRES_REVIEW";
  report.status="RECORDED";
})().catch(e=>{report.status="BLOCKED";report.error=String(e.stack||e);process.exitCode=1})
.finally(async()=>{
  await browser?.close().catch(()=>{});report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,conclusion:report.capacityConclusion,file,error:report.error}));
});
