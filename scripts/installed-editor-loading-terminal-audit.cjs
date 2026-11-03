"use strict";
// Independently read raw traces, real screenshots and restoration evidence.
// This audit never promotes partial loading coverage to G12 motion PASS.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-editor-loading-20261018-01");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
const destination = process.argv[2];
assert(destination && path.dirname(path.resolve(destination)) === path.resolve(run) && !fs.existsSync(destination));
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], inputs: [], screenshots: 0,
  frames: 0, commands: [], g12Status: "FAILED_EXISTING_GEOMETRY_AND_HIT_TEST_DEFECTS_NOT_FIXED",
  productChanges: 0, realModelRequests: 0, error: null };
const load = p => { report.inputs.push({ path: p, sha256: sha(p) }); return read(p); };
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
function frameAudit(episode, expected) {
  assert.equal(sha(episode.trace.path), episode.trace.sha256);
  const trace = JSON.parse(zlib.gunzipSync(fs.readFileSync(episode.trace.path)));
  assert.equal(trace.frames.length, episode.trace.frames); assert(trace.frames.length >= 3);
  assert(!trace.limitReached); assert(trace.inputs.some(i => i.trusted));
  for (const f of trace.frames) {
    assert.equal(f.width, expected.width); assert.equal(f.height, expected.height);
    assert.equal(f.dpr, expected.dpr); assert.equal(f.reduced, expected.reduced);
    assert.equal(f.pageHidden, false); assert.equal(f.visibilityState, "visible");
  }
  report.frames += trace.frames.length;
  return trace;
}
(async () => {
  const raw = load(path.join(run, "flow-01/report.json"));
  const prep = load(path.join(run, "preparation.json")), launch = load(path.join(run, "launch.json"));
  const ready = load(path.join(run, "backend-ready.json"));
  await check("Frozen actual NSIS Editor and automatic packaged backend use four protected default profiles", () => {
    assert.equal(prep.status, "PASS"); assert.equal(launch.status, "PASS"); assert.equal(ready.status, "PASS");
    assert.equal(launch.dataDirectoryOverride, false); assert.equal(launch.webviewDirectoryOverride, false);
    assert.equal(launch.manualBackendSpawn, false); assert.equal(prep.profiles.length, 4);
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")),
      "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(launch.installRoot, "creator-backend.exe")), ready.backendSha256);
    const backend = ready.processes.find(p => p.Name === "creator-backend.exe" && p.ParentProcessId === launch.editorPid);
    assert(backend);
    for (const p of ready.processes) assert.equal(path.resolve(p.ExecutablePath), path.resolve(launch.installRoot, p.Name));
    return { editorPid: launch.editorPid, backendPid: backend.ProcessId, defaultProfilePaths: true,
      manuallySpawnedBackend: false, cleanMachineClaim: false };
  });
  await check("Twelve nonempty actual viewport/DPR/media combinations exercise real module faults and retry", () => {
    assert.equal(raw.status, "PASS"); assert.equal(raw.matrix.length, 12);
    assert.equal(new Set(raw.matrix.map(m => `${m.width}:${m.height}:${m.dpr}:${m.reduced}`)).size, 12);
    let episodes = 0;
    for (const [width,height] of [[1920,1080],[2560,1440],[3840,2160]]) for (const dpr of [1,2]) for (const reduced of [false,true]) {
      const m = raw.matrix.find(m => m.width === width && m.height === height && m.dpr === dpr && m.reduced === reduced);
      assert(m); assert.equal(m.status, "PASS"); assert.equal(m.episodes.length, 2);
      assert.deepEqual(m.actualBefore, { width,height,dpr,reduced }); assert.deepEqual(m.actualAfter, m.actualBefore);
      for (const e of m.episodes) {
        assert.equal(e.status, "PASS"); assert(e.checks.length >= 4); assert(e.checks.every(c => c.status === "PASS"));
        const trace = frameAudit(e, m); assert(trace.inputs.some(i => i.help?.startsWith("advanced.tab.")));
        episodes++;
      }
      const fail = m.episodes[0].checks.find(c => c.name.startsWith("Failure retains")).detail;
      assert.equal(fail.active, "settings"); assert.equal(fail.inert, false); assert.equal(fail.retryHit, true);
      assert(fail.error && fail.overflow <= 1 && fail.errorRect.left >= 0 && fail.errorRect.right <= width + 1);
      const retry = m.episodes[0].checks.find(c => c.name.startsWith("Retry loads")).detail;
      assert.equal(retry.active, "history"); assert.equal(retry.inert, false); assert(!retry.error && !retry.pending);
      const final = m.episodes[1].checks.find(c => c.name.startsWith("Latest actual")).detail;
      assert.equal(final.active, "settings"); assert(!final.error && !final.pending && !final.inert);
    }
    return { matrices: 12, episodes, realTrustedInput: true, nativeWebviewEmulationNotPhysical4K: true,
      staleResponseScope: "Final ownership after consuming delayed module and actual reselect; not an isolated pre-reselect timing oracle" };
  });
  await check("Two actual30s timeout cases separately cover normal and reduced media without timer mocks", () => {
    assert.equal(raw.timeoutCases.length, 2);
    for (const reduced of [false,true]) {
      const c = raw.timeoutCases.find(c => c.reduced === reduced);
      assert(c && c.status === "PASS"); assert.equal(c.episodes.length, 1);
      const failed = c.checks[0].detail;
      assert(failed.elapsedMs >= 29000 && failed.failed.error.includes("超时"));
      assert.equal(failed.failed.active, "settings"); assert.equal(failed.failed.inert, false);
      const e = c.episodes[0]; assert.equal(e.status, "PASS"); frameAudit(e, c);
      assert.equal(e.checks[0].detail.active, "animation");
    }
    assert.equal(raw.timerMock, false);
    return { actualUnacceleratedTimeouts: 2, timeoutFull12MatrixClaim: false };
  });
  await check("Actual module transport is explicit controlled fault injection, no model or store mutation claim", () => {
    assert.equal(raw.sourceServer, false); assert.equal(raw.storeMutation, false);
    assert.equal(raw.realModelRequests, 0); assert.equal(raw.productChanges, 0);
    assert.equal(raw.pageErrors.length, 0); assert.equal(raw.forbiddenRequests.length, 0);
    const aborted = raw.transport.filter(t => t.mode === "abort"), holds = raw.transport.filter(t => t.mode === "hold");
    assert(aborted.length >= 12 && holds.length >= 14);
    assert(aborted.every(t => t.aborted && new URL(t.url).hostname === "tauri.localhost"
      && /\/assets\/GenerationHistoryPanel-.*\.js/.test(new URL(t.url).pathname)));
    assert(holds.every(t => t.releasedAt && !t.releaseError && new URL(t.url).hostname === "tauri.localhost"
      && /\/assets\/AnimationEditorPanel-.*\.js/.test(new URL(t.url).pathname)));
    return { aborted: aborted.length, heldAndReleased: holds.length, realModelRequests: 0,
      nativeProjectPickerClaim: false, sourceServer: false };
  });
  await check("Twenty-six actual native PNGs retain real highDPI pixels and source hashes", () => {
    assert.equal(raw.screenshots.length, 26);
    for (const s of raw.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const png = fs.readFileSync(s.path);
      assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);
      report.screenshots++;
    }
    return { screenshots: report.screenshots, screenshotOnlyClaim: false };
  });
  await check("All55 original profile files/DB/Dev/pendingMSI and560 frozen product sources remain unchanged", () => {
    const restoration = load(path.join(run, "profile-restoration.json")); assert.equal(restoration.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original,f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(sha(path.join(root,"AgentVN Dev.exe")), prep.originalDevSha256);
    const incident = load(path.join(root,"output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path,"agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    const frozen = load(path.join(root,"output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560);
    for (const row of frozen.source) assert.equal(sha(row.path), row.sha256, row.path);
    return { originalProfileHashes: count, frozenSourceFiles: frozen.source.length, productChanges: 0, devRebuild: false };
  });
  await check("Attributed native termination and three relevant listening ports have no residue", () => {
    const stop = load(path.join(run,"stop-01.json"));
    assert.equal(stop.status,"PASS"); assert.equal(stop.before.length,3); assert.equal(stop.after.length,0);
    assert.equal(stop.normalWindowClose,"NOT_RUN");
    const ports = [launch.backendPort,launch.cdpPort,launch.playerCdpPort];
    const result = spawnSync("powershell.exe",["-NoProfile","-Command",`
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 6
    `],{encoding:"utf8",windowsHide:true,timeout:20000});
    assert.equal(result.status,0,result.stderr);
    const live = JSON.parse(result.stdout.replace(/^\uFEFF/,"")); assert.equal(live.processes.length,0); assert.equal(live.ports.length,0);
    return { attributedStops:3, normalCloseClaim:false, ports,...live };
  });
  await check("Support evidence tests and changed tool parsers pass", () => {
    for (const script of ["full-regression-evidence-test.cjs","editor-transition-presentation-test.cjs"]) {
      // A missing support test is an audit error, never a zero-test PASS.
      assert(fs.existsSync(path.join(root,"scripts",script)));
      const result = spawnSync(process.execPath,[`scripts/${script}`],{cwd:root,encoding:"utf8",windowsHide:true,timeout:120000});
      const logfile = path.join(run,`${path.basename(destination,".json")}-${script}.log`);
      fs.writeFileSync(logfile,`${result.stdout||""}\n${result.stderr||""}`,{flag:"wx"});
      report.commands.push({executable:process.execPath,args:[`scripts/${script}`],exitCode:result.status,log:logfile,sha256:sha(logfile)});
      assert.ifError(result.error); assert.equal(result.status,0,logfile);
    }
    for (const script of ["installed-editor-loading-playwright.cjs","installed-editor-loading-terminal-audit.cjs"]) {
      const result=spawnSync(process.execPath,["--check",`scripts/${script}`],{cwd:root,encoding:"utf8",windowsHide:true});
      assert.equal(result.status,0,result.stderr);
    }
    const result=spawnSync("powershell.exe",["-NoProfile","-Command",`
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-assistant-recovery-session.ps1')){
        $qaErrors=$null;[System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$null,[ref]$qaErrors)|Out-Null
        if($qaErrors.Count){throw ($qaErrors|Out-String)}
      }
    `],{encoding:"utf8",windowsHide:true,timeout:20000});
    assert.equal(result.status,0,result.stderr);
    return { supportTests:2,jsParsers:2,psParsers:2 };
  });
  assert.equal(report.checks.length,8); report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(()=>{
  report.finishedAt=new Date().toISOString();
  fs.writeFileSync(destination,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,frames:report.frames,
    screenshots:report.screenshots,g12Status:report.g12Status,error:report.error}));
});
