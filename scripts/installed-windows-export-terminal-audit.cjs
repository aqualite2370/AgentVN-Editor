"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-windows-export-20261018-01");
const out = process.argv[2]; assert(out && !fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => sha256(fs.readFileSync(f));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", windowsExportStatus: "BLOCKED",
  at: new Date().toISOString(), checks: [], inputs: [], commands: [], screenshots: 0,
  productChanges: 0, realModelRequests: 0, error: null };
function load(name) {
  const file = path.join(run, name); report.inputs.push({ path: file, sha256: sha(file) }); return read(file);
}
function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
try {
  const prep = load("preparation.json"), launch = load("launch.json"), ready = load("backend-ready.json");
  const initial = load("prepare-ui-01/report.json"), env = load("environment-01/report.json");
  const choice = load("choose-native-01/report.json"), native = load("choose-native-01/native-computer-use-review.json");
  const payload = load("payload-audit-01.json"), fixture = load("fixtures.json");
  check("Raw failures and scoped passes are retained without claiming a fresh environment check or exported executable", () => {
    for (const r of [prep, launch, ready, env, payload, fixture]) assert.equal(r.status, "PASS");
    assert.equal(initial.status, "FAILED");
    assert.equal(initial.checks[0].status, "PASS");
    assert(initial.error.includes("intercepts pointer events"));
    assert(initial.error.includes("android-env-import-backdrop"));
    assert.equal(choice.status, "FAILED"); assert(choice.error.includes("Timeout 150000ms exceeded"));
    assert.equal(native.status, "BLOCKED_TOOL_NATIVE_INPUT_NO_OBSERVED_RESPONSE");
    assert.equal(native.productFailureClaim, false);
    assert(env.console.includes("skipped the repeated full check"));
    assert.equal(payload.checks.length, 5); assert(payload.checks.every(c => c.status === "PASS"));
    assert.equal(payload.windowsExportStatus, "BLOCKED"); assert.equal(payload.resources.length, 179);
    assert.equal(read(path.join(run, "observed-windows-env-cache.json")).cacheHit, true);
    assert.equal(fs.readdirSync(fixture.output).length, 0);
    assert(!fs.existsSync(path.join(run, "build-01")));
    return { originalOracleRaceRetained: true, actualNativeInputBlocked: true, freshFullProbeClaim: false,
      actualWindowsBuildStarted: false, portableRun: "NOT_RUN", setupInstall: "NOT_RUN", saveAndExitSafety: "NOT_RUN" };
  });
  check("All native WebView captures retain actual DPR/media/PNG dimensions and cannot substitute for OS-picker proof", () => {
    for (const r of [initial, env, choice]) for (const s of r.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256);
      assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
      report.screenshots++;
    }
    assert.equal(report.screenshots, 2);
    return { nativeWebviewCaptures: 2, testedViewport: "1920x1080/DPR1/no-preference",
      full12MatrixClaim: false, osPickerCaptureClaimFromCDP: false };
  });
  check("Original four profiles are independently restored against all55 saved baseline and backup hashes", () => {
    const restored = load("profile-restoration.json"), stopped = load("native-blocked-stop.json");
    assert.equal(restored.status, "PASS"); assert.equal(stopped.status, "PASS");
    assert.equal(stopped.normalWindowClose, "NOT_RUN"); assert.equal(stopped.after.length, 0);
    let files = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original)); assert(!fs.existsSync(p.held));
      for (const f of p.files) {
        assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
        assert.equal(sha(f.backup), f.sha256); files++;
      }
    }
    assert.equal(files, 55);
    const incident = read(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    return { profiles: 4, files, originalDBUnchanged: true, oldMSIExecutableUnchanged: true, rootDevUnchanged: true };
  });
  check("All560 frozen product source files and actual installed executables remain unchanged", () => {
    const frozen = read(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560);
    for (const f of frozen.source) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
    assert.equal(sha(path.join(launch.installRoot, "creator-backend.exe")), ready.backendSha256);
    return { frozenProductFiles: 560, editorSha256: launch.executableSha256, backendSha256: ready.backendSha256,
      productFixClaim: false, newDevBuildClaim: false };
  });
  check("No owned AgentVN/WebView/build process or reserved session port remains", () => {
    const ports = [8278, launch.cdpPort, launch.playerCdpPort];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const state = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { portsChecked: ports, ...state, actualBuildProcessWasStarted: false };
  });
  check("Actual supporting tests and changed test-tool parsers pass; not substituted for native selection or export", () => {
    const commands = [
      ["scripts/editor-installed-version-resources-test.cjs"],
      ["scripts/installed-windows-prerequisite-test.cjs"],
      ["scripts/full-regression-evidence-test.cjs"],
      ...["installed-windows-session-checkpoint.cjs", "installed-windows-export-fixtures.cjs",
        "installed-windows-export-behavior.cjs", "installed-windows-export-payload-audit.cjs",
        "installed-windows-export-terminal-audit.cjs"].map(f => ["--check", `scripts/${f}`]),
    ];
    for (const [index, args] of commands.entries()) {
      const p = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000 });
      const log = path.join(run, `support-${index + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args, exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, `See ${log}`);
    }
    const parser = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-assistant-recovery-session.ps1')){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)}; Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    const log = path.join(run, "powershell-parsers.log");
    fs.writeFileSync(log, `${parser.stdout || ""}\n${parser.stderr || ""}`, { flag: "wx" });
    report.commands.push({ executable: "powershell.exe", exitCode: parser.status, log, sha256: sha(log) });
    assert.equal(parser.status, 0, parser.stderr);
    return { nodeCommands: commands.length, powerShellParsers: 2, nativeSelectorPassedBySourceTests: false };
  });
  report.status = report.evidenceStatus = "PASS";
} catch (e) { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, windowsExportStatus: report.windowsExportStatus,
    checks: report.checks.length, screenshots: report.screenshots, error: report.error, out }));
}
