"use strict";
// Reporting receipt only. Does not rerun the referenced product tests or
// promote their partial PASS evidence into whole-group acceptance.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
const {classifyVoicePages}=require("./lib/voice-paged-classification.cjs");
const root="D:/AgentVN",destination=process.argv[2];
const current=process.argv.includes("--current-20261019");
const voice=process.argv.includes("--with-runtime-voice-20261019");
const paged=process.argv.includes("--with-runtime-voice-paged-20261019");
const paged4k=process.argv.includes("--with-runtime-voice-paged-4k-20261019");
const quickReview=process.argv.includes("--with-quick-source-review-20261019");
const quickGaps=process.argv.includes("--with-quick-gaps-20261019");
const quickLatest=process.argv.includes("--with-quick-latest-20261019");
const portrait=process.argv.includes("--with-dialog-portrait-20261019");
const animationAsset=process.argv.includes("--with-animation-asset-20261019");
assert(!voice||current,"Voice continuation requires the current 20261019 ledger");
assert(!paged||(voice&&current),"Paged voice requires the existing short-voice and current ledger");
assert(!paged4k||paged,"4K supplement requires the original paged evidence");
assert(!quickReview||current,"Quick reconciliation requires the current ledger");
assert(!quickGaps||(quickReview&&current),"Quick supplement must preserve the earlier source reconciliation");
assert(!quickLatest||quickGaps,"Distinguishable latest-valid supplement requires the earlier quick matrix");
assert(!portrait||(current&&quickLatest),"Portrait supplement retains the current quick-save evidence");
assert(!animationAsset||portrait,"Animation asset observation preserves the full preceding evidence chain");
assert(destination&&path.dirname(path.resolve(destination))===path.resolve(root,"output")&&!fs.existsSync(destination));
fs.mkdirSync(destination);
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const result={status:"BLOCKED",at:new Date().toISOString(),scope:"INTERIM_REPORT_RECEIPT_NOT_FULL_ACCEPTANCE",
  evidenceReceiptStatus:"RUNNING",groups:[],counts:{},sources:[],safety:{},productChanges:0,
  newProductTests:0,modelRequests:0,deviceOperations:0,error:null};
function input(relative){
  const file=path.join(root,relative);assert(fs.existsSync(file),file);
  const row={path:file,sha256:sha(file),bytes:fs.statSync(file).size};result.sources.push(row);return file;
}
try{
  const ledger=input("plans/FULL_REGRESSION_20261017.md");
  const text=fs.readFileSync(ledger,"utf8");
  for(const row of text.split(/\r?\n/)){
    const match=row.match(/^\| (G\d\d) \| (.*?) \| ((PASS|FAILED|BLOCKED|NOT_RUN).*?) \|$/);
    if(!match)continue;
    result.groups.push({id:match[1],requirement:match[2],status:match[4],qualification:match[3]});
    result.counts[match[4]]=(result.counts[match[4]]||0)+1;
  }
  assert.equal(result.groups.length,18);
  assert.equal(new Set(result.groups.map(g=>g.id)).size,18);
  for(let i=1;i<=18;i++)assert(result.groups.some(g=>g.id===`G${String(i).padStart(2,"0")}`));
  assert.deepEqual(result.counts,portrait?{FAILED:9,BLOCKED:6,PASS:3}:
    current?{FAILED:8,BLOCKED:7,PASS:3}:{NOT_RUN:3,FAILED:6,BLOCKED:6,PASS:3});
  for(const relative of [
    "output/host-upgrade-20261018-02/acceptance-review.md",
    "output/host-msi-session-20261018-01/incident-audit-01.json",
    "output/installed-assistant-session-20261018-01/acceptance-review.md",
    "output/installed-assistant-recovery-20261018-01/acceptance-review.md",
    "output/installed-assistant-review-20261018-01/acceptance-review.md",
    "output/installed-preview-20261018-01/acceptance-review.md",
    "output/installed-preview-20261018-02/acceptance-review.md",
    "output/installed-editor-motion-20261018-01/acceptance-review.md",
    "output/installed-runtime-motion-20261018-01/acceptance-review.md",
    "output/installed-gui-session-20261018-01/acceptance-review.md",
    "output/installed-runtime-persistence-20261018-01/acceptance-review.md",
    "output/installed-layout-resources-20261018-01/acceptance-review.md",
    "output/installed-project-directory-20261018-01/acceptance-review.md",
    "output/installed-novel-session-20261018-01/acceptance-review.md",
    // The first components report deliberately covers both native sessions;
    // there is no invented second acceptance-review or second terminal audit.
    "output/installed-components-20261018-01/acceptance-review.md",
    "output/installed-components-20261018-01/terminal-audit-02.json",
    "output/installed-database-migration-20261018-01/acceptance-review.md",
    "output/installed-environment-cache-20261018-01/acceptance-review.md",
    "output/installed-runtime-exit-20261018-02/acceptance-review.md",
    "output/installed-runtime-settings-20261018-01/acceptance-review.md",
    "output/installed-runtime-abilities-20261018-01/acceptance-review.md",
    "output/installed-runtime-exceptions-20261018-01/acceptance-review.md",
    "output/installed-assets-20261018-01/acceptance-review.md",
    "output/installed-video-20261018-01/acceptance-review.md",
    "output/old-runtime-refusal-20261018-01/acceptance-review.md",
    "output/installed-editor-loading-20261018-01/acceptance-review.md",
    "output/full-regression-upgrade-preflight-20261018-01/acceptance-review.md",
    "output/installed-windows-export-20261018-02/acceptance-review.md"
  ])input(relative);
  if(current)for(const relative of [
    "output/host-msi-next-20261018-01/acceptance-review.md",
    "output/host-msi-next-20261018-01/terminal-audit-02.json",
    "output/host-nsis-cross-20261018-01/acceptance-review.md",
    "output/host-nsis-cross-20261018-01/terminal-audit-02.json",
    "output/installed-real-model-20261019-01/acceptance-review.md",
    "output/installed-real-model-20261019-01/terminal-audit-01.json",
    "output/editor-selection-mask-20261019-01/terminal-audit-02.json",
    "output/installed-resource-versions-20261019-01/REPORT.md",
    "output/installed-resource-versions-20261019-01/terminal-audit-03.json",
    "output/installed-layout-author-review-20261019-01/REPORT.md",
    "output/installed-layout-author-review-20261019-01/ORDINARY_REPORT.md",
    "output/installed-layout-author-review-20261019-01/ROLE_STATES_REPORT.md",
    "output/installed-layout-author-review-20261019-01/terminal-audit-03.json",
    "output/installed-layout-author-review-20261019-01/role-state-audit-02.json",
    "output/installed-runtime-business-matrix-20261019-01/REPORT.md",
    "output/installed-runtime-business-matrix-20261019-01/attempt-03/report.json",
    "output/installed-runtime-business-matrix-20261019-01/audit-03-01.json",
    "output/f-drive-consolidation-20261019-02/REPORT.md",
    "output/f-drive-consolidation-20261019-02/verification-03.json",
    "plans/DESKTOP_ACCEPTANCE_QUEUE_20261018.md"
  ])input(relative);
  if(voice){
    for(const relative of [
      "output/installed-runtime-voice-20261019-01/REPORT.md",
      "output/installed-runtime-voice-20261019-01/export-01/report.json",
      "output/installed-runtime-voice-20261019-01/player-01/report.json",
      "output/installed-runtime-voice-20261019-01/execution-01.json",
      "output/installed-runtime-voice-20261019-01/audit-01-01.json",
      "output/installed-runtime-voice-20261019-01/audit-01-02.json"
    ])input(relative);
    const observed=read(path.join(root,"output/installed-runtime-voice-20261019-01/player-01/report.json"));
    const audited=read(path.join(root,"output/installed-runtime-voice-20261019-01/audit-01-02.json"));
    assert.equal(audited.status,"PASS");
    assert.equal(audited.sourceConclusion,observed.status);
    assert.equal(observed.cells.length,24);
    result.voiceEvidence={sourceConclusion:observed.status,layoutFlows:observed.cells.length,
      completeSourceMatrix:true,newListeningClaim:false,standaloneSetupOrAndroidClaim:false};
  }
  if(paged){
    const relative="output/installed-runtime-voice-paged-20261019-01/";
    for(const name of ["REPORT.md","EXPLICIT_GAPS_REVIEW.md","export-01/report.json","player-04/report.json","execution-04.json",
      "audit-04-01.json","preparation.json","profile-restoration-04.json",
      "execution-01.json","execution-02.json","abort-02.json","audit-03-01.json",
      "supplemental-nvl-overlap-03.json","supplemental-nvl-overlap-04-agentvn.json",
      "supplemental-nvl-overlap-04-agentvn-retry01.json",
      "capacity-4k-observation-04.json","capacity-4k-observation-04-retry01.json"])input(relative+name);
    const observed=read(path.join(root,relative,"player-04/report.json"));
    const audited=read(path.join(root,relative,"audit-04-01.json"));
    const execution=read(path.join(root,relative,"execution-04.json"));
    const overlap=read(path.join(root,relative,"supplemental-nvl-overlap-04-agentvn-retry01.json"));
    const capacity=read(path.join(root,relative,"capacity-4k-observation-04-retry01.json"));
    assert.equal(audited.status,"PASS");assert.equal(audited.sourceConclusion,observed.status);
    assert.equal(observed.cells.length,24);assert.equal(observed.onlyCell,null);
    assert(observed.finishedAt&&execution.finishedAt);assert.equal(execution.profileRestoration,"PASS");
    assert.equal(execution.status,observed.status);assert.equal(overlap.status,"FAILED");
    assert(overlap.geometry.hits.length>0&&overlap.geometry.controls.length===1);
    const media=audited.checks.find(c=>c.name.startsWith("Passing source flows")).detail;
    const classification=classifyVoicePages(observed,capacity);
    result.pagedVoiceEvidence={sourceConclusion:observed.status,businessConclusion:classification.status,
      classification,layoutFlows:observed.cells.length,
      fullMatrixAttempted:classification.allDeclaredFlowsAttempted,completeCoverage:classification.completeCoverage,
      checks:observed.cells.reduce((n,c)=>n+c.checks.length,0),...media,
      nvlQuickOverlap:{status:"FAILED",characterRectIntersections:overlap.geometry.hits.length,
        scope:overlap.cell,notAllResolutionsOrActualInkClipping:true},
      newListeningClaim:false,standaloneSetupOrAndroidClaim:false};
  }
  if(paged4k){
    const relative="output/installed-runtime-voice-paged-4k-20261019-01/";
    for(const name of ["REPORT.md","combined-coverage.json","player-01/report.json","execution-01.json",
      "audit-01-01.json","fixtures.json","export-01/report.json","preparation.json","profile-restoration.json"])input(relative+name);
    const observed=read(path.join(root,relative,"player-01/report.json"));
    const audited=read(path.join(root,relative,"audit-01-01.json"));
    const combined=read(path.join(root,relative,"combined-coverage.json"));
    assert.equal(audited.status,"PASS");assert.equal(audited.sourceConclusion,observed.status);
    assert.equal(observed.status,"PASS");assert.equal(observed.cells.length,8);
    for(const c of observed.cells){
      assert.equal(c.status,"PASS");assert.equal(c.viewport.width,3840);assert.equal(c.viewport.height,2160);
      assert.equal(c.checks.length,c.layout==="renpy"?11:7);assert(c.checks.every(s=>s.status==="PASS"));
    }
    for(const s of audited.sources)assert.equal(sha(s.path),s.sha256);
    for(const s of combined.sources)assert.equal(sha(s.path),s.sha256);
    const original=read(path.join(root,"output/installed-runtime-voice-paged-20261019-01/player-04/report.json"));
    const covered=[...original.cells.filter(c=>c.status==="PASS"),...observed.cells];
    const keys=new Set(covered.map(c=>c.name));assert.equal(covered.length,24);assert.equal(keys.size,24);
    for(const [w,h]of [[1920,1080],[2560,1440],[3840,2160]])for(const d of [1,2])
      for(const m of ["normal","reduced"])for(const l of ["agentvn","renpy"])
        assert(keys.has(`${w}x${h}-dpr${d}-${m}-${l}`));
    assert.equal(combined.status,"PASS");assert.equal(combined.identicalInputAcrossResolutions,false);
    result.pagedVoiceSupplement={sourceConclusion:observed.status,combinedBusinessConclusion:"PASS",
      complementaryCompleteFlows:24,identicalInputAcrossResolutions:false,
      media:audited.checks.find(c=>c.name.startsWith("Passing source flows")).detail,
      originalQaFailureRetained:true,standaloneSetupOrAndroidClaim:false};
  }
  if(quickReview){
    const relative="output/installed-quick-gap-review-20261019-01/";
    input(relative+"REPORT.md");const reconciled=read(input(relative+"review.json"));
    assert.equal(reconciled.status,"PASS");assert.equal(reconciled.newProductTests,0);
    assert.equal(reconciled.checks.length,5);assert(reconciled.checks.every(c=>c.status==="PASS"));
    for(const s of reconciled.sources)assert.equal(sha(s.path),s.sha256);
    assert.equal(reconciled.requirements.length,3);
    result.quickSourceReconciliation=reconciled.requirements;
  }
  if(quickGaps){
    const relative="output/installed-runtime-quick-gaps-20261019-01/";
    for(const name of ["REPORT.md","player-01.json","execution-01.json","audit-01.json",
      "preparation.json","profile-restoration.json"])input(relative+name);
    const observed=read(path.join(root,relative,"player-01.json"));
    const audited=read(path.join(root,relative,"audit-01.json"));
    const execution=read(path.join(root,relative,"execution-01.json"));
    assert.equal(audited.status,"PASS");assert.equal(audited.sourceConclusion,observed.status);
    assert(observed.finishedAt&&execution.finishedAt);assert.equal(execution.profileRestoration,"PASS");
    assert.equal(observed.cells.length,12);assert.equal(execution.sourceConclusion,observed.status);
    for(const s of audited.sources)assert.equal(sha(s.path),s.sha256);
    result.quickGapSupplement={sourceConclusion:observed.status,combinations:observed.cells.length,
      passingCombinations:observed.cells.filter(c=>c.status==="PASS").length,
      checks:observed.cells.reduce((n,c)=>n+c.checks.length,0),
      pendingPassing:observed.cells.filter(c=>c.checks[0]?.status==="PASS").length,
      semanticPassing:observed.cells.filter(c=>c.checks.at(-1)?.status==="PASS").length,
      writeDenialNewPassing:observed.cells.slice(1).filter(c=>c.checks[1]?.status==="PASS").length,
      writeDenialPriorBaselineReferenced:true,standaloneSetupOrAndroidClaim:false,
      screenshots:observed.screenshots.length,nativeSaveCopies:observed.nativeSaves.length};
  }
  if(quickLatest){
    const relative="output/installed-runtime-quick-latest-20261019-01/";
    for(const name of ["REPORT.md","player-01.json","execution-01.json","audit-01.json",
      "preparation.json","profile-restoration.json"])input(relative+name);
    const observed=read(path.join(root,relative,"player-01.json")),audited=read(path.join(root,relative,"audit-01.json"));
    assert.equal(audited.status,"PASS");assert.equal(audited.sourceConclusion,observed.status);
    assert(observed.finishedAt);assert.equal(observed.cells.length,12);
    for(const s of audited.sources)assert.equal(sha(s.path),s.sha256);
    const {validateDistinctLatest}=require("./installed-runtime-quick-latest-evidence.cjs");
    for(const c of observed.cells.filter(c=>c.status==="PASS"))validateDistinctLatest(c);
    result.quickLatestEvidence={sourceConclusion:observed.status,combinations:observed.cells.length,
      passingCombinations:observed.cells.filter(c=>c.status==="PASS").length,
      scope:"Distinct oldest command0/latest-valid command1/invalid-newest command2; actual restored command1",
      priorIndistinguishableEvidenceDoesNotProveLatest:true,standaloneOrAndroidClaim:false};
  }
  if(portrait){
    const base="output/installed-dialog-portrait-20261019-";
    for(const name of ["01/execution-01.json","01/editor-01.json","01/profile-restoration.json",
      "02/execution-01.json","02/editor-01.json","02/player-01.json","02/profile-restoration.json",
      "03/REPORT.md","03/player-01.json","03/execution-01.json","03/audit-01.json",
      "03/preparation.json","03/profile-restoration.json"])input(base+name);
    const observed=read(path.join(root,base+"03/player-01.json"));
    const audited=read(path.join(root,base+"03/audit-01.json"));
    const authored=read(path.join(root,base+"02/editor-01.json"));
    assert.equal(audited.status,"PASS");assert.equal(audited.sourceConclusion,"FAILED");
    assert.equal(observed.status,"FAILED");assert.equal(observed.cells.length,24);
    assert(observed.cells.every(c=>c.finishedAt&&c.status==="FAILED"&&c.bound.boundCommand
      &&c.bound.dialogVisible&&c.bound.dialogDone&&c.bound.images.length===0
      &&c.bound.backgroundImages.length===0&&c.bound.otherPrimitives.length===0));
    assert.equal(authored.status,"PASS");assert.equal(authored.checks.length,5);
    for(const s of audited.sources)assert.equal(sha(s.path),s.sha256);
    result.portraitEvidence={sourceConclusion:"FAILED",defect:"DIALOG-PORTRAIT-01",combinations:24,
      authoringChecks:5,priorQaFailuresPreserved:true,authoringExportsReusedForPlayerSupplement:true,
      standaloneSetupOrAndroidClaim:false};
    assert.equal(result.groups.find(g=>g.id==="G16").status,"FAILED");
  }
  if(animationAsset){
    const prefix="output/installed-animation-asset-20261019-";
    for(const relative of ["01/execution.json","01/probe.json","01/profile-restoration.json",
      "02/execution.json","02/profile-restoration.json",
      "03/REPORT.md","03/execution.json","03/probe.json","03/audit-01.json",
      "03/preparation.json","03/profile-restoration.json","03/native-input-observation.json"])input(prefix+relative);
    const probe=read(path.join(root,prefix+"03/probe.json"));
    const audit=read(path.join(root,prefix+"03/audit-01.json"));
    assert.equal(probe.status,"PASS");assert.equal(probe.checks.length,5);
    assert(probe.checks.every(c=>c.status==="PASS"));assert.equal(probe.cartridges.length,2);
    assert.equal(probe.consumerConclusion,"BLOCKED");assert.equal(audit.status,"PASS");
    assert.equal(audit.groups.length,7);assert(audit.groups.every(g=>g.status==="PASS"));
    for(const s of audit.sources)assert.equal(sha(s.path),s.sha256);
    result.animationAssetEvidence={observationConclusion:"PASS",observationSteps:5,
      dedicatedJsonConsumptionConclusion:"BLOCKED",actualPlayerFlows:2,
      displayScope:probe.displayScope,visualDefectClaim:false,fullMatrixClaim:false};
  }
  const frozen=read(input("output/full-regression-20261017-01/candidate-02/manifest.json"));
  assert.equal(frozen.source.length,560);
  const authorized=current?read(path.join(root,"output/editor-selection-mask-20261019-01/terminal-audit-02.json")):null;
  const allowed=new Map((authorized?.sources||[]).map(f=>[path.resolve(root,f.file),f.sha256]));
  if(current){assert.equal(authorized.status,"PASS");assert.equal(allowed.size,7);}
  for(const file of frozen.source)assert.equal(sha(file.path),allowed.get(path.resolve(file.path))||file.sha256,file.path);
  result.safety.frozenProductSourceFiles=560;
  result.safety.priorAuthorizedEditorChanges=allowed.size;
  const prep=read(input(portrait?"output/installed-dialog-portrait-20261019-03/preparation.json":
    quickLatest?"output/installed-runtime-quick-latest-20261019-01/preparation.json":
    quickGaps?"output/installed-runtime-quick-gaps-20261019-01/preparation.json":
    paged4k?"output/installed-runtime-voice-paged-4k-20261019-01/preparation.json":
    paged?"output/installed-runtime-voice-paged-20261019-01/preparation.json":
    voice?"output/installed-runtime-voice-20261019-01/preparation.json":
    current?"output/installed-layout-author-review-20261019-01/preparation.json":
    "output/installed-editor-loading-20261018-01/preparation.json"));
  const restored=read(input(portrait?"output/installed-dialog-portrait-20261019-03/profile-restoration.json":
    quickLatest?"output/installed-runtime-quick-latest-20261019-01/profile-restoration.json":
    quickGaps?"output/installed-runtime-quick-gaps-20261019-01/profile-restoration.json":
    paged4k?"output/installed-runtime-voice-paged-4k-20261019-01/profile-restoration.json":
    paged?"output/installed-runtime-voice-paged-20261019-01/profile-restoration-04.json":
    voice?"output/installed-runtime-voice-20261019-01/profile-restoration.json":
    current?"output/installed-layout-author-review-20261019-01/profile-restoration-08.json":
    "output/installed-editor-loading-20261018-01/profile-restoration.json"));
  assert.equal(restored.status,"PASS");
  let count=0;
  for(const profile of prep.profiles){
    assert(fs.existsSync(profile.original)&&!fs.existsSync(profile.held));
    for(const file of profile.files){
      assert.equal(sha(path.join(profile.original,file.relative)),file.sha256);
      assert.equal(sha(file.backup),file.sha256);count++;
    }
  }
  assert.equal(count,55);result.safety.originalProfileFileHashes=count;
  const dev=path.join(root,"AgentVN Dev.exe");
  result.safety.dev={path:dev,sha256:sha(dev),rebuiltThisReceipt:false};
  assert.equal(result.safety.dev.sha256,prep.originalDevSha256);
  const installed=path.join(prep.installRoot,"agentvn-editor.exe");
  result.safety.installedEditor={path:installed,sha256:sha(installed)};
  assert.equal(result.safety.installedEditor.sha256,"f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
  const incident=read(path.join(root,"output/host-msi-session-20261018-01/incident-audit-01.json"));
  if(current){
    // The later, explicitly authorized MSI run actually uninstalled its D
    // program and restored historical data. Do not require a stale pre-test
    // executable to still exist or reinstall it to satisfy an old receipt.
    const legacy=read(input("output/host-msi-next-20261018-01/RestoreLegacy.json"));
    assert.equal(legacy.status,"PASS");assert(legacy.files.length>0);
    const oldBackup="F:/AgentVN/Backups/AgentVN-QA-HostMSI-AuthorizedBackup-20261018-02";
    const oldManifest=read(path.join(oldBackup,"backup.json"));assert.equal(oldManifest.status,"PASS");
    for(const f of legacy.files){
      assert(f.relative.startsWith("data\\"));
      assert.equal(sha(path.join(legacy.to,f.relative.substring(5))),f.sha256);
      assert(oldManifest.files.some(b=>b.relative===f.relative&&b.sha256===f.sha256));
      assert.equal(sha(path.join(oldBackup,"installation",f.relative)),f.sha256);
    }
    assert(!fs.existsSync(path.join(incident.actualInstallation.path,"agentvn-editor.exe")));
    result.safety.formerMsiTarget={path:incident.actualInstallation.path,
      programStatus:"PREVIOUSLY_AUTHORIZED_MSI_UNINSTALLED",historicalDataRestoredFiles:legacy.files.length,
      originalHistoricalDataSha256:legacy.files.map(f=>f.sha256)};
  }else{
    assert.equal(sha(path.join(incident.actualInstallation.path,"agentvn-editor.exe")),incident.actualInstallation.executableSha256);
    result.safety.pendingMsiDirectoryUnchanged=true;
  }
  const inspection=spawnSync("powershell.exe",["-NoProfile","-Command",`
    $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
      ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
    $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -eq 8278}|Select-Object LocalPort,OwningProcess)
    @{processes=$qaProcesses;defaultBackendPorts=$qaPorts}|ConvertTo-Json -Depth 6
  `],{encoding:"utf8",windowsHide:true,timeout:20000});
  assert.equal(inspection.status,0,inspection.stderr);
  result.safety.live=JSON.parse(inspection.stdout.replace(/^\uFEFF/,""));
  assert.equal(result.safety.live.processes.length,0);assert.equal(result.safety.live.defaultBackendPorts.length,0);
  result.blockers=[
    {id:"MSI_TARGET_SCOPE",condition:"Explicit decision before backup/replace of D:\\agentvntest\\AgentVN Editor"},
    {id:"NATIVE_PICKER",condition:"Working native directory selection or user assistance in newly protected installed session"},
    {id:"REAL_MODEL_CREDENTIALS",condition:"User configures isolated Editor for three approved DeepSeek tasks; never read original credentials"},
    {id:"OLD_GAME_UPGRADE_SAMPLES",condition:"Traceable old standalone game installer/portable and legitimately signed APK; no rebuilt fake-old substitute"},
    {id:"INDEPENDENT_MACHINE",condition:"VirtualBox host cannot start the isolated clone; host tests do not prove no-development-directory environment"},
    {id:"PRODUCT_FAILURE_DEPENDENCIES",condition:"Approved current scope is test-only, so failed dependent workflows cannot be made PASS by unapproved product fixes"}
  ];
  result.notRunBoundary=["Three real-model tasks","Cross-generation Editor upgrade","Current Windows portable/setup actual export/install/upgrade",
    "Current Android build/device/retained-data upgrade","Native project/output directory picker end-to-end",
    "Final isolated copy of 隐忍的成长"];
  if(current){
    const business=read(path.join(root,"output/installed-runtime-business-matrix-20261019-01/attempt-03/report.json"));
    const audited=read(path.join(root,"output/installed-runtime-business-matrix-20261019-01/audit-03-01.json"));
    const quickSource=read(input("output/installed-runtime-business-matrix-20261019-01/attempt-03/1920x1080-dpr1-normal/report.json"));
    const quickDetail=quickSource.checks.find(c=>c.layout==="renpy"&&c.detail?.invalidLatestFallback)?.detail;
    assert(quickDetail);
    for(const key of ["invalidLatestFallback","quickWriteFailure","concurrentSubmission"])
      assert.equal(quickDetail[key],"NOT_RUN","Do not silently promote untested quick-flow edge cases");
    assert.equal(business.status,"PASS");assert.equal(business.cells.length,12);
    assert(business.cells.every(c=>c.status==="PASS"&&c.checks.length===15&&c.exitCode===0));
    assert.equal(audited.status,"PASS");assert.equal(audited.sourceRunConclusion,"PASS");
    result.latestBusiness={combinations:12,topLevelChecks:180,scope:business.scope,
      auditChecks:audited.checks.length,notIndependentWindowsSetupOrAndroid:true};
    const live=read(path.join(root,"output/installed-real-model-20261019-01/terminal-audit-01.json"));
    assert.equal(live.status,"PASS");assert.equal(live.productConclusion,"FAILED");
    const calls=live.checks[0].detail;assert.equal(calls.length,2);
    assert(calls.every(c=>c.productStatus==="FAILED"&&c.requests===1));
    const requests=calls.reduce((sum,c)=>sum+c.requests,0),tokens=calls.reduce((sum,c)=>sum+c.tokens,0);
    assert.equal(requests,2);assert.equal(tokens,6456);
    result.realModels={existingControl:"FAILED",newComponent:"FAILED",novel:"NOT_RUN_HIDDEN_ENTRY",
      requests,tokens,additionalPaidRetries:0};
    result.blockers=[
      {id:"NATIVE_INPUT_PIPE",condition:"Computer Use native pipe unavailable on recorded initialization/retry; native file/output selectors remain unproven"},
      {id:"OLD_GAME_UPGRADE_SAMPLES",condition:"Traceable old standalone setup/portable and signed APK/version/signature chain unavailable; no fake-old rebuild"},
      {id:"INDEPENDENT_MACHINE",condition:"Original independent VirtualBox clone did not reach desktop; host-installed tests do not prove development-directory independence"},
      {id:"PRODUCT_FAILURE_DEPENDENCIES",condition:"Test-only scope prohibits unapproved fixes; failed real Agents, hidden novel entry and official GUI parsing block dependent success chains"}
    ];
    result.resolvedHistoricalConditions=["User authorized MSI target scope; actual test/restore evidence retained",
      "User configured isolated DeepSeek; two paid submissions completed and failed, no longer waiting for credentials",
      "Recent and cross-generation Editor host upgrade subflows executed; clean-environment/normal-close requirements remain open",
      "Both-layout full-story twelve-combination business matrix now executed; earlier short-dialog-only scope not reused"];
    result.notRunBoundary=["Real novel model request and parse/write/restart/export chain (entry is hidden)",
      "Real Agent review/merge/reopen/export following the two failed real submissions",
      "Current Windows portable/setup actual export/install/upgrade and EXE-side saves",
      "Current Android build/device/retained-data upgrade",
      "Native project/output directory picker end-to-end",
      "Final isolated copy of 隐忍的成长"];
    result.extraRequirements=[
      {id:"LAYOUT-AUTHOR-01",status:"FAILED",scope:"Inherited opacity says1 but actual Runtime alpha0.78"},
      {id:"LAYOUT-RES-01",status:"FAILED",scope:"Unused asset included despite minimal actual-dependency requirement"},
      {id:"NVL-01",status:"FAILED",scope:"Full NVL page choices leave panel and overlap text at1080p/1440p"},
      {id:"HOST-01",status:"FAILED",scope:"Old/new Editor dark-theme moon icon offsets x/y by2px and leaves its thumb; unrelated voice PASS is not a fix"},
      {id:"ROLE-STRICT-GEOMETRY",status:"FAILED",scope:"Strict geometry violations retained; actual glyph clipping not established"},
      {id:"RUNTIME-BUSINESS-12",status:"PASS",scope:"Current full story native-library matrix only, not independent Windows/setup/Android"},
      {id:"QUICK-INVALID-LATEST",status:"NOT_RUN",scope:"Latest invalid quick-save fallback is explicitly NOT_RUN inside the otherwise passing business quick-flow detail"},
      {id:"QUICK-WRITE-FAILURE",status:"NOT_RUN",scope:"Real quick-save write rejection, preserved six old saves and retry are not proven by successful quick saves or exit-save ACL tests"},
      {id:"QUICK-CONCURRENT",status:"NOT_RUN",scope:"Repeated actual input during a witnessed pending quick write has not been verified; a quick-flow step PASS is insufficient"},
      {id:"VOICE-REPLAY",status:"NOT_RUN",scope:"No-voice fixture does not prove no duplicate speech on restore/rollback"},
      {id:"VNPROJ-PER-PROJECT-DIRECTORY",status:"BLOCKED",scope:"Native selection/restart/path-failure complete chain remains incomplete"},
      {id:"D-01",status:"DEFERRED_BY_USER",scope:"Old-phone black screen"},
      {id:"D-02",status:"DEFERRED_BY_USER",scope:"Known first-open performance"}
    ];
    if(voice){
      const restoredVoice=result.extraRequirements.find(r=>r.id==="VOICE-REPLAY");
      assert(restoredVoice);
      restoredVoice.status=result.voiceEvidence.sourceConclusion;
      restoredVoice.scope="Actual installed library Player, both layouts, all12 combinations; short dialog/NVL/bubble normal triggers and menu/save/load/rollback/forward deduplication; not new listening, standalone/setup or Android";
      result.extraRequirements.push({id:"VOICE-PAGED-RESTART",status:"NOT_RUN",
        scope:"Voiced extreme-text page transitions and voiced quick-load after actual process restart are not covered by the short-voice restoration matrix"});
      result.resolvedHistoricalConditions.push("Previously unvoiced fixture gap now has actual media-trigger/restoration evidence; only the explicitly covered short-voice workflows change status");
    }
    if(paged){
      const restoredPages=result.extraRequirements.find(r=>r.id==="VOICE-PAGED-RESTART");assert(restoredPages);
      restoredPages.status=result.pagedVoiceEvidence.businessConclusion;
      restoredPages.scope=`Actual installed library Player: ${result.pagedVoiceEvidence.classification.counts.pass}/24 complete flows; 4K fixture-precondition gaps remain BLOCKED and later checks unexecuted. Raw source ${result.pagedVoiceEvidence.sourceConclusion} retained; not standalone/setup/Android or new listening`;
      result.extraRequirements.push({id:"NVL-QUICK-OVERLAP-01",status:"FAILED",
        scope:"AgentVN1080p/DPR1/normal NVL page2:38 nonblank character rectangles intersect collapsed quick-menu bounds; not generalized to all resolutions or actual glyph-ink clipping"});
      result.resolvedHistoricalConditions.push("Voiced long pagination and real process-restart restoration partially executed; coverage gaps and raw QA failures retained, with NVL/quick-menu overlap FAILED independent");
    }
    if(paged4k){
      const pages=result.extraRequirements.find(r=>r.id==="VOICE-PAGED-RESTART");assert(pages);
      pages.status=result.pagedVoiceSupplement.combinedBusinessConclusion;
      pages.scope="24 complete installed-library Player flows from complementary inputs: original16 at1080p/1440p plus stronger-NVL4K8; raw original QA failures preserved, not one identical full-matrix run, standalone/setup/Android or new listening";
      result.resolvedHistoricalConditions.push("Missing4K pagination/restart flows supplemented with explicitly longer NVL input; not a product fix or erasure of old QA failures");
    }
    if(quickReview){
      for(const reviewed of result.quickSourceReconciliation){
        const requirement=result.extraRequirements.find(r=>r.id===reviewed.id);assert(requirement);
        requirement.status=reviewed.status;
        requirement.scope=`Existing frozen-candidate limited evidence ${reviewed.limitedEvidence}; ${reviewed.remaining}`;
      }
      result.resolvedHistoricalConditions.push("Three local NOT_RUN fields reconciled against actual prior candidate exception evidence; limited PASS retained, remaining scope BLOCKED rather than wholly absent");
    }
    if(quickGaps){
      const covered=result.quickGapSupplement;
      for(const [id,complete,scope]of [
        ["QUICK-INVALID-LATEST",result.quickLatestEvidence?.passingCombinations===12,
          quickLatest?
            "12 independently supplemented installed-library combinations: three distinguishable command0/1/2 saves, newest2 invalid, actual recovery1 rather than older0, originals restored. Prior ambiguous/original failed reports retained; not live corruption, standalone or Android.":
            "12 combinations prove skip semantic-invalid latest, but valid candidates share command0; exact most-recent valid identity remains unproven. Not a product failure, standalone or Android."],
        ["QUICK-WRITE-FAILURE",covered.writeDenialNewPassing===11,
          "All12 required display combinations via11 new real sharing-denial/retry cases plus same-candidate prior1080p baseline; six old file bytes preserved on failure, retry replaces target only. Not ACL, standalone or Android."],
        ["QUICK-CONCURRENT",covered.pendingPassing===12,
          "12 combinations: second trusted pointerdown witnessed inside actual busy interval, one durable file replacement, another save accepted after completion; no mock delay. Not standalone or Android."]
      ]){
        const requirement=result.extraRequirements.find(r=>r.id===id);assert(requirement);
        requirement.status=complete?"PASS":covered.sourceConclusion==="FAILED"?"FAILED":"BLOCKED";
        requirement.scope=scope;
      }
      result.resolvedHistoricalConditions.push("Remaining quick-save semantic-invalid/pending-pointer/display coverage supplemented in a fresh protected installed-library session; old FAILED reports unchanged, not standalone/setup/Android acceptance");
      if(quickLatest)result.resolvedHistoricalConditions.push("Post-report07 evidence audit found indistinguishable valid quick-save positions; separate three-position12-combination UI supplement now proves latest rather than any valid save, without rewriting report07");
    }
    if(portrait){
      result.extraRequirements.push({id:"DIALOG-PORTRAIT-01",status:"FAILED",
        scope:"Actual installed Editor dedicated picker/save/reopen/two UI exports PASS; exact upgraded bytes and binding exist, but both-layout24 installed Player observations contain no dedicated portrait. Generic show_image does not prove this feature; old QA failures retained."});
      result.resolvedHistoricalConditions.push("G16 dedicated dialogue portrait boundary now actually tested: FAILED rather than missing evidence; no product fix or rebuilt candidate");
    }
    if(animationAsset){
      result.extraRequirements.push({id:"ANIMATION-ASSET-JSON",status:"BLOCKED",
        scope:"Actual installed Editor dedicated asset picker/two UI exports and both-layout installed-library Player command dispatch observed in five steps at1080p/DPR1/normal. Exact legacy JSON has empty frames; actual default opacity fallback is not proof of JSON decoding. Supported asset schema/consumption scope needs confirmation, not a new visual-defect claim or full-matrix PASS."});
      result.resolvedHistoricalConditions.push("Animation JSON boundary now includes real dedicated selection/export/dispatch observations; full consumption remains unaccepted. Two startup-tool failures and separate recovery retained, no product changes.");
    }
  }
  result.evidenceReceiptStatus="PASS";
}catch(error){result.evidenceReceiptStatus="FAILED";result.error=String(error.stack||error);process.exitCode=1;}
finally{
  result.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(destination,"evidence-receipt.json"),JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:result.status,evidenceReceiptStatus:result.evidenceReceiptStatus,
    counts:result.counts,sources:result.sources.length,safety:result.safety,error:result.error}));
}
