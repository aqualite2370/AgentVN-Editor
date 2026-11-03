"use strict";
// Independent terminal review: do not rewrite any raw failed run.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => sha256(fs.readFileSync(f));
const root = "D:/AgentVN", run = path.join(root, "output/installed-runtime-exceptions-20261018-01");
const checkpoint = "F:/AgentVN-QA-Runtime-Exceptions-Checkpoint-20261018-01";
const destination = process.argv[2]; assert(destination && !fs.existsSync(destination));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", limitedCasesStatus: "RUNNING",
  completeRuntimeStatus: "BLOCKED", at: new Date().toISOString(), checks: [], inputs: [], commands: [],
  screenshotCount: 0, productChanges: 0, realModelRequests: 0, error: null };
function load(file) {
  report.inputs.push({ path: file, sha256: sha(file) }); return read(file);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const prep = load(path.join(run, "preparation.json"));
  const first = load(path.join(run, "exceptions-01/report.json"));
  const second = load(path.join(run, "exceptions-02/report.json"));
  const third = load(path.join(run, "exceptions-03/report.json"));
  const all = [first, second, third];
  await check("Frozen installed 1.9.9 Player and560 candidate product files unchanged; real UI-exported cartridges remain exact", () => {
    assert.equal(prep.status, "PASS");
    const frozen = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560);
    for (const s of frozen.source) assert.equal(sha(s.path), s.sha256);
    for (const r of all) {
      assert.equal(sha(r.exe.path), r.exe.sha256);
      assert.equal(r.exe.sha256, "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
      assert.equal(sha(r.source.path), r.source.sha256); assert.equal(sha(r.fixture.path), r.fixture.sha256);
      assert.equal(r.productChanges, 0); assert.equal(r.realModelRequests, 0); assert.equal(r.pageErrors.length, 0);
      assert.equal(r.storage.portable, false);
    }
    for (const c of read(first.source.path).cartridges) assert.equal(sha(c.path), c.sha256);
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    return { productFiles: 560, installedPlayer: true, newExportClaim: false, standaloneWindowsOrAndroidClaim: false };
  });
  await check("Raw FAILED runs and original tool versions retained; continuation only references passing subcases", () => {
    assert.equal(first.status, "FAILED"); assert.equal(second.status, "FAILED"); assert.equal(third.status, "PASS");
    assert.equal(first.checks.length, 8); assert.equal(second.checks.length, 3); assert.equal(third.checks.length, 2);
    assert(first.checks[4].error.includes("2 !== 1"));
    assert(first.checks[6].error.includes("0 !== 1") && first.checks[7].error.includes("0 !== 1"));
    assert(second.checks[1].error.includes("back-to-player") && second.checks[1].error.includes("not visible"));
    assert.equal(sha(path.join(checkpoint, "installed-runtime-exceptions-playwright-first-run.cjs")), first.tool.sha256);
    assert.equal(sha(path.join(checkpoint, "installed-runtime-exceptions-playwright-second-run.cjs")), second.tool.sha256);
    assert.equal(sha(third.tool.path), third.tool.sha256);
    for (const r of [second, third]) {
      assert.equal(r.continuation.sha256, sha(r.continuation.path)); assert.equal(r.continuation.originalStatus, "FAILED");
    }
    assert([0, 1, 2, 3, 5].every(i => first.checks[i].status === "PASS"));
    assert.equal(second.checks[0].status, "PASS"); assert(third.checks.every(c => c.status === "PASS"));
    return { originalFailedReports: 2, originalFailuresNotRewritten: true,
      correctedToolOracles: ["no guaranteed overlap after fast native failure", "dialogue text excludes aria action/speaker prefix",
        "Renpy uses shared menu return, not intentionally hidden top-right button"],
      computerUseObservation: "Window selection raced the completed test process; no screenshot or manual-flow pass claimed" };
  });
  await check("No-quick-save native case covers12 actual WebView combinations with exact PNG/DPR/media and unchanged progress", () => {
    assert.equal(first.matrix.length, 12); assert(first.matrix.every(r => r.status === "PASS"));
    const keys = new Set(first.matrix.map(r => `${r.width}:${r.height}:${r.dpr}:${r.reduced}`));
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const m of [false, true])
      assert(keys.has(`${w}:${h}:${d}:${m}`));
    for (const r of all) for (const s of r.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256);
      assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshotCount++;
    }
    assert(report.screenshotCount >= 18);
    return { combinations: 12, rawPNGs: report.screenshotCount, physical4KClaim: false, allOtherBusiness12MatrixClaim: false };
  });
  await check("Newest native JSON corruption is offline, restart falls back to older valid quick-save, injected file restored exactly", () => {
    const d = first.checks[2].detail; assert.equal(d.restoredPosition.command, 0);
    assert.equal(d.nativeList.length, 1); assert.equal(d.nativeList[0].save_id, d.loadedOlderId);
    assert.equal(d.restartRequiredInThisCase, true); assert.equal(d.corruptionDuringRunningCase, "NOT_RUN");
    assert.equal(first.faultRestoration.length, 1);
    for (const f of first.faultRestoration) { assert.equal(f.status, "RESTORED"); assert.equal(sha(f.retained), f.originalSha256); }
    return { loadedCommand: 0, invalidNewestSlot: d.latestInvalidSlot, originalBytesRetained: true,
      runningTimeCorruptionOrSemanticInvalidity: "NOT_RUN" };
  });
  await check("Real native sharing failure retains6 prior files and no staging residue; unlock retry works; separate successful double click produces one durable write", () => {
    const d = second.checks[0].detail; assert.equal(d.method, "NATIVE_FILE_SHARE_DENY_NOT_ACL");
    assert.equal(d.before.length, 6); assert.equal(d.oldValidSavesPreservedOnFailure, true);
    assert(d.failure.includes("快存失败") && d.failure.includes("不会回退") && d.failure.includes(second.storage.targetDirectory));
    assert.equal(d.observed.clicks.length, 1); assert(d.observed.clicks.every(c => c.trusted));
    assert(d.observed.busy.some(b => b.busy === "true") && d.observed.busy.at(-1).busy !== "true");
    assert.equal(second.lock.cleanup, "PASS"); assert.equal(second.lock.exitCode, 0);
    const changed = d.after.filter(f => !d.before.some(p => p.name === f.name && p.sha256 === f.sha256));
    assert.equal(changed.length, 1); assert.equal(changed[0].path, d.target);
    assert(d.before.some(f => f.path === d.target));
    assert.equal(d.retried.slot, Number(path.basename(d.target).match(/^quick-(\d+)\.json$/)[1]));
    const double = first.checks[5].detail; assert.equal(double.created.length, 1);
    assert.equal(double.after.length, 6); assert.equal(double.observed.clicks.length, 1);
    assert(double.observed.clicks[0].trusted && double.observed.busy.some(b => b.busy === "true"));
    for (const r of all) for (const f of r.retained) assert.equal(sha(f.retained), f.sha256);
    return { preservedOnFailure: 6, changedOnRetry: 1, successfulDoubleClickDurableWrites: 1,
      ACLOrStandaloneLocationAcceptance: false, nativeLockHelpersCleaned: all.filter(r => r.lock).every(r => r.lock.cleanup === "PASS") };
  });
  await check("Both actual native layouts use real history entry/return and retain exact command and current dialogue once", () => {
    assert.deepEqual(third.checks.map(c => c.layout), ["renpy", "agentvn"]);
    for (const c of third.checks) {
      const d = c.detail; assert(d.before.dialogText);
      assert.equal(d.entries.filter(t => t === d.before.dialogText).length, 1);
      assert.deepEqual(d.restored, d.before);
    }
    return { layouts: 2, functionalViewport: "1920x1080/DPR1/no-preference",
      longHistoryScrollOrAllPageMatrix: "NOT_RUN" };
  });
  await check("All8 native processes and2 lock helpers ended; original4 profiles/55 hashes and database/Dev/pendingMSI unchanged", () => {
    const restored = load(path.join(run, "profile-restoration.json")); assert.equal(restored.status, "PASS");
    assert.equal(all.flatMap(r => r.launches).length, 8);
    for (const r of all) for (const l of r.launches) assert.equal(l.cleanup.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    const incident = load(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    const ports = [8278, ...all.flatMap(r => r.launches.map(l => l.port))], pids = all.filter(r => r.lock).map(r => r.lock.pid);
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        $_.ProcessId -in @(${pids.join(",")}) -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const state = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { originalFiles: count, originalDBUnchanged: true, rootDevUnchanged: true,
      pendingMSIExecutableUnchanged: true, normalPhysicalCloseClaim: false, ...state, portsChecked: ports };
  });
  await check("Supporting quick-save/evidence contracts and changed JS/PS tools parse and pass without empty case substitution", () => {
    const args = ["quick-save-policy-test.cjs", "quick-save-runtime-test.cjs", "quick-save-storage-test.cjs", "full-regression-evidence-test.cjs"]
      .map(f => [`scripts/${f}`]);
    args.push(...["installed-runtime-exceptions-playwright.cjs", "installed-runtime-exceptions-terminal-audit.cjs"].map(f => ["--check", `scripts/${f}`]));
    for (const [i, command] of args.entries()) {
      const p = spawnSync(process.execPath, command, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000 });
      const log = path.join(run, `${path.basename(destination, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args: command, exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, log);
    }
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-runtime-save-lock.ps1')){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)};Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    const log = path.join(run, `${path.basename(destination, ".json")}-ps-parser.log`);
    fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
    report.commands.push({ executable: "powershell.exe", exitCode: p.status, log, sha256: sha(log) });
    assert.equal(p.status, 0, p.stderr);
    return { sourceContracts: 4, jsParsers: 2, psParsers: 2, sourceMocksDoNotReplaceNativeEvidence: true };
  });
  assert.equal(report.checks.length, 8); assert(report.checks.every(c => c.status === "PASS"));
  report.status = report.evidenceStatus = report.limitedCasesStatus = "PASS";
  report.remaining = { completeRuntime: "NOT_RUN", independentWindowsExport: "BLOCKED_BY_NATIVE_OUTPUT_PICKER",
    standaloneSavesAndACL: "NOT_RUN", autoSavePreferencesAndExit: "NOT_RUN", android: "NOT_RUN",
    trueModelTasks: "NOT_RUN", originalProductFailures: "FAILED_UNCHANGED", finalUserProject: "NOT_RUN" };
})().catch(e => { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, limitedCasesStatus: report.limitedCasesStatus,
    completeRuntimeStatus: report.completeRuntimeStatus, checks: report.checks.length, screenshotCount: report.screenshotCount,
    error: report.error, destination }, null, 2));
});
