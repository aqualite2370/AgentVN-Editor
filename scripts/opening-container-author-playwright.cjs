"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createRequire}=require("node:module"),root=path.resolve(__dirname,".."),req=createRequire(path.join(root,"editor/package.json"));
const {buildSync}=req("esbuild"),{chromium}=req("playwright"),out=process.argv[2];
assert(out&&!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const compiled=buildSync({stdin:{resolveDir:root,loader:"tsx",contents:`
  import React, { useState } from "react";
  import { createRoot } from "react-dom/client";
  import { OpeningAnimationEditor } from "./editor/src/components/common/OpeningAnimationEditor";
  const seed={kind:"video",video_asset_id:"qa_video"};
  const assets=[{asset_id:"qa_video",asset_type:"video",metadata:{filename:"opening.webm",mime_type:"video/webm"}}];
  function Harness(){
    const [animation,setAnimation]=useState(seed);
    window.__openingAuthor=animation;
    return <OpeningAnimationEditor animation={animation} assets={assets} helpKey="start.loadingAnimation"
      onChange={next=>{window.__openingAuthor=next;localStorage.setItem("qa-opening-config",JSON.stringify(next));setAnimation(next)}}/>;
  }
  createRoot(document.getElementById("root")).render(<Harness/>);
`},bundle:true,platform:"browser",format:"iife",write:false,jsx:"automatic",
  alias:{react:path.dirname(req.resolve("react/package.json")),"react-dom":path.dirname(req.resolve("react-dom/package.json"))},
  nodePaths:[path.join(root,"editor/node_modules")],define:{"process.env.NODE_ENV":'"production"'}}).outputFiles[0].text;
const report={status:"RUNNING",scope:"REAL_AUTHOR_COMPONENT_BROWSER_NOT_INSTALLED_EDITOR",cases:[],cleanup:"PENDING",modelRequests:0};
const css=fs.readdirSync(path.join(root,"editor/dist/assets")).filter(file=>file.endsWith(".css"))
  .map(file=>fs.readFileSync(path.join(root,"editor/dist/assets",file),"utf8")).join("\n");
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let browser;
(async()=>{
  browser=await chromium.launch({headless:true});
  for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of[1,2]){
    const row={width,height,dpr,status:"RUNNING"};report.cases.push(row);save();
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr});
    try{
      await context.route("**/*",route=>route.fulfill({status:200,contentType:"text/html",body:'<div id="root"></div>'}));
      const page=await context.newPage();page.setDefaultTimeout(5000);
      const errors=[];page.on("pageerror",error=>errors.push(String(error)));
      await page.goto("http://qa.invalid/");await page.addStyleTag({content:css});await page.addScriptTag({content:compiled});
      const mode=page.getByRole("combobox",{name:"片头容器",exact:true});await mode.waitFor();
      await mode.click();await page.getByRole("option",{name:"居中尺寸",exact:true}).click();
      await page.getByRole("spinbutton",{name:"片头容器宽度（百分比）"}).fill("64");
      await page.getByRole("spinbutton",{name:"片头容器高度（百分比）"}).fill("72");
      await page.getByRole("combobox",{name:"片头画面适配",exact:true}).click();
      await page.getByRole("option",{name:"裁切铺满",exact:true}).click();
      const before=await page.evaluate(()=>window.__openingAuthor);
      assert.deepEqual(before.presentation,{mode:"centered",fit:"cover",width_percent:64,height_percent:72});
      await page.getByRole("button",{name:"多图序列",exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.__openingAuthor.presentation),before.presentation);
      await page.getByRole("button",{name:"视频",exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.__openingAuthor.presentation),before.presentation);
      // Replacing media is an author operation and must not reset container settings.
      const upload=page.locator('input[type="file"][accept^="video/"]');
      await upload.setInputFiles({name:"替换.webm",mimeType:"video/webm",buffer:Buffer.from("controlled import, no video decoding claim")});
      await page.waitForFunction(()=>window.__openingAuthor.video_asset_id?.includes("loading_video"));
      assert.deepEqual(await page.evaluate(()=>window.__openingAuthor.presentation),before.presentation);
      assert.deepEqual(errors,[]);
      const state=await page.evaluate(()=>({current:window.__openingAuthor,persisted:JSON.parse(localStorage.getItem("qa-opening-config"))}));
      assert.deepEqual(state.current,state.persisted);row.state=state;row.status="PASS";
    }catch(error){row.status="FAILED";row.error=String(error.stack||error);}
    finally{await context.close();save();}
  }
})().catch(error=>report.fatal=String(error.stack||error)).finally(async()=>{
  if(browser)await browser.close();report.cleanup="PASS";
  report.status=!report.fatal&&report.cases.length===6&&report.cases.every(c=>c.status==="PASS")?"PASS":"FAILED";
  save();console.log(JSON.stringify({status:report.status,cases:report.cases.map(c=>[c.width,c.dpr,c.status]),out}));
  process.exitCode=report.status==="PASS"?0:1;
});
