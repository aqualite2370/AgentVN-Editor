"use strict";
// Independent receipt adapter; keep the previously recorded opening tools intact.
const fs=require("node:fs"),path=require("node:path"),net=require("node:net"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawn}=require("node:child_process");
const {chromium}=require("../../editor/node_modules/playwright");
const {rows,listeners,until,ps}=require("./current-native-editor-session.cjs");
const {ownedProcessTree}=require("./owned-process-tree.cjs");
const {stopOwnedProcess}=require("./owned-process-stop.cjs");
const {captureInstalledWebview,readInstalledViewport}=require("./current-native-capture.cjs");
const base=path.resolve("F:/AgentVN/QA/Editor-1.9.24-20261024-01");
const sha=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
function openingCandidateEvidence(file,out){
  assert.equal(path.resolve(file),path.join(base,"installation.json"));
  assert.equal(path.dirname(path.resolve(out)),path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
  assert.match(path.basename(out),/^opening-installed-1924-\d{2}$/);
  const installed=read(file),packaged=read(path.join(base,"package-01/report.json"));
  const payload=read(path.join(base,"payload-01/report.json"));
  assert.equal(installed.status,"PASS");assert.equal(installed.metadataRestoration,"PASS");
  assert.equal(installed.executable.version,"1.9.24");
  assert.equal(path.resolve(installed.installRoot),path.join(base,"installed-editor"));
  for(const r of [packaged,payload]){
    assert.equal(r.status,"PASS");assert.equal(r.candidateVersion,"1.9.24");
  }
  assert.equal(payload.installerFormat,"nsis");
  assert.equal(installed.package.sha256,packaged.installer.sha256);
  assert.equal(payload.archived[0].sha256,packaged.installer.sha256);
  for(const f of [installed.executable,...installed.resources,...installed.protectedFiles,
    packaged.installer,packaged.retainedInstaller])assert.equal(sha(f.path),f.sha256,f.path);
  const player=installed.resources.find(f=>path.basename(f.path)==="agentvn-player.exe");assert(player);
  assert.equal(path.resolve(player.path),path.join(installed.installRoot,"agentvn-player.exe"));
  assert.equal(player.sha256,packaged.player.sha256);
  return {executable:player,receipt:{path:file,sha256:sha(file)}};
}
async function candidateOpeningSession({installationFile,out,report,save,viewport,index,input}){
  const {executable,receipt}=openingCandidateEvidence(installationFile,out);
  assert.equal(path.dirname(path.resolve(input)),path.resolve(out));assert(fs.existsSync(input));
  assert(!rows().some(p=>p.Name==="agentvn-player.exe"),"Do not share a live Player");
  const port=await new Promise((resolve,reject)=>{
    const server=net.createServer();server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{const p=server.address().port;server.close(e=>e?reject(e):resolve(p));});
  });
  assert.equal(listeners([port]).length,0);
  const env={...process.env};
  for(const k of Object.keys(env))if(/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(k))delete env[k];
  const temporary=path.join(out,"temporary");fs.mkdirSync(temporary,{recursive:true});
  Object.assign(env,{WEBVIEW2_USER_DATA_FOLDER:path.join(out,`webview-${index}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:out,TEMP:temporary,TMP:temporary});
  const child=spawn(executable.path,["--mode","preview"],{
    cwd:path.dirname(executable.path),env,windowsHide:true,stdio:"ignore"});
  const launch={pid:child.pid,port,executable,receipt,index,viewport,mode:"preview",normalCloseClaimed:false,
    isolation:{AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:out,webview:env.WEBVIEW2_USER_DATA_FOLDER}};
  report.launches.push(launch);
  const known=new Map();let browser,page,cdp;
  function remember(){
    const tree=ownedProcessTree(rows(),child.pid,launch.identity?.Created);
    if(tree.length){
      assert.equal(path.resolve(tree[0].ExecutablePath),path.resolve(executable.path));launch.identity??=tree[0];
    }
    for(const p of tree)known.set(`${p.ProcessId}:${p.Created}`,p);
    launch.knownProcesses=[...known.values()];save();
  }
  async function close(){
    remember();await browser?.close().catch(()=>{});
    const killed=[];
    for(const p of [...known.values()].reverse()){
      if(!rows().some(n=>n.ProcessId===p.ProcessId&&n.Created===p.Created))continue;
      stopOwnedProcess(p,ps);killed.push(`${p.ProcessId}:${p.Created}`);
    }
    await until(()=>!rows().some(n=>known.has(`${n.ProcessId}:${n.Created}`))&&!listeners([port]).length,
      "candidate opening exact cleanup",15000);
    launch.cleanup={status:"PASS",killed,normalCloseClaimed:false};
    assert.equal(sha(executable.path),executable.sha256);save();
  }
  try{
    remember();
    await until(async()=>{assert.equal(child.exitCode,null);try{
      return(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(700)})).ok;
    }catch{return false;}},"candidate opening WebView",45000);
    remember();const sockets=listeners([port]);assert.equal(sockets.length,1);
    assert([...known.values()].some(p=>p.ProcessId===sockets[0].OwningProcess));
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const diagnostic=await browser.newBrowserCDPSession(),{gpu}=await diagnostic.send("SystemInfo.getInfo");
    launch.renderer={features:gpu.featureStatus,devices:gpu.devices,renderer:gpu.auxAttributes.glRenderer};
    assert.equal(gpu.featureStatus.gpu_compositing,"enabled");await diagnostic.detach();
    page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri\.localhost/.test(p.url())),"candidate opening page");
    cdp=await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride",{
      width:viewport.width,height:viewport.height,deviceScaleFactor:viewport.dpr,mobile:false});
    await page.emulateMedia({reducedMotion:viewport.reduced?"reduce":"no-preference"});
    await readInstalledViewport(page,viewport);
    return {page,close,shot:f=>captureInstalledWebview(page,cdp,f,viewport)};
  }catch(error){
    try{await close();}catch(cleanup){launch.cleanupError=String(cleanup.stack||cleanup);save();}
    throw error;
  }
}
module.exports={candidateOpeningSession,openingCandidateEvidence};
