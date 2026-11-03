"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { captureBrowserViewport } = require("./lib/browser-viewport-capture.cjs");
const root = path.resolve(__dirname, ".."), name = process.argv[2];
assert(/^(red|green|matrix|safety)-\d{2}$/.test(name || ""), "Explicit fresh attempt required");
const out = path.join("F:/AgentVN/QA/Runtime-Screen-Polish-20261022-01", name);
assert(!fs.existsSync(out), "Preserve old evidence");
fs.mkdirSync(out, { recursive: true });
const executed = path.join(out, "executed.cjs"); fs.copyFileSync(__filename, executed, fs.constants.COPYFILE_EXCL);
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceFiles=["GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
  "GameCli_framework/src/components/shell/SavePageTransition.tsx","GameCli_framework/src/components/shell/AboutScreen.tsx",
  "GameCli_framework/src/components/shell/HistoryScreen.tsx","GameCli_framework/src/components/shell/HelpScreen.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx","GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/player/StoryPlayer.tsx","GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/components/shell/renpy-menu.css"];
const report = { status: "RUNNING", scope: "SOURCE_RUNTIME_REAL_BROWSER_NOT_INSTALLED_OR_DEVICE",
  at: new Date().toISOString(), controlled: ["live-preview fixture", "fixed mode for real browser save persistence",
    "public flushAutoSave call", "Storage.setItem failure for saves only"], cases: [], screenshots: [], contexts: [],
  executedSha256: sha(executed),sources:sourceFiles.filter(file=>fs.existsSync(path.join(root,file)))
    .map(file=>({file,sha256:sha(path.join(root,file))})) };
const bundle = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(bundle, bundle.exports);
const full = process.argv.includes("--matrix");
const supplement = process.argv.includes("--motion-supplement");
const gridFit = process.argv.includes("--grid-fit");
const twoColumns = process.argv.includes("--two-columns");
assert(!twoColumns||gridFit,"Authored-column check belongs to the grid-fit flow");
const matrix = full ? [1, 2].flatMap(dpr => [false, true].flatMap(reduced =>
  [[1920,1080],[2560,1440],[3840,2160]].map(([width,height]) => ({width,height,dpr,reduced}))))
  : [{width:1920,height:1080,dpr:1,reduced:false}];
const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser, server;
async function idle(page, target) {
  await page.waitForFunction(target => {
    const root=document.querySelector("[data-runtime-screen-transition]");
    return root?.getAttribute("data-runtime-screen-transition") === "idle"
      && (!target || root.getAttribute("data-runtime-presented-screen")===target)
      && !document.querySelector(".game-launch-blackout");
  },target);
}
async function check(label, params, fn) {
  const row = { label, ...params, status: "RUNNING" }; report.cases.push(row);
  try { row.evidence = await fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack); }
  persist();
}
async function init(page, type) {
  await page.goto(`${server.url}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
  const layout = type === "renpy" ? bundle.exports.createRenpyUILayout() : bundle.exports.getDefaultUISkinLayout();
  if(twoColumns){
    const grid=layout.screens.find(screen=>screen.screen_id==="save_load").components.find(c=>c.component_type==="save_slot_grid");
    grid.style={...grid.style,columns:2};
  }
  await page.evaluate(({layout,type}) => window.postMessage({
    type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "screen-polish",
    revision: 1, requestId: "screen-polish", runId: "screen-polish", screen: "title_menu", uiSkin: layout,
    manifest: { manifest_version:"1.0.0", cartridge_version:"1.0.0", runtime_version:"0.25.0",
      game_id:`screen-polish-${type}`, title:"客户端页面验收", author:"QA", version:"1.0.0", language:"zh-CN",
      entry_script:"script.json", entry_scene_id:"main", assets:[],
      shell: { about: { title:"关于作品", heading:"临时小工程", description:"统一信息容器。",
        fields:[{label:"作者",value:"QA"}], note:"测试说明" } },
      created_at:new Date().toISOString(), updated_at:new Date().toISOString() },
    script:{schema_version:"1.1.0", game_id:`screen-polish-${type}`,title:"客户端页面验收",
      entry_scene_id:"main",characters:[],scenes:[{scene_id:"main",title:"验收场景",chapter:1,tags:[],
        commands:[{type:"gallery_anchor",anchor_id:"qa-gallery",title:"验收画廊",asset_id:"qa-art"},
          ...Array.from({length:30},(_,i)=>({type:"narration",text:`第${i+1}句，临时工程页面验收。`}))]}]},
    assetUrls:{"qa-art":"data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#243746"/></svg>')},
  },"*"), {layout,type});
  await page.getByTestId("game-state-title").waitFor(); await idle(page);
  await page.evaluate(async () => {
    const {useSettingsStore} = await import("/src/store/settingsStore.ts");
    useSettingsStore.getState().updateSettings({autoSaveEnabled:true,textSpeedCps:0});
  });
}
async function back(page,type) {
  await page.getByTestId(type === "renpy" ? "renpy-menu-return" : "back-to-player").click();
  await idle(page);
}
async function frames(page, action) {
  await page.evaluate(() => {
    window.__polishFrames = []; window.__polishRecording = true;
    const tick = () => {
      if (!window.__polishRecording) return;
      const grid = document.querySelector('[data-testid="save-slot-grid"]');
      const layers = [...document.querySelectorAll("[data-save-page-layer]")].map(node => {
        const css = getComputedStyle(node);
        return { page:node.dataset.savePageLayer,opacity:Number(css.opacity),transform:css.transform,
          inert:node.inert, rect:node.getBoundingClientRect().toJSON() };
      });
      window.__polishFrames.push({at:performance.now(),layers,grid:grid?.getBoundingClientRect().toJSON(),
        viewport:document.querySelector(".save-page-viewport")?.getBoundingClientRect().toJSON(),
        screen:document.querySelector(".save-load-screen")?.getBoundingClientRect().toJSON(),
        back:(document.querySelector('[data-testid="renpy-menu-return"]')
          ??document.querySelector('[data-testid="back-to-player"]'))?.getBoundingClientRect().toJSON(),
        navigation:document.querySelector(".save-page-navigation")?.getBoundingClientRect().toJSON(),
        toolbar:document.querySelector(".save-load-toolbar")?.getBoundingClientRect().toJSON(),
        unavailableFocus:!!document.activeElement?.closest("[inert],[aria-hidden='true']"),
        slots:[...document.querySelectorAll(".save-card-main")].filter(b=>!b.closest("[inert]")).map(b=>b.getAttribute("aria-label"))});
      requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  });
  await action();
  await page.waitForFunction(() => {
    const layer = document.querySelector("[data-save-page-layer]");
    return layer && document.querySelectorAll("[data-save-page-layer]").length === 1
      && !layer.getAnimations().some(a=>a.playState==="running");
  }, null, {timeout:8000}).catch(error => { if (!name.startsWith("red")) throw error; });
  return page.evaluate(() => { window.__polishRecording=false; return window.__polishFrames; });
}
async function main() {
  server = await startOwnedViteServer({root:path.join(root,"GameCli_framework"),
    configFile:path.join(root,"GameCli_framework/vite.config.cjs"), logFile:path.join(out,"server.log")});
  report.owner = {pid:server.pid,runId:server.runId,url:server.url}; persist();
  browser = await chromium.launch({args:["--use-angle=d3d11","--enable-gpu"]});
  const browserDiagnostic = await browser.newBrowserCDPSession();
  const {gpu} = await browserDiagnostic.send("SystemInfo.getInfo");
  report.renderer={features:gpu.featureStatus,devices:gpu.devices,renderer:gpu.auxAttributes.glRenderer};
  assert.equal(gpu.featureStatus.gpu_compositing,"enabled","Explicit real GPU, no silent software fallback");
  await browserDiagnostic.detach();
  await server.run(async () => {
    for (const params of matrix) for (const type of ["agentvn","renpy"]) {
      const context = await browser.newContext({viewport:{width:params.width,height:params.height},
        deviceScaleFactor:params.dpr,reducedMotion:params.reduced?"reduce":"no-preference"});
      const page = await context.newPage(), errors=[];
      const actualViewport=()=>page.evaluate(()=>({width:innerWidth,height:innerHeight,
        dpr:devicePixelRatio,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
      const ownership={...params,type,before:await actualViewport(),closed:false};
      report.contexts.push(ownership);
      assert.deepEqual(ownership.before,params);
      const closeContext=async()=>{
        ownership.after=await actualViewport();
        assert.deepEqual(ownership.after,ownership.before,"Viewport/DPR/reduced state must remain real and stable");
        await context.close();ownership.closed=true;
      };
      page.setDefaultTimeout(20000);
      page.on("pageerror", e=>errors.push(String(e)));
      await init(page,type);
      const p={...params,type};
      await page.getByTestId("open-save-load").click(); await idle(page,"save_load");
      if(gridFit){
        const cdp=await context.newCDPSession(page);
        const geometry=async state=>{
          await check(`six-slots-${state}-fit-and-hit`,p,async()=>{
            const g=await page.getByTestId("save-slot-grid").evaluate(grid=>{
              const rect=n=>n.getBoundingClientRect().toJSON();
              const hit=n=>{const r=rect(n);return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));};
              return {grid:rect(grid),clientHeight:grid.clientHeight,scrollHeight:grid.scrollHeight,
                cards:[...grid.querySelectorAll(".save-slot")].map(card=>({
                  rect:rect(card),button:rect(card.querySelector(".save-card-main")),
                  copy:rect(card.querySelector(".save-card-copy")),
                  text:[...card.querySelectorAll(".save-card-copy strong,.save-card-copy>span,.save-card-copy small")].map(rect),
                  populated:card.classList.contains("has-save"),hit:hit(card.querySelector(".save-card-main")),
                  preview:rect(card.querySelector(".save-preview-frame")),
                  image:(()=>{const image=card.querySelector(".save-preview-frame img");return image
                    ?{rect:rect(image),fit:getComputedStyle(image).objectFit,
                      complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight}:null;})(),
                })),overflow:document.documentElement.scrollWidth-innerWidth};
            });
            // Store geometry before asserting, including the exact failure.
            const shot=await captureBrowserViewport(page,cdp,path.join(out,
              `grid-${state}-${type}-${params.width}-${params.dpr}-${params.reduced}.png`),params);
            report.screenshots.push(shot);
            const current=report.cases.at(-1);current.geometry=g;persist();
            assert.equal(g.cards.length,6);
            assert(g.scrollHeight<=g.clientHeight+1,`Six-slot default grid must fit without vertical scrolling: ${g.scrollHeight}/${g.clientHeight}`);
            assert(g.cards.every(card=>card.hit&&card.preview.height>0
              && [card.rect,card.button,card.copy,...card.text].every(r=>
                r.top>=g.grid.top-1&&r.bottom<=g.grid.bottom+1
                &&r.left>=g.grid.left-1&&r.right<=g.grid.right+1)
              && [card.preview,card.copy,...card.text].every(r=>
                r.top>=card.rect.top-1&&r.bottom<=card.rect.bottom+1
                &&r.left>=card.rect.left-1&&r.right<=card.rect.right+1)),
            "All six slots, titles and metadata must stay inside the visible grid and have real hit targets");
            assert.equal(g.overflow,0);
            assert(g.cards.every(card=>card.populated===(state==="populated")));
            if(state==="populated")assert(g.cards.every(card=>card.image?.complete&&card.image.naturalWidth>0
              &&card.image.fit==="contain"&&card.image.rect.top>=card.preview.top-1
              &&card.image.rect.bottom<=card.preview.bottom+1&&card.image.rect.left>=card.preview.left-1
              &&card.image.rect.right<=card.preview.right+1),
            "Saved preview image elements must fit completely within their frames, without intrinsic-track clipping");
            return g;
          });
        };
        await geometry("empty");
        await back(page,type);await idle(page,"title_menu");
        // Explicit controlled browser storage mode; save operations below use
        // actual player UI and storage, not injected save rows.
        await page.evaluate(async()=>{
          const {useRuntimeStore}=await import("/src/store/runtimeStore.ts");useRuntimeStore.getState().setRuntimeMode("fixed");
        });
        await idle(page,"title_menu");
        await page.getByTestId("start-new-game").click();await idle(page,"playing");
        await page.keyboard.press("Escape");await idle(page,"main_menu");
        await page.getByTestId("open-save-load").click();await idle(page,"save_load");
        await page.locator(".save-mode-switch").getByRole("button",{name:"保存",exact:true}).click();
        for(let slot=1;slot<=6;slot++){
          await page.getByTestId(`save-slot-manual-${slot}`).getByRole("button",{name:`保存到手动存档 ${slot}`,exact:true}).click();
          await page.waitForFunction(slot=>document.querySelector(`[data-testid="save-slot-manual-${slot}"]`)?.classList.contains("has-save"),slot);
        }
        await geometry("populated");
        assert.deepEqual(errors,[]);await cdp.detach();await closeContext();persist();
        console.log(`CHECKED six-slot grid ${type} ${params.width} DPR${params.dpr} ${params.reduced?"reduced":"normal"}`);
        continue;
      }
      await check("bottom-corner-pagination-and-back",p,async()=>{
        const g = await page.locator(".save-load-screen").evaluate(screen=>{
          const rect=n=>n.getBoundingClientRect().toJSON();
          const nav=screen.querySelector(".save-page-navigation"), grid=screen.querySelector('[data-testid="save-slot-grid"]');
          const prev=screen.querySelector('[data-testid="save-page-previous"]'), next=screen.querySelector('[data-testid="save-page-next"]');
          const back=document.querySelector('[data-testid="renpy-menu-return"]')??screen.querySelector('[data-testid="back-to-player"]');
          const hit=n=>{const r=rect(n);return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));};
          return {screen:rect(screen),nav:rect(nav),grid:rect(grid),prev:rect(prev),next:rect(next),back:rect(back),
            backHit:hit(back),nextHit:hit(next),overflow:document.documentElement.scrollWidth-innerWidth};
        });
        assert(g.nav.top>=g.grid.bottom-1,"Pagination must be below save grid");
        assert(Math.abs(g.prev.left-g.grid.left)<28 && Math.abs(g.next.right-g.grid.right)<28,"Pagination must occupy bottom left/right corners");
        assert(g.back.top < params.height*.16 && g.back.left < params.width*.2,"Return must be upper left");
        assert(g.backHit&&g.nextHit&&g.overflow<=1,`Return/pagination must remain reachable without overflow: ${JSON.stringify(g)}`);
        return g;
      });
      await check("page-slide-and-interrupt",p,async()=>{
        const sampled=await frames(page,()=>page.getByTestId("save-page-next").click());
        const moving=sampled.filter(f=>f.layers.some(l=>l.transform!=="none"&&l.opacity>.05&&l.opacity<.95));
        assert(moving.length>=2,"Save page flip must expose continuous translated intermediate frames");
        assert(sampled.every(f=>f.layers.length && f.layers.filter(l=>!l.inert).length===1),"Exactly one interactive page throughout pagination");
        assert(sampled.every(f=>!f.unavailableFocus),"Pagination focus cannot remain in an unavailable layer");
        await page.getByTestId("save-slot-manual-7").waitFor();
        assert(await page.getByTestId("save-page-previous").evaluate(n=>n===document.activeElement),
          "At the last page pagination focus must move to the enabled return action");
        const reversed=await frames(page,async()=>{
          await page.getByTestId("save-page-previous").click();
          await page.waitForFunction(()=>[...document.querySelectorAll("[data-save-page-layer]")].some(n=>{
            const a=Number(getComputedStyle(n).opacity);return a>.1&&a<.9;
          }));
          await page.getByTestId("save-page-next").click();
        });
        assert(reversed.every(f=>!f.unavailableFocus),"Rapid reversal must retain an available focus owner");
        await page.getByTestId("save-slot-manual-7").waitFor();
        assert.equal(await page.locator("[data-save-page-layer]").count(),1);
        let keyboard;
        if(supplement){
          await page.getByTestId("save-page-previous").focus();
          keyboard=await frames(page,()=>page.keyboard.press("Enter"));
          await page.getByTestId("save-slot-manual-1").waitFor();
          assert(keyboard.filter(f=>f.layers.some(l=>l.opacity>.05&&l.opacity<.95&&l.transform!=="none")).length>=2,
            "Keyboard must retain translated intermediate frames");
          assert(keyboard.every(f=>!f.unavailableFocus),"Keyboard pagination must retain an available focus owner");
          // The grid deliberately translates. Its viewport and surrounding
          // controls, rather than the moving grid, must keep stable geometry.
          for(const samples of [sampled,keyboard]) for(const field of ["viewport","screen","back","navigation","toolbar"]){
            const first=samples.find(frame=>frame[field])?.[field];assert(first);
            for(const frame of samples) for(const key of ["x","y","width","height"])
              assert(Math.abs(frame[field][key]-first[key])<=.25,`${field} moved during save pagination`);
          }
          await page.getByTestId("save-page-next").click();
          await page.waitForFunction(()=>document.querySelectorAll("[data-save-page-layer]").length===2);
          await page.keyboard.press("Escape");await idle(page,"title_menu");
          assert.equal(await page.locator("[data-save-page-layer]").count(),0,"Leaving during flip must remove all page layers");
        }
        return {frames:sampled,movingFrames:moving.length,keyboard,unmountDuringFlip:supplement};
      });
      if(supplement){
        assert.deepEqual(errors,[]);await closeContext();persist();
        console.log(`CHECKED pagination safety ${type} ${params.width} DPR${params.dpr} ${params.reduced?"reduced":"normal"}`);
        continue;
      }
      await check("save-copy-contrast-and-shadow",p,async()=>{
        const styles=await page.locator(".save-card-copy").first().evaluate(node=>{
          const rgb=s=>{const ctx=document.createElement("canvas").getContext("2d");ctx.fillStyle=s;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
          const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;})
            .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          let parent=node,bg;
          while(parent){const value=getComputedStyle(parent).backgroundColor;if(value!=="rgba(0, 0, 0, 0)"&&value!=="transparent"){bg=value;break;}parent=parent.parentElement;}
          return {bg,shadow:getComputedStyle(node.closest(".save-slot")).boxShadow,
            colors:[...node.querySelectorAll("strong,span,small")].map(n=>{
              const color=getComputedStyle(n).color,L=luminance(rgb(color)),B=luminance(rgb(bg));
              return {color,text:n.textContent,contrast:(Math.max(L,B)+.05)/(Math.min(L,B)+.05)};
            })};
        });
        assert(styles.colors.length>0&&styles.colors.every(c=>c.contrast>=4.5),"Save card text must have readable contrast");
        assert.equal(styles.shadow,"none","Save card decorative shadow removed");
        return styles;
      });
      // Navigation uses real existing entry/return buttons. No direct setState.
      await back(page,type);
      await page.getByTestId("open-about").click(); await idle(page,"about");
      await check("about-heading-inside-information-container",p,async()=>{
        const g=await page.getByTestId("about-screen").evaluate(screen=>{
          const card=screen.querySelector(".about-card"),title=screen.querySelector("h2");
          const rect=n=>n?.getBoundingClientRect().toJSON();
          const back=document.querySelector('[data-testid="renpy-menu-return"]')??screen.querySelector('[data-testid="back-to-main-menu"]');
          return {card:rect(card),title:rect(title),inside:!!title&&card.contains(title),back:rect(back)};
        });
        assert(g.inside,"About title must live inside the same information container");
        assert(g.title.left>=g.card.left&&g.title.right<=g.card.right&&g.title.top>=g.card.top,"About heading must not escape its container");
        assert(g.back.top<params.height*.16&&g.back.left<params.width*.2,"About return must be upper left");
        return g;
      });
      const shot=path.join(out,`${type}-${params.width}-${params.dpr}-${params.reduced}.png`);
      const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
      await page.screenshot({path:shot}); const png=fs.readFileSync(shot);
      assert.deepEqual(actual,{width:params.width,height:params.height,dpr:params.dpr,reduced:params.reduced});
      assert.equal(png.readUInt32BE(16),params.width*params.dpr);assert.equal(png.readUInt32BE(20),params.height*params.dpr);
      report.screenshots.push({path:shot,...actual});
      await page.getByTestId(type==="renpy"?"renpy-menu-return":"back-to-main-menu").click(); await idle(page);
      await page.evaluate(async()=>{
        const {useRuntimeStore}=await import("/src/store/runtimeStore.ts");useRuntimeStore.getState().setRuntimeMode("fixed");
      });
      await idle(page,"title_menu");
      await page.getByTestId("start-new-game").click(); await idle(page,"playing");
      await page.getByTestId("game-state-playing").waitFor();
      await page.evaluate(async()=>{
        window.__toastHistory=[];const observer=new MutationObserver(()=>{
          const toast=document.querySelector(".save-status-toast");if(toast)window.__toastHistory.push(toast.textContent);
        });observer.observe(document.body,{subtree:true,childList:true,characterData:true});window.__toastObserver=observer;
      });
      await check("silent-autosave-real-write",p,async()=>{
        const result=await page.evaluate(async()=>{
          const {useRuntimeStore}=await import("/src/store/runtimeStore.ts");
          const result=await useRuntimeStore.getState().flushAutoSave();await new Promise(requestAnimationFrame);
          return {result,toast:window.__toastHistory,notice:useRuntimeStore.getState().saveNotice,
        saves:useRuntimeStore.getState().saves.map(s=>({kind:s.save_kind,slot:s.slot}))};
        });
        assert.equal(result.result.status,"saved");assert(result.saves.some(s=>s.kind==="auto"),"Auto save must persist");
        assert.deepEqual(result.toast,[],"Successful automatic save must not show saving/saved popup");return result;
      });
      await check("manual-feedback-and-autosave-error",p,async()=>{
        const result=await page.evaluate(async()=>{
          const {useRuntimeStore}=await import("/src/store/runtimeStore.ts"), store=useRuntimeStore.getState();
          await store.save({kind:"manual",slot:1});await new Promise(requestAnimationFrame);
          const manual=document.querySelector(".save-status-toast")?.textContent;
          store.completeCurrentTyping();store.next();store.completeCurrentTyping();
          const original=Storage.prototype.setItem;
          Storage.prototype.setItem=function(key,value){if(key.startsWith("agentvn.gamecli.saves."))throw Error("QA save storage denied");return original.call(this,key,value);};
          let failed;try{failed=await useRuntimeStore.getState().flushAutoSave();}finally{Storage.prototype.setItem=original;}
          await new Promise(requestAnimationFrame);
          return {manual,failed,errorToast:document.querySelector(".save-status-toast")?.textContent};
        });
        assert(result.manual?.includes("存档已保存"),"Manual save feedback retained");
        assert.equal(result.failed.status,"failed");assert(result.errorToast?.includes("失败"),"Actual automatic save failure must remain visible");return result;
      });
      await check("saved-slot-consumption-and-child-page-returns",p,async()=>{
        const records=await page.evaluate(async()=>{
          const {useRuntimeStore}=await import("/src/store/runtimeStore.ts");
          return useRuntimeStore.getState().saves.map(s=>({kind:s.save_kind,slot:s.slot,command:s.command_index}));
        });
        if(type==="renpy")await page.getByTestId("renpy-quick-save-load").click();
        else {await page.getByTestId("quick-menu-toggle").click();await page.getByRole("button",{name:"打开存档读档",exact:true}).click();}
        await idle(page,"save_load");
        await page.getByRole("button",{name:"读取",exact:true}).click();
        const contrasts=await page.getByTestId("save-slot-manual-1").locator(".save-card-copy").evaluate(node=>{
          const rgb=value=>{const c=document.createElement("canvas").getContext("2d");c.fillStyle=value;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data];};
          const L=value=>rgb(value).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          const bg=L(getComputedStyle(node).backgroundColor);
          return [...node.querySelectorAll("strong,span,small")].map(n=>{const fg=L(getComputedStyle(n).color);return {text:n.textContent,ratio:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};});
        });
        assert(contrasts.length>=3&&contrasts.every(c=>c.ratio>=4.5),"Saved scene/date and title must all remain readable");
        await page.getByRole("button",{name:"读取手动存档 1",exact:true}).click();await idle(page,"playing");
        const restored=await page.evaluate(async()=>{const {useRuntimeStore}=await import("/src/store/runtimeStore.ts");return useRuntimeStore.getState().engineState.currentCommandIndex;});
        assert.equal(restored,records.find(s=>s.kind==="manual"&&s.slot===1).command);
        const navigation=[];
        for(const target of ["history","gallery",...(type==="renpy"?["help"]:[])]) {
          if(target==="history") {
            if(type==="renpy")await page.getByTestId("renpy-quick-history").click();
            else {await page.getByTestId("quick-menu-toggle").click();await page.getByRole("button",{name:"打开历史记录",exact:true}).click();}
          } else {
            await page.keyboard.press("Escape");await idle(page,"main_menu");
            await page.getByTestId(`open-${target}`).click();
          }
          await idle(page,target);
          const button=page.getByTestId(type==="renpy"?"renpy-menu-return":target==="gallery"?"back-to-main-menu":"back-to-player");
          const box=await button.boundingBox();assert(box.x<params.width*.2&&box.y<params.height*.16,`${target} return must be upper left`);
          await button.click();await idle(page,target==="history"?"playing":"main_menu");
          if(target!=="history"){await page.getByTestId("continue-game").click();await idle(page,"playing");}
          navigation.push(target);
        }
        await page.keyboard.press("Escape");await idle(page,"main_menu");await page.getByTestId("open-settings").click();await idle(page,"settings");
        const finish=page.getByTestId("settings-finish");await finish.click();await idle(page,"main_menu");
        await page.getByTestId("continue-game").click();await idle(page,"playing");
        return {records,contrasts,restored,navigation,settingsExceptionPreserved:true};
      });
      await page.evaluate(()=>window.__toastObserver?.disconnect());
      assert.deepEqual(errors,[],"No Runtime page errors");await closeContext();persist();
      console.log(`PASS/CHECKED ${type} ${params.width}x${params.height} DPR${params.dpr} ${params.reduced?"reduced":"normal"}`);
    }
  });
  assert.equal(report.cases.length,matrix.length*2*(gridFit?2:supplement?2:7),"No missing/empty test groups");
  for(const source of report.sources)assert.equal(sha(path.join(root,source.file)),source.sha256,"Product changed during matrix");
  report.status=report.cases.every(c=>c.status==="PASS")?"PASS":"FAILED";
}
main().catch(error=>{report.status="FAILED";report.error=String(error.stack);}).finally(async()=>{
  await browser?.close();await server?.stop();
  report.cleanup={status:"PASS",ownedServerStopped:true};
  report.finishedAt=new Date().toISOString();persist();
  console.log(JSON.stringify({status:report.status,out,cases:report.cases.length,failed:report.cases.filter(c=>c.status==="FAILED").map(c=>[c.type,c.label,c.error?.split("\n")[0]]),error:report.error}));
  if(report.status!=="PASS")process.exitCode=1;
});
