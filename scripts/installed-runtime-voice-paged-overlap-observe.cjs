"use strict";
// Read-only supplemental probe: never clicks, changes metrics, reloads,
// pauses playback, touches a store or modifies the running test.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require("../editor/node_modules/playwright");
const {captureInstalledWebview,readInstalledViewport}=require("./lib/installed-webview-capture.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-paged-20261019-01";
const work="F:/AgentVN/QA/Runtime-Voice-Paged-20261019-01";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const attempt=process.argv[2]||"03",layout=process.argv[3]||"renpy";
assert(/^\d{2}$/.test(attempt)&&["agentvn","renpy"].includes(layout));
const raw=read(path.join(base,`player-${attempt}/report.json`)),launch=raw.launches.at(-1);
assert.equal(raw.status,"RUNNING");assert(launch&&launch.cell.endsWith(`-${layout}`));
const cell=raw.cells.find(c=>c.name===launch.cell);
const observation=process.argv[4];if(observation)assert(/^retry\d{2}$/.test(observation));
const suffix=(attempt==="03"&&layout==="renpy"?"03":`${attempt}-${layout}`)+(observation?`-${observation}`:"");
const dest=path.join(base,`supplemental-nvl-overlap-${suffix}.json`);assert(!fs.existsSync(dest));
const result={status:"RUNNING",at:new Date().toISOString(),scope:"READ_ONLY_LIVE_GLYPH_CONTROL_INTERSECTION",
  pid:launch.pid,cell:cell.name,readOnly:true,productChanges:0,error:null};
let browser;
(async()=>{
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));assert(page);
  await page.waitForFunction(()=>{
    const d=document.querySelector(".dialog-box");
    return d?.getAttribute("data-dialogue-layout-mode")==="nvl"&&d.getAttribute("data-dialog-page-done")==="true"&&
      Number(d.getAttribute("data-dialog-page"))===2;
  },null,{timeout:180000});
  result.before=await readInstalledViewport(page,cell.viewport);
  result.geometry=await page.evaluate(()=>{
    const dialog=document.querySelector(".dialog-box"),text=dialog.querySelector('[data-nvl-current="true"] .nvl-page-text');
    const controls=Array.from(document.querySelectorAll(".renpy-quick-action,[data-testid='quick-menu-toggle']"))
      .filter(n=>getComputedStyle(n).visibility!=="hidden"&&getComputedStyle(n).display!=="none").map(n=>{
        const r=n.getBoundingClientRect();return {id:n.getAttribute("data-testid"),x:r.x,y:r.y,right:r.right,bottom:r.bottom};
      });
    const walker=document.createTreeWalker(text,NodeFilter.SHOW_TEXT),hits=[];let n;
    while((n=walker.nextNode()))for(let i=0;i<n.length;i++){
      if(!n.textContent[i].trim())continue;
      const range=document.createRange();range.setStart(n,i);range.setEnd(n,i+1);
      for(const rect of range.getClientRects())for(const control of controls){
        const width=Math.min(rect.right,control.right)-Math.max(rect.x,control.x);
        const height=Math.min(rect.bottom,control.bottom)-Math.max(rect.y,control.y);
        if(width>1&&height>1)hits.push({char:n.textContent[i],control:control.id,width,height,
          x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom});
      }
    }
    return {mode:dialog.dataset.dialogueLayoutMode,page:Number(dialog.dataset.dialogPage),
      command:Number(document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index")),
      controls,hits};
  });
  const cdp=await page.context().newCDPSession(page);
  result.screenshot=await captureInstalledWebview(page,cdp,path.join(work,`supplemental-nvl-overlap-${suffix}.png`),cell.viewport);
  result.after=await readInstalledViewport(page,cell.viewport);assert.deepEqual(result.before,result.after);
  assert.equal(result.geometry.controls.length,layout==="renpy"?8:1);assert.equal(result.geometry.page,2);assert.equal(result.geometry.command,2);
  result.status=result.geometry.hits.length?"FAILED":"PASS";
  if(result.status==="FAILED")result.finding="VISIBLE_NVL_GLYPHS_INTERSECT_VISIBLE_QUICK_CONTROLS";
})().catch(e=>{result.status="BLOCKED";result.error=String(e.stack||e);process.exitCode=1})
.finally(async()=>{
  await browser?.close().catch(()=>{});result.finishedAt=new Date().toISOString();
  fs.writeFileSync(dest,JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:result.status,hits:result.geometry?.hits.length,dest,error:result.error}));
  if(result.status==="FAILED")process.exitCode=1;
});
