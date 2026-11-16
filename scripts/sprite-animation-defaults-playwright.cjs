"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Sprite-Animation-Defaults-"));
assert(!fs.existsSync(out)); fs.mkdirSync(out, {recursive:true});
const input = path.join(out,"fixture.vnproj"), project = fixture(`sprite-defaults-${Date.now()}`);
project.nodes[1].data.scene.commands.push(
  {type:"sprite",character_id:"alice",sprite_id:"",visible:true,animation_config:{kind:"fade",phase:"enter",duration_ms:520}},
  {type:"sprite",character_id:"alice",sprite_id:"",visible:false,animation_config:{kind:"fade",phase:"exit",duration_ms:420}},
  {type:"sprite",character_id:"bob",sprite_id:"",visible:true,animation_config:{kind:"preset",phase:"emphasis",preset_id:"sprite_shake",duration_ms:420}},
);
fs.writeFileSync(input,JSON.stringify(project));
process.env.AGENTVN_TEST_PROJECT=input; process.env.AGENTVN_WORKSPACE_OUTPUT=path.join(out,"services");
const report={status:"RUNNING",scope:"SOURCE_BROWSER_ISOLATED_REAL_BACKEND_NOT_INSTALLED",cases:[],errors:[]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
let env,browser;
async function idle(page){await page.waitForFunction(()=>document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle"));}
async function animation(page){
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.animation"]:visible').click();await idle(page);
  await page.locator('.advanced-tab-content.is-active[data-tab="animation"]:not([inert]) .animation-editor-shell').waitFor();
}
async function hit(locator){assert(await locator.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.y>=0&&r.bottom<=innerHeight+1&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),"Save/action control obscured");}
(async()=>{
 try{
  env=await startEditorAcceptance(undefined,{isolateBackendWorkingDirectory:true});
  report.service={url:env.url,pid:env.server.pid,backendPid:env.backendPid};save();
  const temp=path.join(out,"temp");fs.mkdirSync(temp);
  browser=await chromium.launch({headless:true,env:{...process.env,TEMP:temp,TMP:temp}});
  const matrix=process.argv.includes("--matrix")?[[1920,1080],[2560,1440],[3840,2160]].flatMap(([w,h])=>[1,2].flatMap(dpr=>[false,true].map(reduced=>({w,h,dpr,reduced})))):[{w:1920,h:1080,dpr:1,reduced:false}];
  for(const m of matrix){
   const row={...m,status:"RUNNING"};report.cases.push(row);save();
   const page=await browser.newPage({viewport:{width:m.w,height:m.h},deviceScaleFactor:m.dpr,reducedMotion:m.reduced?"reduce":"no-preference"});
   page.on("pageerror",e=>report.errors.push(String(e)));
   try{
    await env.open(page);await animation(page);
    const button=page.getByRole("button",{name:"保存全局入场",exact:true});
    await button.waitFor({timeout:8000});await hit(button);
    // Save entry and exit independently; scope confirmation must be cancellable.
    await button.click();
    const dialog=page.getByTestId("sprite-animation-default-confirmation");await dialog.waitFor();
    if(process.argv.includes("--dialog-help-check")){
      const cancel=dialog.getByRole("button",{name:"取消",exact:true});
      await cancel.focus();await cancel.hover();await page.waitForTimeout(280);
      await page.screenshot({path:path.join(out,"global-confirmation-visual.png"),scale:"device"});
      assert.equal(await page.locator(".hover-help-card").count(),0,"Generic help must not obscure confirmation actions");
      for(const action of await dialog.getByRole("button").all()){
        await action.focus();await action.hover();await page.waitForTimeout(240);
        await hit(action);assert.equal(await page.locator(".hover-help-card").count(),0);
      }
      await cancel.click();await dialog.waitFor({state:"detached"});
      assert.equal(await page.evaluate(()=>window.__AGENTVN_PROJECT_STORE__.getState().settings.spriteAnimationDefaults?.enter),undefined);
      row.confirmationActionsUnobscured=true;row.cancelPreservesSettings=true;row.status="PASS";continue;
    }
    await dialog.getByRole("button",{name:"取消",exact:true}).click();
    await dialog.waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>window.__AGENTVN_PROJECT_STORE__.getState().settings.spriteAnimationDefaults?.enter),undefined);
    await button.click();await dialog.getByRole("button",{name:"确认应用",exact:true}).click();
    await page.getByRole("status").filter({hasText:"全局入场已保存"}).waitFor();
    const entry=await page.evaluate(()=>window.__AGENTVN_PROJECT_STORE__.getState().settings.spriteAnimationDefaults.enter);
    assert.equal(entry.phase,"enter");assert.equal(entry.duration_ms,500);
    await page.getByRole("tab",{name:/立绘退场/}).click();
    await page.locator('.animation-template-popover [aria-label="关闭动画模板选择"]').click();
    const exit=page.getByRole("button",{name:"保存全局退场",exact:true});await exit.waitFor();await hit(exit);
    await exit.click();await dialog.getByRole("button",{name:"确认应用",exact:true}).click();
    await page.getByRole("status").filter({hasText:"全局退场已保存"}).waitFor();
    const graph=await page.evaluate(()=>window.__AGENTVN_EDITOR_STORE__.getState().nodes.find(n=>n.id==="scene").data.scene.commands);
    assert.equal(graph[1].animation_source,"project");assert.equal(graph[2].animation_source,"project");
    assert.equal(graph[3].animation_config.phase,"emphasis");
    row.entryExitIndependent=true;row.confirmCancel=true;row.emphasisPreserved=true;
    const response=await fetch(`${env.backendUrl}/api/project/state`);const stored=(await response.json()).data;
    assert.deepEqual(stored.project_metadata.settings.spriteAnimationDefaults.enter,entry);
    // A real reload reopens backend data; do not reimport fixture over saved state.
    await page.reload({waitUntil:"domcontentloaded"});
    const continueButton=page.getByRole("button",{name:"继续上次编辑",exact:true});
    await continueButton.waitFor();await continueButton.click();
    await page.locator('.editor-toolbar').waitFor();await animation(page);
    assert.deepEqual(await page.evaluate(()=>window.__AGENTVN_PROJECT_STORE__.getState().settings.spriteAnimationDefaults.enter),entry);
    row.persistedAndReopened=true;
    // Header save remains reachable while keyframes are at the bottom.
    const active=page.locator('.advanced-tab-content.is-active[data-tab="animation"]:not([inert])');
    const advanced=active.locator('.animation-advanced-panel summary');await advanced.scrollIntoViewIfNeeded();await advanced.click();
    await active.locator('.animation-advanced-fields').scrollIntoViewIfNeeded();await hit(page.getByRole("button",{name:"保存全局入场",exact:true}));
    if(m.w===1920&&m.dpr===1&&!m.reduced){
      // Controlled transport failure, real save API/retry and persisted readback.
      const scroll=active.locator('.advanced-tab-scroll');await scroll.evaluate(el=>el.scrollTop=0);
      const apply=page.getByRole("checkbox",{name:"同步应用到现有入场事件",exact:true});await apply.uncheck();
      const duration=active.getByRole("slider",{name:"动画参数 duration_ms",exact:true});await duration.focus();await duration.press("End");
      let fail=true;const handler=async route=>{
        if(route.request().method()==="POST"&&fail) return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"QA_GLOBAL_SAVE_DENIED"})});
        return route.continue();
      };
      await page.route("**/api/project/state",handler);
      await button.click();await page.getByRole("status").filter({hasText:"保存失败"}).waitFor();
      assert.equal(await duration.inputValue(),"1400");
      fail=false;await button.click();await page.getByRole("status").filter({hasText:"全局入场已保存"}).waitFor();
      await page.unroute("**/api/project/state",handler);
      const saved=(await(await fetch(`${env.backendUrl}/api/project/state`)).json()).data.project_metadata.settings.spriteAnimationDefaults;
      assert.equal(saved.enter.duration_ms,1400);assert.equal(saved.exit.phase,"exit");row.failedSaveRetainsDraftAndRetries=true;
      // Use the same exported graph/settings path as Preview/Cartridge; no fixture rewrite.
      row.exported=await page.evaluate(async()=>{
        const {applyProjectRuntimeSettingsToScript}=await import('/src/utils/exportScript.ts');
        const script=applyProjectRuntimeSettingsToScript(window.__AGENTVN_EDITOR_STORE__.getState().exportScript(),window.__AGENTVN_PROJECT_STORE__.getState().settings);
        const commands=script.scenes.flatMap(s=>s.commands).filter(c=>c.type==='sprite');
        return {entry:commands[0].animation_config,exit:commands[1].animation_config,emphasis:commands[2].animation_config,editorLeak:JSON.stringify(script).includes('animation_source')};
      });
      assert.equal(row.exported.entry.duration_ms,1400);assert.equal(row.exported.exit.phase,"exit");assert.equal(row.exported.emphasis.phase,"emphasis");assert.equal(row.exported.editorLeak,false);
    }
    const parameters=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches,overflow:document.documentElement.scrollWidth>innerWidth+1}));
    assert.deepEqual(parameters,{width:m.w,height:m.h,dpr:m.dpr,reduced:m.reduced,overflow:false});
    row.parameters=parameters;row.status="PASS";
    if(m.w===1920&&m.dpr===1&&!m.reduced)await page.screenshot({path:path.join(out,"global-animation-settings.png"),scale:"device"});
   }catch(e){row.status="FAILED";row.error=e.stack;await page.screenshot({path:path.join(out,"failure.png")});throw e;}
   finally{await page.close();save();}
  }
  assert.equal(report.errors.length,0);report.status="PASS";
 }catch(e){report.status="FAILED";report.error=e.stack;process.exitCode=1;}
 finally{await browser?.close();await env?.stop();report.cleanup="OWNED_BROWSER_BACKEND_AND_VITE_STOPPED";save();console.log(JSON.stringify(report));}
})();
