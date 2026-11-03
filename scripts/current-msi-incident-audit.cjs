"use strict";
// Independent filesystem/SQLite/receipt audit; keeps the destination failure.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const root="F:/AgentVN/QA/Current-MSI-Upgrade-20261021-01/session-01";
const backup="F:/AgentVN/Checkpoints/Current-MSI-Incident-20261021-01";
const oldBackup="F:/AgentVN/Checkpoints/Current-MSI-Upgrade-20261021-01";
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
function windowsLog(bytes){
  return bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xfe
    ?bytes.subarray(2).toString("utf16le"):bytes.toString("utf8").replace(/^\uFEFF/,"");
}
function validateUI(row,phase){
  assert.equal(row.status,"PASS");assert.equal(row.phase,phase);
  assert.equal(row.launch.actualVersion,"1.9.16");
  assert(row.checks.length>=2&&row.knownProcesses.length>=3);
  assert.equal(row.launch.dataDirectoryOverride,false);assert.equal(row.launch.webviewDirectoryOverride,false);
  assert.equal(row.launch.manualBackendSpawn,false);assert.equal(row.realModelRequests,0);
  assert.equal(row.cleanup.status,"PASS");assert.equal(row.cleanup.survivors.length,0);
  assert.equal(row.cleanup.ports.length,0);assert(row.cleanup.stopped.length>0);
  assert(row.project.metadata.projectId&&row.project.graph.nodes.length>0);
  assert(row.screenshots.length>=(phase==="create"?1:2));
  if(phase==="create")assert(row.package.absentBefore&&row.package.bytes>0);
}
if(process.argv[2]==="--self-test"){
  const marker="PROPERTY CHANGE: INSTALLDIR F→D";
  assert.equal(windowsLog(Buffer.from(marker,"utf8")),marker);
  assert.equal(windowsLog(Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(marker,"utf16le")])),marker);
  const valid={status:"PASS",phase:"create",checks:["a","b"],knownProcesses:[1,2,3],realModelRequests:0,
    launch:{actualVersion:"1.9.16",dataDirectoryOverride:false,webviewDirectoryOverride:false,manualBackendSpawn:false},
    cleanup:{status:"PASS",survivors:[],ports:[],stopped:["owned"]},
    project:{metadata:{projectId:"qa"},graph:{nodes:[{}]}},screenshots:[{}],package:{absentBefore:true,bytes:1}};
  validateUI(valid,"create");
  const mutations=[
    row=>row.checks=[],row=>row.knownProcesses=[],row=>row.cleanup.status="NOT_RUN",
    row=>row.cleanup.survivors=[{}],row=>row.cleanup.ports=[{}],row=>row.cleanup.stopped=[],
    row=>row.screenshots=[],row=>row.project.graph.nodes=[],row=>row.launch.actualVersion="1.9.9",
    row=>row.launch.dataDirectoryOverride=true,row=>row.launch.webviewDirectoryOverride=true,
    row=>row.package.absentBefore=false,row=>row.status="FAILED",row=>row.realModelRequests=1,
  ];
  for(const mutate of mutations){const bad=structuredClone(valid);mutate(bad);assert.throws(()=>validateUI(bad,"create"));}
  console.log("PASS: fourteen invalid MSI UI evidence envelopes rejected; UTF-8/UTF-16LE log decoding; self-test, not product acceptance");
  process.exit(0);
}
const destination=process.argv[2];
assert(destination&&!fs.existsSync(destination),"Fresh audit required");
assert.equal(path.dirname(path.resolve(destination)),path.resolve(root));
const report={status:"FAILED",evidenceAuditStatus:"RUNNING",
  scope:"CURRENT_ENGLISH_MSI_INCIDENT_RECOVERY_AND_DEFAULT_PROFILE_UI_NOT_FULL_REGRESSION",
  at:new Date().toISOString(),checks:[],sources:[],screenshots:[],productFailures:["EXPLICIT_INSTALL_DIRECTORY_OVERRIDDEN_BY_APPSEARCH"],
  physicalInputVerified:false,cleanMachineVerified:false,upgradeTested:false,realModelRequests:0,error:null};
function source(file){report.sources.push({path:file,sha256:sha(file),bytes:fs.statSync(file).size});return read(file);}
function check(name,fn){report.checks.push({name,status:"PASS",detail:fn()});}
function inventory(directory,files){
  const actual=[];
  function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);assert(!entry.isSymbolicLink(),"No linked inventory");
    if(entry.isDirectory())walk(file);else actual.push(path.relative(directory,file));
  }}
  walk(directory);assert.equal(actual.length,files.length);
  for(const file of files){const actual=path.join(directory,file.relative);
    assert.equal(fs.statSync(actual).size,file.bytes);assert.equal(sha(actual),file.sha256);}
  return files.length;
}
try{
  check("Original failed actual installation, real elevation and immutable MSI",()=>{
    const install=source(path.join(root,"clean/en-US/Install-1.9.16-01.json"));
    const parent=source(path.join(root,"clean/en-US/Install-1.9.16-01-elevation.json"));
    assert.equal(install.status,"FAILED");assert.equal(install.exitCode,0);
    assert.equal(install.isElevated,true);assert.equal(parent.parentElevated,false);
    assert.equal(install.package.sha256,sha(install.package.path));
    assert.equal(install.arguments[0],"/i");
    const registration=install.registrationsAfter.filter(r=>r.WindowsInstaller===1);
    assert.equal(registration.length,1);assert.equal(registration[0].InstallLocation,"D:\\agentvntest\\AgentVN Editor\\");
    const text=windowsLog(fs.readFileSync(install.log));
    assert(text.includes("Its new value: 'D:\\agentvntest\\AgentVN Editor'."));
    report.sources.push({path:install.log,sha256:sha(install.log),bytes:fs.statSync(install.log).size});
    return {productOutcome:"FAILED",actual:registration[0].InstallLocation};
  });
  check("Verified full D incident checkpoint and same-byte F original/protected artifacts",()=>{
    const original=source(path.join(oldBackup,"checkpoint-verified-02.json"));
    const checkpoint=source(path.join(backup,"checkpoint.json"));assert.equal(checkpoint.status,"PASS");
    const dFiles=inventory(path.join(backup,"installation"),checkpoint.files);
    const fFiles=inventory(original.source,original.files);
    for(const file of original.protectedFiles)assert.equal(sha(file.path),file.sha256);
    return {dBackupFiles:dFiles,fOriginalFiles:fFiles,protectedFiles:original.protectedFiles.length};
  });
  check("Two current installed shortcut UI flows, export bytes and repair-persistent graph/theme",()=>{
    const create=source(path.join(root,"ui-create-01/report.json"));
    const restart=source(path.join(root,"ui-restart-01/report.json"));
    validateUI(create,"create");validateUI(restart,"restart");
    assert.notEqual(create.knownProcesses[0].ProcessId,restart.knownProcesses[0].ProcessId);
    for(const key of ["projectId","title","author"])assert.equal(create.project.metadata[key],restart.project.metadata[key]);
    assert.deepEqual(create.project.graph,restart.project.graph);
    for(const row of [create,restart])for(const capture of row.screenshots){
      const png=fs.readFileSync(capture.path);assert.equal(sha(capture.path),capture.sha256);
      assert.deepEqual(capture.before,capture.after);
      assert.equal(capture.before.width,1920);assert.equal(capture.before.height,1080);
      assert.equal(capture.before.dpr,1);assert.equal(capture.before.reduced,false);
      assert.equal(png.readUInt32BE(16),1920);assert.equal(png.readUInt32BE(20),1080);
      report.screenshots.push(capture);
    }
    assert.equal(sha(create.package.retained),create.package.sha256);
    report.generatedExport=create.package;return {nativeLaunches:2,uiFlows:2,screenshots:report.screenshots.length};
  });
  check("Actual elevated repair and uninstall reach terminal state without erasing held legacy data",()=>{
    for(const phase of ["Repair","Uninstall"]){
      const row=source(path.join(root,`incident-${phase}.json`));
      const parent=source(path.join(root,`incident-${phase}-elevation.json`));
      assert.equal(row.status,"PASS");assert.equal(row.isElevated,true);assert.equal(row.exitCode,0);
      assert.equal(parent.status,"PASS");assert.equal(parent.parentElevated,false);
      assert.equal(row.arguments[0],phase==="Repair"?"/fa":"/x");
      assert.equal(row.productCode,"{C1223FB9-5E27-4874-A3F6-B9CAB5F8585F}");
      assert.equal(sha(row.package.path),row.package.sha256);
      assert(fs.statSync(row.log).size>0);
      report.sources.push({path:row.log,sha256:sha(row.log),bytes:fs.statSync(row.log).size});
    }
    assert(!fs.existsSync("D:/agentvntest/AgentVN Editor/agentvn-editor.exe"));
    return {repair:"PASS",uninstall:"PASS",directoryDefect:"FAILED_UNCHANGED"};
  });
  check("Original default profiles, legacy bytes and pre-install shortcuts restored",()=>{
    const restored=source(path.join(root,"profile-restoration.json"));
    const protection=source(path.join(root,"profile-protection.json"));
    const legacy=source(path.join(root,"RestoreLegacy.json"));
    const shortcuts=source(path.join(root,"incident-RestoreShortcuts.json"));
    assert.equal(restored.status,"PASS");assert.equal(restored.originalsRestored,true);
    assert.equal(restored.deletedUserFiles,0);assert.equal(restored.records.length,2);
    assert.equal(legacy.status,"PASS");assert.equal(legacy.deletedUserFiles,0);
    inventory(legacy.source,legacy.files);assert(!fs.existsSync(legacy.held));
    for(const row of protection.records){assert(!fs.existsSync(row.held));
      const id=spawnSync("fsutil.exe",["file","queryfileid",row.original],{windowsHide:true,encoding:"utf8"});
      assert.equal(id.status,0,id.stderr);
      assert.equal(id.stdout.match(/0x[0-9a-fA-F]+/)?.[0].toLowerCase(),row.directoryId);
      if(row.byteInventory)inventory(row.original,row.files);}
    assert.equal(shortcuts.status,"PASS");
    const original=read(path.join(oldBackup,"checkpoint-verified-02.json"));
    for(const row of original.shortcuts)assert.equal(sha(row.path),row.sha256);
    return {defaultProfiles:2,roamingByteInventory:true,localVerification:"NTFS identity, not all cache bytes",
      legacyFiles:legacy.files.length,originalShortcuts:original.shortcuts.length};
  });
  check("Actual persisted SQLite project survives repair and original user profiles are now back",()=>{
    const {DatabaseSync}=require("node:sqlite"),create=read(path.join(root,"ui-create-01/report.json"));
    const restored=read(path.join(root,"profile-restoration.json"));
    const archived=restored.records.find(r=>r.byteInventory);
    const file=path.join(archived.archive,"backend/vn_engine.db"),db=new DatabaseSync(file,{readOnly:true});
    try{
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
      const row=db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?")
        .get(create.project.metadata.projectId);assert(row);
      const project=JSON.parse(row.project_json);assert.equal(project.title,create.project.metadata.title);
      assert.deepEqual(project.nodes,create.project.graph.nodes);assert.deepEqual(project.edges,create.project.graph.edges);
    }finally{db.close();}
    return {database:file,sha256:sha(file),integrity:"ok"};
  });
  check("Owned process and port residuals absent; original NSIS registration preserved",()=>{
    const old=read(path.join(oldBackup,"checkpoint-verified-02.json"));
    const expectedPorts=[8278,...["new","restart"].map(phase=>read(path.join(root,phase+"-launch.json")).cdpPort)];
    const command="$ErrorActionPreference='Stop';"+
      "$p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '^(agentvn-editor|AgentVN Dev|creator-backend|agentvn-player)\\.exe$' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.editor')});"+
      "$m=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue|Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1});"+
      `$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${expectedPorts.join(",")})});`+
      "$old=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor';"+
      "$registry=@(foreach($path in @('Software\\agentvn\\AgentVN Editor','Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor')){"+
      "$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path);try{if(!$key){throw 'Original NSIS key missing'};"+
      "@{path=$path;values=@(foreach($name in $key.GetValueNames()){@{name=$name;kind=$key.GetValueKind($name).ToString();value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}})}"+
      "}finally{if($key){$key.Dispose()}}});"+
      "@{processCount=$p.Count;msiCount=$m.Count;portCount=$ports.Count;nsisVersion=$old.DisplayVersion;nsisLocation=$old.InstallLocation;registry=$registry}|ConvertTo-Json -Depth 8 -Compress";
    const result=spawnSync("powershell.exe",["-NoProfile","-Command",command],{windowsHide:true,encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);const state=JSON.parse(result.stdout.trim());
    assert.equal(state.processCount,0);assert.equal(state.msiCount,0);assert.equal(state.portCount,0);
    assert.equal(state.nsisVersion,"1.9.9");
    assert.equal(state.nsisLocation,'"F:\\AgentVN-QA-HostUpgrade-20261018-02\\installed-editor"');
    const canonical=entries=>entries.map(row=>({path:row.path,
      values:row.values.map(v=>({name:v.name,kind:v.kind,value:v.value})).sort((a,b)=>a.name.localeCompare(b.name))
    })).sort((a,b)=>a.path.localeCompare(b.path));
    assert.deepEqual(canonical(state.registry),canonical(old.registry));
    return state;
  });
  // Only remove the exact newly generated native download after all evidence
  // is retained and validated. Never enumerate/delete general Downloads files.
  const generated=report.generatedExport;
  assert.equal(path.dirname(path.resolve(generated.source)),path.resolve("C:/Users/1/Downloads"));
  if(fs.existsSync(generated.source)){
    assert(generated.absentBefore);assert.equal(sha(generated.source),generated.sha256);
    assert.equal(sha(generated.retained),generated.sha256);
    fs.unlinkSync(generated.source);
  }
  report.downloadCleanup={source:generated.source,retained:generated.retained,sha256:generated.sha256,
    sourceRemoved:!fs.existsSync(generated.source),deletedUserFiles:0};
  assert.equal(report.checks.length,7);assert.equal(report.screenshots.length,3);
  report.evidenceAuditStatus="PASS";
}catch(e){report.evidenceAuditStatus="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
finally{fs.writeFileSync(destination,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,evidenceAuditStatus:report.evidenceAuditStatus,
    checks:report.checks.map(c=>c.name),downloadCleanup:report.downloadCleanup,error:report.error},null,2));}
