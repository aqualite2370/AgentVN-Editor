"use strict";
// Independent receipt audit while the genuine cross-generation consent is pending.
// PASS checks below do not mean the upgrade/migration or complete product passed.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const root = "D:/AgentVN", run = path.join(root, "output/host-msi-next-20261018-01");
const destination = process.argv[2];
assert(destination && !fs.existsSync(destination), "Fresh progress receipt required");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "BLOCKED", evidenceAuditStatus: "RUNNING", startedAt: new Date().toISOString(),
  scope: "PARTIAL_MSI_RECEIPTS_AND_HELD_PROFILE_SAFETY_NOT_FULL_PRODUCT_ACCEPTANCE",
  checks: [], sources: [], screenshots: [], productFindings: [], realModelRequests: 0,
  pending: "Real 1.7.1 to 1.9.9 native database-migration consent requires user input; no injected consent" };
function source(relative) {
  const file = path.join(run, relative);
  report.sources.push({ path: file, sha256: sha(file), bytes: fs.statSync(file).size });
  return read(file);
}
function check(name, fn) {
  try { const detail = fn(); report.checks.push({ name, status: "PASS", detail }); }
  catch (error) { report.checks.push({ name, status: "FAILED", error: String(error.stack || error) }); }
}
function captures(row) {
  for (const capture of row.screenshots) {
    const file = path.resolve(root, capture.path), bytes = fs.readFileSync(file);
    assert.equal(sha(file), capture.sha256);
    assert.deepEqual(capture.before, capture.after);
    assert.equal(bytes.readUInt32BE(16), capture.before.width * capture.before.dpr);
    assert.equal(bytes.readUInt32BE(20), capture.before.height * capture.before.dpr);
    report.screenshots.push({ path: file, sha256: capture.sha256, actual: capture.before, png: capture.png });
  }
}
check("Both actual 1.9.9 ordinary MSI /i and /x receipts, not administrative extraction", () => {
  for (const language of ["en-US", "zh-CN"]) {
    const first = language === "en-US" ? "Install-1.9.9-attempt03" : "Install-1.9.9";
    for (const [stem, verb] of [[first, "/i"], ["Uninstall-1.9.9", "/x"]]) {
      const row = source(`clean/${language}/${stem}.json`), parent = source(`clean/${language}/${stem}-elevation.json`);
      if (language === "en-US" && verb === "/i") {
        // Preserve the original redirection finding. An exit-zero installation
        // at D is NOT a successful test of the requested F destination.
        assert.equal(row.status, "FAILED"); assert.equal(parent.status, "BLOCKED");
        assert.equal(row.error, "Actual MSI identity/path mismatch");
        assert.equal(row.installRoot, "F:\\AgentVN-QA-HostUpgrade-20261018-02\\installed-editor");
        assert(row.registrationsAfter.some(r => r.WindowsInstaller === 1 &&
          r.InstallLocation === "D:\\agentvntest\\AgentVN Editor\\"));
        report.productFindings.push({ status: "UNRESOLVED", category: "Installation target mismatch",
          originalStatus: "FAILED", requested: row.installRoot,
          actual: "D:\\agentvntest\\AgentVN Editor", productCauseNotYetEstablished: true });
      } else {
        assert.equal(row.status, "PASS"); assert.equal(parent.status, "PASS");
      }
      assert.equal(row.exitCode, 0); assert.equal(row.isElevated, true);
      assert.equal(parent.parentElevated, false);
      assert.equal(row.arguments[0], verb); assert.equal(sha(row.package), row.packageSha256);
      assert(fs.statSync(path.join(run, `clean/${language}/${stem}.log`)).size > 0);
    }
    const resources = source(`clean/${language}/installed-resources.json`);
    assert.equal(resources.status, "PASS"); assert.equal(resources.files.length, 28);
    assert.equal(resources.scriptCount, 19);
    const persistence = source(`clean/${language}/after-uninstall-verify.json`);
    assert.equal(persistence.status, "PASS"); assert(persistence.files.length);
    assert(persistence.files.every(file => file.match));
  }
  return "No prior MSI registration, but existing NSIS registration/installation history; NOT a clean machine";
});
check("Both ordinary MSI real UI creation, exported bytes and new-process restart", () => {
  for (const language of ["en-US", "zh-CN"]) {
    const baseline = source(`clean/${language}/created-ui-data.json`);
    const again = source(`clean/${language}/restart-ui-02/report.json`);
    assert.equal(baseline.status, "PASS"); assert.equal(again.status, "PASS");
    assert(baseline.checks.length >= 3 && again.checks.length >= 4);
    assert.equal(sha(baseline.package.path), baseline.package.sha256);
    assert(again.checks.some(text => text.includes("all nodes, edges and commands")));
    assert(again.checks.some(text => text.includes("Theme survives")));
    const firstLaunch = source(`clean/${language}/new-launch.json`);
    const nextLaunch = source(`clean/${language}/restart-launch.json`);
    assert.notEqual(firstLaunch.cdpPort, nextLaunch.cdpPort);
    for (const launch of [firstLaunch, nextLaunch]) {
      assert.equal(launch.actualVersion, "1.9.9");
      assert(!launch.dataDirectoryOverride && !launch.webviewDirectoryOverride && !launch.manualBackendSpawn);
    }
    captures(baseline); captures(again);
    for (const phase of ["new", "restart"]) {
      const close = source(`clean/${language}/${phase}-close-audit.json`);
      assert.equal(close.status, "FAILED"); assert.equal(close.cleanup, "PASS");
      assert.equal(close.defect, "BACKEND_CHILD_SURVIVES_NORMAL_WINDOW_CLOSE");
      report.productFindings.push({ language, phase, status: "FAILED", defect: close.defect });
    }
  }
  return "Actual recorded native viewport/DPR only; NOT the complete 12-combination display matrix";
});
check("1.7.1 actual legacy UI save bytes and exact attributed termination", () => {
  const old = source("cross-generation/en-US/chain02/old-ui-03/report.json");
  assert.equal(old.status, "PASS"); assert(old.checks.length >= 2);
  assert.equal(old.launch.actualVersion, "1.7.1");
  assert.equal(sha(old.package.path), old.package.sha256);
  const project = read(old.package.path);
  assert.equal(project.project_id, old.project.metadata.projectId);
  assert.equal(project.title, old.project.metadata.title);
  assert.equal(project.author, old.project.metadata.author);
  const stop = source("cross-generation/en-US/chain02/old-owned-termination.json");
  assert.equal(stop.status, "PASS"); assert.equal(stop.ports.length, 0);
  assert(stop.method.includes("NOT normal close"));
  captures(old);
  return { oldProjectId: project.project_id, normalClose: "NOT_VERIFIED", format: old.package.format };
});
check("Cross-generation actual /i, unchanged old persistent bytes, installed candidate resources", () => {
  const install = source("cross-generation/en-US/Install-1.9.9.json");
  assert.equal(install.status, "PASS"); assert.equal(install.exitCode, 0); assert.equal(install.arguments[0], "/i");
  assert.equal(install.actualVersion, "1.9.9");
  assert(install.registrationsBefore.some(row => row.DisplayVersion === "1.7.1" && row.WindowsInstaller === 1));
  const preserved = source("cross-generation/en-US/before-upgrade-verify.json");
  assert.equal(preserved.status, "PASS"); assert.equal(preserved.files.length, 19);
  assert(preserved.files.every(file => file.match));
  const resources = source("cross-generation/en-US/installed-resources.json");
  assert.equal(resources.status, "PASS"); assert.equal(resources.files.length, 28);
  for (const row of resources.files) assert.equal(sha(path.join(resources.installedRoot, row.relative)), row.sha256);
  return "Installer replacement verified; old data migration/UI preservation still pending native consent";
});
check("All original held profiles and root Dev still match independent original hashes", () => {
  const prep = source("preparation.json");
  let count = 0;
  for (const profile of prep.profiles) {
    assert(fs.existsSync(profile.held));
    for (const file of profile.files) {
      assert.equal(sha(path.join(profile.held, file.relative)), file.sha256);
      assert.equal(sha(file.backup), file.sha256);
      count++;
    }
  }
  assert.equal(count, 55);
  assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
  return { protectedOriginalFiles: count, profilesRestored: false, reason: "Active isolated QA migration dialog" };
});
check("Real native migration dialog is pending; no fabricated consent file", () => {
  const probe = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match 'creator-backend|agentvn-editor'}|Select-Object Name,ProcessId,ParentProcessId,ExecutablePath); $w=@(Get-Process -Name agentvn-editor|Select-Object Id,MainWindowTitle); @{processes=$p;windows=$w;consentExists=(Test-Path -LiteralPath 'C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\database-migration-decision.json')}|ConvertTo-Json -Depth 5"
  ], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(probe.status, 0, probe.stderr);
  const actual = JSON.parse(probe.stdout.replace(/^\uFEFF/, ""));
  assert.equal(actual.processes.length, 1); assert.equal(actual.processes[0].Name, "agentvn-editor.exe");
  assert.equal(actual.windows.length, 1);
  assert.equal(actual.windows[0].MainWindowTitle, "迁移 AgentVN 项目数据");
  assert.equal(actual.consentExists, false);
  return actual;
});
report.evidenceAuditStatus = report.checks.length === 6 && report.checks.every(check => check.status === "PASS") ? "PASS" : "FAILED";
report.limitations = ["Computer Use native pipe unavailable", "No migration approval automation or injected decision",
  "English ordinary install exit 0 but destination differs requested F: original FAILED retained, cause unresolved",
  "Original profiles intentionally still held until QA session restoration", "No product changes or new build",
  "Chinese 1.7.1 cross-generation test NOT_RUN", "Installed Windows/Android game upgrade and final project NOT_RUN"];
report.finishedAt = new Date().toISOString();
fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, evidenceAuditStatus: report.evidenceAuditStatus,
  checks: report.checks, screenshots: report.screenshots.length }, null, 2));
if (report.evidenceAuditStatus !== "PASS") process.exitCode = 1;
