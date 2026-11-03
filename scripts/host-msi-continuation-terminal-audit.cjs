"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),
  assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const root="D:/AgentVN",run=path.join(root,"output/host-msi-continuation-20261018-02"),
  backupRoot="F:/AgentVN-QA-HostMSI-AuthorizedBackup-20261018-02",destination=process.argv[2];
assert(destination&&!fs.existsSync(destination),"Fresh independent terminal audit required");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const result={status:"RUNNING",scope:"MSI_INSTALL_UPGRADE_REPAIR_UNINSTALL_EVIDENCE_AND_RESTORATION_NOT_FULL_PRODUCT_PASS",
  startedAt:new Date().toISOString(),checks:[],screenshots:[],sources:[],normalCloseFailures:[],error:null};
function source(relative){const file=path.join(run,relative);result.sources.push({path:file,sha256:sha(file),bytes:fs.statSync(file).size});return read(file);}
function check(name,fn){fn();result.checks.push({name,status:"PASS"});}
try{
  const backup=read(path.join(backupRoot,"backup.json"));
  check("Full authorized backup independently verified",()=>{
    assert.equal(backup.status,"PASS");assert.equal(backup.fileCount,9073);
    let bytes=0;
    for(const row of backup.files){const file=path.join(backupRoot,"installation",row.relative);
      assert.equal(sha(file),row.sha256,row.relative);assert.equal(fs.statSync(file).size,row.bytes);bytes+=row.bytes;}
    assert.equal(bytes,243195873);result.backup={path:backupRoot,files:9073,bytes,sha256:sha(path.join(backupRoot,"backup.json"))};
  });
  check("Both language real MSI operations and installed identity",()=>{
    for(const language of ["en-US","zh-CN"]){
      for(const phase of ["InstallNew","Repair","Uninstall"]){
        const row=source(`${language}/${phase}.json`),elevation=source(`${language}/${phase}-elevation.json`);
        assert.equal(row.status,"PASS");assert.equal(row.exitCode,0);assert.equal(row.isElevated,true);
        assert.equal(elevation.status,"PASS");assert.equal(elevation.parentElevated,false);
        assert.equal(row.installRoot,"D:\\agentvntest\\AgentVN Editor");
        assert.equal(sha(row.package),row.sha256);
        assert.equal(row.arguments[0],phase==="Repair"?"/fa":phase==="Uninstall"?"/x":"/i");
        const log=path.join(run,language,phase+".log");assert(fs.statSync(log).size>0);
        result.sources.push({path:log,sha256:sha(log),bytes:fs.statSync(log).size});
        if(phase!=="Uninstall"){
          assert.equal(row.actualVersion,"1.9.9");
          assert.equal(row.executableSha256,"5c38db3d8569b8f4fcd2553fbbe5e74179f948cfd720e60b315f6968d4752ee9");
          assert.equal(row.versionResource.editorVersion,"1.9.9");
        }else assert.equal(row.executableRemains,false);
      }
      const resources=source(`${language}/installed-resource-after-repair.json`);
      assert.equal(resources.status,"PASS");assert.equal(resources.scriptCount,19);assert.equal(resources.files.length,28);
    }
    const old=source("zh-CN/InstallOld.json");assert.equal(old.status,"PASS");assert.equal(old.arguments[0],"/i");
    const incident=read(path.join(root,"output/host-msi-session-20261018-01/en-US/InstallOld.json"));
    assert.equal(incident.exitCode,0);assert.equal(incident.status,"FAILED");
    result.englishOldInstall="Earlier real /i path-incident retained FAILED; current authorized continuation does not rewrite it";
  });
  check("Upgrade, repair and uninstall preserve real persistent byte baselines",()=>{
    for(const language of ["en-US","zh-CN"]){
      for(const phase of ["before-upgrade","after-repair","after-uninstall"]){
        const row=source(`${language}/${phase}-verify.json`);
        assert.equal(row.status,"PASS");assert(row.files.length>=16);assert(row.files.every(f=>f.match));
      }
    }
    const clean=source("chinese-clean-profile.json");assert.equal(clean.status,"PASS");
    assert.equal(clean.rows.length,2);assert(clean.rows.every(r=>r.moved&&fs.existsSync(r.target)));
    const fault=source("zh-CN/repair-fault.json");assert.equal(fault.originalAbsent,true);
    assert.equal(sha(fault.preservedOriginal),fault.sha256);
    const restored=source("zh-CN/installed-resource-after-repair.json").files.find(f=>f.relative==="build-versions.json");
    assert.equal(restored.sha256,fault.sha256);
  });
  check("Both actual installed UI preservation, real export bytes and process restart",()=>{
    for(const language of ["en-US","zh-CN"]){
      const old=source(`${language}/old-ui-data-created.json`);assert.equal(old.status,"PASS");
      const first=source(`${language}/new-ui-01/report.json`),restart=source(`${language}/restart-ui-01/report.json`);
      for(const row of [old,first,restart]){
        assert.equal(row.status,"PASS");assert(row.checks.length);
        if(row!==old){assert.equal(row.scope,"HOST_MSI_UPGRADE_ACTUAL_INSTALLED_UI");assert(row.checks.every(c=>c.status==="PASS"));}
        for(const capture of row.screenshots){
          const file=path.resolve(root,capture.path);assert.equal(sha(file),capture.sha256);
          const bytes=fs.readFileSync(file);assert.equal(bytes.readUInt32BE(16),capture.before.width*capture.before.dpr);
          assert.equal(bytes.readUInt32BE(20),capture.before.height*capture.before.dpr);
          assert.deepEqual(capture.before,capture.after);result.screenshots.push({path:file,sha256:capture.sha256,actual:capture.before,png:capture.png});
        }
      }
      assert.equal(first.resumedProject.metadata.projectId,old.project.metadata.projectId);
      assert.equal(restart.resumedProject.metadata.projectId,old.project.metadata.projectId);
      assert(restart.checks.some(c=>c.name.includes("after restart")&&c.status==="PASS"));
      const exported=source(`${language}/new-project-export.json`);assert.equal(exported.status,"PASS");
      assert.equal(sha(exported.package.path),exported.package.sha256);
      assert.deepEqual(exported.checks.map(c=>c.name),["Real success dialog","Real ZIP project.json",
        "Project identity preserved","Node/edge IDs preserved","Edited summary present in package"]);
      assert(exported.checks.every(c=>c.status==="PASS"));
      const initial=source(`${language}/new-launch.json`),again=source(`${language}/restart-launch.json`);
      assert.notEqual(initial.cdpPort,again.cdpPort);
      const pidA=source(`${language}/new-capture-audit.json`).processes.find(p=>p.Name==="agentvn-editor.exe").ProcessId;
      const pidB=source(`${language}/restart-capture-audit.json`).processes.find(p=>p.Name==="agentvn-editor.exe").ProcessId;
      assert.notEqual(pidA,pidB);
    }
    assert.equal(result.screenshots.length,14);
    result.displayScope="Actual native WebView viewport recorded per PNG; NOT the complete 12-row UI matrix, NOT physical 4K";
  });
  check("Default packaged backend provenance and honest normal-close failures",()=>{
    for(const language of ["en-US","zh-CN"])for(const phase of ["old","new","restart"]){
      const captured=source(`${language}/${phase}-capture-audit.json`),closed=source(`${language}/${phase}-close-audit.json`);
      assert.equal(captured.status,"PASS");assert(captured.checks.defaultDatabaseLog&&captured.checks.ownedBackend);
      assert.equal(closed.status,"FAILED");assert.equal(closed.cleanup,"PASS");
      assert.equal(closed.defect,"BACKEND_CHILD_SURVIVES_NORMAL_WINDOW_CLOSE");
      assert.equal(closed.remainingAfterCleanup.length,0);assert.equal(closed.remainingPorts.length,0);
      result.normalCloseFailures.push({language,phase,path:path.join(run,language,phase+"-close-audit.json"),status:"FAILED"});
    }
  });
  check("Unexecuted fresh-install boundary is documented, not falsely promoted to PASS",()=>{
    const probe=source("clean-install-location-probe.json");
    assert.equal(probe.status,"BLOCKED");assert.equal(probe.evidenceStatus,"PASS");
    assert.equal(probe.installerInvoked,false);assert.equal(probe.registryEdited,false);
    assert.equal(probe.packages.length,2);
    assert.equal(probe.remembered[0].value,"F:\\AgentVN-QA-HostUpgrade-20261018-02\\installed-editor");
    for(const language of ["en-US","zh-CN"]){
      assert(!fs.existsSync(path.join(run,language,"InstallClean.json")));
      assert(!fs.existsSync(path.join(run,language,"UninstallClean.json")));
    }
    result.freshCandidateInstallStatus="BLOCKED";
    result.cleanInstallBoundary=probe.limitation;
  });
  check("Four original profiles independently restored, 55 SHA and backup checks",()=>{
    const prep=source("preparation.json"),restored=source("profile-restoration.json");
    assert.equal(prep.status,"PASS");assert.equal(restored.status,"PASS");let count=0;
    for(const profile of prep.profiles){
      assert(fs.existsSync(profile.original)&&!fs.existsSync(profile.held));
      for(const row of profile.files){assert.equal(sha(path.join(profile.original,row.relative)),row.sha256);assert.equal(sha(row.backup),row.sha256);count++;}
    }
    assert.equal(count,55);result.originalProfileFiles=count;
  });
  check("Historical legacy data returned unchanged; all original backup still retained",()=>{
    const legacy=source("legacy-data-restoration.json");assert.equal(legacy.status,"PASS");assert.equal(legacy.checks.length,1);
    for(const row of legacy.checks)assert.equal(sha(row.path),row.sha256);
  });
  check("Frozen 560 product sources, Dev and NSIS candidate unchanged",()=>{
    const frozen=read(path.join(root,"output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length,560);for(const row of frozen.source)assert.equal(sha(row.path),row.sha256,row.path);
    assert.equal(sha(path.join(root,"AgentVN Dev.exe")),"ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96");
    assert.equal(sha("F:/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe"),
      "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    result.productChanges=0;result.devRebuilt=false;result.realModelRequests=0;result.androidOperations=0;
  });
  check("No owned native process/listener/MSI registration; unrelated shortcuts unchanged",()=>{
    const state=spawnSync("powershell.exe",["-NoProfile","-Command",`
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')
      }|Select-Object Name,ProcessId,ParentProcessId,ExecutablePath)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -eq 8278}|Select-Object LocalPort,OwningProcess)
      $qaRegistrations=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN'}|Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller)
      @{processes=$qaProcesses;ports=$qaPorts;registrations=$qaRegistrations}|ConvertTo-Json -Depth 7
    `],{encoding:"utf8",windowsHide:true,timeout:20000});
    assert.equal(state.status,0,state.stderr);result.systemState=JSON.parse(state.stdout.replace(/^\uFEFF/,""));
    assert.equal(result.systemState.processes.length,0);assert.equal(result.systemState.ports.length,0);
    assert.equal(result.systemState.registrations.filter(r=>r.WindowsInstaller===1).length,0);
    for(const link of backup.shortcuts){
      if(link.target.toLowerCase()==="d:\\agentvntest\\agentvn editor\\agentvn-editor.exe")continue;
      assert.equal(sha(link.path),link.sha256,link.path);
    }
    assert(!fs.existsSync("D:/agentvntest/AgentVN Editor/agentvn-editor.exe"));
  });
  result.status="BLOCKED";
  result.evidenceStatus="PASS";
  result.upgradeRepairUninstallOperationsStatus="PASS";
  result.normalExitStatus="FAILED";
  result.overallFullRegressionStatus="NOT_COMPLETE";
}catch(error){result.status="FAILED";result.evidenceStatus="FAILED";result.error=String(error.stack||error);process.exitCode=1;}
finally{
  result.finishedAt=new Date().toISOString();
  fs.writeFileSync(destination,JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:result.status,evidenceStatus:result.evidenceStatus,checks:result.checks.length,screenshots:result.screenshots.length,
    normalCloseFailures:result.normalCloseFailures.length,error:result.error},null,2));
}
