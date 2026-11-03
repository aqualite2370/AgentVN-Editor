const {spawn, execFileSync} = require('child_process');
const path = require('path');
const fs = require('fs');
const port = 9483;
const exe = path.resolve('editor/src-tauri/binaries/agentvn-player.exe');
const previewRoot = path.join(process.env.LOCALAPPDATA, 'com.agentvn.editor', 'gamecli-preview', 'current');
const outDir = path.resolve('output/automated/current-preview-dialog-inspect');
fs.mkdirSync(outDir, {recursive:true});
try { execFileSync('powershell.exe',['-NoProfile','-Command','Get-Process agentvn-player -ErrorAction SilentlyContinue | Stop-Process -Force'],{stdio:'ignore'}); } catch {}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function fetchJson(url){ const r=await fetch(url); if(!r.ok) throw new Error(url+' '+r.status); return r.json(); }
async function waitForTarget(){ const started=Date.now(); let last; while(Date.now()-started<30000){ try{ const list=await fetchJson('http://127.0.0.1:'+port+'/json/list'); const t=list.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||list.find(x=>x.webSocketDebuggerUrl); if(t) return t; }catch(e){last=e;} await sleep(250);} throw new Error('No CDP target '+(last&&last.message));}
class CDP{constructor(url){this.ws=new WebSocket(url);this.nextId=1;this.pending=new Map();}
 async open(){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('ws open timeout')),10000);this.ws.onopen=()=>{clearTimeout(timer);resolve();};this.ws.onerror=()=>{clearTimeout(timer);reject(new Error('ws error'));};this.ws.onmessage=e=>{const m=JSON.parse(e.data); if(!m.id||!this.pending.has(m.id)) return; const h=this.pending.get(m.id); this.pending.delete(m.id); m.error?h.reject(new Error(JSON.stringify(m.error))):h.resolve(m.result);};});}
 send(method,params={},timeout=15000){const id=this.nextId++; this.ws.send(JSON.stringify({id,method,params})); return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject}); setTimeout(()=>{if(!this.pending.has(id))return; this.pending.delete(id); reject(new Error(method+' timeout'));},timeout);});}
 close(){try{this.ws.close();}catch{}}
}
(async()=>{
 const child=spawn(exe,['--mode','preview','--preview-root',previewRoot],{env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port='+port+' --remote-allow-origins=*'},windowsHide:false,stdio:['ignore','pipe','pipe']});
 let stderr=''; child.stderr.on('data',d=>stderr+=d.toString()); child.stdout.on('data',d=>{});
 const result={previewRoot, exe, outDir};
 let cdp;
 try{
  const target=await waitForTarget(); result.target=target;
  cdp=new CDP(target.webSocketDebuggerUrl); await cdp.open(); await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('DOM.enable');
  async function evalv(expression,timeout=15000){ const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout},timeout+1000); if(r.exceptionDetails) throw new Error('Eval failed '+JSON.stringify(r.exceptionDetails)); return r.result.value; }
  async function waitFor(expr,label,timeout=30000){ const st=Date.now(); let last; while(Date.now()-st<timeout){ try{ last=await evalv(expr,5000); if(last===true || (last&&typeof last!=='object')) return last; }catch(e){ last=e.message; } await sleep(200);} throw new Error('wait '+label+' last='+JSON.stringify(last)); }
  async function shot(name){ const s=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); fs.writeFileSync(path.join(outDir,name),Buffer.from(s.data,'base64')); }
  async function clickCenter(selector){ const rect=await evalv(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,text:e.textContent};})()`); if(!rect) throw new Error('missing '+selector); await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x,y:rect.y,button:'none'}); await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1}); await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x,y:rect.y,button:'left',clickCount:1}); return rect; }
  await waitFor("document.readyState === 'complete' || document.readyState === 'interactive'",'ready');
  await waitFor("document.querySelector('[data-testid=\\\"start-new-game\\\"]') && !document.querySelector('.boot-overlay')", 'title menu ready', 45000);
  await sleep(500);
  result.initialText=await evalv('document.body.innerText.slice(0,1000)');
  result.titleButtons=await evalv(`(()=>[...document.querySelectorAll('button,[role="button"],.ui-button')].map((e,i)=>({i,cls:e.className,text:e.textContent.trim(),testid:e.getAttribute('data-testid'),rect:(()=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()})).slice(0,50))()`);
  await shot('01-title.png');
  let clicked=false;
  for (const sel of ['[data-testid="start-new-game"]','button[data-testid="start-new-game"]']) {
    if(await evalv(`!!document.querySelector(${JSON.stringify(sel)})`)){ result.clicked=await clickCenter(sel); clicked=true; break; }
  }
  if(!clicked){
    const btn=await evalv(`(()=>{const items=[...document.querySelectorAll('button,.ui-button,[role="button"]')].map((e,i)=>({i,text:e.textContent.trim(),x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})); return items.find(x=>/开始|Start|重新/.test(x.text)) || items.find(x=>x.w>50&&x.h>20);})()`);
    if(!btn) throw new Error('no start button candidate');
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:btn.x+btn.w/2,y:btn.y+btn.h/2,button:'none'});
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:btn.x+btn.w/2,y:btn.y+btn.h/2,button:'left',clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:btn.x+btn.w/2,y:btn.y+btn.h/2,button:'left',clickCount:1});
    result.clicked=btn;
  }
  await sleep(3000);
  // If still title, try Enter
  if(!(await evalv("!!document.querySelector('.dialog-box,.dialog-text,[data-testid=\\\"game-state-playing\\\"]')"))){
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
    await sleep(2000);
  }
  await waitFor("!!document.querySelector('.dialog-box,.dialog-text,[data-testid=\\\"game-state-playing\\\"]')",'dialog',20000);
  await sleep(1500);
  await shot('02-dialog.png');
  result.dialog=await evalv(`(()=>{
    const box=document.querySelector('.dialog-box'); const text=document.querySelector('.dialog-text'); const speaker=document.querySelector('.speaker'); const cont=document.querySelector('.continue-indicator'); const frame=document.querySelector('.runtime-layout-frame');
    const rect=(e)=>{ if(!e)return null; const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
    const cs=(e)=>{ if(!e)return null; const s=getComputedStyle(e); return {fontSize:s.fontSize,lineHeight:s.lineHeight,padding:s.padding,position:s.position,overflow:s.overflow,display:s.display}; };
    const overlap=(a,b)=>{ if(!a||!b)return 0; const x=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)); const y=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)); return x*y; };
    const rr={frame:rect(frame),box:rect(box),text:rect(text),speaker:rect(speaker),continue:rect(cont),boxClass:box?.className||'',textClass:text?.className||'',speakerClass:speaker?.className||'',textStyle:text?.getAttribute('style'),speakerStyle:speaker?.getAttribute('style'),boxStyle:box?.getAttribute('style'),textCss:cs(text),speakerCss:cs(speaker),continueCss:cs(cont),bodyText:document.body.innerText.slice(0,1000),textContent:text?.textContent||'',speakerText:speaker?.textContent||''};
    rr.speakerTextOverlapArea=overlap(rr.speaker,rr.text); rr.speakerTextOverlapRatio=rr.speakerTextOverlapArea/(Math.min((rr.speaker?.width||0)*(rr.speaker?.height||0),(rr.text?.width||0)*(rr.text?.height||0))||1);
    return rr;
  })()`);
  fs.writeFileSync(path.join(outDir,'result.json'),JSON.stringify(result,null,2),'utf8');
  console.log(JSON.stringify(result,null,2));
 } catch(e){ result.error=String(e.stack||e); result.stderrTail=stderr.slice(-4000); fs.writeFileSync(path.join(outDir,'error-result.json'),JSON.stringify(result,null,2),'utf8'); console.error(e.stack||e); process.exitCode=1; }
 finally{ if(cdp) cdp.close(); child.kill(); }
})();
