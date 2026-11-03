"use strict";
// Wrap established old/current actual UI flows with current-chain identity,
// native ZIP bytes and finally cleanup. No store or database writes.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {spawnSync}=require("node:child_process"),{chromium}=require("../editor/node_modules/playwright");
const JSZip=require("../editor/node_modules/jszip");
const {rows,listeners,ps,until}=require("./lib/current-native-editor-session.cjs");
const {ownedProcessTree}=require("./lib/owned-process-tree.cjs");
const {sha256}=require("./lib/installed-acceptance.cjs");
function chainConfig(chain) {
  assert(["recent-en","recent-zh","cross-en","cross-zh","nsis-recent"].includes(chain));
  const nsis=chain==="nsis-recent";
  return {
    root: nsis ? "F:/AgentVN/QA/Current-NSIS-Upgrade-20261021-01"
      : path.resolve("F:/AgentVN/QA/Current-MSI-Upgrade-20261021-02",chain),
    install: nsis ? "F:/AgentVN/QA/Current-NSIS-Upgrade-20261021-01/installed-editor"
      : "D:/agentvntest/AgentVN Editor",
    kind: nsis ? "NSIS" : "MSI",
    oldVersion: chain.startsWith("cross-") ? "1.7.1" : "1.9.8"
  };
}
if(process.argv[2]==="--self-test"){
  for(const chain of ["recent-en","recent-zh","cross-en","cross-zh"]){
    const c=chainConfig(chain);
    assert.equal(c.kind,"MSI");assert.equal(c.install,"D:/agentvntest/AgentVN Editor");
    assert.equal(c.oldVersion,chain.startsWith("cross-")?"1.7.1":"1.9.8");
    assert.equal(path.resolve(c.root),path.resolve("F:/AgentVN/QA/Current-MSI-Upgrade-20261021-02",chain));
  }
  const c=chainConfig("nsis-recent");
  assert.equal(c.kind,"NSIS");assert.equal(c.oldVersion,"1.9.8");
  assert.equal(c.root,"F:/AgentVN/QA/Current-NSIS-Upgrade-20261021-01");
  assert.equal(path.dirname(c.install),c.root);
  for(const bad of ["","incident","../recent-en","nsis-recent/..","NSIS","D:/AgentVN"])
    assert.throws(()=>chainConfig(bad));
  console.log("PASS: five explicit UI session identities and six unrelated-session rejections; no launch");process.exit(0);
}
const [chain,phase]=process.argv.slice(2);
const config=chainConfig(chain);
assert(["old","new","restart"].includes(phase));
const root=path.resolve(config.root);
const destination=path.join(root,`${phase}-ui-01`),ownership=path.join(root,`${phase}-owned-01.json`);
assert(!fs.existsSync(destination)&&!fs.existsSync(ownership),"Fresh UI/ownership evidence required");
assert(process.env.AGENTVN_TEST_PROJECT&&process.env.AGENTVN_WORKSPACE_OUTPUT);
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const launch=read(path.join(root,phase+"-launch.json"));
const expectedVersion=phase==="old"?config.oldVersion:"1.9.16";
assert.equal(launch.status,"PASS");assert.equal(launch.actualVersion,expectedVersion);
assert.equal(launch.installerKind,config.kind);
assert.equal(path.resolve(launch.installRoot),path.resolve(config.install));
assert(!launch.dataDirectoryOverride&&!launch.webviewDirectoryOverride&&!launch.manualBackendSpawn);
const protection=read(path.join(root,"profile-protection.json"));
assert.equal(protection.records.length,2);
for(const record of protection.records)assert(fs.existsSync(record.held));
const report={status:"RUNNING",scope:`REAL_INSTALLED_${config.kind}_UPGRADE_CHAIN_UI_AND_OWNED_TERMINATION`,
  chain,phase,startedAt:new Date().toISOString(),launch,testProject:process.env.AGENTVN_TEST_PROJECT,
  workspaceOutput:process.env.AGENTVN_WORKSPACE_OUTPUT,knownProcesses:[],realModelRequests:0,
  physicalInputVerified:false,cleanup:{status:"NOT_RUN"},screenshots:[],error:null};
const known=new Map(),id=p=>`${p.ProcessId}:${p.Created}`;
const save=()=>fs.writeFileSync(ownership,JSON.stringify(report,null,2));
let browser,page,editor;
function remember(){
  const live=rows();assert(editor);
  for(const p of ownedProcessTree(live,editor.ProcessId,editor.Created))known.set(id(p),p);
  report.knownProcesses=[...known.values()];save();return live;
}
(async()=>{
  const candidates=rows().filter(p=>p.Name==="agentvn-editor.exe");assert.equal(candidates.length,1);
  editor=candidates[0];
  assert.equal(path.resolve(editor.ExecutablePath),path.resolve(path.join(launch.installRoot,"agentvn-editor.exe")));
  assert.equal(sha256(fs.readFileSync(editor.ExecutablePath)),launch.executableSha256);remember();
  await until(()=>listeners([8278,launch.cdpPort]).length>=2,"Actual installed backend/CDP startup",60000);
  remember();report.listeners=listeners([8278,launch.cdpPort]);
  assert(report.listeners.every(l=>[...known.values()].some(p=>p.ProcessId===l.OwningProcess)));
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes("tauri.localhost")),"Installed page");
  const cdp=await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await page.emulateMedia({reducedMotion:"no-preference"});
  report.displayScope="Real installed WebView viewport simulation; 1080p DPR1 ordinary installation smoke, not full matrix";
  const downloads="C:/Users/1/Downloads",before=new Set(fs.readdirSync(downloads));
  const script=path.join(__dirname,phase==="old"?"host-msi-old-ui-baseline.cjs":"host-upgrade-installed-ui.cjs");
  const args=[script,path.join(root,phase+"-launch.json"),destination,
    ...(phase==="old"?["create"]:[phase==="new"?"first":"restart","1.9.16"])];
  const child=spawnSync(process.execPath,args,{windowsHide:true,encoding:"utf8",timeout:180000,
    env:{...process.env,AGENTVN_WORKSPACE_OUTPUT:destination},maxBuffer:4*1024*1024});
  fs.writeFileSync(path.join(root,phase+"-ui-console.log"),String(child.stdout||"")+String(child.stderr||""),{flag:"wx"});
  report.command=[process.execPath,...args];report.childExitCode=child.status;
  const ui=read(path.join(destination,"report.json"));report.uiReport={path:path.join(destination,"report.json"),
    sha256:sha256(fs.readFileSync(path.join(destination,"report.json")))};
  assert.equal(child.status,0,child.stderr||child.error?.message);assert.equal(ui.status,"PASS",ui.error);
  report.screenshots=ui.screenshots;
  if(phase!=="restart"){
    const baseline=phase==="old"?ui:read(path.join(root,"old-ui-data-created.json"));
    const project=phase==="old"?ui.project:ui.savedProject;
    assert(project?.metadata.projectId);
    if(expectedVersion==="1.7.1"){
      assert(ui.package&&fs.existsSync(ui.package.path));report.package=ui.package;
    }else{
      const title=baseline.project.metadata.title;
      const files=fs.readdirSync(downloads).filter(name=>!before.has(name)&&name.startsWith(title+"_")&&name.endsWith(".vnproj"));
      assert.equal(files.length,1,"Exactly one newly created matching native project package required");
      const source=path.join(downloads,files[0]),bytes=fs.readFileSync(source),zip=await JSZip.loadAsync(bytes);
      const packed=JSON.parse(await zip.file("project.json").async("string"));
      assert.equal(packed.project_id,project.metadata.projectId);assert.equal(packed.title,project.metadata.title);
      assert.equal(packed.author,project.metadata.author);assert.deepEqual(packed.nodes,project.graph.nodes);
      assert.deepEqual(packed.edges,project.graph.edges);
      const retained=path.join(destination,"native-export.vnproj");fs.writeFileSync(retained,bytes,{flag:"wx"});
      report.package={source,retained,sha256:sha256(bytes),bytes:bytes.length,absentBefore:true,sourceRemoved:false};
      const dialog=page.getByRole("dialog",{name:"工程已导出",exact:true});
      if(await dialog.isVisible())await dialog.getByRole("button",{name:"OK",exact:true}).click();
    }
  }
  const hostLog=path.join(launch.installRoot,"error_log/editor-desktop.log"),text=fs.readFileSync(hostLog,"utf8");
  const lines=text.split(/\r?\n/).filter(line=>line.includes("Packaged backend data dir: "));
  const expectedDatabase=expectedVersion==="1.7.1"?path.join(launch.installRoot,"data/backend/vn_engine.db"):launch.databasePath;
  assert(lines.at(-1)?.includes(path.dirname(expectedDatabase)));
  assert(text.includes("Using bundled editor frontend."));
  fs.copyFileSync(hostLog,path.join(destination,"actual-host.log"),fs.constants.COPYFILE_EXCL);
  report.database={path:expectedDatabase,sha256:sha256(fs.readFileSync(expectedDatabase)),hostLine:lines.at(-1)};
  assert(fs.existsSync(launch.webviewRoot));report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
  .finally(async()=>{
    await browser?.close().catch(()=>{});
    try{
      if(editor){
        remember();const stopped=[];
        for(const p of [...known.values()]){
          const current=rows().find(a=>id(a)===id(p));if(!current)continue;
          assert.equal(current.ExecutablePath,p.ExecutablePath);
          ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';`+
            `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
          stopped.push(id(p));
        }
        const live=rows(),survivors=[...known.values()].filter(p=>live.some(a=>id(a)===id(p))),ports=listeners([8278,launch.cdpPort]);
        report.cleanup={status:survivors.length||ports.length?"FAILED":"PASS",stopped,survivors,ports,
          method:"Exact captured PID/creation/path termination; not physical or normal close"};
        assert.equal(report.cleanup.status,"PASS");
      }
    }catch(e){report.status="FAILED";report.cleanup.status="FAILED";report.cleanup.error=String(e.stack||e);process.exitCode=1;}
    report.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({status:report.status,chain,phase,cleanup:report.cleanup.status,error:report.error},null,2));
  });
