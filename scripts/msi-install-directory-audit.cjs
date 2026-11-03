"use strict";
// Terminal, read-only audit. No product repair, installer or process termination.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/MSI-Location-Repair-20261021-01";
const file = path.join(qa, "terminal-audit-01.json"); assert(!fs.existsSync(file));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const report = { status: "RUNNING", scope: "MSI_DIRECTORY_REPAIR_ONLY_NOT_COMPLETE_REGRESSION",
  at: new Date().toISOString(), checks: [], evidence: [], limitations: [
    "Quiet actual installation, not interactive wizard input", "UI 1080p DPR1 ordinary viewport simulation only",
    "DB/WebView isolated, not default-profile or clean-machine proof", "No version-upgrade or Android claim",
    "HKCU InstallDir observation was empty; product location checked by actual uninstall registration and server log",
  ] };
function evidence(p) { const r = read(p); report.evidence.push({ path: p, sha256: sha(p), status: r.status }); return r; }
function check(name, run) {
  try { run(); report.checks.push({ name, status: "PASS" }); }
  catch (e) { report.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
const baseline = read(path.join(qa, "prepare-01/report.json"));
const installation = read("F:/AgentVN/Checkpoints/MSI-Location-Repair-20261021-01/installation/checkpoint.json");
const actual = [
  { ui: evidence(path.join(qa, "editor-05/report.json")), directory: "msi-en-US-03" },
  { ui: evidence(path.join(qa, "editor-02/report.json")), directory: "msi-zh-CN" },
];
check("Eleven gates, full Dev replacement and sealed three-package provenance", () => {
  const gates = evidence(path.join(qa, "check-01/report.json"));
  assert.equal(gates.status, "PASS"); assert.equal(gates.commands.length, 11);
  assert(gates.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  const dev = evidence(path.join(qa, "dev-01/report.json"));
  assert.equal(dev.status, "PASS"); assert.equal(dev.commands.length, 2);
  assert.equal(sha(dev.dev.path), dev.dev.sha256);
  assert.equal(sha("D:/AgentVN/editor/src-tauri/target/debug/agentvn-editor.exe"), dev.dev.sha256);
  assert(Date.parse(dev.dev.generatedAt) >= Date.parse(dev.startedAt));
  const release = evidence(path.join(qa, "release-01/report.json"));
  const payload = evidence(path.join(qa, "payload-01/report.json"));
  assert.equal(release.status, "PASS"); assert.equal(payload.status, "PASS"); assert.equal(payload.archived.length, 3);
  // Post-package edits were QA only. Do not pretend the entire QA tool tree
  // still equals its build-time snapshot; verify actual product sources.
  const productSources = release.sources.filter(f =>
    /[\\/]AgentVN[\\/](editor|GameCli_framework|backend|shared)[\\/]/.test(f.path));
  assert(productSources.length > 0);
  for (const f of productSources) assert.equal(sha(f.path), f.sha256, f.path);
  report.productSourcesChecked = productSources.length;
  for (const name of ["msi-install-directory-session.ps1", "installed-layout-cache-session.ps1"]) {
    const snapshot = name === "msi-install-directory-session.ps1" ? "session-v3-executed.ps1" : "cache-session-executed.ps1";
    assert.equal(sha("D:/AgentVN/scripts/" + name), sha(path.join(qa, snapshot)), "Executed QA source changed");
  }
  for (const f of [...release.installers, ...payload.archived, ...release.reusedBinaries])
    assert.equal(sha(f.path), f.sha256);
});
check("Two real candidate MSIs, eighteen native UI/execute/handoff scenarios", () => {
  for (const language of ["en-US", "zh-CN"]) {
    const probe = evidence(path.join(qa, `probe-release-${language}.json`));
    assert.equal(probe.status, "PASS"); assert.equal(probe.cases.length, 9);
    assert(probe.cases.every(c => c.status === "PASS" && c.actual === c.expected));
    assert.equal(sha(probe.package.path), probe.package.sha256);
    assert(probe.tables.Properties.find(p => p.Property === "SecureCustomProperties").Value
      .split(";").includes("AGENTVN_REQUESTED_INSTALLDIR"));
    assert.equal(probe.tables.Properties.find(p => p.Property === "ProductVersion").Value, "1.9.18");
  }
});
check("Actual bilingual install, repair and uninstall with requested registered directory", () => {
  for (const target of actual) {
    for (const phase of ["Install", "Repair", "Uninstall"]) {
      const r = evidence(path.join(qa, target.directory, phase + ".json"));
      const elevation = evidence(path.join(qa, target.directory, phase + "-elevation.json"));
      assert.equal(r.status, "PASS"); assert.equal(r.isElevated, true); assert.equal(r.exitCode, 0);
      assert.equal(elevation.status, "PASS"); assert.equal(elevation.parentElevated, false);
      assert.equal(r.metadataRestoration, "PASS"); assert.equal(r.originalInstallationUnchanged, "PASS");
      if (phase === "Repair") assert.equal(r.arguments[0], "/famus");
      assert.equal(sha(r.package.path), r.package.sha256); assert.equal(sha(r.log.path), r.log.sha256);
      if (phase !== "Uninstall") {
        assert.equal(r.registeredDirectory.replace(/\\$/, ""), r.installRoot);
        assert.equal(r.finalDirectoryLogLines.length, 1);
        assert.equal(r.finalDirectoryLogLines[0].slice("Property(S): INSTALLDIR = ".length).replace(/\\$/, ""), r.installRoot);
        assert(r.shortcuts.length > 0 && r.resources.length === 4);
      } else {
        assert.equal(r.registrationsAfter.length, 0);
        assert(!fs.existsSync(path.join(r.installRoot, "agentvn-editor.exe")));
      }
    }
  }
});
check("Four installed host launches, real editing/restart, six hit assertions and four exact PNGs", () => {
  for (const { ui } of actual) {
    assert.equal(ui.status, "PASS"); assert.equal(ui.launches.length, 2);
    assert.equal(ui.checks.length, 2); assert.equal(ui.observations.length, 3); assert.equal(ui.screenshots.length, 2);
    assert.equal(ui.errors.length, 0); assert.equal(ui.modelRequests, 0);
    for (const observation of ui.observations) {
      assert.equal(observation.hit, true); assert.equal(observation.disabled, false); assert(observation.overflow <= 1);
      assert.deepEqual(observation.viewport, { width: 1920, height: 1080, dpr: 1 });
    }
    for (const shot of ui.screenshots) {
      assert.equal(sha(shot.path), shot.sha256);
      const png = fs.readFileSync(shot.path);
      assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
      assert.deepEqual(shot.before, shot.after);
      assert.deepEqual(shot.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
    }
  }
});
check("Original files, runtime/editor boundaries, old installation and preserved failure remain", () => {
  for (const f of [...baseline.protected, ...installation.protectedFiles])
    assert.equal(sha(f.path), f.sha256, f.path);
  assert.equal(sha(installation.oldInstallation.receipt), installation.oldInstallation.sha256);
  const old = read(installation.oldInstallation.receipt);
  const found = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const f = path.join(directory, entry.name); assert(!fs.lstatSync(f).isSymbolicLink());
      if (entry.isDirectory()) walk(f); else { assert(entry.isFile()); found.push(f); }
    }
  }
  walk(old.source); assert.equal(found.length, old.files.length); assert.equal(found.length, 12848);
  for (const f of old.files) {
    const p = path.join(old.source, f.relative);
    assert.equal(sha(p), f.sha256, p); assert.equal(fs.statSync(p).size, f.bytes);
  }
  const failed = evidence(path.join(qa, "editor-01/report.json"));
  assert.equal(failed.status, "FAILED"); assert.equal(failed.checks.length, 0); assert.equal(failed.uninstallStatus, "PASS");
  assert.equal(read(path.join(qa, "msi-en-US/Install.json")).status, "FAILED");
  const failedRepair = evidence(path.join(qa, "editor-03/report.json"));
  assert.equal(failedRepair.status, "FAILED"); assert.equal(failedRepair.checks.length, 1);
  assert.equal(failedRepair.uninstallStatus, "PASS");
});
check("Original registry/shortcuts/cache restored; owned processes/ports/MSI absent", () => {
  const registry = JSON.parse(ps(
    "$rs=@();foreach($p in @('Software\\agentvn\\AgentVN Editor','Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor')){" +
    "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($p);if(!$k){throw 'Original key missing'};" +
    "try{$v=@(foreach($n in $k.GetValueNames()){[pscustomobject]@{name=$n;kind=$k.GetValueKind($n).ToString();" +
    "value=$k.GetValue($n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}});" +
    "$rs+=@{path=$p;values=$v}}finally{$k.Dispose()}};ConvertTo-Json -InputObject $rs -Depth 8 -Compress"));
  const normalize = items => items.map(r => ({ path: r.path, values: r.values.sort((a, b) =>
    a.name.localeCompare(b.name)).map(v => ({ name: v.name, kind: v.kind, value: v.value })) }));
  assert.deepEqual(normalize(registry), normalize(installation.registry));
  for (const f of installation.shortcuts) assert.equal(sha(f.path), f.sha256);
  const registered = JSON.parse(ps("ConvertTo-Json -Compress -InputObject @(" +
    "Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
    "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
    "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue|" +
    "Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1}|Select-Object PSChildName)"));
  assert.equal(registered.length, 0);
  const live = rows(), ports = [];
  for (const { ui } of actual) {
    assert.equal(ui.uninstallStatus, "PASS"); assert.equal(ui.cacheRestored, true);
    assert.equal(ui.cleanups.length, 2); assert(ui.cleanups.every(c => c.status === "PASS"));
    assert(!ui.knownProcesses.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
    ports.push(...ui.launches.flatMap(l => l.ports));
    const restored = evidence(path.join(path.dirname(ui.screenshots[0].path), "native-cache-restoration.json"));
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const f of restored.originalFiles)
      assert.equal(sha(path.join(restored.originalDirectory, f.relative)), f.sha256);
  }
  assert.equal(listeners(ports).length, 0);
});
report.status = report.checks.length === 6 && report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks, file }, null, 2));
if (report.status !== "PASS") process.exitCode = 1;
