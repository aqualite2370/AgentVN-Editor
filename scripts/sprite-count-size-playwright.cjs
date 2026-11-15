"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out), "Use a new evidence directory");
fs.mkdirSync(out, {recursive:true});
const report = {scope:"REAL_SPRITE_LAYER_AND_CSS_CONTROLLED_ASSETS_NOT_INSTALLED",status:"RUNNING",cases:[],errors:[]};
let server, browser;
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
(async()=>{
  server=await startOwnedViteServer({root:path.resolve(__dirname,"../GameCli_framework"),logFile:path.join(out,"vite.log")});
  report.service={url:server.url,pid:server.pid,runId:server.runId};
  browser=await chromium.launch({headless:true});
  const full=process.argv.includes("--matrix");
  const sizes=full?[[1920,1080],[2560,1440],[3840,2160]]:[[1920,1080]];
  for(const [width,height] of sizes) for(const dpr of full?[1,2]:[1]) for(const reduced of full?[false,true]:[false]){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:reduced?"reduce":"no-preference"});
    const page=await context.newPage();page.on("pageerror",e=>report.errors.push(String(e)));
    await page.route("**/__sprite-size",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{position:relative}</style></head><body><div id="root"></div><script type="module" src="/@vite/client"></script></body></html>'}));
    const row={width,height,dpr,reduced,status:"RUNNING",counts:[]};report.cases.push(row);save();
    try{
      await page.goto(new URL("/__sprite-size",server.url).href);
      await page.evaluate(async()=>{
        const { default: RefreshRuntime } = await import("/@react-refresh");
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$=()=>{};
        window.$RefreshSig$=()=>type=>type;
        window.__vite_plugin_react_preamble_installed__=true;
        // Resolve the same prebundled React instance as the product component.
        const text=await(await fetch("/src/components/player/SpriteLayer.tsx")).text();
        const reactURL=text.match(/from\s+["']([^"']*\/react\.js[^"']*)["']/)?.[1];
        if(!reactURL)throw Error("Product React module URL not found");
        const [{default:React},dom,{SpriteLayer},{assetResolver}]=await Promise.all([
          import(reactURL),import(reactURL.replace(/react\.js/,"react-dom_client.js")),
          import("/src/components/player/SpriteLayer.tsx"),import("/src/engine/assetResolver.ts"),import("/src/styles/player.css")]);
        const svg=(w,h)=>"data:image/svg+xml;base64,"+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#468"/></svg>`);
        assetResolver.resolveSprite=id=>id==="wide"?svg(900,600):svg(420,1100);
        document.getElementById("root").style.setProperty("--runtime-ui-scale",String(innerWidth/1920));
        const root=(dom.createRoot ?? dom.default.createRoot)(document.getElementById("root"));
        window.setSpriteCount=(count,scale=0.85)=>{
          const sprites=Object.fromEntries(Array.from({length:count},(_,i)=>["c"+i,{
            character_id:"c"+i,sprite_id:i===0?"wide":"portrait",position:i===0?"left":i===count-1?"right":"center",
            visible:true,scale:i===0?scale:1.15,offset_x:i===0?2:0,offset_y:0,layer:i}]));
          root.render(React.createElement(SpriteLayer,{sprites,spriteOrder:Object.keys(sprites),presentationMode:"settle"}));
        };
      });
      let baseline;
      for(const count of [1,2,5,1]){
        await page.evaluate(c=>window.setSpriteCount(c),count);
        await page.waitForFunction(c=>document.querySelectorAll(".sprite-slot:not(.is-exiting)").length===c,count);
        await page.locator('.sprite-slot[data-character-id="c0"] img').waitFor();
        await page.waitForFunction(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0));
        const geometry=await page.evaluate(async()=>{
          await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
          const img=document.querySelector('.sprite-slot[data-character-id="c0"]:not(.is-exiting) img');
          const r=img.getBoundingClientRect(),slot=img.closest(".sprite-slot").getBoundingClientRect();
          return {width:r.width,height:r.height,slotWidth:slot.width,scale:img.closest("[data-sprite-scale]").dataset.spriteScale,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};
        });
        row.counts.push({count,...geometry});
        if(!baseline)baseline=geometry;
        assert(Math.abs(geometry.width-baseline.width)<0.5&&Math.abs(geometry.height-baseline.height)<0.5,`count=${count} resized author sprite ${JSON.stringify(geometry)} vs ${JSON.stringify(baseline)}`);
        assert.equal(geometry.scale,"0.85");
      }
      // Explicit author edits still resize; simultaneous sprites keep distinct scales.
      await page.waitForFunction(()=>!document.querySelector(".sprite-slot.is-exiting"));
      await page.evaluate(()=>window.setSpriteCount(2,1.1));
      await page.waitForFunction(()=>document.querySelector('.sprite-slot[data-character-id="c0"] [data-sprite-scale]')?.dataset.spriteScale==="1.1");
      await page.waitForFunction(()=>document.querySelectorAll(".sprite-slot:not(.is-exiting)").length===2);
      const explicit=await page.locator('.sprite-slot[data-character-id="c0"]:not(.is-exiting) img').evaluate(img=>img.getBoundingClientRect().width);
      assert(Math.abs(explicit/baseline.width-1.1/0.85)<0.01);
      const leavingImage=await page.locator('.sprite-slot[data-character-id="c1"]:not(.is-exiting) img').elementHandle();
      const leaving=await leavingImage.evaluate(img=>img.getBoundingClientRect().width);
      await page.evaluate(()=>window.setSpriteCount(1,1.1));
      await page.waitForFunction(()=>document.querySelector('.sprite-slot[data-character-id="c1"].is-exiting'));
      const exitWidth=await leavingImage.evaluate(img=>img.getBoundingClientRect().width);
      assert(Math.abs(exitWidth-leaving)<0.5,`exit resized ${leaving} -> ${exitWidth}`);
      row.authorScaleAndExit="PASS";row.status="PASS";
    }catch(e){row.status="FAILED";row.error=e.stack;await page.screenshot({path:path.join(out,`${width}-${dpr}-${reduced}-failed.png`)});}
    await context.close();save();
  }
  report.status=report.cases.length&&report.cases.every(c=>c.status==="PASS")&&!report.errors.length?"PASS":"FAILED";
})().catch(e=>{report.status="FAILED";report.error=e.stack;}).finally(async()=>{
  await browser?.close();await server?.stop();report.cleanup="OWNED_BROWSER_AND_VITE_STOPPED";save();console.log(JSON.stringify({status:report.status,cases:report.cases.map(({width,height,dpr,reduced,status,error})=>({width,height,dpr,reduced,status,error})),out}));if(report.status!=="PASS")process.exitCode=1;
});
