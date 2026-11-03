"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const run = path.join(root, "output/host-upgrade-20261018-02");
const installed = "F:\\AgentVN-QA-HostUpgrade-20261018-02\\installed-editor";
const destination = process.argv[2];
assert(destination && !fs.existsSync(destination), "Fresh terminal audit report required");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const local = name => read(path.join(run, name));
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", scope: "INDEPENDENT_HOST_NSIS_UPGRADE_EVIDENCE_AUDIT",
  productStatus: "FAILED", startedAt: new Date().toISOString(), checks: [],
  limitations: ["Host has development dependencies", "Not MSI or cross-generation upgrade",
    "No AI-session/component migration in old sample", "Not full UI/DPI/motion matrix",
    "No Windows game/Android/final-project acceptance in this slice"] };
function check(name, action) {
  try { report.checks.push({ name, status: "PASS", detail: action() }); }
  catch (error) { report.checks.push({ name, status: "FAILED", error: String(error.stack || error) }); }
}
const install = local("install-1.9.9.json");
const payload = read(path.join(root, "output/full-regression-20261017-01/candidate-payload-audit/installer-resource-report.json"));
const frozen = read(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
check("Real NSIS installation upgraded 1.9.8 registration to 1.9.9 without uninstall", () => {
  assert.equal(install.status, "PASS"); assert.equal(install.exitCode, 0);
  assert.equal(install.registrationsBefore.DisplayVersion, "1.9.8");
  assert.equal(install.registrationsAfter.DisplayVersion, "1.9.9");
  assert.equal(hash(install.package), "14ce31f9fa026797a99c9bfea92ca3a41a449255d9a8a8946f21a8af0db2beb4");
});
check("Actual installed EXE matches actual frozen NSIS payload", () => {
  const expected = payload.deployments.find(d => d.kind === "NSIS actual payload").executable.sha256;
  assert.equal(hash(path.join(installed, "agentvn-editor.exe")), expected);
  assert.equal(install.executableSha256, expected);
  return { installedSha256: expected, note: "Bundle-stamped NSIS EXE, not standalone target EXE" };
});
check("Actual installed version, backend and player match frozen package", () => {
  assert.equal(read(path.join(installed, "build-versions.json")).editorVersion, "1.9.9");
  const rows = payload.deployments.find(d => d.kind === "NSIS actual payload").runtimeProvenance;
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(hash(path.join(installed, row.name)), row.expectedSha256);
});
check("Actual installed 158 Runtime/shared sources match frozen candidate", () => {
  const audit = read(path.join(root, "output/full-regression-20261017-01/candidate-payload-source-audit.json"));
  const rows = audit.deployments.find(d => d.kind === "NSIS actual payload").files;
  assert.equal(rows.length, 158);
  for (const row of rows) assert.equal(hash(path.join(installed, row.relative)), row.expected, row.relative);
  return { fileCount: rows.length };
});
check("Actual installed build helpers match exact frozen NSIS archive bytes", () => {
  const names = read(path.join(root, "scripts/standalone-build-scripts.json")).scripts;
  assert.equal(names.length, 19);
  assert.equal(hash(install.package), "14ce31f9fa026797a99c9bfea92ca3a41a449255d9a8a8946f21a8af0db2beb4");
  const proof = "F:\\AgentVN-QA-HostUpgrade-20261018-02\\nsis-script-proof-01";
  assert(!fs.existsSync(proof), "Script archive proof must be fresh");
  const extraction = spawnSync("C:\\Program Files\\7-Zip\\7z.exe",
    ["x", install.package, `-o${proof}`, "scripts\\*", "-y"],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
  fs.writeFileSync(path.join(proof, "extraction.log"), `${extraction.stdout}\n${extraction.stderr}`, { flag: "wx" });
  assert.equal(extraction.status, 0);
  const files = [];
  for (const name of names) {
    const expected = hash(path.join(proof, "scripts", name));
    const actual = hash(path.join(installed, "scripts", name));
    assert.equal(actual, expected, name);
    files.push({ name, expected, actual });
  }
  return { fileCount: names.length, archive: install.package, proof, files };
});
check("17 pre-launch application files were verified unchanged by upgrade", () => {
  const before = local("installed-before-launch.json");
  assert.equal(before.status, "PASS"); assert.equal(before.files.length, 17);
  assert(before.files.every(f => f.match && f.expected === f.actual));
});
check("Real UI preservation, edit and restart checks are complete and nonempty", () => {
  for (const file of ["new-ui-03/report.json", "restart-ui-01/report.json"]) {
    const ui = local(file);
    assert.equal(ui.status, "PASS"); assert.equal(ui.checks.length, 6);
    assert(ui.checks.every(c => c.status === "PASS"));
    assert.equal(ui.realModelRequests, 0);
  }
});
check("Actual exported package contains preserved identity and new edit", () => {
  const exported = local("export-bytes-audit.json");
  assert.equal(exported.status, "PASS"); assert.equal(exported.checks.length, 5);
  assert.equal(hash(exported.package.path), exported.package.sha256);
  return exported.package;
});
check("All UI evidence PNG dimensions, real parameters and hashes remain valid", () => {
  let count = 0;
  for (const file of ["new-ui-03/report.json", "restart-ui-01/report.json"]) {
    for (const capture of local(file).screenshots) {
      assert.deepEqual(capture.before, capture.after);
      assert.equal(capture.png.width, capture.before.width * capture.before.dpr);
      assert.equal(capture.png.height, capture.before.height * capture.before.dpr);
      const absolute = path.resolve(root, capture.path);
      const png = fs.readFileSync(absolute);
      assert.equal(hash(absolute), capture.sha256);
      assert.equal(png.readUInt32BE(16), capture.png.width);
      assert.equal(png.readUInt32BE(20), capture.png.height);
      count++;
    }
  }
  assert.equal(count, 6);
  return { screenshotCount: count, physicalDisplayMatrix: false };
});
check("Bundled frontend, auto-started frozen backend and default DB independently recorded", () => {
  for (const phase of ["new", "restart"]) {
    const capture = local(`${phase}-capture-audit.json`);
    assert.equal(capture.status, "PASS");
    assert.equal(Object.keys(capture.checks).length, 5);
    assert(Object.values(capture.checks).every(Boolean));
    const launch = local(`${phase}-launch.json`);
    assert.equal(launch.manualBackendSpawn, false);
    assert.equal(launch.dataDirectoryOverride, false);
    assert.equal(launch.webviewDirectoryOverride, false);
  }
});
check("Old and current theme icon product failures remain explicitly FAILED", () => {
  for (const file of ["theme-icon-old/report.json", "theme-icon-new/report.json"]) {
    const icon = local(file);
    assert.equal(icon.status, "FAILED");
    assert.equal(icon.geometry.icons.length, 1);
    assert.equal(icon.geometry.icons[0].deltaX, 2);
    assert.equal(icon.geometry.icons[0].deltaY, 2);
    assert.equal(icon.geometry.icons[0].outsideThumb, true);
    assert.equal(hash(path.resolve(root, icon.capture.path)), icon.capture.sha256);
  }
});
check("Backend exit defects not reclassified as PASS; attributed cleanup complete", () => {
  for (const file of ["new-close-audit-02.json", "restart-close-audit.json"]) {
    const close = local(file);
    assert.equal(close.status, "FAILED");
    assert.equal(close.defect, "BACKEND_CHILD_SURVIVES_NORMAL_WINDOW_CLOSE");
    assert.equal(close.cleanup, "PASS");
    assert.equal(close.remainingAfterCleanup.length, 0);
    assert.equal(close.remainingPorts.length, 0);
  }
});
check("Original profiles independently verified against backup after restoration", () => {
  const restore = local("user-profile-restoration.json");
  const preparation = local("preparation.json");
  assert.equal(restore.status, "PASS"); assert.equal(restore.profiles.length, 2);
  let count = 0;
  for (const profile of restore.profiles) {
    assert(profile.userRestored && profile.testStaged);
    assert(fs.existsSync(profile.testHeld)); assert(!fs.existsSync(profile.userHeld));
    const previous = preparation.profiles.find(p => p.kind === profile.kind);
    assert(profile.checks.length > 0);
    for (const file of profile.checks) {
      assert.equal(file.match, true);
      assert.equal(hash(path.join(profile.original, file.relative)), hash(path.join(previous.backupRoot, file.relative)));
      count++;
    }
  }
  assert.equal(count, 31);
  assert.equal(hash("C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\vn_engine.db"),
    "984d7a62038312040b8d510312bb01ef0268e8d9c9987ea04181db531f4ab1e3");
  return { independentlyVerifiedFiles: count };
});
check("Root Dev unchanged; no product rebuild in this test-only slice", () => {
  assert.equal(hash(path.join(root, "AgentVN Dev.exe")), "ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96");
});
check("No owned Editor/backend/WebView or test ports remain; registration and shortcut retained", () => {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
    $ErrorActionPreference='Stop'
    $procs=@(Get-CimInstance Win32_Process | Where-Object {
      $_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or
      ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.editor')
    } | Select-Object Name,ProcessId,ParentProcessId,ExecutablePath)
    $ports=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in @(8278,65055,54719)} | Select-Object LocalPort,OwningProcess)
    $reg=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor'
    $shell=New-Object -ComObject WScript.Shell
    @{processes=$procs;ports=$ports;version=$reg.DisplayVersion;location=$reg.InstallLocation;
      shortcut=$shell.CreateShortcut('C:\\Users\\1\\Desktop\\AgentVN Editor.lnk').TargetPath}|ConvertTo-Json -Depth 5
  `], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  assert.equal(snapshot.processes.length, 0); assert.equal(snapshot.ports.length, 0);
  assert.equal(snapshot.version, "1.9.9");
  assert.equal(snapshot.shortcut, path.join(installed, "agentvn-editor.exe"));
  return snapshot;
});
report.status = report.checks.length === 15 && report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.productFindings = [
  { id: "HOST-01", status: "FAILED", description: "Theme icon offset and containment, reproduced on 1.9.8 and 1.9.9" },
  { id: "HOST-02", status: "FAILED", description: "Normal Editor close leaves owned backend child running, old and new builds" }
];
report.finishedAt = new Date().toISOString();
fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, productStatus: report.productStatus,
  checks: report.checks, report: destination }, null, 2));
if (report.status !== "PASS") process.exitCode = 1;
