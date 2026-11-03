"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const {DatabaseSync}=require("node:sqlite");
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
function validateOwned(row){
  assert.equal(row.status,"PASS");assert.equal(row.cleanup.status,"PASS");
  assert.equal(row.cleanup.survivors.length,0);assert.equal(row.cleanup.ports.length,0);
  assert(row.knownProcesses.length>=3&&row.cleanup.stopped.length>0);
  assert.equal(row.realModelRequests,0);assert.equal(row.physicalInputVerified,false);
  assert(!row.launch.dataDirectoryOverride&&!row.launch.webviewDirectoryOverride&&!row.launch.manualBackendSpawn);
}
function preserved(before,after,where="root"){
  if(Array.isArray(before)){
    assert(Array.isArray(after),where);assert.equal(after.length,before.length,where);
    before.forEach((item,index)=>preserved(item,after[index],where+"["+index+"]"));
  }else if(before&&typeof before==="object"){
    for(const [key,value]of Object.entries(before)){
      if(key==="measured"||key==="updatedAt")continue; // Presentation measurement / persistence timestamp only.
      assert(after&&Object.hasOwn(after,key),where+"."+key);
      preserved(value,after[key],where+"."+key);
    }
  }else assert.deepEqual(after,before,where);
}
if(process.argv[2]==="--self-test"){
  const good={status:"PASS",cleanup:{status:"PASS",survivors:[],ports:[],stopped:[1]},
    knownProcesses:[1,2,3],realModelRequests:0,physicalInputVerified:false,
    launch:{dataDirectoryOverride:false,webviewDirectoryOverride:false,manualBackendSpawn:false}};
  validateOwned(good);
  for(const mutate of [
    r=>r.status="FAILED",r=>r.cleanup.status="NOT_RUN",r=>r.cleanup.ports=[{}],
    r=>r.cleanup.survivors=[{}],r=>r.cleanup.stopped=[],r=>r.knownProcesses=[],
    r=>r.realModelRequests=1,r=>r.physicalInputVerified=true,
    r=>r.launch.dataDirectoryOverride=true,r=>r.launch.webviewDirectoryOverride=true,r=>r.launch.manualBackendSpawn=true,
  ]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateOwned(bad));}
  preserved({position:{x:1},commands:[{text:"old"}],measured:{height:2}},
    {position:{x:1},commands:[{text:"old"}],measured:{height:9},newDefault:true});
  assert.throws(()=>preserved({position:{x:1}},{position:{x:2}}));
  assert.throws(()=>preserved({commands:[{text:"old"}]},{commands:[{text:"lost"}]}));
  assert.throws(()=>preserved({edges:[{id:"old"}]},{edges:[]}));
  console.log("PASS: eleven bad ownership envelopes and three semantic data-loss cases rejected; self-test only");
  process.exit(0);
}
const [chain,attempt="01"]=process.argv.slice(2);
assert(["recent-en","recent-zh","cross-en","cross-zh"].includes(chain));assert(/^\d\d$/.test(attempt));
const root=path.resolve("F:/AgentVN/QA/Current-MSI-Upgrade-20261021-02",chain);
const backup=path.resolve("F:/AgentVN/Checkpoints/Current-MSI-Upgrade-20261021-02",chain);
const destination=path.join(root,`terminal-audit-${attempt}.json`);
assert(!fs.existsSync(destination),"Fresh audit required");
const report={status:"RUNNING",scope:"CURRENT_MSI_REAL_OLD_UPGRADE_UI_RESTART_AND_RESTORATION_NOT_FULL_ACCEPTANCE",
  chain,at:new Date().toISOString(),checks:[],sources:[],screenshots:[],downloads:[],
  originalDirectoryFailure:"UNCHANGED_FAILED",physicalInputVerified:false,realModelRequests:0,error:null};
function source(file){report.sources.push({path:file,sha256:sha(file),bytes:fs.statSync(file).size});return read(file);}
function check(name,fn){const detail=fn();report.checks.push({name,status:"PASS",detail});}
function inventory(directory,expected){
  const actual=[];
  function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    assert(!entry.isSymbolicLink());const file=path.join(folder,entry.name);
    if(entry.isDirectory())walk(file);else actual.push(path.relative(directory,file));
  }}walk(directory);assert.equal(actual.length,expected.length);
  for(const file of expected){const full=path.join(directory,file.relative);
    assert.equal(fs.statSync(full).size,file.bytes);assert.equal(sha(full),file.sha256);}
  return expected.length;
}
try{
  const baseVersion=chain.startsWith("recent")?"1.9.8":"1.7.1";
  const old=source(path.join(root,"old-ui-01/report.json"));
  const first=source(path.join(root,"new-ui-01/report.json"));
  const restart=source(path.join(root,"restart-ui-01/report.json"));
  const installed=source(path.join(root,"Install.json")),upgraded=source(path.join(root,"Upgrade.json"));
  check("Real trusted old/current MSI major upgrade and actual uninstall, real elevation",()=>{
    const uninstall=source(path.join(root,"Uninstall.json"));
    for(const [phase,row]of [["Install",installed],["Upgrade",upgraded],["Uninstall",uninstall]]){
      const parent=source(path.join(root,phase+"-elevation.json"));
      assert.equal(row.status,"PASS");assert.equal(row.isElevated,true);assert.equal(row.exitCode,0);
      assert.equal(parent.parentElevated,false);assert.equal(parent.status,"PASS");
      assert.equal(sha(row.package.path),row.package.sha256);
      assert.equal(row.arguments[0],phase==="Uninstall"?"/x":"/i");
      assert(fs.statSync(row.log).size>0);
      report.sources.push({path:row.log,sha256:sha(row.log),bytes:fs.statSync(row.log).size});
    }
    assert.equal(installed.version,baseVersion);assert.equal(upgraded.version,"1.9.16");
    assert.equal(upgraded.registrationsBefore.length,1);
    assert.equal(upgraded.registrationsBefore[0].PSChildName,installed.registration.PSChildName);
    assert.notEqual(upgraded.registration.PSChildName,installed.registration.PSChildName);
    assert.equal(upgraded.registrationsAfter.length,1);
    assert.equal(installed.installRoot,upgraded.installRoot);
    assert(!fs.existsSync(path.join(installed.installRoot,"agentvn-editor.exe")));
    return {oldVersion:baseVersion,currentVersion:"1.9.16",sameInstallRoot:installed.installRoot,
      oldProductCode:installed.registration.PSChildName,newProductCode:upgraded.registration.PSChildName};
  });
  check("Old persistence bytes kept by actual MSI before first current-version launch",()=>{
    assert.equal(upgraded.persistenceUnchangedBeforeFirstNewLaunch,true);
    assert(upgraded.persistenceBefore.length>=(baseVersion==="1.7.1"?3:2));
    let count=0;for(const row of upgraded.persistenceBefore)count+=inventory(row.archive,row.files);
    return {snapshots:upgraded.persistenceBefore.length,files:count,scope:"Before first new launch, not immutable during normal app writes"};
  });
  check("Three actual UI phases and distinct owned default-shortcut processes, no residuals",()=>{
    const pids=[],identities=[];
    for(const phase of ["old","new","restart"]){
      const owned=source(path.join(root,phase+"-owned-01.json"));validateOwned(owned);
      const launch=source(path.join(root,phase+"-launch.json"));
      assert.equal(launch.executableSha256,phase==="old"?installed.executable.sha256:upgraded.executable.sha256);
      assert.equal(sha(owned.uiReport.path),owned.uiReport.sha256);
      const editor=owned.knownProcesses.find(p=>p.Name==="agentvn-editor.exe");
      pids.push(editor.ProcessId);identities.push(`${editor.ProcessId}:${editor.Created}`);
      if(owned.package)report.downloads.push(owned.package);
      for(const capture of owned.screenshots){
        assert.equal(sha(capture.path),capture.sha256);assert.deepEqual(capture.before,capture.after);
        assert.equal(capture.before.width,1920);assert.equal(capture.before.height,1080);
        assert.equal(capture.before.dpr,1);assert.equal(capture.before.reduced,false);
        const png=fs.readFileSync(capture.path);assert.equal(png.readUInt32BE(16),1920);assert.equal(png.readUInt32BE(20),1080);
        report.screenshots.push(capture);
      }
    }
    assert.equal(new Set(identities).size,3);assert(report.screenshots.length>=7);
    return {nativeProcesses:3,pids,identities,screenshots:report.screenshots.length};
  });
  check("Real old graph/metadata preserved and new edit survives true current-version restart",()=>{
    assert.equal(old.status,"PASS");assert.equal(first.status,"PASS");assert.equal(restart.status,"PASS");
    assert(first.checks.length>=6&&first.checks.every(c=>c.status==="PASS"));
    assert(restart.checks.length>=6&&restart.checks.every(c=>c.status==="PASS"));
    preserved(old.project.graph,first.resumedProject.graph,"old graph");
    preserved(old.project.metadata,first.resumedProject.metadata,"old metadata");
    assert.equal(restart.resumedProject.metadata.projectId,old.project.metadata.projectId);
    assert.deepEqual(restart.resumedProject.graph,first.savedProject.graph);
    assert.equal(first.theme.tone,old.localStorage["agentvn.themeTone"]);
    assert.equal(restart.theme.tone,old.localStorage["agentvn.themeTone"]);
    return {projectId:old.project.metadata.projectId,nodes:old.project.graph.nodes.length,
      measuredGeometryExcluded:true,allOtherExistingGraphFieldsChecked:true};
  });
  check("Original default profiles, legacy database and original shortcuts restored",()=>{
    const protection=source(path.join(root,"profile-protection.json"));
    const restored=source(path.join(root,"profile-restoration.json"));
    const legacy=source(path.join(root,"RestoreLegacy.json"));
    const shortcuts=source(path.join(root,"RestoreShortcuts.json"));
    const checkpoint=source(path.join(backup,"checkpoint.json"));
    assert.equal(checkpoint.status,"PASS");inventory(path.join(backup,"installation"),checkpoint.files);
    assert.equal(restored.status,"PASS");assert.equal(restored.originalsRestored,true);
    assert.equal(restored.deletedUserFiles,0);assert.equal(restored.records.length,2);
    assert.equal(legacy.status,"PASS");assert.equal(legacy.deletedUserFiles,0);
    inventory(legacy.source,legacy.files);assert(!fs.existsSync(legacy.held));
    for(const row of protection.records){
      assert(!fs.existsSync(row.held));
      const result=spawnSync("fsutil.exe",["file","queryfileid",row.original],{encoding:"utf8",windowsHide:true});
      assert.equal(result.status,0,result.stderr);
      assert.equal(result.stdout.match(/0x[0-9a-fA-F]+/)?.[0].toLowerCase(),row.directoryId);
      if(row.byteInventory)inventory(row.original,row.files);
    }
    assert.equal(shortcuts.status,"PASS");for(const link of checkpoint.shortcuts)assert.equal(sha(link.path),link.sha256);
    return {originalProfiles:2,roamingBytesVerified:true,localVerification:"NTFS identity only",legacyFiles:legacy.files.length};
  });
  check("Actual old/new SQLite integrity and persisted semantic graph",()=>{
    const snapshots=upgraded.persistenceBefore;
    const before=snapshots.find(r=>r.archive.endsWith(baseVersion==="1.7.1"?"install-local":"roaming"));
    const restored=read(path.join(root,"profile-restoration.json"));
    const after=restored.records.find(r=>r.byteInventory);
    for(const [file,expected]of [[path.join(before.archive,"backend/vn_engine.db"),old.project],
      [path.join(after.archive,"backend/vn_engine.db"),first.savedProject]]){
      const db=new DatabaseSync(file,{readOnly:true});
      try{
        assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
        const row=db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(expected.metadata.projectId);
        assert(row);const project=JSON.parse(row.project_json);
        assert.equal(project.title,expected.metadata.title);
        preserved(expected.graph.nodes,project.nodes);preserved(expected.graph.edges,project.edges);
      }finally{db.close();}
      report.sources.push({path:file,sha256:sha(file),bytes:fs.statSync(file).size});
    }
    return {databases:2,integrity:"ok"};
  });
  check("No MSI, Editor/backend/WebView or test-port remnants; protected F installation and artifacts unchanged",()=>{
    const original=source("F:/AgentVN/Checkpoints/Current-MSI-Upgrade-20261021-01/checkpoint-verified-02.json");
    inventory(original.source,original.files);
    for(const file of original.protectedFiles)assert.equal(sha(file.path),file.sha256);
    const ports=[8278,...["old","new","restart"].map(phase=>read(path.join(root,phase+"-launch.json")).cdpPort)];
    const command="$ErrorActionPreference='Stop';"+
      "$p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\\.exe$' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.editor')});"+
      "$m=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue|Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1});"+
      `$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})});`+
      "@{processes=$p.Count;msi=$m.Count;ports=$ports.Count}|ConvertTo-Json -Compress";
    const result=spawnSync("powershell.exe",["-NoProfile","-Command",command],{encoding:"utf8",windowsHide:true});
    assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout.trim());
    assert.deepEqual(actual,{msi:0,ports:0,processes:0});return actual;
  });
  for(const file of report.downloads){
    if(!file.source){assert(file.path&&fs.existsSync(file.path));continue;}
    assert(file.absentBefore);assert.equal(path.dirname(path.resolve(file.source)),path.resolve("C:/Users/1/Downloads"));
    assert.equal(sha(file.retained),file.sha256);
    if(fs.existsSync(file.source)){assert.equal(sha(file.source),file.sha256);fs.unlinkSync(file.source);}
    file.sourceRemoved=!fs.existsSync(file.source);
  }
  assert.equal(report.checks.length,7);report.status="PASS";
}catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
finally{fs.writeFileSync(destination,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,chain,checks:report.checks.length,screenshots:report.screenshots.length,
    downloads:report.downloads,error:report.error},null,2));}
