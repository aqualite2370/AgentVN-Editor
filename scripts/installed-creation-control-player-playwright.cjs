"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const A = require("./lib/installed-acceptance.cjs");
assert(process.argv[2] && process.argv[3] && process.argv[4], "Pass exact installed session, creation report and fresh output");
const runRoot=path.resolve(process.argv[2]), sourceFile=path.resolve(process.argv[3]), out=path.resolve(process.argv[4]);
assert(A.inside(runRoot,sourceFile) && A.inside(runRoot,out) && !fs.existsSync(out));
const source=JSON.parse(fs.readFileSync(sourceFile,"utf8")); assert.equal(source.status,"PASS");
assert.equal(source.cases.length,5); assert.equal(source.matrix.length,12);
const {state}=A.readInstalledSession(runRoot), exe=path.join(state.installRoot,"agentvn-player.exe");
const artifact=source.cartridgeArtifact; assert.equal(A.sha256(fs.readFileSync(artifact.path)),artifact.sha256);
fs.mkdirSync(out);
const report={status:"RUNNING",exe,exeSha256:A.sha256(fs.readFileSync(exe)),cartridge:artifact,cases:[],errors:[],cleanup:{}};
let child,browser,page;
async function main(){
 const port=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once("error",reject);
   probe.listen(0,"127.0.0.1",()=>{const p=probe.address().port;probe.close(()=>resolve(p));});});
 child=spawn(exe,["--mode","preview","--cartridge",artifact.path],{cwd:state.installRoot,windowsHide:true,stdio:"ignore",
  env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(out,"player-webview"),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
 report.pid=child.pid;report.cdpPort=port;
 const deadline=Date.now()+80000;let ready=false;
 while(Date.now()<deadline){assert.equal(child.exitCode,null);
  try{if((await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,200));}
 assert(ready,"Owned installed player never became ready");
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(45000);
 page.on("pageerror",e=>report.errors.push(String(e)));
 const session=await browser.contexts()[0].newCDPSession(page);
 await page.getByTestId("game-state-title").waitFor();await A.settleRuntime(page);
 for(const [width,height] of desktopViewports)for(const dpr of [1,2])for(const reduced of [false,true]){
  await session.send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:dpr,mobile:false});
  await page.emulateMedia({reducedMotion:reduced?"reduce":"no-preference"});await A.settleRuntime(page);
  const button=page.getByRole("button",{name:"开始创作",exact:true});
  const geometry=await button.evaluate(b=>{const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return{rect:r.toJSON(),hit:hit===b||b.contains(hit),overflow:document.documentElement.scrollWidth-innerWidth};});
  assert(geometry.hit&&geometry.overflow<=1&&geometry.rect.width>0&&geometry.rect.height>0);
  assert(geometry.rect.left>=0&&geometry.rect.right<=width+1&&geometry.rect.top>=0&&geometry.rect.bottom<=height+1);
  assert.equal(await page.getByRole("button",{name:"开始游戏",exact:true}).count(),0);
  report.cases.push({width,height,dpr,reduced,geometry,status:"PASS"});
 }
 assert.equal(report.cases.length,12);
 await page.screenshot({path:path.join(out,"installed-player-approved-title-4k.png")});
 await page.getByRole("button",{name:"开始创作",exact:true}).click();
 await page.getByTestId("game-state-playing").waitFor();await A.settleRuntime(page);
 assert.match(await page.locator("body").innerText(),/本轮独立 UI 验收/);
 report.originalStartAction="PASS";
 await page.screenshot({path:path.join(out,"installed-player-original-story-action.png")});
 assert.equal(A.sha256(fs.readFileSync(artifact.path)),artifact.sha256);
 assert.deepEqual(report.errors,[]);report.status="PASS";
}
main().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}).finally(async()=>{
 await browser?.close();
 if(child&&child.exitCode===null&&child.signalCode===null){
  const killed=spawnSync("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,encoding:"utf8"});
  report.cleanup.exit=killed.status;if(killed.status!==0){report.status="FAILED";process.exitCode=1;}
 }
 report.scope="actual installed player consumes newly exported cartridge; logical WebView viewport; not Android/final overall release";
 fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,cases:report.cases.length,cleanup:report.cleanup,error:report.error,out}));
});
