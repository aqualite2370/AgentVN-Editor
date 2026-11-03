"use strict";
// Real App bootstrap, Runtime modal and navigation. Only native I/O is controlled.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require("../editor/node_modules/playwright");
const {buildSync}=require("../editor/node_modules/esbuild");
const {startOwnedViteServer}=require("./lib/owned-vite-server.cjs");
const {settleRuntime}=require("./lib/installed-acceptance.cjs");
const root=path.resolve(__dirname,".."),out=process.argv[2];
assert(out&&!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const report={status:"RUNNING",scope:"REAL_APP_BOOT_AND_MODAL_CONTROLLED_NATIVE_IO",cases:[],errors:[],modelRequests:0};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const mod={exports:{}};
new Function("module","exports",buildSync({stdin:{resolveDir:root,loader:"ts",contents:
  'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";'},
  bundle:true,platform:"node",format:"cjs",write:false}).outputFiles[0].text)(mod,mod.exports);
let server,browser,page;
(async()=>{
  server=await startOwnedViteServer({root:path.join(root,"GameCli_framework"),
    configFile:path.join(root,"GameCli_framework/vite.config.cjs"),port:0,logFile:path.join(out,"vite.log")});
  report.server={url:server.url,pid:server.pid,runId:server.runId};
  browser=await chromium.launch();
  for(const layout of ["agentvn","renpy"])for(const reduced of [false,true]){
    await server.assertAlive();
    const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,
      reducedMotion:reduced?"reduce":"no-preference"});
    page=await context.newPage();page.on("pageerror",e=>report.errors.push(String(e)));
    const row={layout,reduced,status:"RUNNING"};report.cases.push(row);save();
    const uiSkin=layout==="renpy"?mod.exports.createRenpyUILayout():mod.exports.getDefaultUISkinLayout();
    await page.addInitScript(({uiSkin})=>{
      const manifest={game_id:"boot-claim-test",title:"启动后存档归属确认",version:"1.0.0",assets:[],
        entry_scene_id:"main",runtime_version:"0.7.0"};
      const script={schema_version:"1.1.0",game_id:manifest.game_id,entry_scene_id:"main",characters:[],
        scenes:[{scene_id:"main",title:"Main",commands:[{type:"narration",text:"启动功能回归"}]}]};
      window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:"main"},currentWebview:{label:"main"}},
        transformCallback:()=>0,invoke:async(command)=>{
          if(command==="load_embedded_game")return{manifest,script,uiSkin,assetUrls:{},uiAssetUrls:{},
            gallery:{gallery_version:"1.0.0",items:[]},checksum:{algorithm:"sha256",files:[]}};
          if(command==="get_save_storage_info")return{portable:true,sourceDirectory:"C:\\隔离旧档",
            targetDirectory:"F:\\隔离游戏\\saves",availableFiles:[],conflictFiles:[],skippedFiles:[],copiedFiles:[],
            unverifiedFiles:[{fileName:"slot-01.json",sourceSha256:"a".repeat(64),slot:1,saveKind:"manual",
              sceneId:"main",summary:"测试旧档",conflict:false}]};
          if(command==="list_saves"||command==="list_gallery_unlocks")return[];
          return null;
        }};
    },{uiSkin});
    await page.goto(server.url+"/?mode=fixed");
    const dialog=page.getByRole("dialog",{name:"复制旧存档到游戏目录？",exact:true});
    await dialog.waitFor();await settleRuntime(page);
    await dialog.getByRole("button",{name:"暂不迁移",exact:true}).click();
    await dialog.waitFor({state:"detached"});await settleRuntime(page);
    row.after=await page.getByTestId("open-save-load").evaluate(button=>{
      const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return{bootBlocking:document.querySelector(".runtime-boot-content")?.hasAttribute("data-runtime-boot-blocking"),
        inertAncestor:button.closest("[inert]")?.className||null,hit:hit===button||button.contains(hit)};
    });save();
    assert.equal(row.after.bootBlocking,false);assert.equal(row.after.inertAncestor,null);
    assert.equal(row.after.hit,true);
    await page.getByTestId("open-save-load").click();
    await page.getByTestId("save-storage-open").waitFor();await settleRuntime(page);
    await page.getByTestId("save-storage-open").click();await dialog.waitFor();
    await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});
    assert(await page.getByTestId("save-storage-open").evaluate(b=>document.activeElement===b));
    await page.screenshot({path:path.join(out,`${layout}-${reduced}.png`)});
    row.status="PASS";save();await context.close();
  }
  assert.equal(report.cases.length,4);assert.deepEqual(report.errors,[]);report.status="PASS";
})().catch(async e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;
  if(report.cases.at(-1)?.status==="RUNNING")report.cases.at(-1).status="FAILED";
  await page?.screenshot({path:path.join(out,"failure.png")}).catch(()=>{});})
.finally(async()=>{
  const errors=[];try{await browser?.close();}catch(e){errors.push(String(e));}
  try{await server?.stop();}catch(e){errors.push(String(e));}
  report.cleanup=errors.length?"FAILED":"PASS";
  if(errors.length){report.cleanupErrors=errors;report.status="FAILED";process.exitCode=1;}
  save();console.log(JSON.stringify({status:report.status,cases:report.cases.length,error:report.error,out}));
});
