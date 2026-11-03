const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('../editor/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output/playwright/preview-window-lifecycle');
const url = 'http://127.0.0.1:6779';
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div>
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type; window.__vite_plugin_react_preamble_installed__=true;
</script><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import {PreviewWindowControls} from '/src/components/advanced/PreviewWindowControls.tsx';
import '/src/styles/variables.css'; import '/src/styles/layout.css';
import '/src/styles/editor-tokens.css'; import '/src/styles/editor-preview.css';
function Harness(){const session=React.useRef(); const [open,setOpen]=React.useState(true);
return React.createElement(React.Fragment,null,
React.createElement('button',{id:'toggle',onClick:()=>setOpen(!open)},'Toggle task'),
open && React.createElement('main',{style:{height:'calc(100dvh - 60px)',padding:12}},React.createElement(PreviewWindowControls,{sessionRef:session})));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`;
const bridge = `
window.previewTest={running:false,queries:0,launches:0,failLaunch:false,failClose:false,failQuery:false};
export const isTauriRuntime=()=>true;
export const isMissingDirectoryPreviewSupport=()=>false;
export async function getGameCliPreviewRunning(){const s=window.previewTest;s.queries++;if(s.failQuery)throw Error('status unavailable');return s.running;}
export async function openGameCliPreviewDirectory(){const s=window.previewTest;s.launches++;if(s.failLaunch)throw Error('launch failed');s.running=true;return {mode:'gamecli',message:'Started test process'};}
export const openGameCliPreview=openGameCliPreviewDirectory;
export async function closeGameCliPreview(){if(window.previewTest.failClose)throw Error('close failed');window.previewTest.running=false;}
`;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const service = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','6779','--strictPort'], {cwd:path.join(root,'editor'),windowsHide:true,stdio:'ignore'});
  let browser;
  const report={ok:false,scope:'real React component/browser with mocked process bridge; not native acceptance',viewports:[]};
  try {
    for(let i=0;i<120;i++){try{if((await fetch(url)).ok)break;}catch{} if(i===119)throw Error('Vite unavailable');await new Promise(r=>setTimeout(r,250));}
    browser=await chromium.launch({headless:true});
    for(const viewport of [{width:1440,height:900},{width:757,height:299},{width:390,height:844}]){
      const page=await browser.newPage({viewport});
      page.on('pageerror',error=>console.error('PAGE_ERROR',error.message));
      page.on('console',message=>{if(message.type()==='error')console.error('BROWSER_ERROR',message.text());});
      await page.route('**/__preview_lifecycle__',r=>r.fulfill({contentType:'text/html',body:html}));
      await page.route('**/src/preview/previewWindow.ts*',r=>r.fulfill({contentType:'application/javascript',body:bridge}));
      await page.route('**/src/cartridge/exportCartridge.ts*',r=>r.fulfill({contentType:'application/javascript',body:'export async function exportEditorPreviewDirectory(){return {textFiles:[],assets:[],fileName:"test"}};export const exportEditorCartridge=exportEditorPreviewDirectory;'}));
      await page.route('**/src/utils/exportScript.ts*',r=>r.fulfill({contentType:'application/javascript',body:'export const exportScript=()=>({entry_scene_id:"entry",scenes:[{scene_id:"entry",commands:[]}]});export const applyProjectRuntimeSettingsToScript=s=>s;export const validateExportScript=()=>[];'}));
      await page.goto(url+'/__preview_lifecycle__');
      const launch=page.locator('[data-help-key="preview.open"]');
      await launch.click();
      await page.waitForFunction(()=>window.previewTest?.running);
      await page.evaluate(()=>{window.previewTest.running=false;});
      await page.waitForFunction(()=>document.querySelector('[data-testid="preview-window-status"]')?.textContent.includes('已关闭'),null,{timeout:6000});
      assert.equal(await page.locator('[data-help-key="preview.close"]').isDisabled(),true);
      await page.evaluate(()=>{window.previewTest.failLaunch=true;});
      await launch.click();
      await page.getByRole('button',{name:'重试 GameCLI 预览'}).waitFor();
      await page.evaluate(()=>{window.previewTest.failLaunch=false;});
      await launch.click();
      await page.waitForFunction(()=>document.querySelector('[data-testid="preview-window-status"]')?.textContent.includes('运行中'));
      await page.locator('#toggle').click();
      await page.evaluate(()=>{window.previewTest.running=false;});
      await page.locator('#toggle').click();
      await page.waitForFunction(()=>document.querySelector('[data-testid="preview-window-status"]')?.textContent.includes('已关闭'));
      await launch.click();
      await page.evaluate(()=>{window.previewTest.failClose=true;});
      await page.locator('[data-help-key="preview.close"]').click();
      await page.waitForFunction(()=>document.querySelector('.gamecli-preview-progress-header strong')?.textContent==='关闭失败');
      assert.equal(await page.evaluate(()=>window.previewTest.running),true,'failed close must not imply process exited');
      await page.evaluate(()=>{window.previewTest.failQuery=true;});
      await page.waitForFunction(()=>document.querySelector('[data-testid="preview-window-status"]')?.textContent.includes('未知'),null,{timeout:6000});
      await page.evaluate(()=>{window.previewTest.failQuery=false;window.previewTest.failClose=false;});
      await page.waitForFunction(()=>document.querySelector('[data-testid="preview-window-status"]')?.textContent.includes('运行中'));
      await page.locator('[data-help-key="preview.close"]').click();
      await page.waitForFunction(()=>document.querySelector('[data-testid="preview-window-status"]')?.textContent.includes('已关闭'));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
      report.viewports.push(viewport);
      await page.screenshot({path:path.join(out,`${viewport.width}.png`)});
      await page.close();
    }
    const bridgePage=await browser.newPage();
    await bridgePage.goto(url);
    await bridgePage.evaluate(async()=>{
      const api=await import('/src/preview/previewWindow.ts');
      window.lifecycleApi=api;
      await api.closeGameCliPreview();
      if(await api.getGameCliPreviewRunning())throw Error('No window should be running before launch');
    });
    assert.equal(bridgePage.context().pages().length,1,'close before launch must not create a blank popup');
    const popupPromise=bridgePage.waitForEvent('popup');
    await bridgePage.evaluate(()=>window.lifecycleApi.openGameCliPreview({cartridge:new Blob(['test']),fileName:'test.vncart'}));
    const popup=await popupPromise;
    assert.equal(await bridgePage.evaluate(()=>window.lifecycleApi.getGameCliPreviewRunning()),true);
    await popup.close();
    assert.equal(await bridgePage.evaluate(()=>window.lifecycleApi.getGameCliPreviewRunning()),false);
    await bridgePage.close();
    report.browserWindowHandle=true;
    report.ok=true;
  }catch(error){report.error=String(error.stack||error);process.exitCode=1;}
  finally{await browser?.close();if(service.pid)spawnSync('taskkill.exe',['/PID',String(service.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report,null,2));
})();
