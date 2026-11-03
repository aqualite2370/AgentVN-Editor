"use strict";
// Actual menu frame + snapshot copier, with a controlled loading gate. This
// makes the native Escape/loading focus defect deterministic without AI/IO.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const http = require("node:http");
const attempt = process.argv[2]; assert.match(attempt || "", /^(red|green)-\d{2}$/);
const root = path.resolve(__dirname, ".."), out = `F:/AgentVN/QA/Runtime-SavePage-Handoff-20261024-01/${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out,{recursive:true});
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourcePaths = ["GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/app/runtimePageCrossfade.ts"];
const css = fs.readdirSync(path.join(root,"GameCli_framework/dist/assets")).filter(f=>f.endsWith(".css"))
  .map(f=>fs.readFileSync(path.join(root,"GameCli_framework/dist/assets",f),"utf8")).join("\n");
const compiled = buildSync({stdin:{resolveDir:root,loader:"tsx",contents:`
  import React, {useState} from "react";
  import {createRoot} from "./GameCli_framework/node_modules/react-dom/client";
  import {flushSync} from "./GameCli_framework/node_modules/react-dom";
  import {RenpyMenuFrame} from "./GameCli_framework/src/components/shell/RenpyMenuFrame";
  import {UISkinProvider} from "./GameCli_framework/src/uiSkin/uiSkinRuntime";
  import {useRuntimeStore} from "./GameCli_framework/src/store/runtimeStore";
  import {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";
  import {captureRuntimePage} from "./GameCli_framework/src/app/runtimePageCrossfade";
  useRuntimeStore.setState({currentGame:{install_id:"handoff-fixture",game_id:"handoff-fixture",
    title:"交接隔离工程",author:"QA",assetUrls:{},gallery:[],
    script:{entry_scene_id:"main",characters:[],scenes:[]},
    uiSkin:createRenpyUILayout(),manifest:{assets:[]}},screen:"save_load"});
  function Fixture(){
    const [blocked,setBlocked]=useState(false);
    window.__setBlocked=value=>flushSync(()=>setBlocked(value));
    window.__captureSavePage=()=>{
      const snapshot=captureRuntimePage(document.querySelector("[data-runtime-motion-surface]"));
      document.querySelector("#fixture").append(snapshot);
      return {markers:snapshot.querySelectorAll("[data-save-page-layer]").length,
        grids:snapshot.querySelectorAll('[data-testid="save-slot-grid"]').length,
        inert:snapshot.inert,hidden:snapshot.getAttribute("aria-hidden")};
    };
    return <UISkinProvider><RenpyMenuFrame activeScreen="save_load" managedOutlet contentBlocked={blocked}>
      <div className="save-page-viewport"><div data-save-page-layer="manual:0">
        <div data-testid="save-slot-grid"><button data-testid="focused-paginator">下一页</button></div>
      </div></div>
    </RenpyMenuFrame></UISkinProvider>;
  }
  createRoot(document.querySelector("#fixture")).render(<Fixture/>);
`},bundle:true,platform:"browser",format:"iife",write:false,jsx:"automatic",loader:{".css":"empty"},
nodePaths:[path.join(root,"GameCli_framework/node_modules")],define:{"process.env.NODE_ENV":'"production"'}
}).outputFiles[0].text;
const report={status:"RUNNING",scope:"ACTUAL_COMPONENT_CONTROLLED_LOADING_NOT_FULL_RUNTIME_OR_NATIVE",
  cases:[],sources:sourcePaths.map(file=>({path:path.join(root,file),sha256:sha(path.join(root,file))})),modelRequests:0};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);
let browser,server;
(async()=>{
  // Full Runtime dependencies read localStorage. Use a real owned HTTP origin
  // rather than opaque about:blank, and keep that setup failure separate.
  server=http.createServer((request,response)=>{
    response.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});
    response.end(`<style>${css}#fixture{position:fixed;inset:0}</style><div id="fixture"></div>`);
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  report.server={pid:process.pid,port:server.address().port};
  browser=await chromium.launch({args:["--use-angle=d3d11","--enable-gpu"]});
  for(const reduced of [false,true]){
    const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:reduced?"reduce":"no-preference"});
    const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(String(e)));
    try{
      await page.goto(`http://127.0.0.1:${report.server.port}/`);
      await page.addScriptTag({content:compiled});
      await page.getByTestId("focused-paginator").waitFor();
      for(const label of ["blocked-outlet-focus","snapshot-markers"]){
        const row={label,reduced,status:"RUNNING"};report.cases.push(row);
        try{
          if(label==="blocked-outlet-focus"){
            await page.getByTestId("focused-paginator").focus();
            await page.evaluate(()=>window.__setBlocked(true));
            row.actual=await page.evaluate(()=>({focus:document.activeElement?.getAttribute("data-testid"),
              unavailable:!!document.activeElement?.closest("[inert],[aria-hidden='true']"),
              blocked:document.querySelector('[data-testid="renpy-menu-content"]').inert}));
            assert(row.actual.blocked);assert(!row.actual.unavailable,
              "Loading must move focused paginator onto the still-available menu rail before paint");
            assert.match(row.actual.focus,/^renpy-menu-/);
          }else{
            await page.evaluate(()=>window.__setBlocked(false));
            row.actual=await page.evaluate(()=>window.__captureSavePage());
            assert.deepEqual(row.actual,{markers:0,grids:0,inert:true,hidden:"true"},
              "An outer page snapshot must not retain functional save-page markers");
          }
          row.status="PASS";
        }catch(error){row.status="FAILED";row.error=String(error.stack||error);}
        save();
      }
      assert.deepEqual(errors,[]);
    }finally{report.pageErrors??=[];report.pageErrors.push(...errors);await context.close();}
  }
  assert.equal(report.cases.length,4);assert(report.cases.every(c=>c.status==="PASS"));
  for(const file of report.sources)assert.equal(sha(file.path),file.sha256);
  report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(async()=>{await browser?.close();if(server){await new Promise(resolve=>server.close(resolve));report.server.closed=true;}
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,out,cases:report.cases.map(c=>({label:c.label,reduced:c.reduced,status:c.status,actual:c.actual})),error:report.error}));});
