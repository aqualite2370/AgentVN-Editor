"use strict";
// Evidence audit, not a substitute for the actual installed Player execution.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process");
const JSZip=require("../editor/node_modules/jszip");
const {sha256}=require("./lib/installed-acceptance.cjs");
const root="D:/AgentVN",run=path.join(root,"output/installed-layout-author-review-20261019-01");
const attempt=process.argv[2]||"01";assert(/^\d{2}$/.test(attempt));
const destination=path.join(run,`role-state-audit-${attempt}.json`);assert(!fs.existsSync(destination));
const result={status:"RUNNING",at:new Date().toISOString(),checks:[],sources:[],error:null,
  scope:"INDEPENDENT_ROLE_STATE_EVIDENCE_AND_RESTORATION_AUDIT_NOT_PRODUCT_PASS",
  productChanges:0,newBuilds:0,modelRequests:0};
const sha=p=>sha256(fs.readFileSync(p));
function read(file){
  result.sources.push({path:file,sha256:sha(file)});
  return JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
}
const local=p=>read(path.join(run,p));
async function check(name,fn){
  const item={name,status:"RUNNING"};result.checks.push(item);
  try{item.detail=await fn();item.status="PASS";console.log(`PASS ${name}`)}
  catch(e){item.status="FAILED";item.error=String(e.stack||e);throw e}
}
const rgb=c=>`rgb(${[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)).join(", ")})`;
(async()=>{
  const prep=local("preparation.json"),saved=local("save-01/report.json");
  const exported=local("export-01/report.json"),report=local("role-states-04/report.json");
  const roles=saved.authored.settings.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.buttonRoles;
  await check("Original focus/overflow failures retained, complete matrix still cannot PASS",()=>{
    const failures=["01","02","03"].map(i=>local(`role-states-${i}/report.json`));
    assert(failures.every(r=>r.status==="FAILED"&&r.error));
    assert.match(failures[0].error,/page_navigation\/selected/);
    assert.equal(failures[0].matrix[0].samples.length,7);
    assert.equal(report.status,"FAILED");assert.equal(report.checks.length,2);
    assert.equal(report.checks[0].status,"PASS");assert.equal(report.checks[1].status,"FAILED");
    assert(report.violations.length>0);assert.deepEqual(report.pageErrors,[]);
    assert.equal(report.productChanges,0);assert.equal(report.modelRequests,0);
    assert.equal(report.nativePickerClaim,false);
    return {retainedFailedAttempts:4,strictBoundaryFailures:report.violations.length,
      firstFailure:"QA assertion confused focused-selected with unfocused-selected; separately checked in04",
      visibleTextClippingClaim:false,productRepair:false};
  });
  await check("Twelve actual WebView combinations and204 role samples execute with exact state colors",()=>{
    assert.equal(report.matrix.length,12);
    const keys=new Set();
    for(const row of report.matrix){
      const v=row.viewport;keys.add([v.width,v.height,v.dpr,v.reduced].join("/"));
      assert(row.executed);assert.equal(row.samples.length,17);
      assert.equal(row.status,"FAILED");assert(row.violations>0);
      for(const sample of row.samples){
        assert.equal(sample.color,rgb(roles[sample.role].states[sample.expectedState].textColor));
        assert(sample.hit&&sample.opacity>0&&sample.overflow<=1);
        if(sample.textOutsideButton)assert(sample.role==="page_navigation"&&v.width===3840);
        const r=sample.rect;
        assert(r.left>=-1&&r.top>=-1&&r.right<=v.width+1&&r.bottom<=v.height+1);
        if(sample.clipped)assert.equal(sample.role,"modal_action");
      }
      const keyboard=row.samples.filter(s=>s.focused&&s.focusVisible);
      assert.equal(keyboard.length,3);
      assert(keyboard.every(s=>s.expectedState==="hover"));
      assert(keyboard.some(s=>s.role==="page_navigation"&&s.state==="selected"));
      assert(row.samples.some(s=>s.role==="page_navigation"&&s.expectedState==="selected"&&!s.focused));
      const category=new Set(row.samples.filter(s=>s.role==="category_pagination").map(s=>s.expectedState));
      assert.deepEqual([...category].sort(),["disabled","hover","normal","selected"]);
      assert(row.modalGeometry.buttons.length===3);
      for(const b of row.modalGeometry.buttons)assert(b.hit);
    }
    for(const [w,h]of [[1920,1080],[2560,1440],[3840,2160]])for(const d of [1,2])
      for(const reduced of [false,true])assert(keys.has([w,h,d,reduced].join("/")));
    assert(report.violations.every(v=>v.role==="modal_action"
      ||(v.role==="page_navigation"&&v.viewport.width===3840)));
    const sizes=report.violations.filter(v=>v.role==="modal_action"&&v.actual.textRects);
    assert(sizes.length>0&&sizes.every(v=>v.actual.clipped&&!v.actual.textOutsideButton));
    const textRangeOverflow=report.violations.filter(v=>v.role==="page_navigation");
    assert(textRangeOverflow.length>0&&textRangeOverflow.every(v=>v.actual.textOutsideButton&&!v.actual.clipped));
    return {combinations:12,samples:204,colorsCorrect:204,
      categoryFourNaturalStates:true,focusAndUnfocusedSelectedSeparatelyVerified:true,
      modalNormalHoverFocusColors:true,contentBoxOverflowRetained:true,
      modalTextRangesOutsideButton:0,
      navigation4KTextRangeOverflowSamples:textRangeOverflow.length,
      visualInkClipping:"UNPROVEN_BY_TEXT_RANGE_OR_SCROLLWIDTH_ALONE",all24RoleStateClaim:false};
  });
  await check("Untouched actual UI cartridge and actual installed Player identity are traceable",async()=>{
    assert.equal(sha(exported.cartridge.path),exported.cartridge.sha256);
    assert.equal(report.source.sha256,exported.cartridge.sha256);
    const zip=await JSZip.loadAsync(fs.readFileSync(exported.cartridge.path),{checkCRC32:true});
    const bytes=await zip.file("ui/layout.json").async("nodebuffer");
    const layout=JSON.parse(bytes);
    assert.deepEqual(layout.renpy.shared.buttonRoles,roles);
    assert.equal(report.launches.length,1);
    assert.equal(report.launches[0].cleanup.status,"PASS");
    assert.equal(sha(report.launches[0].identity.ExecutablePath),
      "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    const restore=local("profile-restoration-05.json");
    const profile=prep.profiles.find(p=>p.app==="player"&&p.kind==="Roaming");
    const retained=restore.profiles.find(p=>p.app==="player"&&p.kind==="Roaming").testHeld;
    const libraryCartridge=path.join(retained,path.relative(profile.original,report.launches[0].library.record.cartridgePath));
    assert.equal(sha(libraryCartridge),report.source.sha256);
    return {playerSha256:sha(report.launches[0].identity.ExecutablePath),
      cartridge:report.source,layoutSha256:sha256(bytes),
      independentWindowsSetupOrAndroid:false};
  });
  await check("All actual PNG pixels and hashes match sampled WebView parameters",()=>{
    let count=0;
    for(const name of ["01","02","03","04"]){
      const r=local(`role-states-${name}/report.json`);
      for(const shot of r.screenshots){
        const bytes=fs.readFileSync(shot.path);
        assert.equal(sha256(bytes),shot.sha256);assert.deepEqual(shot.before,shot.after);
        assert.equal(bytes.readUInt32BE(16),shot.before.width*shot.before.dpr);
        assert.equal(bytes.readUInt32BE(20),shot.before.height*shot.before.dpr);count++;
      }
    }
    assert.equal(report.screenshots.length,13);
    const diagnostic=local("role-overflow-01/report.json");
    assert.equal(diagnostic.status,"PASS");assert.equal(diagnostic.cases.length,2);
    assert.equal(diagnostic.screenshots.length,4);
    for(const shot of diagnostic.screenshots){
      const bytes=fs.readFileSync(shot.path);assert.equal(sha256(bytes),shot.sha256);
      assert.deepEqual(shot.before,shot.after);
      assert.equal(bytes.readUInt32BE(16),shot.before.width*shot.before.dpr);
      assert.equal(bytes.readUInt32BE(20),shot.before.height*shot.before.dpr);count++;
    }
    for(const c of diagnostic.cases){
      assert.equal(c.navigation.ancestors[0].overflowY,"visible");
      assert(c.modal.scrollWidth>c.modal.clientWidth);
      assert(c.modal.textRects.every(t=>t.left>=c.modal.rect.left&&t.right<=c.modal.rect.right
        &&t.top>=c.modal.rect.top&&t.bottom<=c.modal.rect.bottom));
    }
    return {pngCount:count,actualWebviewEmulationNotPhysicalDisplay:true};
  });
  await check("Four original profiles and55 independent baseline file hashes restored",()=>{
    const restore=local("profile-restoration-05.json");assert.equal(restore.status,"PASS");
    let count=0;
    for(const p of prep.profiles){
      assert(fs.existsSync(p.original)&&!fs.existsSync(p.held));
      for(const f of p.files){
        assert.equal(sha(path.join(p.original,f.relative)),f.sha256);
        assert.equal(sha(f.backup),f.sha256);count++;
      }
    }
    assert.equal(count,55);return {profiles:4,independentlyCheckedFiles:55};
  });
  await check("Frozen installed EXE, current Dev and560 product source files unchanged",()=>{
    assert.equal(sha(path.join(prep.installRoot,"agentvn-editor.exe")),
      "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(root,"AgentVN Dev.exe")),prep.originalDevSha256);
    const baseline=read(path.join(root,"output/full-regression-20261017-01/candidate-02/manifest.json"));
    const authorized=read(path.join(root,"output/editor-selection-mask-20261019-01/terminal-audit-02.json"));
    const allowed=new Map(authorized.sources.map(f=>[path.resolve(root,f.file),f.sha256]));
    assert.equal(baseline.source.length,560);assert.equal(allowed.size,7);
    for(const f of baseline.source)assert.equal(sha(f.path),allowed.get(path.resolve(f.path))||f.sha256,f.path);
    return {productFiles:560,priorAuthorizedFiles:7,newProductChanges:0,devRebuilt:false};
  });
  await check("All five owned Player PIDs and debug ports absent",()=>{
    const launches=["01","02","03","04"].flatMap(i=>local(`role-states-${i}/report.json`).launches);
    launches.push(...local("role-overflow-01/report.json").launches);
    assert.equal(launches.length,5);assert(launches.every(l=>l.cleanup.status==="PASS"));
    const pids=launches.map(x=>Number(x.pid)),ports=launches.map(x=>Number(x.port));
    const command=`$p=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in @(${pids.join(",")}) }); `+
      `$t=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(${ports.join(",")}) }); `+
      `@{pids=@($p | ForEach-Object { $_.ProcessId });ports=@($t | ForEach-Object { $_.LocalPort })} | ConvertTo-Json -Compress`;
    const actual=JSON.parse(execFileSync("powershell.exe",["-NoProfile","-Command",command],
      {encoding:"utf8",windowsHide:true}).replace(/^\uFEFF/,""));
    assert.deepEqual(actual.pids,[]);assert.deepEqual(actual.ports,[]);
    return {checkedOwnedPids:pids,checkedPorts:ports,remaining:actual,
      method:"Attributed termination, not a normal-close test"};
  });
  result.status="PASS";
})().catch(e=>{result.status="FAILED";result.error=String(e.stack||e);process.exitCode=1})
.finally(()=>{
  result.finishedAt=new Date().toISOString();
  fs.writeFileSync(destination,JSON.stringify(result,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:result.status,checks:result.checks.length,error:result.error,destination}));
});
