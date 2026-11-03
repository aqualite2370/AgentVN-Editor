"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT);
const out=path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT); assert(!fs.existsSync(out)); fs.mkdirSync(out,{recursive:true});
const report={status:"RUNNING",scope:"isolated browser E5 deletion confirmations; no model requests",cases:[],errors:[]};
let server,browser;
async function test(context,name,operation){ const page=await context.newPage(); page.on("pageerror",error=>report.errors.push(String(error)));
  try{await operation(page);report.cases.push({name,status:"PASS"});}
  catch(error){report.cases.push({name,status:"FAILED",error:String(error.stack||error)});await page.screenshot({path:path.join(out,`${name}-failed.png`)});}
  finally{await page.close();} }
async function main(){
 server=await startOwnedViteServer({root:path.resolve(__dirname,"../editor"),port:0,logFile:path.join(out,"server.log")});
 browser=await chromium.launch();
 for(const [width,height] of desktopViewports)for(const dpr of [1,2])for(const reduced of [false,true]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:reduced?"reduce":"no-preference"});
  await context.addInitScript(()=>{ window.confirm=()=>Promise.resolve(false); });
  const suffix=`${width}-dpr${dpr}-${reduced?"reduced":"normal"}`;
  await test(context,`library-${suffix}`,async page=>{
   await page.goto(`${server.url}/custom-component-library-harness.html`);const library=page.getByTestId("custom-component-library"); await library.waitFor();
   await library.getByTestId("component-save").click();await library.getByText(/已保存到本机个人组件库/).waitFor();
   const item=library.locator(".custom-component-list li");assert.equal(await item.count(),1);
   await item.getByRole("button",{name:"删除 我的组件",exact:true}).click();
   const dialog=page.getByTestId("editor-delete-confirmation");await dialog.waitFor({timeout:5000});
   assert.equal(await item.count(),1,"No deletion while confirmation is pending");
   assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),"取消");
   assert.equal(await page.locator("#root").evaluate(n=>n.inert),true,"Confirmation owns background input");
   await page.keyboard.press("Tab"); assert.equal(await dialog.evaluate(n=>n.contains(document.activeElement)),true);
   await page.keyboard.press("Shift+Tab"); assert.equal(await dialog.evaluate(n=>n.contains(document.activeElement)),true);
   await dialog.getByRole("button",{name:"取消",exact:true}).click();await dialog.waitFor({state:"detached"});assert.equal(await item.count(),1);
   await item.getByRole("button",{name:"删除 我的组件",exact:true}).click();await dialog.waitFor();await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});assert.equal(await item.count(),1);
   await item.getByRole("button",{name:"删除 我的组件",exact:true}).click();await dialog.waitFor();
   const metrics=await dialog.getByRole("dialog").evaluate(n=>{const r=n.getBoundingClientRect();return{rect:r.toJSON(),overflow:document.documentElement.scrollWidth-innerWidth};});
   assert(metrics.rect.left>=0&&metrics.rect.top>=0&&metrics.rect.right<=width+1&&metrics.rect.bottom<=height+1&&metrics.overflow<=1);
   await dialog.getByRole("button",{name:"确认删除",exact:true}).click();await item.waitFor({state:"detached"});await dialog.waitFor({state:"detached"});
   await page.reload();await library.waitFor();assert.equal(await item.count(),0);
  });
  await test(context,`history-${suffix}`,async page=>{
   await page.goto(`${server.url}/assistant-session-harness.html`);
   await page.getByTestId("seed-creation-history").click();await page.getByTestId("mode-isolation-summary").filter({hasText:"创造模式隔离样例"}).waitFor();
   await page.getByRole("button",{name:"创造模式",exact:true}).click();const history=page.locator("details.assistant-history-popover");
   if(!await history.evaluate(n=>n.open))await history.locator("summary").click();
   const del=page.getByRole("button",{name:"永久删除 创造模式隔离样例",exact:true});await del.click();const dialog=page.getByTestId("editor-delete-confirmation");await dialog.waitFor({timeout:5000});
   assert.equal(await del.count(),1);await dialog.getByRole("button",{name:"取消",exact:true}).click();await dialog.waitFor({state:"detached"});
   if(!await history.evaluate(n=>n.open))await history.locator("summary").click();assert.equal(await del.count(),1);
   await del.click();await dialog.waitFor();await dialog.getByRole("button",{name:"确认删除",exact:true}).click();await dialog.waitFor({state:"detached"});
   await page.getByText("已永久删除该对话",{exact:true}).waitFor();assert.equal(await del.count(),0);
  });
  await context.close();if(report.cases.some(item=>item.status==="FAILED"))break;
 }
 assert.equal(report.cases.length,24,"Three desktop sizes, both DPR/motion modes, two deletion flows required");assert(report.cases.every(item=>item.status==="PASS"));assert.deepEqual(report.errors,[]);report.status="PASS";
}
main().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;}).finally(async()=>{
 await browser?.close();await server?.stop();fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cases:report.cases,out,error:report.error}));
});
