"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),net=require("node:net");
const {spawn,spawnSync}=require("node:child_process");
const {sha256,inside}=require("./installed-acceptance.cjs");
const {startOwnedViteServer}=require("./owned-vite-server.cjs");
async function freePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once("error",reject);probe.listen(0,"127.0.0.1",()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});}
async function startInstalledEditor(runRoot,{restart=false,visible=false}={}){
  const audit=JSON.parse(fs.readFileSync(path.join(runRoot,"installer-resource-report.json"),"utf8"));assert.equal(audit.status,"PASS");
  const actual=audit.deployments.filter(item=>item.kind==="NSIS actual isolated installation");assert.equal(actual.length,1);const installRoot=actual[0].installedRoot;
  assert.equal(sha256(fs.readFileSync(path.join(installRoot,"agentvn-editor.exe"))),actual[0].executable.sha256);
  const data=path.join(runRoot,"isolated-data"),databasePath=path.join(data,"backend/vn_engine.db"),webviewRoot=path.join(runRoot,"webview");
  assert(inside(runRoot,databasePath)&&inside(runRoot,webviewRoot));
  if(restart)assert(fs.existsSync(databasePath)&&(process.env.E5_LIFECYCLE_SOURCE==="1"||fs.existsSync(webviewRoot)),"Restart must use original data/profile");
  const launches=fs.readdirSync(runRoot).filter(name=>/^owned-launch-\d+$/.test(name));const launchDir=path.join(runRoot,`owned-launch-${launches.length+1}`);fs.mkdirSync(launchDir);
  fs.mkdirSync(path.dirname(databasePath),{recursive:true});
  const backendPort=await freePort(),cdpPort=await freePort();assert.notEqual(backendPort,cdpPort);
  const env={...process.env,AGENTVN_EDITOR_DATA_DIR:data,AGENTVN_BACKEND_DATA_DIR:path.dirname(databasePath),DATABASE_PATH:databasePath,AGENTVN_LEGACY_DATABASE_PATHS:"",AGENTVN_BACKEND_PORT:String(backendPort),AGENTVN_BACKEND_LOG:path.join(launchDir,"backend.log"),AGENTVN_ERROR_LOG_DIR:path.join(launchDir,"errors"),WEBVIEW2_USER_DATA_FOLDER:webviewRoot,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${cdpPort}`};
  const source=process.env.E5_LIFECYCLE_SOURCE==="1";
  let backend,editor,server;const peers=[],stoppedChildren=new WeakSet();
  const state={installRoot,databasePath,webviewRoot,backendPort,cdpPort,startedAt:new Date().toISOString(),launchDir,restart,visible};
  function kill(child){if(!child||stoppedChildren.has(child)||child.exitCode!==null||child.signalCode!==null)return{exitCode:0,alreadyExited:true};const r=spawnSync("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,encoding:"utf8"});if(r.status===0)stoppedChildren.add(child);return{exitCode:r.status,pid:child.pid};}
  async function wait(url,child){const deadline=Date.now()+60000;while(Date.now()<deadline){assert.equal(child.exitCode,null,"Owned installed executable exited");try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,150));}throw new Error(`Owned endpoint readiness timed out: ${url}`);}
  try{
    backend=source?spawn("python",["backend_launcher.py"],{cwd:path.resolve(__dirname,"../../backend"),env,windowsHide:true,stdio:"ignore"}):spawn(path.join(installRoot,"creator-backend.exe"),[],{cwd:installRoot,env,windowsHide:true,stdio:"ignore"});state.backendPid=backend.pid;
    await wait(`http://127.0.0.1:${backendPort}/api/health`,backend);
    if(source){
      const previous=process.env.VITE_BACKEND_URL;process.env.VITE_BACKEND_URL=`http://127.0.0.1:${backendPort}`;
      const sourcePort=restart?Number(new URL(JSON.parse(fs.readFileSync(path.join(runRoot,"installed-processes.json"))).sourceUrl).port):0;
      try{server=await startOwnedViteServer({root:path.resolve(__dirname,"../../editor"),port:sourcePort,logFile:path.join(launchDir,"source-editor.log")});}finally{if(previous===undefined)delete process.env.VITE_BACKEND_URL;else process.env.VITE_BACKEND_URL=previous;}
      state.source=true;state.sourceUrl=server.url;state.editorPid=server.pid;
    }else{
    editor=spawn(path.join(installRoot,"agentvn-editor.exe"),[],{cwd:installRoot,env,windowsHide:!visible,stdio:"ignore"});state.editorPid=editor.pid;
    await wait(`http://127.0.0.1:${cdpPort}/json/version`,editor);
    }
    // Preserve each launch's identity; the canonical file is an explicit live-state
    // index, never a historical acceptance result.
    fs.writeFileSync(path.join(launchDir,"installed-processes.json"),JSON.stringify(state,null,2),{flag:"wx"});
    fs.writeFileSync(path.join(runRoot,"installed-processes.json"),JSON.stringify(state,null,2));
    return{state,async startPeer(){
      assert(!source);const peerPort=await freePort(),peerProfile=path.join(runRoot,`peer-webview-${peers.length+1}`);
      const peer=spawn(path.join(installRoot,"agentvn-editor.exe"),[],{cwd:installRoot,env:{...env,WEBVIEW2_USER_DATA_FOLDER:peerProfile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${peerPort}`},windowsHide:true,stdio:"ignore"});
      peers.push(peer);await wait(`http://127.0.0.1:${peerPort}/json/version`,peer);
      return{pid:peer.pid,cdpPort:peerPort,webviewRoot:peerProfile,backendPid:backend.pid,stop(){return kill(peer);}};
    },async restartFrontend(){
      assert(!source,"Source Chromium is restarted by its browser owner");
      const stopped=kill(editor);assert.equal(stopped.exitCode,0);const nextPort=await freePort();env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=`--remote-debugging-port=${nextPort}`;
      editor=spawn(path.join(installRoot,"agentvn-editor.exe"),[],{cwd:installRoot,env,windowsHide:!visible,stdio:"ignore"});state.editorPid=editor.pid;state.cdpPort=nextPort;
      await wait(`http://127.0.0.1:${nextPort}/json/version`,editor);fs.writeFileSync(path.join(runRoot,"installed-processes.json"),JSON.stringify(state,null,2));return{stopped,newEditorPid:editor.pid,backendPid:backend.pid};
    },async stop(){if(server)await server.stop();const result={editor:server?{exitCode:0,sourceVitePid:server.pid}:kill(editor),backend:kill(backend),peers:peers.map(kill)};fs.writeFileSync(path.join(launchDir,"cleanup.json"),JSON.stringify(result,null,2));return result;}};
  }catch(error){kill(editor);kill(backend);throw error;}
}
module.exports={startInstalledEditor};
