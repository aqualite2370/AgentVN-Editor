"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict");
const {chromium}=require("../editor/node_modules/playwright");
const output=process.argv[2];
assert(output && /^F:[/\\]AgentVN[/\\]QA[/\\]/.test(output) && !fs.existsSync(output));
const report={status:"RUNNING",at:new Date().toISOString(),scope:"BROWSER_RENDERER_CAPABILITY_NOT_PRODUCT_ACCEPTANCE",rows:[]};
(async()=>{
  for(const args of [[],["--use-angle=d3d11"]]){
    const browser=await chromium.launch({args});
    try{
      const session=await browser.newBrowserCDPSession();
      const info=await session.send("SystemInfo.getInfo");
      report.rows.push({args,version:browser.version(),devices:info.gpu.devices,features:info.gpu.featureStatus});
      await session.detach();
    }finally{await browser.close();}
  }
  report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack);process.exitCode=1;})
.finally(()=>{fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:"wx"});
 console.log(JSON.stringify(report));});
