"use strict";
// Real Runtime stylesheet with a bounded save-card DOM and a known image.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{chromium}=require("../editor/node_modules/playwright");
const root=path.resolve(__dirname,".."),attempt=process.argv[2];
assert(/^(red|green)-\d{2}$/.test(attempt||""));
const out=`F:/AgentVN/QA/Runtime-Save-Grid-Fit-20261024-01/image-${attempt}`;
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const stylePaths=["GameCli_framework/src/styles/variables.css","GameCli_framework/src/styles/shell.css"];
const sha=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const css=stylePaths.map(file=>fs.readFileSync(path.join(root,file),"utf8")).join("\n");
const report={status:"RUNNING",scope:"REAL_STYLESHEET_IMAGE_MIN_CONTENT_NOT_FULL_PLAYER_OR_INSTALLATION",
  sources:stylePaths.map(file=>({path:path.join(root,file),sha256:sha(path.join(root,file))})),cases:[],modelRequests:0};
const image="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#174c6d"/><rect width="1280" height="20" fill="red"/><rect y="700" width="1280" height="20" fill="lime"/></svg>');
let browser;
(async()=>{
  browser=await chromium.launch({args:["--use-angle=d3d11","--enable-gpu"]});
  for(const reduced of [false,true]){
    const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:reduced?"reduce":"no-preference"});
    const page=await context.newPage(),row={reduced,status:"RUNNING"};report.cases.push(row);
    try{
      await page.setContent(`<style>${css}</style><div class="save-page-viewport" style="position:absolute;left:100px;top:100px;width:600px;height:300px">
      <article class="save-slot"><button class="save-card-main">
      <span class="save-preview-frame"><img src="${image}"></span>
      <span class="save-card-copy"><strong>存档01</strong><span>场景名</span><small>2026-10-24</small></span>
      </button></article></div>`);
      await page.waitForFunction(()=>document.querySelector("img").complete);
      row.geometry=await page.locator(".save-preview-frame").evaluate(frame=>{
        const image=frame.querySelector("img"),rect=n=>n.getBoundingClientRect().toJSON();
        return {frame:rect(frame),image:rect(image),fit:getComputedStyle(image).objectFit,
          naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight};
      });
      const g=row.geometry;
      assert.equal(g.fit,"contain");assert.equal(g.naturalWidth,1280);assert.equal(g.naturalHeight,720);
      assert(g.frame.height>0&&g.image.top>=g.frame.top-1&&g.image.bottom<=g.frame.bottom+1
        &&g.image.left>=g.frame.left-1&&g.image.right<=g.frame.right+1,
      "An intrinsic 16:9 image must not create an oversized implicit grid track behind the metadata");
      row.status="PASS";
    }catch(error){row.status="FAILED";row.error=String(error.stack||error);}
    finally{await context.close();row.contextClosed=true;}
  }
  assert.equal(report.cases.length,2);assert(report.cases.every(c=>c.status==="PASS"));report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(async()=>{await browser?.close();report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,out,cases:report.cases}));});
