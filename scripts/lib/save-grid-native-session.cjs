"use strict";
// Separate receipt binding: previously recorded save-page tools remain unchanged.
const fs=require("node:fs"),path=require("node:path"),net=require("node:net"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawn}=require("node:child_process");
const {chromium}=require("../../editor/node_modules/playwright");
const {rows,listeners,until,ps}=require("./current-native-editor-session.cjs");
const {ownedProcessTree}=require("./owned-process-tree.cjs");
const {stopOwnedProcess}=require("./owned-process-stop.cjs");
const {readInstalledViewport,captureInstalledWebview}=require("./current-native-capture.cjs");
const root=path.resolve(__dirname,"../..");
const sha=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function saveGridBuildEvidence(file,out){
  assert.equal(path.resolve(file),path.resolve("F:/AgentVN/QA/Runtime-Save-Grid-Fit-20261024-01/build-02/report.json"));
  assert.equal(path.dirname(path.resolve(out)),path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
  assert.match(path.basename(out),/^save-grid-native02-\d{2}$/);
  const build=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(build.status,"PASS");assert.equal(build.phase,"build");
  assert.deepEqual(build.commands.map(c=>c.label),["editor-typecheck","editor-build","gamecli-build","full-dev"]);
  assert(build.commands.every(c=>c.status==="PASS"&&c.exitCode===0));
  assert.equal(path.resolve(build.player.path),path.join(root,"editor/src-tauri/binaries/agentvn-player.exe"));
  assert.equal(path.resolve(build.dev.path),path.join(root,"AgentVN Dev.exe"));
  for(const file of [build.player,build.dev,...build.sources,...build.bundled,...build.frozen])
    assert.equal(sha(file.path),file.sha256,file.path);
  assert.equal(sha(path.join(root,"GameCli_framework/src-tauri/target/release/agentvn-player.exe")),build.player.sha256);
  return {player:build.player,receipt:{path:file,sha256:sha(file)}};
}
async function saveGridNativeSession({file,out,input,layout,report,save}){
  const evidence=saveGridBuildEvidence(file,out),executable=evidence.player;
  assert.equal(path.dirname(path.resolve(input)),path.resolve(out));
  assert(!rows().some(p=>p.Name==="agentvn-player.exe"),"Do not share an active Player");
  const port=await new Promise((resolve,reject)=>{
    const socket=net.createServer();socket.once("error",reject);
    socket.listen(0,"127.0.0.1",()=>{const value=socket.address().port;socket.close(e=>e?reject(e):resolve(value));});
  });
  assert.equal(listeners([port]).length,0);
  const env={...process.env};
  for(const key of Object.keys(env))if(/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(key))delete env[key];
  const temp=path.join(out,`temporary-${layout}`);fs.mkdirSync(temp);
  Object.assign(env,{WEBVIEW2_USER_DATA_FOLDER:path.join(out,`webview-${layout}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,TEMP:temp,TMP:temp,
    AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:out});
  const child=spawn(executable.path,["--mode","preview"],{cwd:path.dirname(executable.path),env,windowsHide:true,stdio:"ignore"});
  const launch={layout,pid:child.pid,port,executable,receipt:evidence.receipt,mode:"preview",normalCloseClaimed:false};
  report.launches.push(launch);
  const known=new Map();let browser,cdp,page,viewport;
  function remember(){
    const tree=ownedProcessTree(rows(),child.pid,launch.identity?.Created);
    if(tree.length){assert.equal(path.resolve(tree[0].ExecutablePath),path.resolve(executable.path));launch.identity??=tree[0];}
    for(const p of tree)known.set(`${p.ProcessId}:${p.Created}`,p);
    launch.knownProcesses=[...known.values()];save();
  }
  async function close(){
    remember();await browser?.close().catch(()=>{});
    const stopped=[];
    for(const p of [...known.values()].reverse()){
      if(!rows().some(n=>n.ProcessId===p.ProcessId&&n.Created===p.Created))continue;
      stopOwnedProcess(p,ps);stopped.push(`${p.ProcessId}:${p.Created}`);
    }
    await until(()=>!rows().some(n=>known.has(`${n.ProcessId}:${n.Created}`))&&!listeners([port]).length,
      "save-grid exact process cleanup",15000);
    launch.cleanup={status:"PASS",stopped,normalCloseClaimed:false};
    assert.equal(sha(executable.path),executable.sha256);save();
  }
  try{
    remember();
    await until(async()=>{assert.equal(child.exitCode,null);try{
      return(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(700)})).ok;
    }catch{return false;}},"save-grid native WebView");
    remember();const socket=listeners([port]);assert.equal(socket.length,1);
    assert([...known.values()].some(p=>p.ProcessId===socket[0].OwningProcess));
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const diagnostic=await browser.newBrowserCDPSession(),{gpu}=await diagnostic.send("SystemInfo.getInfo");
    launch.renderer={features:gpu.featureStatus,devices:gpu.devices,renderer:gpu.auxAttributes.glRenderer};
    assert.equal(gpu.featureStatus.gpu_compositing,"enabled");await diagnostic.detach();
    page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri\.localhost/.test(p.url())),"save-grid page");
    cdp=await page.context().newCDPSession(page);
    return {page,close,async setViewport(value){
      await cdp.send("Emulation.setDeviceMetricsOverride",{width:value.width,height:value.height,deviceScaleFactor:value.dpr,mobile:false});
      await page.emulateMedia({reducedMotion:value.reduced?"reduce":"no-preference"});viewport=value;
      return readInstalledViewport(page,value);
    },shot:file=>captureInstalledWebview(page,cdp,file,viewport)};
  }catch(error){
    try{await close();}catch(cleanup){launch.cleanupError=String(cleanup.stack||cleanup);save();}
    throw error;
  }
}
module.exports={saveGridBuildEvidence,saveGridNativeSession};
