"use strict";
// Read-only artifact preflight. No installation, APK signing/building, adb,
// credentials, original user database or project execution.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const root = "D:/AgentVN";
const dest = process.argv[2];
assert(dest && path.dirname(path.resolve(dest)) === path.resolve(root,"output") && !fs.existsSync(dest));
fs.mkdirSync(dest);
const read = p => JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const normalized = p => path.resolve(p).toLowerCase();
const report = { status:"RUNNING", at:new Date().toISOString(), scope:"READ_ONLY_UPGRADE_SAMPLE_PREFLIGHT_NOT_UPGRADE_ACCEPTANCE",
  productChanges:0, installationRuns:0, apkBuilds:0, deviceOperations:0, realModelRequests:0,
  editorSamples:[], historicalGameArtifacts:[], excludedCandidates:[], candidateArtifacts:[],
  checks:[], commands:[], inputs:[], error:null };
const load = p => { report.inputs.push({path:p,sha256:sha(p)}); return read(p); };
function command(executable,args,label,expectedExit) {
  const r=spawnSync(executable,args,{cwd:root,windowsHide:true,encoding:"utf8",timeout:60000,maxBuffer:8*1024*1024});
  const logfile=path.join(dest,`${label}.log`);
  fs.writeFileSync(logfile,`${r.stdout||""}\n${r.stderr||""}`,{flag:"wx"});
  report.commands.push({executable,args,exitCode:r.status,log:logfile,sha256:sha(logfile)});
  assert.ifError(r.error); assert.equal(r.status,expectedExit,logfile); return r.stdout+"\n"+r.stderr;
}
function check(name,fn) {
  const row={name,status:"RUNNING"};report.checks.push(row);
  try{row.detail=fn();row.status="PASS";}catch(e){row.status="FAILED";row.error=String(e.stack||e);throw e;}
}
try {
  const old=load(path.join(root,"output/full-regression-20261017-01/old-editor-samples.json"));
  check("Six actual old Editor release installers retain recorded release identity",()=>{
    for(const s of old.samples) for(const f of s.files) {
      assert(fs.existsSync(f.path));assert.equal(sha(f.path),f.sha256);
      assert.equal(fs.statSync(f.path).size,f.bytes);
      report.editorSamples.push({...f,actualCurrentSha256:sha(f.path),recordedVersion:s.actualPeVersion,
        versionScope:s.purpose,upgradeClaim:false});
    }
    assert.equal(report.editorSamples.length,6);return {actualInstallers:6,upgradeRuns:0};
  });
  const executions=[];
  for(let i=2;i<=8;i++) {
    const f=path.join(root,`output/cleanup-audit-20261017-generated-${String(i).padStart(2,"0")}/execution.json`);
    if(fs.existsSync(f)) executions.push({path:f,value:load(f)});
  }
  const archiveRows=executions.flatMap(e=>(e.value.rows||[]).filter(r=>r.archive).map(r=>({execution:e.path,...r})));
  function locateCleanup(file) {
    return executions.flatMap(e=>(e.value.rows||[]).filter(r=>normalized(file)===normalized(r.path)
      || normalized(file).startsWith(normalized(r.path)+path.sep)).map(r=>({execution:e.path,...r})));
  }
  check("Historical QA standalone EXE and signed-source APK are genuinely absent and were deleted without archive",()=>{
    const win=load(path.join(root,"output/portable-save-release-20261016-02/portable-saves-01/report.json")).windowsExport;
    const apkmeta=load(path.join(root,"output/android-host-cleanup-installed-20261017-01/installed-session/android-export/完整剧情隔离验收 5bff274c-0.1.0.apk.acceptance.json"));
    for(const row of [{kind:"OLD_TEMP_PROJECT_PORTABLE_EXE",path:win.exe,expectedSha256:win.exeSha256},
      {kind:"OLD_TEMP_PROJECT_APK",path:apkmeta.apk.path,expectedSha256:apkmeta.apk.sha256,
        packageName:apkmeta.packageName,recordedEditorVersion:apkmeta.editorVersion,recordedRuntimeField:apkmeta.runtimeVersion}]) {
      const cleanup=locateCleanup(row.path);assert.equal(fs.existsSync(row.path),false);
      assert(cleanup.length===1 && cleanup[0].status==="DELETED" && cleanup[0].archive===null);
      // Do not say "unrecoverable everywhere": only the actual declared archive
      // manifests and exact old source paths have been verified here.
      const archivedMatch=archiveRows.filter(a=>a.archive.sha256===row.expectedSha256);
      assert.equal(archivedMatch.length,0);
      report.historicalGameArtifacts.push({...row,existsNow:false,cleanup,
        declaredArchiveHashMatches:archivedMatch.length,upgradeStatus:"BLOCKED_MISSING_OLD_BINARY",
        oldReportRewritten:false,universalDiskAbsenceClaim:false});
    }
    return {missingDeclaredArtifacts:2,matchingDeclaredRecoveryFiles:0,oldVersionRebuildAllowed:false};
  });
  check("Remaining raw APK is checked by actual apksigner, not selected by unsigned filename",()=>{
    const file=path.join(root,"GameCli_framework/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk");
    assert(fs.existsSync(file));const hash=sha(file);
    const java="C:/Users/1/AppData/Local/AgentVN/AndroidToolchain/jdk-17/bin/java.exe";
    const jar="C:/Users/1/AppData/Local/AgentVN/AndroidToolchain/Sdk/build-tools/35.0.0/lib/apksigner.jar";
    assert(fs.existsSync(java)&&fs.existsSync(jar));
    const text=command(java,["-jar",jar,"verify","--verbose","--print-certs",file],"raw-apk-signature",1);
    assert(/DOES NOT VERIFY/.test(text));assert.equal(sha(file),hash);
    report.excludedCandidates.push({kind:"RAW_BUILD_APK_NOT_VERIFIED_OLD_SIGNED_RELEASE",path:file,
      sha256:hash,bytes:fs.statSync(file).size,actualSignatureVerification:"DOES_NOT_VERIFY",
      reason:"Cannot substitute for a traceable old signed APK with matching upgrade identity",
      staticSignatureInspectionOnly:true,modified:false});
    return {staticVerifierExitCode:1,expectedNegative:true,signingOrInstallPerformed:false};
  });
  check("Two remaining named final-project setups are listed only, not installed or used as temporary-project substitutes",()=>{
    for(const stem of ["隐忍的成长_0.1.0_x64-setup.exe","隐忍的成长_1.9.8_x64-setup.exe"]) {
      const file=path.join(root,"output/checkpoints/standalone-runtime-freshness-20261005/nsis-before-build",stem);
      assert(fs.existsSync(file));const before=sha(file);
      const text=command("C:/Program Files/7-Zip/7z.exe",["l","-slt",file],`final-project-${stem.includes("1.9.8")?"198":"010"}-listing`,0);
      assert(text.includes("Path = "));assert.equal(sha(file),before);
      report.excludedCandidates.push({kind:"FINAL_USER_PROJECT_SETUP_STATIC_INVENTORY_ONLY",path:file,sha256:before,
        bytes:fs.statSync(file).size,installedOrExecuted:false,oldRuntimeIdentityVerified:false,
        reason:"Final project is reserved until all prerequisites; filename is not engine-version provenance"});
    }
    return {listedOnly:2,userProjectExecuted:false,temporaryProjectSubstitution:false};
  });
  check("Candidate frozen installer artifacts still exist at verified recovery locations",()=>{
    const frozen=load(path.join(root,"output/full-regression-20261017-01/candidate-02/manifest.json"));
    for(const item of frozen.artifacts.filter(i=>/\/installers\//.test(i.frozen.path.replace(/\\/g,"/")))) {
      const recorded=item.frozen, exact=fs.existsSync(recorded.path)?recorded.path:
        archiveRows.find(r=>normalized(r.path)===normalized(recorded.path)&&r.archive.sha256===recorded.sha256)?.archive.path;
      assert(exact&&fs.existsSync(exact));assert.equal(sha(exact),recorded.sha256);
      report.candidateArtifacts.push({originalPath:recorded.path,currentPath:exact,sha256:recorded.sha256,
        bytes:fs.statSync(exact).size,installationClaim:false});
    }
    assert.equal(report.candidateArtifacts.length,3);
    return {frozenCurrentInstallers:3,rebuilt:false};
  });
  report.upgradeReadiness={
    editorLatestNsis:"PRIOR_LIMITED_UPGRADE_PASS_RECORDED_SEPARATELY",
    editorMsi:"BLOCKED_PENDING_EXPLICIT_UNEXPECTED_TARGET_DIRECTORY_SCOPE",
    editorCrossGeneration:"NOT_RUN_NEEDS_SAFE_INSTALL_BRANCH",
    windowsGameUpgrade:"BLOCKED_MISSING_TRUSTED_OLD_TEMP_GAME_SETUP_AND_CURRENT_NATIVE_EXPORT",
    androidGameUpgrade:"BLOCKED_MISSING_SIGNED_OLD_APK_AND_FROZEN_CURRENT_EXPORT",
    realModelTasks:"NOT_RUN_REQUIRES_USER_CONFIGURED_ISOLATED_CREDENTIALS",
    physicalOrDeviceAcceptance:"NOT_PERFORMED_BY_THIS_PREFLIGHT"
  };
  report.status="PASS"; // Evidence preflight succeeds; upgrades explicitly do not.
} catch(e) {report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
finally {
  report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(dest,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,editorSamples:report.editorSamples.length,
    missingGameArtifacts:report.historicalGameArtifacts.length,candidateInstallers:report.candidateArtifacts.length,
    upgradeReadiness:report.upgradeReadiness,error:report.error}));
}
