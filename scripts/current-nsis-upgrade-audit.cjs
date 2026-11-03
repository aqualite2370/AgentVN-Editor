"use strict";
// Evidence audit, not a substitute for the real installed UI or installer.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const {DatabaseSync}=require("node:sqlite");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function owner(row){
  assert.equal(row.status,"PASS");assert.equal(row.cleanup.status,"PASS");
  assert.equal(row.cleanup.survivors.length,0);assert.equal(row.cleanup.ports.length,0);
  assert(row.knownProcesses.length>=3&&row.cleanup.stopped.length>0);
  assert.equal(row.realModelRequests,0);assert.equal(row.physicalInputVerified,false);
  assert.equal(row.launch.installerKind,"NSIS");
  for(const key of ["dataDirectoryOverride","webviewDirectoryOverride","manualBackendSpawn"])
    assert.equal(row.launch[key],false);
}
function preserved(a,b){
  if(Array.isArray(a)){
    assert(Array.isArray(b));assert.equal(b.length,a.length);a.forEach((v,i)=>preserved(v,b[i]));
  }else if(a&&typeof a==="object"){
    for(const [k,v]of Object.entries(a)){
      if(k==="measured"||k==="updatedAt")continue;
      assert(b&&Object.hasOwn(b,k));preserved(v,b[k]);
    }
  }else assert.deepEqual(b,a);
}
if(process.argv[2]==="--self-test"){
  const good={status:"PASS",cleanup:{status:"PASS",survivors:[],ports:[],stopped:[1]},
    knownProcesses:[1,2,3],realModelRequests:0,physicalInputVerified:false,
    launch:{installerKind:"NSIS",dataDirectoryOverride:false,webviewDirectoryOverride:false,manualBackendSpawn:false}};
  owner(good);
  for(const mutate of [r=>r.status="FAILED",r=>r.cleanup.status="NOT_RUN",r=>r.cleanup.survivors=[1],
    r=>r.cleanup.ports=[1],r=>r.cleanup.stopped=[],r=>r.knownProcesses=[],
    r=>r.realModelRequests=1,r=>r.physicalInputVerified=true,r=>r.launch.installerKind="MSI",
    r=>r.launch.dataDirectoryOverride=true,r=>r.launch.webviewDirectoryOverride=true,r=>r.launch.manualBackendSpawn=true]){
    const bad=structuredClone(good);mutate(bad);assert.throws(()=>owner(bad));
  }
  preserved({nodes:[{id:"one",measured:{height:1}}]},{nodes:[{id:"one",measured:{height:2}}],newDefault:true});
  for(const changed of [{nodes:[]},{nodes:[{id:"different"}]},{}])
    assert.throws(()=>preserved({nodes:[{id:"one"}]},changed));
  console.log("PASS: twelve bad native ownership envelopes and three data-loss cases rejected; no installation");process.exit(0);
}
const attempt=process.argv[2]||"01";assert(/^\d\d$/.test(attempt));
const root="F:/AgentVN/QA/Current-NSIS-Upgrade-20261021-01";
const checkpointRoot="F:/AgentVN/Checkpoints/Current-NSIS-Upgrade-20261021-01";
const destination=path.join(root,`terminal-audit-${attempt}.json`);assert(!fs.existsSync(destination));
const report={status:"RUNNING",scope:"CURRENT_NSIS_REAL_RECENT_RELEASE_UPGRADE_UI_RESTART_UNINSTALL_RESTORE_NOT_FULL_ACCEPTANCE",
  at:new Date().toISOString(),checks:[],sources:[],screenshots:[],downloads:[],
  realModelRequests:0,physicalInputVerified:false,error:null};
function source(f){report.sources.push({path:f,sha256:sha(f),bytes:fs.statSync(f).size});return read(f);}
function check(name,fn){report.checks.push({name,status:"PASS",detail:fn()});}
function inventory(folder,expected){
  const files=[];function walk(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      assert(!entry.isSymbolicLink());const f=path.join(dir,entry.name);
      if(entry.isDirectory())walk(f);else files.push(path.relative(folder,f));
    }
  }walk(folder);assert.equal(files.length,expected.length);
  for(const row of expected){const f=path.join(folder,row.relative);assert.equal(fs.statSync(f).size,row.bytes);assert.equal(sha(f),row.sha256);}
  return files.length;
}
try{
  const checkpoint=source(path.join(checkpointRoot,"checkpoint.json"));assert.equal(checkpoint.status,"PASS");
  const oldInstall=source(path.join(root,"InstallOld.json")),next=source(path.join(root,"InstallNew.json"));
  const old=source(path.join(root,"old-ui-01/report.json"));
  const first=source(path.join(root,"new-ui-01/report.json"));
  const restart=source(path.join(root,"restart-ui-01/report.json"));
  const protection=source(path.join(root,"profile-protection.json"));
  const restored=source(path.join(root,"profile-restoration.json"));
  const restoration=source(path.join(root,"Restore.json"));
  const removed=source(path.join(root,"Uninstall.json"));
  check("Real trusted 1.9.8 -> 1.9.16 NSIS same-directory upgrade and actual uninstall",()=>{
    for(const row of [oldInstall,next,removed]){
      assert.equal(row.status,"PASS");assert.equal(row.installerKind,"NSIS");assert.equal(row.exitCode,0);
      assert.equal(sha(row.package),row.packageSha256);
      assert.equal(row.installRoot,checkpoint.installRoot);assert.equal(row.arguments[0],"/S");
      assert(!row.arguments.some(a=>/UPDATE|FORCE|\/NS$/i.test(a)));
    }
    assert.equal(oldInstall.actualVersion,"1.9.8");assert.equal(next.actualVersion,"1.9.16");
    assert.equal(next.executableSha256,"120b1ea9b577faa24172a8854ca752e1c1320772792cab04f33cfeedbf28914c");
    assert.equal(removed.arguments[1],"_?="+checkpoint.installRoot);
    assert(!fs.existsSync(path.join(checkpoint.installRoot,"agentvn-editor.exe")));
    return {oldVersion:"1.9.8",newVersion:"1.9.16",installRoot:checkpoint.installRoot};
  });
  check("Actual old persistence bytes survive installer before first new launch",()=>{
    assert.equal(next.persistenceUnchangedBeforeFirstNewLaunch,true);assert.equal(next.persistenceBefore.length,2);
    return {snapshots:2,files:next.persistenceBefore.reduce((n,r)=>n+inventory(r.archive,r.files),0)};
  });
  check("Three owned real shortcut launches, real inputs and seven correctly sampled PNGs",()=>{
    const ids=[];
    for(const phase of ["old","new","restart"]){
      const owned=source(path.join(root,phase+"-owned-01.json"));owner(owned);
      assert.equal(sha(owned.uiReport.path),owned.uiReport.sha256);
      assert.equal(owned.launch.executableSha256,phase==="old"?oldInstall.executableSha256:next.executableSha256);
      const editor=owned.knownProcesses.find(p=>p.Name==="agentvn-editor.exe");assert(editor);
      ids.push(editor.ProcessId+":"+editor.Created);
      if(owned.package)report.downloads.push(owned.package);
      for(const shot of owned.screenshots){
        assert.equal(sha(shot.path),shot.sha256);assert.deepEqual(shot.before,shot.after);
        assert.deepEqual(shot.before,{width:1920,height:1080,dpr:1,reduced:false});
        const png=fs.readFileSync(shot.path);assert.equal(png.readUInt32BE(16),1920);assert.equal(png.readUInt32BE(20),1080);
        report.screenshots.push(shot);
      }
    }
    assert.equal(new Set(ids).size,3);assert.equal(report.screenshots.length,7);
    return {identities:ids,screenshots:7,scope:"Real installed WebView, not physical input or full display matrix"};
  });
  check("Old project/theme retained; new edit survives a separate current-version process",()=>{
    for(const row of [old,first,restart])assert.equal(row.status,"PASS");
    assert(first.checks.length>=6&&first.checks.every(c=>c.status==="PASS"));
    assert(restart.checks.length>=6&&restart.checks.every(c=>c.status==="PASS"));
    preserved(old.project.metadata,first.resumedProject.metadata);preserved(old.project.graph,first.resumedProject.graph);
    assert.equal(restart.resumedProject.metadata.projectId,old.project.metadata.projectId);
    assert.deepEqual(restart.resumedProject.graph,first.savedProject.graph);
    assert.equal(first.theme.tone,old.localStorage["agentvn.themeTone"]);
    assert.equal(restart.theme.tone,old.localStorage["agentvn.themeTone"]);
    return {projectId:old.project.metadata.projectId,existingNodes:old.project.graph.nodes.length};
  });
  check("Two real SQLite databases remain valid and preserve semantic content",()=>{
    const before=next.persistenceBefore.find(r=>r.archive.endsWith("roaming"));
    const after=restored.records.find(r=>r.byteInventory);
    for(const [file,expected]of [[path.join(before.archive,"backend/vn_engine.db"),old.project],
      [path.join(after.archive,"backend/vn_engine.db"),first.savedProject]]){
      const db=new DatabaseSync(file,{readOnly:true});
      try{
        assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
        const row=db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(expected.metadata.projectId);
        assert(row);const p=JSON.parse(row.project_json);assert.equal(p.title,expected.metadata.title);
        preserved(expected.graph.nodes,p.nodes);preserved(expected.graph.edges,p.edges);
      }finally{db.close();}
      report.sources.push({path:file,sha256:sha(file),bytes:fs.statSync(file).size});
    }
    return {databases:2,integrity:"ok"};
  });
  check("Original profiles and protected original installation restored",()=>{
    assert.equal(protection.records.length,2);assert.equal(restored.status,"PASS");
    assert.equal(restored.originalsRestored,true);assert.equal(restored.deletedUserFiles,0);
    assert.equal(restoration.status,"PASS");
    for(const row of protection.records){
      assert(!fs.existsSync(row.held));const p=spawnSync("fsutil.exe",["file","queryfileid",row.original],{encoding:"utf8",windowsHide:true});
      assert.equal(p.status,0);assert.equal(p.stdout.match(/0x[0-9a-fA-F]+/)?.[0].toLowerCase(),row.directoryId);
      if(row.byteInventory)inventory(row.original,row.files);
    }
    assert.equal(sha(checkpoint.sourceCheckpoint.path),checkpoint.sourceCheckpoint.sha256);
    const original=source(checkpoint.sourceCheckpoint.path);
    inventory(checkpoint.originalPhysical,original.files);
    inventory(path.join(path.dirname(checkpoint.sourceCheckpoint.path),"installation"),original.files);
    for(const row of checkpoint.protectedFiles)assert.equal(sha(row.path),row.sha256);
    for(const row of checkpoint.shortcuts){assert.equal(sha(row.path),row.sha256);assert.equal(sha(row.backup),row.sha256);}
    return {profiles:2,originalFiles:original.files.length,localVerification:"NTFS identity only"};
  });
  check("Original registration values restored and no owned process or port remains",()=>{
    const ports=[8278,...["old","new","restart"].map(p=>read(path.join(root,p+"-launch.json")).cdpPort)];
    const command="$ErrorActionPreference='Stop';"+
      "$registry=@(foreach($path in @('Software\\agentvn\\AgentVN Editor','Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor')){"+
      "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path);try{if(!$k){throw 'Original key missing'};"+
      "@{path=$path;values=@(foreach($n in $k.GetValueNames()){@{name=$n;kind=$k.GetValueKind($n).ToString();value=$k.GetValue($n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}})}}finally{if($k){$k.Dispose()}}});"+
      "$p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\\.exe$' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')});"+
      `$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})});`+
      "$msi=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue|Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1});"+
      "@{registry=$registry;processes=$p.Count;ports=$ports.Count;msi=$msi.Count}|ConvertTo-Json -Depth 9 -Compress";
    const p=spawnSync("powershell.exe",["-NoProfile","-Command",command],{encoding:"utf8",windowsHide:true,timeout:20000});
    assert.equal(p.status,0,p.stderr);const current=JSON.parse(p.stdout.trim());
    assert.equal(current.processes,0);assert.equal(current.ports,0);assert.equal(current.msi,0);
    const canonical=rs=>rs.map(r=>({path:r.path,values:r.values.map(v=>({name:v.name,kind:v.kind,value:v.value}))
      .sort((a,b)=>a.name.localeCompare(b.name))})).sort((a,b)=>a.path.localeCompare(b.path));
    assert.deepEqual(canonical(current.registry),canonical(checkpoint.registry));return current;
  });
  assert.equal(report.checks.length,7);assert.equal(report.downloads.length,2);
  for(const row of report.downloads){
    assert(row.absentBefore);assert.equal(path.resolve(path.dirname(row.source)),path.resolve("C:/Users/1/Downloads"));
    assert.equal(sha(row.retained),row.sha256);
    if(fs.existsSync(row.source)){assert.equal(sha(row.source),row.sha256);fs.unlinkSync(row.source);}
    row.sourceRemoved=!fs.existsSync(row.source);
  }
  report.status="PASS";
}catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
finally{
  fs.writeFileSync(destination,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,screenshots:report.screenshots.length,error:report.error,downloads:report.downloads},null,2));
}
