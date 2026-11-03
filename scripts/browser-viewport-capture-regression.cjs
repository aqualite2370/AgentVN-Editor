"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require("../editor/node_modules/playwright");
const {captureBrowserViewport}=require("./lib/browser-viewport-capture.cjs");
const attempt=process.argv[2];
assert(/^(red|green)-\d{2}$/.test(attempt||""));
const out=`F:/AgentVN/QA/Runtime-Save-Grid-Fit-20261024-01/capture-${attempt}`;
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const report={status:"RUNNING",scope:"BROWSER_CAPTURE_TOOL_ONLY_NOT_PRODUCT",cases:[],diagnostics:[]};
let browser;
(async()=>{
  browser=await chromium.launch({args:["--use-angle=d3d11","--enable-gpu"]});
  for(const dpr of [1,2]){
    const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:dpr});
    const page=await context.newPage(),cdp=await context.newCDPSession(page);
    await page.setContent('<button autofocus>保持焦点</button><p>截图参数校验</p>');
    await page.locator("button").focus();
    const expected={width:1920,height:1080,dpr,reduced:false},row={dpr,status:"RUNNING"};
    report.cases.push(row);
    try{
      const focus=await page.locator("button").evaluate(n=>n===document.activeElement);
      row.capture=await captureBrowserViewport(page,cdp,path.join(out,`actual-${dpr}.png`),expected);
      assert.equal(await page.locator("button").evaluate(n=>n===document.activeElement),focus);
      row.status="PASS";
    }catch(error){row.status="FAILED";row.error=String(error.stack||error);}
    await cdp.detach();await context.close();row.contextClosed=true;
  }
  assert.equal(report.cases.length,2);assert(report.cases.every(c=>c.status==="PASS"));report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(async()=>{await browser?.close();report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify(report));});
