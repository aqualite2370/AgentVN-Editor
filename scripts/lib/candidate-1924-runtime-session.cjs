"use strict";
// Separate installed-candidate binding. Previously sealed QA tools stay intact.
const fs=require("node:fs"),path=require("node:path"),net=require("node:net");
const assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{spawn}=require("node:child_process");
const {chromium}=require("../../editor/node_modules/playwright");
const {rows,listeners,until,ps}=require("./current-native-editor-session.cjs");
const {ownedProcessTree}=require("./owned-process-tree.cjs");
const {stopOwnedProcess}=require("./owned-process-stop.cjs");
const {readInstalledViewport,captureInstalledWebview}=require("./current-native-capture.cjs");
const legacyBase=path.resolve("F:/AgentVN/QA/Editor-1.9.24-20261024-01");
const currentBase=path.resolve("F:/AgentVN/QA/Editor-1.9.30-20261026-01");
const sha=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
function candidateEvidence(file,out){
  if(process.env.AGENTVN_EXIT_CANDIDATE_CONFIG){
    const options=require("./candidate-1924-quick-adapter.cjs").quickCandidate();
    assert.equal(path.resolve(file),path.resolve(options.installation));
    assert.equal(path.dirname(path.resolve(out)),path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
    assert.match(path.basename(out),new RegExp(`^candidate-${options.stamp}-save-\\d{2}$`));
    const installation=require("../candidate-1930-exit.cjs").validateInstallation(file);
    const player=installation.resources.find(f=>path.basename(f.path)==="agentvn-player.exe");
    assert(player);assert.equal(sha(player.path),player.sha256);
    return {player,installation:{path:path.resolve(file),sha256:sha(file)},
      candidateVersion:options.version,
      candidateBindings:[options.bindingFile,...["candidateConfig","installation","predecessor","exported","fixture"]
        .map(k=>options.binding[k].path)].map(f=>({path:path.resolve(f),sha256:sha(f)}))};
  }
  const current=path.resolve(file)===path.join(currentBase,"derived-components-installation-01.json");
  const base=current?currentBase:legacyBase;
  assert.equal(path.resolve(file),path.join(base,current?"derived-components-installation-01.json":"installation.json"));
  assert.equal(path.dirname(path.resolve(out)),path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
  assert.match(path.basename(out),current?/^candidate-1930-save-\d{2}$/:/^candidate-1924-save-\d{2}$/);
  const installation=read(file),packaged=current?null:read(path.join(base,"package-01/report.json"));
  const payload=current?null:read(path.join(base,"payload-01/report.json"));
  assert.equal(installation.status,"PASS");assert.equal(installation.metadataRestoration,"PASS");
  if(current) {
    assert.equal(installation.version,"1.9.30");
    assert.equal(installation.executable.sha256,"a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577");
    assert.equal(sha(installation.actualInstallation.path),installation.actualInstallation.sha256);
    const actual=read(installation.actualInstallation.path);
    assert(actual.status==="PASS"&&actual.exitCode===0&&actual.registryRestored);
    assert.equal(actual.executable.sha256,installation.executable.sha256);
  }else assert.equal(installation.executable.version,"1.9.24");
  assert.equal(path.resolve(installation.installRoot),path.join(base,current?"install-01/installed-nsis":"installed-editor"));
  assert.equal(path.resolve(installation.executable.path),path.join(installation.installRoot,"agentvn-editor.exe"));
  for(const receipt of current?[]:[packaged,payload]){
    assert.equal(receipt.status,"PASS");assert.equal(receipt.candidateVersion,"1.9.24");
  }
  if(!current) {
    assert.equal(payload.installerFormat,"nsis");
    assert.equal(installation.package.sha256,packaged.installer.sha256);
    assert.equal(payload.archived[0].sha256,packaged.installer.sha256);
  }
  for(const item of [installation.executable,...installation.resources,...installation.protectedFiles,
    ...(current?[]:[packaged.installer,packaged.retainedInstaller])])assert.equal(sha(item.path),item.sha256,item.path);
  const player=installation.resources.find(f=>path.basename(f.path)==="agentvn-player.exe");
  assert(player);assert.equal(player.sha256,current?"296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa":packaged.player.sha256);
  assert.equal(path.resolve(player.path),path.join(installation.installRoot,"agentvn-player.exe"));
  return {player,installation:{path:file,sha256:sha(file)},installer:current?installation.protectedFiles.find(f=>f.path.endsWith(".exe")&&/releases/i.test(f.path)):packaged.installer};
}
async function candidateRuntimeSession({file,out,input,layout,report,save}){
  const evidence=candidateEvidence(file,out),executable=evidence.player;
  assert.equal(path.dirname(path.resolve(input)),path.resolve(out));
  assert(!rows().some(p=>p.Name==="agentvn-player.exe"),"Do not share an active Player");
  const port=await new Promise((resolve,reject)=>{
    const server=net.createServer();server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{const p=server.address().port;server.close(e=>e?reject(e):resolve(p));});
  });
  assert.equal(listeners([port]).length,0);
  const env={...process.env};
  for(const key of Object.keys(env))if(/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(key))delete env[key];
  const temporary=path.join(out,`temporary-${layout}`);fs.mkdirSync(temporary);
  Object.assign(env,{WEBVIEW2_USER_DATA_FOLDER:path.join(out,`webview-${layout}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,TEMP:temporary,TMP:temporary,
    AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:out});
  const child=spawn(executable.path,["--mode","preview"],{
    cwd:path.dirname(executable.path),env,windowsHide:true,stdio:"ignore"});
  const launch={layout,pid:child.pid,port,executable,receipt:evidence.installation,
    isolation:{project:input,output:out,webview:env.WEBVIEW2_USER_DATA_FOLDER},
    mode:"preview",normalCloseClaimed:false};
  report.launches.push(launch);
  const known=new Map();let browser,cdp,page,viewport;
  function remember(){
    const tree=ownedProcessTree(rows(),child.pid,launch.identity?.Created);
    if(tree.length){
      assert.equal(path.resolve(tree[0].ExecutablePath),path.resolve(executable.path));
      launch.identity??=tree[0];
    }
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
      "candidate installed exact process cleanup",15000);
    launch.cleanup={status:"PASS",stopped,normalCloseClaimed:false};
    candidateEvidence(file,out);save();
  }
  try{
    remember();
    await until(async()=>{assert.equal(child.exitCode,null);try{
      return(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(700)})).ok;
    }catch{return false;}},"candidate installed Runtime WebView",45000);
    remember();const sockets=listeners([port]);assert.equal(sockets.length,1);
    assert([...known.values()].some(p=>p.ProcessId===sockets[0].OwningProcess));
    browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const diagnostic=await browser.newBrowserCDPSession(),{gpu}=await diagnostic.send("SystemInfo.getInfo");
    launch.renderer={features:gpu.featureStatus,devices:gpu.devices,renderer:gpu.auxAttributes.glRenderer};
    assert.equal(gpu.featureStatus.gpu_compositing,"enabled");await diagnostic.detach();
    page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri\.localhost/.test(p.url())),"candidate installed Runtime page");
    cdp=await page.context().newCDPSession(page);
    return {page,close,async setViewport(value){
      await cdp.send("Emulation.setDeviceMetricsOverride",{
        width:value.width,height:value.height,deviceScaleFactor:value.dpr,mobile:false});
      await page.emulateMedia({reducedMotion:value.reduced?"reduce":"no-preference"});
      viewport=value;return readInstalledViewport(page,value);
    },shot:file=>captureInstalledWebview(page,cdp,file,viewport)};
  }catch(error){
    try{await close();}catch(cleanup){launch.cleanupError=String(cleanup.stack||cleanup);save();}
    throw error;
  }
}
module.exports={candidateEvidence,candidateRuntimeSession};
