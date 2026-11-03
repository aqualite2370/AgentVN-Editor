"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const run = path.join(root, "output/host-msi-session-20261018-01");
const destination = process.argv[2];
assert(destination && !fs.existsSync(destination), "Fresh incident audit required");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const installed = read(path.join(run, "en-US/InstallOld.json"));
const restoration = read(path.join(run, "user-profile-restoration.json"));
const preparation = read(path.join(run, "preparation.json"));
const report = { status: "BLOCKED", scope: "MSI_UNEXPECTED_HISTORICAL_DIRECTORY_NOT_UPGRADE_PASS",
  startedAt: new Date().toISOString(), evidenceChecks: [], error: null,
  installationCleanupStatus: "BLOCKED_PENDING_USER_DECISION",
  newCandidateMsiStatus: "NOT_RUN", nextQuestion: "May the existing D:\\agentvntest\\AgentVN Editor be fully backed up to F and used as a replaceable legacy test installation?",
  warning: "The old MSI already wrote to the unexpected existing directory. No pre-install backup/hash of that directory exists; its earlier binaries cannot be proven restored." };
try {
  assert.equal(installed.isElevated, true);
  assert.equal(installed.exitCode, 0);
  assert.equal(installed.status, "FAILED");
  const old = installed.registrationsAfter.find(r => r.WindowsInstaller === 1);
  assert.equal(old.PSChildName, "{6DAD4267-BCC7-4C95-BCC5-70AF9B6CC52E}");
  assert.equal(old.InstallLocation, "D:\\agentvntest\\AgentVN Editor\\");
  report.actualInstallation = { path: old.InstallLocation, version: old.DisplayVersion,
    productCode: old.PSChildName, executableSha256: hash(path.join(old.InstallLocation, "agentvn-editor.exe")) };
  const logFile = path.join(run, "en-US/InstallOld.log");
  const bytes = fs.readFileSync(logFile);
  const log = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf16le" : "utf8");
  report.pathEvidence = log.split(/\r?\n/).filter(line => line.includes("INSTALLDIR property")
    && (line.includes("Adding") || line.includes("Modifying"))).slice(0, 5);
  assert(report.pathEvidence.some(line => line.includes("F:\\AgentVN-QA-HostMSI-20261018-01")));
  assert(report.pathEvidence.some(line => line.includes("D:\\agentvntest\\AgentVN Editor")));
  report.rawLog = { path: logFile, bytes: bytes.length, sha256: hash(logFile) };
  report.evidenceChecks.push("Administrator token, real /i exit 0 and actual wrong-directory registration verified");
  assert.equal(restoration.status, "PASS");
  assert.equal(restoration.unexpectedInstallationPreserved, true);
  assert.equal(restoration.installationCleanupStatus, "BLOCKED_PENDING_USER_DECISION");
  let count = 0;
  for (const profile of preparation.profiles) {
    assert(!fs.existsSync(profile.held), "Original user profile still held");
    assert(fs.existsSync(profile.original));
    for (const file of profile.verified) {
      assert.equal(hash(path.join(profile.original, file.relative)), file.sha256);
      count++;
    }
  }
  assert.equal(count, 31);
  report.userPersistence = { status: "PASS", independentlyVerifiedFiles: count,
    databaseSha256: hash("C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\vn_engine.db") };
  report.evidenceChecks.push("Both original default profiles independently restored, 31 SHA checks");
  assert.equal(hash(path.join(root, "AgentVN Dev.exe")), "ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96");
  report.evidenceChecks.push("Root Dev unchanged, no product rebuild");
  const state = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
    $ErrorActionPreference='Stop'
    $processes=@(Get-CimInstance Win32_Process|Where-Object {
      $_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or
      $_.ProcessId -in @(118560,119180) -or
      ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.editor')
    }|Select-Object Name,ProcessId,ExecutablePath)
    $ports=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -eq 8278}|Select-Object LocalPort,OwningProcess)
    $registrations=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue|
      Where-Object {$_.DisplayName -match 'AgentVN'}|
      Select-Object DisplayName,DisplayVersion,InstallLocation,WindowsInstaller,PSChildName)
    $shell=New-Object -ComObject WScript.Shell
    $links=@()
    foreach($folder in @('C:\\Users\\1\\Desktop','C:\\Users\\Public\\Desktop','C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs')){
      foreach($file in (Get-ChildItem -LiteralPath $folder -Filter '*AgentVN*.lnk' -File -ErrorAction SilentlyContinue)){
        $links+=@{path=$file.FullName;target=$shell.CreateShortcut($file.FullName).TargetPath}
      }
    }
    @{processes=$processes;ports=$ports;registrations=$registrations;shortcuts=$links}|ConvertTo-Json -Depth 7
  `], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(state.status, 0, state.stderr);
  report.systemState = JSON.parse(state.stdout.replace(/^\uFEFF/, ""));
  assert.equal(report.systemState.processes.length, 0);
  assert.equal(report.systemState.ports.length, 0);
  report.evidenceChecks.push("No test helper/editor/backend/WebView or backend listener remains");
  assert(!fs.existsSync(path.join(run, "en-US/InstallNew.json")));
  report.evidenceChecks.push("No new MSI, repair, uninstall or game/model workflow followed the incident");
  report.evidenceStatus = "PASS";
} catch (error) {
  report.evidenceStatus = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
