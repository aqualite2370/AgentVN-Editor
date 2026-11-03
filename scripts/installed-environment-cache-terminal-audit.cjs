"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-environment-cache-20261018-01");
const checkpoint = "F:/AgentVN-QA-Environment-Checkpoint-20261018-01";
const sha = p => sha256(fs.readFileSync(p)), read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const destination = process.argv[2]; assert(destination && !fs.existsSync(destination));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", windowsCacheStatus: "RUNNING", g10Status: "BLOCKED",
  at: new Date().toISOString(), checks: [], inputs: [], commands: [], screenshotCount: 0,
  productChanges: 0, realModelRequests: 0, error: null };
function load(p) { report.inputs.push({ path: p, sha256: sha(p) }); return read(p); }
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const prep = load(path.join(run, "preparation.json")), fixtureFailed = load(path.join(run, "fixtures.json"));
  const fixture = load(path.join(run, "fixtures-02.json")), first = load(path.join(run, "behavior-01/report.json"));
  const second = load(path.join(run, "behavior-02/report.json")), main = load(path.join(run, "behavior-03/report.json"));
  const cache = load(path.join(run, "cache-protection.json")), all = [first, second, main];
  await check("Genuine1.9.8 release payload matches prior installed EXE; frozen installed1.9.9 and560 source files unchanged", () => {
    assert.equal(fixture.status, "PASS"); assert.equal(sha(fixture.source.path), fixture.source.sha256);
    assert.equal(fixture.source.sha256, "f91118bf15d1f0f76e5628596e61bfd8d981c037d051f6cb6f59f8a5c92ccd42");
    const old = load(path.join(root, "output/host-upgrade-20261018-02/old-launch.json"));
    assert.equal(sha(fixture.old.exe), old.executableSha256);
    assert.equal(fixture.old.version, "1.9.8"); assert.equal(fixture.oldPayloadIsExtractionNotInstallation, true);
    assert.equal(sha(fixture.current.exe), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(fixture.old.root, "creator-backend.exe")), fixture.old.backendSha256);
    const frozen = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560); for (const f of frozen.source) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(fixture.input), fixture.inputSha256); assert.equal(sha(main.fixture.path), main.fixture.sha256);
    for (const r of [fixture, main]) assert.equal(r.productChanges, 0);
    assert.equal(main.realModelRequests, 0); assert.equal(main.pageErrors.length, 0);
    return { oldPayloadNotNewInstallation: true, currentActuallyInstalled: true,
      twoRealVersions: ["1.9.8", "1.9.9"], frozenProductFiles: 560, noNewBuild: true };
  });
  await check("Three original tool failures preserved with archived versions; no empty or zero-case pass substituted", () => {
    assert.equal(fixtureFailed.status, "FAILED"); assert(fixtureFailed.error.includes("null !== 0"));
    assert.equal(first.status, "FAILED"); assert.equal(first.checks.length, 0);
    assert(first.error.includes("viewport/DPR/media differs"));
    assert.equal(second.status, "FAILED"); assert.equal(second.checks.length, 0);
    assert(second.error.includes("assert(page)"));
    const archived = ["installed-environment-cache-playwright-first-run.cjs", "installed-environment-cache-playwright-second-run.cjs"];
    for (const [i, r] of [first, second].entries()) assert.equal(sha(path.join(checkpoint, archived[i])), r.tools[0].sha256);
    assert.equal(sha(main.tools[0].path), main.tools[0].sha256);
    assert.equal(main.status, "PASS"); assert.equal(main.checks.length, 6); assert(main.checks.every(c => c.status === "PASS"));
    assert(!main.error && !main.cleanupError);
    return { failedPreparationReports: 1, failedEarlyStartupReports: 2,
      corrections: ["7-Zip1.91MB listing exceeds default subprocess buffer", "wait for real document and actual metrics after native startup"],
      actualBusinessCases: main.checks.length, rawFailuresRetained: true };
  });
  await check("Actual UI old full check/same-version reuse/new automatic recheck/new reuse/native restart form complete Windows cache chain", () => {
    const [oldFirst, oldSame, newFirst, newSame, , restart] = main.checks.map(c => c.detail);
    for (const [d, version, hit] of [[oldFirst, "1.9.8", false], [oldSame, "1.9.8", true],
      [newFirst, "1.9.9", false], [newSame, "1.9.9", true], [restart, "1.9.9", true]]) {
      assert.equal(sha(d.resultFile), d.resultSha256); assert.equal(sha(d.cacheFile), d.cacheSha256);
      assert.deepEqual(read(d.resultFile), d.value); assert.deepEqual(read(d.cacheFile), d.pass);
      assert.equal(d.value.status, "PASS"); assert.equal(d.value.ok, true);
      assert.equal(d.value.cacheHit, hit); assert.equal(d.value.cacheEditorVersion, version);
      assert.equal(d.pass.cacheEditorVersion, version); assert.equal(d.pass.cacheSchemaVersion, 1);
      assert.equal(d.pass.cachePlatform, "windows"); assert.equal(d.value.installAttempted, false);
      assert.equal(d.value.checks.length, 6); assert(d.value.checks.every(c => c.status === "PASS"));
      for (const l of d.logs) assert.equal(sha(l.retained), l.sha256);
      const log = fs.readFileSync(d.logs.find(l => l.source === d.value.logPath).retained, "utf8");
      assert(log.includes(hit ? "[cache] Reused successful Windows environment check" : "native Rust checker"));
    }
    assert.equal(oldFirst.cacheSha256, oldSame.cacheSha256);
    assert.equal(newFirst.priorCacheSha256, oldSame.cacheSha256);
    assert.deepEqual(newFirst.priorCache, oldSame.pass); assert.equal(newFirst.priorCache.cacheEditorVersion, "1.9.8");
    assert.notEqual(newFirst.cacheSha256, oldSame.cacheSha256);
    assert.equal(newFirst.cacheSha256, newSame.cacheSha256); assert.equal(newSame.cacheSha256, restart.cacheSha256);
    assert.equal(main.launches.length, 3); assert.deepEqual(main.launches.map(l => l.version), ["1.9.8", "1.9.9", "1.9.9"]);
    assert.equal(new Set(main.launches.map(l => l.pid)).size, 3);
    return { fullNativeChecks: 2, verifiedCacheHits: 3, automaticVersionInvalidation: true,
      rewrittenOrForgedVersion: false, actualDependencyInstallation: "NOT_RUN", androidCacheParity: "NOT_RUN" };
  });
  await check("Twelve actual WebView controls/recheck cases and17 screenshots validate real dimensions/DPR/media, focus, clicks and boundaries", () => {
    assert.equal(main.matrix.length, 12); assert(main.matrix.every(r => r.status === "PASS"));
    const keys = new Set(main.matrix.map(r => `${r.width}:${r.height}:${r.dpr}:${r.reduced}`)); assert.equal(keys.size, 12);
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const m of [false, true])
      assert(keys.has(`${w}:${h}:${d}:${m}`));
    for (const r of main.matrix) {
      const g = r.geometry; assert(g.hit && g.x >= 0 && g.y >= 0 && g.right <= r.width + 1 && g.bottom <= r.height + 1);
      assert(g.overflow <= 1); assert.equal(r.native.value.cacheHit, true);
      assert.equal(sha(r.native.resultFile), r.native.resultSha256); assert.equal(sha(r.native.cacheFile), r.native.cacheSha256);
      assert.equal(r.native.cacheSha256, main.checks[3].detail.cacheSha256);
      for (const l of r.native.logs) assert.equal(sha(l.retained), l.sha256);
    }
    for (const s of main.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshotCount++;
    }
    assert.equal(report.screenshotCount, 17);
    return { matrixCases: 12, nativeScreenshots: 17, WebViewViewportSimulation: true,
      fullPageMotionOrPhysical4KAcceptanceClaim: false };
  });
  await check("Two extra global cache originals and4 app profiles/55 original hashes restored, DB/Dev/pendingMSI unmodified", () => {
    const cacheRestored = load(path.join(run, "cache-restoration.json")), restored = load(path.join(run, "profile-restoration.json"));
    assert.equal(cache.status, "PASS"); assert.equal(cache.files.length, 2); assert.equal(cacheRestored.status, "PASS");
    assert(!fs.existsSync(cache.held)); assert(fs.existsSync(cache.tested));
    for (const f of cache.files) {
      assert.equal(sha(path.join(cache.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256);
    }
    assert.equal(restored.status, "PASS"); let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    const incident = load(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    assert(!fs.existsSync(path.join(cache.tested, "android-pass.json")), "No Android detection invoked or injected");
    return { originalAppFiles: 55, originalExtraCacheFiles: 2, defaultPathsPreserved: true,
      noEnvironmentOverrideForDataOrWebView: true, oldMSIScopeUntouched: true, rootDevUnchanged: true };
  });
  await check("All5 native Editor sessions and packaged backends attributed/terminated, default backend and5 CDP ports empty", () => {
    const launches = all.flatMap(r => r.launches); assert.equal(launches.length, 5);
    for (const l of launches) {
      assert.equal(l.cleanup.status, "PASS"); assert.equal(l.cleanup.method, "ATTRIBUTED_TERMINATION_NOT_NORMAL_WINDOW_CLOSE");
      assert.equal(sha(l.exe), l.sha256); assert(l.defaultDataAndWebViewPaths);
      for (const p of l.identities) assert.equal(path.resolve(path.dirname(p.path)), path.resolve(l.root));
    }
    const ports = [8278, ...launches.map(l => l.port)];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 5
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const state = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { nativeEditorSessions: 5, portsChecked: ports, ...state, normalWindowCloseClaim: false };
  });
  await check("Five supporting source tests and three JS/two PowerShell parsers pass, without substituting Android/native evidence", () => {
    const tests = ["package-windows-env-contract-test.cjs", "package-environment-race-contract.cjs",
      "package-environment-orchestration-contract.cjs", "android-env-import-file-picker-contract-test.cjs", "full-regression-evidence-test.cjs"];
    const parsers = ["installed-environment-cache-prepare.cjs", "installed-environment-cache-playwright.cjs", "installed-environment-cache-terminal-audit.cjs"];
    const commands = [...tests.map(f => [`scripts/${f}`]), ...parsers.map(f => ["--check", `scripts/${f}`])];
    for (const [i, args] of commands.entries()) {
      const p = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000 });
      const log = path.join(run, `${path.basename(destination, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args, exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, log);
      if (i < tests.length) assert((p.stdout || "").includes("PASS"), "No empty source-test PASS");
    }
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-environment-cache-session.ps1')){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)};Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    const log = path.join(run, `${path.basename(destination, ".json")}-ps-parser.log`);
    fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
    report.commands.push({ executable: "powershell.exe", exitCode: p.status, log, sha256: sha(log) });
    assert.equal(p.status, 0, p.stderr); return { sourceTests: 5, JSParsers: 3, PSParsers: 2, notProductAndroidAcceptance: true };
  });
  assert.equal(report.checks.length, 7); assert(report.checks.every(c => c.status === "PASS"));
  report.status = report.evidenceStatus = report.windowsCacheStatus = "PASS";
  report.remaining = { androidCacheAndAvnenv: "NOT_RUN", actualOldReinstallation: "NOT_RUN_THIS_SLICE",
    originalProductFailures: "FAILED_UNCHANGED", independentWindowsExport: "BLOCKED", finalProject: "NOT_RUN" };
})().catch(e => { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, windowsCacheStatus: report.windowsCacheStatus,
    g10Status: report.g10Status, checks: report.checks.length, screenshotCount: report.screenshotCount, error: report.error, destination }, null, 2));
});
