const {spawn, execFileSync} = require('child_process');
const path = require('path');
const fs = require('fs');
const port = 9484;
const exe = path.resolve('editor/src-tauri/binaries/agentvn-player.exe');
const previewRoot = path.join(process.env.LOCALAPPDATA, 'com.agentvn.editor', 'gamecli-preview', 'current');
const outDir = path.resolve('output/automated/current-preview-dialog-sequence');
fs.rmSync(outDir,{recursive:true,force:true}); fs.mkdirSync(outDir,{recursive:true});
try { execFileSync('powershell.exe',['-NoProfile','-Command','Get-Process agentvn-player -ErrorAction SilentlyContinue | Stop-Process -Force'],{stdio:'ignore'}); } catch {}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function fetchJson(url){const r=await fetch(url); if(!r.ok) throw new Error(url+' '+r.status); return r.json();}
async function waitForTarget(){const st=Date.now(); while(Date.now()-st<30000){try{const l=await fetchJson('http://127.0.0.1:'+port+'/json/list'); const t=l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)||l.find(x=>x.webSocketDebuggerUrl); if(t)return t;}catch{} await sleep(250);} throw new Error('no target');}
class CDP{constructor(url){this.ws=new WebSocket(url);this.nextId=1;this.pending=new Map();} async open(){await new Promise((res,rej)=>{const tm=setTimeout(()=>rej(new Error('ws timeout')),10000);this.ws.onopen=()=>{clearTimeout(tm);res();};this.ws.onerror=()=>{clearTimeout(tm);rej(new Error('ws err'));};this.ws.onmessage=e=>{const m=JSON.parse(e.data); if(!m.id||!this.pending.has(m.id))return; const h=this.pending.get(m.id); this.pending.delete(m.id); m.error?h.reject(new Error(JSON.stringify(m.error))):h.resolve(m.result);};});} send(method,params={},timeout=15000){const id=this.nextId++;this.ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>{this.pending.set(id,{resolve:res,reject:rej});setTimeout(()=>{if(!this.pending.has(id))return;this.pending.delete(id);rej(new Error(method+' timeout'));},timeout);});} close(){try{this.ws.close();}catch{}}}
(async()=>{
 const child=spawn(exe,['--mode','preview','--preview-root',previewRoot],{env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port='+port+' --remote-allow-origins=*'},windowsHide:false,stdio:['ignore','pipe','pipe']});
 let cdp;
 try{
  const target=await waitForTarget(); cdp=new CDP(target.webSocketDebuggerUrl); await cdp.open(); await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  const evalv=async(expr,timeout=15000)=>{const r=await cdp.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout},timeout+1000); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value;};
  const waitFor=async(expr,label,timeout=45000)=>{const st=Date.now();let last;while(Date.now()-st<timeout){try{last=await evalv(expr,5000);if(last===true||(last&&typeof last!=='object'))return last;}catch(e){last=e.message}await sleep(200)}throw new Error('wait '+label+' '+JSON.stringify(last));};
  const clickAt=async(x,y)=>{await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none'});await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
  const shot=async(name)=>{const s=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(outDir,name),Buffer.from(s.data,'base64'));};
  const sample=async()=>evalv(`(()=>{const box=document.querySelector('.dialog-box');const text=document.querySelector('.dialog-text');const speaker=document.querySelector('.speaker');const cont=document.querySelector('.continue-indicator');const player=document.querySelector('[data-testid="game-state-playing"]');const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const css=e=>{if(!e)return null;const s=getComputedStyle(e);return{fontSize:s.fontSize,lineHeight:s.lineHeight,padding:s.padding,display:s.display,overflow:s.overflow}};const overlap=(a,b)=>{if(!a||!b)return 0;return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))};const o={idx:player?.getAttribute('data-current-command-index'),type:player?.getAttribute('data-current-command-type'),box:rect(box),text:rect(text),speaker:rect(speaker),continue:rect(cont),boxClass:box?.className||'',textClass:text?.className||'',speakerClass:speaker?.className||'',textStyle:text?.getAttribute('style'),speakerStyle:speaker?.getAttribute('style'),textCss:css(text),speakerCss:css(speaker),textContent:text?.textContent||'',speakerText:speaker?.textContent||'',bodyText:document.body.innerText.slice(0,500)};o.speakerTextOverlapArea=overlap(o.speaker,o.text);o.speakerTextOverlapRatio=o.speakerTextOverlapArea/(Math.min((o.speaker?.width||0)*(o.speaker?.height||0),(o.text?.width||0)*(o.text?.height||0))||1);return o;})()`);
  await waitFor("document.querySelector('[data-testid=\\\"start-new-game\\\"]') && !document.querySelector('.boot-overlay')",'title');
  const start=await evalv(`(()=>{const e=document.querySelector('[data-testid="start-new-game"]');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`); await clickAt(start.x,start.y);
  await waitFor("!!document.querySelector('.dialog-text')",'dialog'); await sleep(1000);
  const samples=[];
  for(let i=0;i<12;i++){
    const s=await sample(); samples.push(s); await shot(String(i).padStart(2,'0')+'-'+(s.speakerText||'narration')+'.png');
    const point=s.box?{x:s.box.left+s.box.width/2,y:s.box.top+s.box.height/2}:{x:1200,y:1100};
    // click twice: first completes typing/page, second advances
    await clickAt(point.x,point.y); await sleep(250); await clickAt(point.x,point.y); await sleep(900);
  }
  const result={previewRoot,outDir,samples,hasOverlap:samples.some(s=>s.speakerTextOverlapRatio>0.02),maxOverlap:Math.max(...samples.map(s=>s.speakerTextOverlapRatio||0))};
  fs.writeFileSync(path.join(outDir,'result.json'),JSON.stringify(result,null,2),'utf8'); console.log(JSON.stringify(result,null,2));
 }catch(e){console.error(e.stack||e);process.exitCode=1;}finally{if(cdp)cdp.close();child.kill();}
})();
