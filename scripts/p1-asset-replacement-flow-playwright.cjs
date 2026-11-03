"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, ".."), runId = new Date().toISOString().replace(/[:.]/g, "-");
const configuredOutput = process.env.AGENTVN_ASSET_REPLACEMENT_OUTPUT
  ? path.resolve(process.env.AGENTVN_ASSET_REPLACEMENT_OUTPUT)
  : undefined;
if (configuredOutput && fs.existsSync(configuredOutput) && fs.readdirSync(configuredOutput).length > 0)
  throw new Error(`AGENTVN_ASSET_REPLACEMENT_OUTPUT must be new or empty: ${configuredOutput}`);
const out = configuredOutput ?? path.join(root, "output/playwright/p1-asset-replacement", runId);
fs.mkdirSync(out, { recursive: true });
const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#334455"/></svg>');
const upgraded = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#91aabb"/></svg>');
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const baseline = process.argv.includes("--baseline");
const project = fixture(`p1-assets-${runId}`), input = path.join(out, "isolated-small.vnproj");
project.title = "P1 素材替换独立工程";
project.nodes[1].data.scene.commands.unshift({ type: "background", background_id: "p1_background", background_fit: "cover" });
project.asset_manifest = [{ asset_id: "p1_background", asset_type: "background", metadata: {
  display_name: "保留显示名称", filename: "原始素材.svg", mime_type: "image/svg+xml",
  data_url: `data:image/svg+xml;base64,${source.toString("base64")}`, source: "generated",
  project_path: "assets/background/old.svg", width: 600, height: 400, duration_ms: 999,
  hash_sha256: sha(source), license_note: "旧授权", provider_id: "old-provider", model: "old-model",
  prompt: "old-prompt", generation: { old: true }, created_at: "2026-10-01T00:00:00Z", tags: ["reference-tag"] } }];
project.editor_settings.assetLibrary = { folders: [{ folder_id: "p1_folder", name: "原文件夹", parent_folder_id: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
  assetLocations: { p1_background: { primaryFolderId: "p1_folder", linkedFolderIds: [] } } };
fs.writeFileSync(input, JSON.stringify(project));
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = { status: "RUNNING", runId, input, scope: "P1 real Editor navigation/save/reopen; browser not installed", cases: [], pageErrors: [], diagnostics: [] };
const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function idle(page) { await page.waitForFunction(() => {
  const panel = document.querySelector('.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)');
  return !document.querySelector('.app-transition-stage.is-switching') && !panel?.classList.contains('is-morphing')
    && (!panel || panel.querySelector('.advanced-tools-panel')?.classList.contains('is-tab-idle'));
}); }
async function library(page) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.library"]:visible').click();
  await idle(page);
  await page.getByRole('button', { name: /原文件夹/ }).first().click();
  await page.locator('.asset-library-card[data-asset-id="p1_background"]').waitFor();
}
async function replace(page, file) {
  const card = page.locator('.asset-library-card[data-asset-id="p1_background"]');
  await card.locator('[data-help-key="asset.card.menu"]').click();
  await card.getByRole('menuitem', { name: '替换文件', exact: true }).click();
  await page.locator('[data-help-key="asset.replace.file"]').setInputFiles(file);
}
async function snapshot(page) { return page.evaluate(() => {
  const p = window.__AGENTVN_PROJECT_STORE__.getState(), graph = window.__AGENTVN_EDITOR_STORE__?.getState();
  return { id: p.projectId, assets: p.assetManifest, folders: p.settings.assetLibrary, nodes: graph?.nodes, edges: graph?.edges };
}); }
async function delayOldReplacement(page) {
  await page.evaluate(oldDataUrl=>{
    const originalReader=FileReader.prototype.readAsDataURL,OriginalImage=window.Image;
    window.__p1ReleaseRead=null;window.__p1OldImageSettled=false;
    window.__p1RestoreReader=()=>{FileReader.prototype.readAsDataURL=originalReader;window.Image=OriginalImage;};
    window.Image=class extends OriginalImage{
      constructor(...args){super(...args);this.addEventListener('load',()=>{
        if(this.src===oldDataUrl)window.__p1OldImageSettled=true;
      });}
    };
    FileReader.prototype.readAsDataURL=function(file){
      if(file.name==='旧的延迟请求.svg')window.__p1ReleaseRead=()=>originalReader.call(this,file);
      else originalReader.call(this,file);
    };
  },`data:image/svg+xml;base64,${source.toString('base64')}`);
  await replace(page,{name:'旧的延迟请求.svg',mimeType:'image/svg+xml',buffer:source});
  await page.waitForFunction(()=>Boolean(window.__p1ReleaseRead));
}
async function finishOldReplacement(page) {
  await page.evaluate(()=>window.__p1ReleaseRead());
  await page.waitForFunction(()=>window.__p1OldImageSettled);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function run(page, context, env) {
  const { width, height, dpr, reduced } = context;
  const add = async (name, task) => { const item = { ...context, name, status: 'RUNNING' }; report.cases.push(item);
    try { Object.assign(item, await task()); item.status = 'PASS'; }
    catch (error) { item.status = 'FAILED'; item.error = String(error.stack || error); persist(); throw error; }
    persist(); };
  await env.open(page); await library(page); const before = await snapshot(page);
  await add('real-navigation-cancel-invalid-and-no-mutation', async () => {
    await replace(page, { name: '升级素材.svg', mimeType: 'image/svg+xml', buffer: upgraded });
    const dialog = page.getByRole('dialog', { name: '确认替换素材' });
    await dialog.getByText(/授权和生成来源说明不会沿用/).waitFor();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual(await snapshot(page), before);
    await replace(page, { name: '错误音频.wav', mimeType: 'audio/wav', buffer: Buffer.from('invalid') });
    await page.locator('.asset-library-panel [role=alert]').filter({ hasText: '不兼容' }).waitFor();
    assert.deepEqual(await snapshot(page), before);
    await replace(page, { name: '损坏图片.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('invalid') });
    await page.locator('.asset-library-panel [role=alert]').filter({ hasText: '原素材未改变' }).waitFor();
    assert.deepEqual(await snapshot(page), before);
  });
  await add('replacement-identity-references-metadata-and-hit-geometry', async () => {
    await replace(page, { name: '升级素材.svg', mimeType: 'image/svg+xml', buffer: upgraded });
    await page.getByRole('dialog', { name: '确认替换素材' }).getByRole('button', { name: '确认替换', exact: true }).click();
    const after = await snapshot(page), asset = after.assets[0];
    assert.equal(asset.asset_id, 'p1_background'); assert.equal(asset.asset_type, 'background');
    assert.equal(asset.metadata.display_name, '保留显示名称');
    assert.equal(asset.metadata.filename, '升级素材.svg');
    assert.deepEqual([asset.metadata.width, asset.metadata.height], [900, 600]);
    assert.equal(Buffer.from(asset.metadata.data_url.split(',')[1], 'base64').equals(upgraded), true);
    assert.deepEqual(after.folders, before.folders); assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges, before.edges);
    for (const field of ['duration_ms','media_warning','hash_sha256','provider_id','model','prompt','generation','license_note','backend_asset_path','filePath','url','bytes','path'])
      assert.equal(asset.metadata[field], undefined, `Old byte/source field must be removed: ${field}`);
    assert.deepEqual(asset.metadata.tags, ['reference-tag']); assert.equal(asset.metadata.created_at, '2026-10-01T00:00:00Z');
    const geometry = await page.locator('.asset-library-panel').evaluate(node => {
      const rect = node.getBoundingClientRect(), controls = [...node.querySelectorAll('button')].filter(n => {
        const r=n.getBoundingClientRect(); if(r.width<=0||r.height<=0||n.disabled)return false;
        for(let p=n;p&&node.contains(p);p=p.parentElement){const s=getComputedStyle(p);if(s.visibility==='hidden'||s.display==='none'||Number(s.opacity)<.01)return false;}
        return true;
      });
      return { rect: rect.toJSON(), overflow: document.documentElement.scrollWidth-innerWidth,
        controls: controls.filter(n=>{const r=n.getBoundingClientRect();return r.top>=rect.top&&r.bottom<=rect.bottom}).map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent,rect:r.toJSON(),hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}}) };
    });
    assert(geometry.overflow <= 1 && geometry.rect.left>=0&&geometry.rect.right<=width);
    report.currentGeometry = geometry; persist();
    assert(geometry.controls.length>0&&geometry.controls.every(c=>c.hit), 'Visible library targets must receive real clicks');
    return { asset, geometry };
  });
  await add('real-save-portable-byte-integrity-and-home-reimport', async () => {
    await page.locator('[data-workspace-surface="edit"]:visible').click();await idle(page);
    await page.evaluate(() => {
      window.__p1SaveClicks=[];
      window.__p1SaveNotices=[];
      window.__p1NoticeSubscription?.();
      window.__p1NoticeSubscription=window.__AGENTVN_EDITOR_STORE__.subscribe((state,previous)=>{
        if(state.lastError!==previous.lastError)window.__p1SaveNotices.push(state.lastError??null);
      });
      document.addEventListener('click', event => {
        const target=event.target.closest?.('[data-help-key="toolbar.saveProject"]');
        if(target)window.__p1SaveClicks.push({time:performance.now(),trusted:event.isTrusted,
          inert:Boolean(target.closest('[inert]')),disabled:target.disabled});
      }, {capture:true});
    });
    const pending = page.waitForEvent('download'); await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const download = await pending, file = path.join(out, `${width}-${dpr}-${reduced}.vnproj`); await download.saveAs(file);
    await page.getByTestId('project-save-confirmation').getByRole('button',{name:'OK',exact:true}).click();
    const bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes), exported = JSON.parse(await zip.file('project.json').async('string'));
    const a = exported.asset_manifest.find(x=>x.asset_id==='p1_background');
    assert((await zip.file(a.metadata.project_path).async('nodebuffer')).equals(upgraded));
    assert(!JSON.stringify(exported).includes('projectExportDirectories'), 'Local directories must not travel in portable projects');
    await page.getByRole('button',{name:'返回首页',exact:true}).click(); await idle(page);
    await page.locator('.project-import-button input').first().setInputFiles(file);
    await page.locator('.editor-toolbar').waitFor(); await idle(page); await library(page);
    const reopened = await snapshot(page); assert.equal(reopened.id, before.id); assert.deepEqual(reopened.folders,before.folders);
    const latest=reopened.assets.find(x=>x.asset_id==='p1_background');
    const sourceUrl=latest.metadata.data_url??latest.metadata.blob_url??latest.metadata.url;
    const currentBytes=await page.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),sourceUrl);
    assert(Buffer.from(currentBytes).equals(upgraded));
    await page.screenshot({path:path.join(out,`${width}-${dpr}-${reduced}-reopened.png`)});
    return { file, sha256:sha(bytes), assetSha256:sha(upgraded) };
  });
  await add('project-directory-browser-boundary-and-viewport', async()=>{
    await page.locator('[data-help-key="advanced.tab.settings"]:visible').click(); await idle(page);
    const section=page.getByRole('region',{name:'工程保存目录'}); await section.scrollIntoViewIfNeeded();
    assert(await section.getByText(/浏览器下载目录由浏览器控制/).isVisible());
    const r=await section.boundingBox(); assert(r.x>=0&&r.x+r.width<=width+1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  });
  await add('overlapping-replacement-reads-latest-file-owns-confirmation',async()=>{
    await page.locator('[data-help-key="advanced.tab.library"]:visible').click();await idle(page);
    await page.getByRole('button',{name:/原文件夹/}).first().click();
    await delayOldReplacement(page);
    try{
      await replace(page,{name:'最新请求.svg',mimeType:'image/svg+xml',buffer:upgraded});
      await page.getByRole('dialog',{name:'确认替换素材'}).getByText(/最新请求.svg/).waitFor();
      await finishOldReplacement(page);
      assert(await page.getByRole('dialog',{name:'确认替换素材'}).getByText(/最新请求.svg/).isVisible(), 'Older replacement read must never take over the latest confirmation');
      await page.getByRole('dialog',{name:'确认替换素材'}).getByRole('button',{name:'取消',exact:true}).click();
    }finally{await page.evaluate(()=>window.__p1RestoreReader())}
  });
  await add('pending-replacement-project-a-b-a-and-unmount-isolation',async()=>{
    await delayOldReplacement(page);
    try{
      const other={...project,project_id:`${project.project_id}-other`,title:'P1 第二个隔离工程'};
      for(const target of [other,project]){
        await page.locator('[data-workspace-surface="edit"]:visible').click();await idle(page);
        await page.getByRole('button',{name:'返回首页',exact:true}).click();await idle(page);
        await page.locator('.project-import-button input').first().setInputFiles({
          name:'隔离工程.vnproj',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(target)),
        });
        await page.locator('.editor-toolbar').waitFor();await idle(page);
        await page.waitForFunction(id=>window.__AGENTVN_PROJECT_STORE__?.getState().projectId===id
          &&Boolean(window.__AGENTVN_PROJECT_STORE__.getState().assetManifest[0]?.metadata.backend_asset_path),target.project_id);
      }
      await library(page);const beforeRelease=await snapshot(page);
      await finishOldReplacement(page);
      assert.equal(await page.getByRole('dialog',{name:'确认替换素材'}).count(),0,'Unmounted task cannot reopen the replacement UI');
      assert.deepEqual(await snapshot(page),beforeRelease,'Stale A task cannot mutate the new A session');
    }finally{await page.evaluate(()=>window.__p1RestoreReader())}
  });
}
(async()=>{let env,browser;
  try{env=await startEditorAcceptance();browser=await chromium.launch();report.owner={pid:env.server.pid,backendPid:env.backendPid,url:env.url};
    for(const [width,height]of baseline?desktopViewports.slice(0,1):desktopViewports)
      for(const dpr of baseline?[1]:[1,2])for(const reduced of baseline?[false]:[false,true]){
        const context={width,height,dpr,reduced},page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:reduced?'reduce':'no-preference'});
        page.on('pageerror',e=>report.pageErrors.push({...context,error:String(e)}));
        page.on('console',e=>{if(['warning','error'].includes(e.type()))report.diagnostics.push({...context,type:e.type(),text:e.text().slice(0,2000)});});
        page.on('request',r=>{if(r.url().includes('/api/project/'))report.diagnostics.push({...context,type:'request',method:r.method(),url:r.url()});});
        page.on('response',r=>{if(r.url().includes('/api/project/'))report.diagnostics.push({...context,type:'response',status:r.status(),url:r.url()});});
        page.on('requestfailed',r=>report.diagnostics.push({...context,type:'requestfailed',url:r.url().slice(0,500),error:r.failure()}));
        try{await env.server.run(()=>run(page,context,env));}
        catch(error){report.failureState=await page.evaluate(()=>({text:document.body.innerText.slice(-10000),saveButton:document.querySelector('[data-help-key="toolbar.saveProject"]')?.outerHTML,project:window.__AGENTVN_PROJECT_STORE__?.getState().projectId,notice:window.__AGENTVN_EDITOR_STORE__?.getState().lastError,notices:window.__p1SaveNotices,clicks:window.__p1SaveClicks}));
          await page.screenshot({path:path.join(out,'failure.png')});throw error;}
        finally{await page.close();}
      }
    assert.equal(report.cases.length,baseline?6:72);assert.equal(report.pageErrors.length,0);report.status='PASS';
  }catch(error){report.status='FAILED';report.error=String(error.stack||error);process.exitCode=1;}
  finally{await browser?.close();await env?.stop();persist();console.log(`Evidence: ${out}`);}
})();
