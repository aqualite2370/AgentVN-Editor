const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const {spawn,spawnSync} = require('node:child_process');
const {chromium} = require('../editor/node_modules/playwright');
const exe = path.resolve(process.argv[2] || 'output/test-matrix/lifecycle-20260920-windows/standalone-windows-package/portable/AgentVN Sample-0.1.0.exe');
const projectAcceptance = process.argv.includes('--project');
const out = path.resolve('output/playwright/windows-portable',new Date().toISOString().replace(/[:.]/g,'-'));
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const report={ok:false,exe,scope:projectAcceptance ? 'project portable package: title, first scene, eight-row menu geometry and collapse; not full media acceptance' : 'sample portable package, title and first scene; not full project/media acceptance',errors:[]};
  let child,browser,page;
  try{
    await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(9481,'127.0.0.1',()=>s.close(resolve));});
    report.sha256=crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
    child=spawn(exe,[],{cwd:path.dirname(exe),windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(out,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9481'}});
    for(let i=0;i<120;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9481');break;}catch{}await new Promise(r=>setTimeout(r,500));}
    assert.ok(browser,'portable CDP ready');
    page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(30000);
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.locator('[data-testid="start-new-game"]').waitFor();
    await page.locator('.boot-overlay').waitFor({state:'detached'});
    await page.screenshot({path:path.join(out,'title.png')});
    await page.locator('[data-testid="start-new-game"]').click();
    await page.locator('[data-testid="game-state-playing"]').waitFor();
    if (projectAcceptance) {
      await page.locator('.dialog-text').waitFor();
      await page.waitForFunction(() => document.querySelector('.dialog-text')?.textContent.trim().length > 0);
      const toggle = page.locator('[data-testid="quick-menu-toggle"]');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await page.waitForFunction(() => [...document.querySelectorAll('.playback-controls')].every(
        root => root.getAnimations({subtree:true}).every(animation => animation.playState === 'finished')));
      report.menu = await page.locator('.playback-controls').evaluate(root => {
        const rect = node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
        const surface=root.querySelector('.quick-menu-surface');
        const dialogue=document.querySelector('.dialog-box');
        const rows=[...root.querySelectorAll('button')].map(button => {
          const r=rect(button), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {label:button.getAttribute('aria-label'),rect:r,hit:button===hit || button.contains(hit),disabled:button.disabled};
        });
        return {rows, viewport:{width:innerWidth,height:innerHeight}, dialogue:dialogue ? rect(dialogue) : null,
          scrollHeight:surface.scrollHeight,clientHeight:surface.clientHeight,
          horizontalOverflow:document.documentElement.scrollWidth > innerWidth};
      });
      assert.equal(report.menu.rows.length,8,'seven operations plus collapse');
      assert.ok(report.menu.scrollHeight<=report.menu.clientHeight+1,'no internal scrolling');
      assert.equal(report.menu.horizontalOverflow,false);
      if (report.menu.viewport.width >= 1600 && report.menu.viewport.height >= 900) {
        const actionRows = report.menu.rows.slice(0, 7);
        assert.ok(actionRows.every(row => row.rect.width >= 280 && row.rect.height >= 52),
          'wide desktop quick-menu actions must meet the enlarged visual baseline');
        assert.ok(report.menu.rows[7].rect.width >= 52 && report.menu.rows[7].rect.height >= 52,
          'wide desktop quick-menu collapse control must meet the enlarged visual baseline');
        assert.ok(report.menu.rows[0].rect.width >= report.menu.viewport.width * 0.115,
          'wide desktop quick-menu must occupy a visible share of the frame');
      }
      for (const [index,row] of report.menu.rows.entries()) {
        const r=row.rect;
        assert.ok(r.width>0 && r.height>0 && r.x>=-1 && r.y>=-1 &&
          r.right<=report.menu.viewport.width+1 && r.bottom<=report.menu.viewport.height+1,`${row.label}: within viewport`);
        assert.ok(row.hit,`${row.label}: not occluded`);
        if (report.menu.dialogue) assert.ok(r.bottom<=report.menu.dialogue.y+1,`${row.label}: above dialogue`);
        for (const previous of report.menu.rows.slice(0,index)) {
          const p=previous.rect;
          assert.ok(Math.min(r.right,p.right)-Math.max(r.x,p.x)<=1 ||
            Math.min(r.bottom,p.bottom)-Math.max(r.y,p.y)<=1,'menu rows must not overlap');
        }
      }
      await page.screenshot({path:path.join(out,'menu.png')});
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'),'false');
      assert.equal(await page.locator('.quick-menu-action-layer button:not([tabindex="-1"])').count(),0);
    } else await page.getByText('AgentVN cartridge verification scene.',{exact:true}).waitFor();
    await page.screenshot({path:path.join(out,'scene.png')});
    assert.equal(child.exitCode,null);
    assert.deepEqual(report.errors,[]);
    report.ok=true;
  }catch(error){report.error=String(error.stack||error);process.exitCode=1;if(page){report.body=await page.locator('body').innerText().catch(()=>'');await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}}
  finally{
    if(child?.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    await browser?.close().catch(()=>{});
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({...report,out},null,2));
})();
