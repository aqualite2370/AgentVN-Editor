"use strict";
// Explicit newer candidate configuration reuses the existing publication flow.
// With no configuration, the historical 1.9.24 behavior remains unchanged.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{spawn,execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),phase=process.argv[2],attempt=process.argv[3]||"01";
const configArg=process.argv[4];
assert(!configArg||configArg.startsWith("--publication-config="));
const publication=configArg?JSON.parse(fs.readFileSync(configArg.slice(21),"utf8").replace(/^\uFEFF/,"")):null;
const version=publication?.version||"1.9.24",date=publication?.date||"20261024";
assert.match(version,/^\d+\.\d+\.\d+$/);assert.match(date,/^\d{8}$/);
assert(["checkpoint","build","package","payload","install",...(publication?["self-test","adopt-build"]:[])].includes(phase));
assert(/^\d{2}$/.test(attempt));
const base=`F:/AgentVN/QA/Editor-${version}-${date}-01`,out=path.join(base,`${phase}-${attempt}`);
if(publication){
  assert.equal(publication.qa,base);assert.equal(publication.checkpoint,`F:/AgentVN/Checkpoints/Editor-${version}-${date}-01`);
  for(const name of ["frozenSeal","buildReceipt","nativeReport","nativeAudit"])assert.equal(typeof publication[name],"string");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,"editor/package.json"),"utf8")).version,version);
}
function validateNativePublication(r){
  assert.equal(r.status,"PASS");assert(r.finishedAt&&!r.error&&!r.cleanupError);
  assert.equal(r.cells.length,24);assert.equal(r.launches.length,24);assert.equal(r.screenshots.length,24);
  const groups=["routine-save-off","display","typing","auto-delay","auto-click","skip-unread","skip-after-choice","audio","routine-save-on"];
  const settings=["fontScale","lineSpacing","highContrastText","textSpeedCps","autoForwardTime","autoForwardAfterClick",
    "volumeMaster","volumeBgm","volumeSfx","volumeVoice","muteBgm","muteSfx","muteVoice","muteAll","skipUnread","skipAfterChoices","autoSaveEnabled"].sort();
  for(const layout of ["agentvn","renpy"])for(const width of [1920,2560,3840])for(const dpr of [1,2])for(const reduced of [false,true]){
    const cells=r.cells.filter(c=>c.display.layout===layout&&c.display.width===width&&c.display.height===width*9/16&&c.display.dpr===dpr&&c.display.reduced===reduced);
    assert.equal(cells.length,1);const c=cells[0];assert.equal(c.status,"PASS");
    assert.deepEqual(c.checks.map(k=>k.name),groups);assert(c.checks.every(k=>k.status==="PASS"));
    assert.deepEqual([...c.covered].sort(),settings);
  }
  assert.equal(r.profileRestoration.status,"PASS");assert.equal(r.profileRestoration.deletedUserFiles,0);
  assert(r.launches.every(l=>l.cleanup.status==="PASS"));assert.deepEqual(r.pageErrors,[]);
}
function normalizeActualInstallation(installed,journal,expectedVersion){
  assert.equal(installed.status,"PASS");assert.equal(installed.exitCode,0);
  assert.equal(installed.metadataRestoration,"PASS");
  assert.equal(installed.scope,"ACTUAL_NSIS_NEW_DIRECTORY_NOT_UPGRADE_OR_CLEAN_MACHINE");
  assert.equal(installed.executable.version,expectedVersion);
  assert.equal(path.resolve(installed.executable.path),path.join(path.resolve(installed.installRoot),"agentvn-editor.exe"));
  assert.match(journal.sha256,/^[a-f0-9]{64}$/);
  assert(installed.package&&installed.resources.length===4&&Array.isArray(installed.protectedFiles));
  for(const f of [installed.package,installed.executable,...installed.resources,...installed.protectedFiles])
    assert.match(f.sha256,/^[a-f0-9]{64}$/);
  return {...installed,scope:"NORMALIZED_ACTUAL_NSIS_JOURNAL_NOT_A_NEW_INSTALLATION",
    actualInstallationJournal:journal,installer:installed.package,registryRestored:true};
}
if(phase==="self-test"){
  assert(!fs.existsSync(out));
  for(const name of ["frozenSeal","buildReceipt"])assert(fs.existsSync(publication[name]),name);
  const seal=JSON.parse(fs.readFileSync(publication.frozenSeal,"utf8"));
  const build=JSON.parse(fs.readFileSync(publication.buildReceipt,"utf8"));
  assert.equal(seal.status,"PASS");assert.equal(build.status,"PASS");
  assert(build.commands.length>=18&&build.commands.every(c=>c.status==="PASS"&&c.exitCode===0));
  assert.deepEqual(build.commands.filter(c=>["editor-typecheck","editor-build","GameCli_framework-build","full-dev"].includes(c.label)).map(c=>c.label),
    ["editor-typecheck","editor-build","GameCli_framework-build","full-dev"]);
  assert(!fs.existsSync(path.join(base,"package-01")));
  assert.throws(()=>validateNativePublication({status:"PASS",finishedAt:"x",cells:[],launches:[],screenshots:[]}));
  const native=JSON.parse(fs.readFileSync(publication.nativeReport,"utf8"));
  if(native.status==="PASS")validateNativePublication(native);
  else assert.throws(()=>validateNativePublication(native),"In-progress/failed native evidence must block publication");
  // Read-only historical format fixture; never a new candidate install verdict.
  const sampleFile="F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
  const sample=JSON.parse(fs.readFileSync(sampleFile,"utf8"));
  const journal={path:path.resolve(sampleFile),sha256:createHash("sha256").update(fs.readFileSync(sampleFile)).digest("hex")};
  const normalized=normalizeActualInstallation(sample,journal,sample.executable.version);
  assert.deepEqual(normalized.installer,sample.package);assert.deepEqual(normalized.actualInstallationJournal,journal);
  for(const change of [{status:"FAILED"},{exitCode:1},{metadataRestoration:"FAILED"},{scope:"PAYLOAD_ONLY"},
    {executable:{...sample.executable,version:"0.0.0"}},{resources:[]},{package:null}])
    assert.throws(()=>normalizeActualInstallation({...sample,...change},journal,sample.executable.version));
  console.log(JSON.stringify({status:"PASS",version,base,productStarts:0,builds:0,
    scope:"PUBLICATION_BINDING_ONLY_NATIVE_TERMINAL_RECEIPTS_REQUIRED_BEFORE_PACKAGING"}));
  return;
}
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const sha=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc=file=>({path:path.resolve(file),sha256:sha(file),bytes:fs.statSync(file).size,modifiedUtc:fs.statSync(file).mtime.toISOString()});
const unchanged=files=>files.forEach(file=>assert.equal(sha(file.path),file.sha256,file.path));
const priorGridFile=publication?.buildReceipt||"F:/AgentVN/QA/Runtime-Save-Grid-Fit-20261024-01/build-02/report.json",grid=read(priorGridFile);
const sealed=publication?read(publication.frozenSeal):null;
if(sealed)assert.equal(sealed.status,"PASS");
const frozenProducts=sealed?[sealed.installer,sealed.editor,...sealed.resources]:grid.frozen;
const report={status:"RUNNING",phase,candidateVersion:version,startedAt:new Date().toISOString(),modelRequests:0,
  scope:"EDITOR_NSIS_CANDIDATE_NOT_UPGRADE_CLEAN_MACHINE_FUNCTIONAL_EXPORT_OR_ANDROID",
  commands:[],priorGridBuild:desc(priorGridFile),frozenProducts,
  ...(publication?{configuration:desc(configArg.slice(21)),frozenSeal:desc(publication.frozenSeal)}:{})};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
function sourceNames(){
  return execFileSync("git",["ls-files","--cached","--others","--exclude-standard","-z"],
    {cwd:root,maxBuffer:32*1024*1024}).toString().split("\0").filter(file=>
    /^(editor|GameCli_framework|backend|shared|scripts)\//.test(file)&&fs.existsSync(path.join(root,file))
    &&fs.lstatSync(path.join(root,file)).isFile());
}
function assertProductSources(sources){
  unchanged(sources.filter(file=>/^(editor|GameCli_framework|backend|shared)[\\/]/.test(path.relative(root,file.path))
    &&!/[\\/]agentvnDocIndex\.generated\.ts$/.test(file.path)));
}
async function command(label,exe,args,expected=0){
  const temporary=path.join(out,"temporary");fs.mkdirSync(temporary,{recursive:true});
  const row={label,command:[exe,...args],expected,status:"RUNNING",startedAt:new Date().toISOString(),log:path.join(out,`${label}.log`)};
  report.commands.push(row);save();const fd=fs.openSync(row.log,"wx");
  try{
    // Node preserves PS7's module search path when launching Windows PS5.
    // Use PS5's own built-in modules; never mutate the machine configuration.
    const shellEnv=/^powershell\.exe$/i.test(exe)
      ?{PSModulePath:path.join(process.env.SystemRoot,"System32/WindowsPowerShell/v1.0/Modules")}:{};
    row.shellModulePath=shellEnv.PSModulePath;save();
    const child=spawn(exe,args,{cwd:root,windowsHide:true,stdio:["ignore",fd,fd],env:{...process.env,...shellEnv,TEMP:temporary,TMP:temporary,
      AGENTVN_TEST_PROJECT:"F:/AgentVN/QA/Project-Directory-Write-20261024-01/red-02/isolated-small.vnproj",
      AGENTVN_WORKSPACE_OUTPUT:path.join(out,`${label}-evidence`)}});
    row.pid=child.pid;save();
    row.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
    assert.equal(row.exitCode,expected,row.log);row.status=expected===0?"PASS":"EXPECTED_REJECTION";
  }catch(error){row.status="FAILED";throw error;}
  finally{fs.closeSync(fd);row.finishedAt=new Date().toISOString();row.logIdentity=desc(row.log);save();console.log(`${label} ${row.status}`);}
}
function prior(kind,which="01"){
  const file=path.join(base,`${kind}-${which}/report.json`),value=read(file);
  assert.equal(value.status,"PASS");assert.equal(value.candidateVersion,version);unchanged(value.frozenProducts);
  (report.prerequisites??=[]).push(desc(file));return value;
}
(async()=>{
  save();assert.equal(grid.status,"PASS");unchanged(report.frozenProducts);
  if(phase==="checkpoint"){
    unchanged(grid.sources);unchanged([grid.dev,grid.player??grid.nativePlayer]);
    if(!publication){
      const nativeFile="F:/AgentVN/QA/Runtime-Save-Grid-Fit-20261024-01/native-audit-02/report.json";
      assert.equal(read(nativeFile).status,"PASS");report.priorGridAudit=desc(nativeFile);
    }
    const checkpoint=publication?.checkpoint||"F:/AgentVN/Checkpoints/Editor-1.9.24-20261024-01";
    assert(!fs.existsSync(checkpoint));fs.mkdirSync(checkpoint,{recursive:true});report.checkpoint=checkpoint;
    const names=[...new Set(execFileSync("git",["ls-files","--modified","--others","--exclude-standard","-z"],
      {cwd:root,maxBuffer:32*1024*1024}).toString().split("\0").filter(Boolean))];
    report.snapshots=[];
    for(const name of names){
      const file=path.resolve(root,name);assert(file.startsWith(root+path.sep));
      if(!fs.existsSync(file)){report.snapshots.push({file:name,deleted:true});continue;}
      assert(fs.lstatSync(file).isFile(),"Do not follow checkpoint links: "+file);
      const copy=path.join(checkpoint,"worktree",name);fs.mkdirSync(path.dirname(copy),{recursive:true});
      fs.copyFileSync(file,copy,fs.constants.COPYFILE_EXCL);
      const source=desc(file),snapshot=desc(copy);assert.equal(source.sha256,snapshot.sha256);
      report.snapshots.push({file:name,source,copy:snapshot});
    }
    fs.writeFileSync(path.join(checkpoint,"tracked.patch"),execFileSync("git",["-c","core.safecrlf=false","diff","--binary","HEAD"],
      {cwd:root,maxBuffer:192*1024*1024}),{flag:"wx"});
    report.priorProducts=[];
    for(const source of [grid.dev,grid.player??grid.nativePlayer]){
      const copy=path.join(checkpoint,path.basename(source.path));fs.copyFileSync(source.path,copy,fs.constants.COPYFILE_EXCL);
      report.priorProducts.push({source,copy:desc(copy)});assert.equal(sha(copy),source.sha256);
    }
    if(publication){
      report.sourceBaseline=sourceNames().map(file=>desc(path.join(root,file)));
      await command("version-forward",process.execPath,["scripts/editor-forward-version-test.cjs",path.join(out,"version-forward.json")]);
    }else{
      await command("version-red",process.execPath,["scripts/editor-forward-version-test.cjs",path.join(out,"version-red.json")],1);
      const red=read(path.join(out,"version-red.json"));
      assert.equal(red.current,"1.9.23");assert.equal(red.highestHistorical.version,"1.9.23");
      assert(red.error.includes("must be newer than actual historical PE"));report.versionRed=desc(path.join(out,"version-red.json"));
      report.highestHistorical=desc(red.highestHistorical.path);
    }
    fs.writeFileSync(path.join(checkpoint,"manifest.json"),JSON.stringify(report,null,2),{flag:"wx"});
  }else if(phase==="adopt-build"){
    assert(publication);
    const checkpoint=prior("checkpoint");
    unchanged(checkpoint.snapshots.filter(f=>f.copy).map(f=>f.copy));
    assertProductSources(checkpoint.sourceBaseline);
    unchanged(grid.sources);unchanged([grid.dev,grid.nativePlayer]);
    assert.equal(sha(path.join(root,"editor/src-tauri/binaries/agentvn-player.exe")),grid.nativePlayer.sha256);
    assert(grid.commands.length>=18&&grid.commands.every(c=>c.status==="PASS"&&c.exitCode===0));
    const native=read(publication.nativeReport),audit=read(publication.nativeAudit);
    validateNativePublication(native);assert.equal(audit.status,"PASS");assert(audit.checks.length>=3&&!audit.error);
    assert.equal(audit.input.sha256,sha(publication.nativeReport));
    assert.equal(path.resolve(audit.input.path),path.resolve(publication.nativeReport));
    assert.equal(native.nativeBuild.receipt.sha256,sha(publication.buildReceipt));
    assert.equal(native.executable.sha256,grid.nativePlayer.sha256);
    report.sources=sourceNames().map(file=>desc(path.join(root,file)));
    report.commands=grid.commands;report.dev=grid.dev;report.player=grid.nativePlayer;
    report.nativePrerequisites=[desc(publication.nativeReport),desc(publication.nativeAudit)];
    report.buildReused=true;report.additionalBuilds=0;
    await command("exe-only",process.execPath,["scripts/exe-only-installers-test.cjs",path.join(out,"exe-only")]);
  }else if(phase==="build"){
    const checkpoint=prior("checkpoint");unchanged(checkpoint.snapshots.filter(f=>f.copy).map(f=>f.copy));
    unchanged(grid.sources);
    assert.equal(read(path.join(root,"editor/src-tauri/tauri.conf.json")).version,version);
    report.sources=sourceNames().map(file=>desc(path.join(root,file)));
    await command("version-green",process.execPath,["scripts/editor-forward-version-test.cjs",path.join(out,"version-green.json")]);
    for(const name of ["package-version-contract","package-version-encoding-regression-test","installer-payload-provenance-test",
      "renpy-title-text-runtime-test","runtime-layout-profiles-test","title-text-button-export-contract",
      "editor-transition-presentation-test","project-export-directory-preferences-test","project-save-asset-payload-contract",
      "runtime-save-queue-test","runtime-exit-flow-test","runtime-terminal-save-test"])
      await command(name,process.execPath,[`scripts/${name}.cjs`]);
    await command("exe-only",process.execPath,["scripts/exe-only-installers-test.cjs",path.join(out,"exe-only")]);
    await command("editor-typecheck","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run typecheck"]);
    await command("editor-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\editor run build"]);
    await command("gamecli-build","cmd.exe",["/d","/s","/c","npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
    await command("full-dev","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    report.dev=desc(path.join(root,"AgentVN Dev.exe"));assert.equal(report.dev.sha256,sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert(new Date(report.dev.modifiedUtc)>=new Date(report.commands.at(-1).startedAt));
    report.player=desc(path.join(root,"editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(report.player.sha256,sha(path.join(root,"GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    await command("version-resources",process.execPath,["scripts/editor-installed-version-resources-test.cjs"]);
    assertProductSources(report.sources);
  }else if(phase==="package"){
    const build=prior(publication?"adopt-build":"build");assert(build.commands.length>=19&&build.commands.every(c=>c.status==="PASS"&&c.exitCode===0));
    if(publication)unchanged(build.nativePrerequisites);
    assertProductSources(build.sources);unchanged([build.dev,build.player]);report.sources=build.sources;
    const releaseDir=path.join(root,"releases/editor"),before=new Set(fs.readdirSync(releaseDir));
    await command("editor-nsis-package","cmd.exe",["/d","/s","/c",`package-installers.bat editor ${version} --preserve-build-cache`]);
    const added=fs.readdirSync(releaseDir).filter(file=>!before.has(file));assert.equal(added.length,1);
    assert(added[0].startsWith(`AgentVN_Editor_v${version}_`)&&added[0].endsWith(".exe"));
    report.installer=desc(path.join(releaseDir,added[0]));
    report.editor=desc(path.join(root,"editor/src-tauri/target/release/agentvn-editor.exe"));
    report.player=desc(path.join(root,"editor/src-tauri/binaries/agentvn-player.exe"));
    report.backend=desc(path.join(root,"editor/src-tauri/binaries/creator-backend.exe"));
    const metadata=path.join(root,"editor/src-tauri/bundle-workspace/build-versions.json");
    assert.equal(read(metadata).editorVersion,version);report.versions=desc(metadata);
    const retained=path.join(out,path.basename(report.installer.path));fs.copyFileSync(report.installer.path,retained,fs.constants.COPYFILE_EXCL);
    report.retainedInstaller=desc(retained);assert.equal(report.retainedInstaller.sha256,report.installer.sha256);
    assertProductSources(build.sources);
  }else if(phase==="payload"){
    const packaged=prior("package");unchanged([packaged.installer,packaged.retainedInstaller]);
    await command("actual-nsis-payload",process.execPath,["scripts/editor-installer-resources-acceptance.cjs",
      path.join(out,"deployments"),version,path.dirname(packaged.installer.path)]);
    const payloadFile=path.join(out,"deployments/installer-resource-report.json"),payload=read(payloadFile);
    assert.equal(payload.status,"PASS");assert.equal(payload.deployments.length,1);assert.equal(payload.installers.length,1);
    assert.equal(payload.installerFormat,"nsis");assert.equal(payload.installers[0].sha256,packaged.installer.sha256);
    report.installerFormat="nsis";report.payloadReport=desc(payloadFile);report.deployments=payload.deployments;
    report.archived=[packaged.retainedInstaller];
  }else{
    prior("payload");prior("checkpoint");
    const common=["-NoProfile","-ExecutionPolicy","Bypass","-File","scripts/current-candidate-install-session.ps1",
      "-QaRoot",base,"-ExpectedVersion",version,...(publication?["-CandidateDate",date]:[])];
    await command("install-boundaries","powershell.exe",[...common,"-Action","SelfTest"]);
    await command("actual-nsis-install","powershell.exe",[...common,"-Action","Install"]);
    const file=path.join(base,"installation.json"),installed=read(file);
    assert.equal(installed.status,"PASS");assert.equal(installed.metadataRestoration,"PASS");
    assert.equal(installed.executable.version,version);report.installation=desc(file);
    unchanged([installed.executable,...installed.resources,...installed.protectedFiles]);
    if(publication){
      // Canonical compatibility receipt is derived from, and cryptographically
      // linked to, the actual installer journal. It is not another installation.
      const canonical=path.join(out,"actual-installation.json");
      const normalized=normalizeActualInstallation(installed,desc(file),version);
      fs.writeFileSync(canonical,JSON.stringify(normalized,null,2),{flag:"wx"});
      const actual=desc(canonical);
      const derived=require("./installed-profile-data-replay.cjs").deriveActual(actual,version);
      derived.protectedFiles=installed.protectedFiles;
      derived.installationJournal=desc(file);
      fs.writeFileSync(path.join(base,"derived-installed-01.json"),JSON.stringify(derived,null,2),{flag:"wx"});
      const candidate={version,qa:base,agentvnNavigation:"existing",actual};
      require("./candidate-layout-consumption.cjs").validateCandidateConfig(candidate);
      fs.writeFileSync(path.join(base,"layout-config-01.json"),JSON.stringify(candidate,null,2),{flag:"wx"});
      report.canonicalInstallation=actual;
      report.derivedInstallation=desc(path.join(base,"derived-installed-01.json"));
      report.candidateConfig=desc(path.join(base,"layout-config-01.json"));
    }
  }
  unchanged(report.frozenProducts);report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({phase,status:report.status,out,
  commands:report.commands.length,error:report.error}));});
