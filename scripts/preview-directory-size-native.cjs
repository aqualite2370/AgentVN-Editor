const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {chromium}=require('../editor/node_modules/playwright');
const JSZip=require('../editor/node_modules/jszip');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'output/playwright/preview-directory-size',new Date().toISOString().replace(/[:.]/g,'-'));
const exe=path.join(root,'editor/src-tauri/binaries/agentvn-player.exe');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function sha(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
async function run(label,mb,zip){
  const dir=path.join(out,label,'current');fs.mkdirSync(dir,{recursive:true});
  for(const item of Object.values(zip.files)){
    if(item.dir||item.name==='checksum.json')continue;
    const target=path.resolve(dir,item.name);assert.ok(target.startsWith(dir+path.sep));
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,await item.async('nodebuffer'));
  }
  const pad=path.join(dir,'assets/padding.bin');fs.mkdirSync(path.dirname(pad),{recursive:true});
  const fd=fs.openSync(pad,'w');try{fs.writeSync(fd,Buffer.from([0]),0,1,mb*1024*1024-1);}finally{fs.closeSync(fd);}
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  const backgroundPath='assets/backgrounds/size-test.svg';
  fs.writeFileSync(path.join(dir,backgroundPath),'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#194c64"/><circle cx="400" cy="200" r="100" fill="#80d4bf"/></svg>');
  manifest.assets=manifest.assets.map(a=>a.asset_id==='sample_bg'?{asset_id:'sample_bg',asset_type:'background',path:backgroundPath,filename:'size-test.svg',mime_type:'image/svg+xml',preload:true}:a);
  manifest.assets.push({asset_id:'padding',asset_type:'other',path:'assets/padding.bin',filename:'padding.bin',mime_type:'application/octet-stream',size_bytes:mb*1024*1024});
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
  const files=[];
  async function walk(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){const p=path.join(folder,e.name);if(e.isDirectory())await walk(p);else files.push({path:path.relative(dir,p).replace(/\\/g,'/'),size_bytes:fs.statSync(p).size,hash_sha256:await sha(p)});}}
  await walk(dir);
  fs.writeFileSync(path.join(dir,'checksum.json'),JSON.stringify({checksum_version:'1.0.0',algorithm:'sha256',generated_at:new Date().toISOString(),files},null,2));
  let child,browser,page;
  const result={label,paddingMB:mb,directory:dir,totalBytes:files.reduce((a,f)=>a+f.size_bytes,0),ok:false,errors:[]};
  const started=Date.now();
  try{
    await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(9491,'127.0.0.1',()=>s.close(resolve));});
    child=spawn(exe,['--mode','preview','--preview-root',dir],{cwd:path.dirname(exe),windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(out,label,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9491'}});
    for(let i=0;i<120;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9491');break;}catch{}await sleep(500);}
    assert.ok(browser,'native CDP ready');page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(30000);
    page.on('pageerror',e=>result.errors.push(e.message));
    await page.getByTestId('start-new-game').waitFor();
    await page.locator('.boot-overlay').waitFor({state:'hidden'});
    await page.getByTestId('start-new-game').click();
    await page.getByText('AgentVN cartridge verification scene.',{exact:true}).waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.background-layer, .background-layer *')].some(e=>getComputedStyle(e).backgroundImage.includes('size-test.svg')||(e instanceof HTMLImageElement&&e.complete&&e.naturalWidth>0)));
    assert.ok(await page.locator('.background-transition-frame.is-current').evaluate(async e=>{
      const url=getComputedStyle(e).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
      if(!url)return false;const image=new Image();image.src=url;
      try{await image.decode();return image.naturalWidth===800&&image.naturalHeight===450;}catch{return false;}
    }),'native directory background bytes decode at expected dimensions');
    if(mb===445)while(Date.now()-started<20000)await sleep(500);
    assert.equal(child.exitCode,null,'native process remains alive');assert.deepEqual(result.errors,[]);
    await page.screenshot({path:path.join(out,label,'scene.png')});
    result.aliveMs=Date.now()-started;result.pid=child.pid;result.ok=true;
  }catch(e){result.error=String(e.stack||e);if(page)await page.screenshot({path:path.join(out,label,'failure.png')}).catch(()=>{});}
  finally{if(child?.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await browser?.close().catch(()=>{});}
  return result;
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const report={ok:false,scope:'native directory-size regression with sample background and inert padding; not realistic large-media decode/load pressure',exe,sha256:await sha(exe),runs:[]};
  try{
    const zip=await JSZip.loadAsync(fs.readFileSync(path.join(root,'output/cartridges/agentvn-sample-0.1.0.vncart')));
    for(const [label,mb] of [['small',20],['large',445],['repeat',20]]){const result=await run(label,mb,zip);report.runs.push(result);if(!result.ok)throw Error(result.error);}
    report.ok=true;
  }catch(e){report.error=String(e.stack||e);process.exitCode=1;}
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,out},null,2));
})();
