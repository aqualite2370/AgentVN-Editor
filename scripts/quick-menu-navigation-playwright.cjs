const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn,spawnSync} = require('node:child_process');
const {chromium} = require('../editor/node_modules/playwright');
const JSZip = require('../editor/node_modules/jszip');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'output/playwright/quick-menu-navigation');
const url='http://127.0.0.1:6879';
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const service=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','vite.config.cjs','--configLoader','native','--host','127.0.0.1','--port','6879','--strictPort'],{cwd:path.join(root,'GameCli_framework'),windowsHide:true,stdio:'ignore'});
  let browser,page;
  const report={ok:false,runs:[]};
  try{
    for(let i=0;i<120;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
    const zip=await JSZip.loadAsync(fs.readFileSync(path.join(root,'output/cartridges/agentvn-sample-0.1.0.vncart')));
    browser=await chromium.launch({headless:true});
    for(const viewport of [{width:1440,height:980},{width:757,height:299},{width:390,height:844}]){
      page=await browser.newPage({viewport});page.setDefaultTimeout(10000);
      await page.route('**/embedded-cartridge/**',async route=>{
        const name=decodeURIComponent(new URL(route.request().url()).pathname.split('/embedded-cartridge/')[1]);
        const file=zip.file(name);
        await route.fulfill(file?{body:await file.async('nodebuffer'),contentType:name.endsWith('.json')?'application/json':name.endsWith('.svg')?'image/svg+xml':'application/octet-stream'}:{status:404,body:'Missing fixture'});
      });
      await page.goto(url+'/?mode=fixed',{waitUntil:'domcontentloaded',timeout:60000});
      await page.getByTestId('start-new-game').waitFor({timeout:60000});
      await page.locator('.boot-overlay').waitFor({state:'hidden',timeout:45000});
      await page.getByTestId('start-new-game').click();
      await page.getByTestId('game-state-playing').waitFor();
      await page.locator('.boot-overlay').waitFor({state:'hidden',timeout:45000});
      await page.locator('.dialog-text').waitFor();
      await page.evaluate(async()=>{
        const {useRuntimeStore}=await import('/src/store/runtimeStore.ts');
        document.addEventListener('click',e=>{
          if(e.target.closest('[data-testid="open-main-menu"]')) window.menuClickPhase=useRuntimeStore.getState().launchTransition;
        },true);
      });
      await page.getByTestId('quick-menu-toggle').click();
      assert.equal(await page.getByTestId('quick-menu-toggle').getAttribute('aria-expanded'),'true');
      await page.getByTestId('open-main-menu').click();
      const clickPhase=await page.evaluate(()=>window.menuClickPhase);
      if(viewport.width===1440) assert.equal(clickPhase,'revealing','regression must exercise a click before launch reveal finishes');
      await page.getByTestId('main-menu').waitFor();
      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-screen').waitFor();
      await page.getByTestId('settings-finish').click();
      await page.getByTestId('main-menu').waitFor();
      await page.getByTestId('continue-game').click();
      await page.getByTestId('game-state-playing').waitFor();
      assert.equal(await page.getByTestId('quick-menu-toggle').getAttribute('aria-expanded'),'false');
      await page.screenshot({path:path.join(out,`${viewport.width}.png`)});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
      report.runs.push({viewport,clickPhase,ok:true});await page.close();page=null;
    }
    report.ok=true;
  }catch(error){
    report.error=String(error.stack||error);process.exitCode=1;
    if(page){
      report.diagnostic=await page.evaluate(async()=>{
        const {useRuntimeStore}=await import('/src/store/runtimeStore.ts');const s=useRuntimeStore.getState();
        return {screen:s.screen,launchTransition:s.launchTransition,pending:s.pendingScreenNavigation,clickPhase:window.menuClickPhase,body:document.body.innerText};
      }).catch(e=>String(e));
      await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
    }
  }finally{
    await browser?.close();
    if(service.pid)spawnSync('taskkill.exe',['/PID',String(service.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report,null,2));
})();
