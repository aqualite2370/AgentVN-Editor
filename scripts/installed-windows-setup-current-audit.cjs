"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { validateSetupEvidence } = require("./lib/windows-setup-current-evidence.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const nativeUI = process.argv.includes("--native-ui"), attempt = process.argv[2] || "07", number = process.argv[3] || "01";
assert(/^\d{2}$/.test(attempt) && /^\d{2}$/.test(number));
const base = "F:/AgentVN/QA/Windows-Package-20261021-01", run = path.join(base, `runtime-${attempt}`), out = path.join(base, `setup-audit-${number}`);
fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const file = path.join(run, "report.json"), r = read(file);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: { path: file, sha256: sha(file) }, checks: [] };
try {
  const context = nativeUI
    ? require("./lib/windows-current-native-source.cjs").loadNativeSource(r.source.path, r.sourceAudit.path) : undefined;
  Object.assign(report, validateSetupEvidence(r, { editorVersion: context?.editorVersion || "1.9.16",
    candidateBinding: context?.candidateBinding, sourcePath: r.source.path, nativeAuditPath: r.sourceAudit?.path,
    payloadPath: r.payload?.path, gameId: context?.source.projectId }));
  if (context?.candidateBinding) report.candidateBinding = context.candidateBinding;
  const source = read(r.source.path), install = read(path.join(run, "installation.json"));
  assert.deepEqual(install, r.checks[0].result);
  assert.deepEqual(read(path.join(run, "uninstallation.json")), r.checks[4].result.result);
  if (nativeUI) {
    assert.equal(read(r.sourceAudit.path).source.sha256, r.source.sha256);
    assert.equal(read(r.prior.path).sourceReport.sha256, r.source.sha256);
  }
  for (const f of [r.source, r.prior, ...(nativeUI ? [r.sourceAudit, r.payload] : []),
    ...(r.nativePhysicalClose ? [r.nativeCloseReceipt] : []),
    install.installer, install.payloadEvidence.executable, ...source.protectedFiles, ...r.references])
    assert.equal(sha(f.path), f.sha256, f.path);
  assert(!fs.existsSync(install.executable.path)); assert(!fs.existsSync(install.uninstaller.path));
  const payload = read(r.payload.path);
  for (const resource of install.resources) {
    const expected = payload.resources.find(p => path.basename(p.path) === path.basename(resource.path));
    assert(expected && expected.sha256 === resource.sha256 && expected.bytes === resource.bytes);
    assert(!fs.existsSync(resource.path));
  }
  const installProcess = read(path.join(run, "install-process.json")), uninstallProcess = read(path.join(run, "uninstall-process.json"));
  assert.deepEqual(installProcess.arguments, ["/S", "/D=" + install.client]);
  assert.deepEqual(uninstallProcess.arguments, ["/S"]);
  report.checks.push("Actual installation/uninstallation process arguments; exact payload hashes; installed resources removed");
  if (r.nativePhysicalClose) report.checks.push("Native Alt+F4 confirmation receipt and natural process exit; no forced final-close claim");
  for (const s of r.screenshots) {
    assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
    validateNativeViewport(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
    const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), 1920); assert.equal(b.readUInt32BE(20), 1080);
  }
  report.checks.push("Five actual installed WebView screenshots with correct viewport/pixel parameters");
  const restoration = read(path.join(run, "profile-restoration.json")), protection = read(path.join(run, "profile-protection.json"));
  assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
  for (const p of restoration.records) {
    assert(p.qaRemoved);
    assert(ps(`fsutil.exe file queryfileid '${p.original}'`).toLowerCase().includes(p.directoryId));
    const before = protection.records.find(n => n.original === p.original); assert(before);
    assert(!fs.existsSync(before.held) && !fs.existsSync(before.retained));
    if (before.byteInventory) for (const f of before.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
  }
  const target = r.launches[0].storage.targetDirectory;
  for (const f of r.finalSaves) assert.equal(sha(path.join(target, f.name)), f.sha256);
  for (const f of r.finalLegacy)
    assert.equal(sha(path.join(run, "profile-roaming/saves/preview_gamecli", f.name)), f.sha256);
  report.checks.push("Uninstall preserves real saves and isolated legacy bytes; original profile identities/roaming hashes restored");
  const cleanup = read(path.join(run, "setup-cleanup.json")), journal = read(path.join(run, "setup-protection.json"));
  assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.deletedUserFiles, 0);
  assert.equal(journal.registry.length, 8); assert(journal.registry.every(k => !k.exists));
  assert.equal(cleanup.registry.length, 8); assert(cleanup.registry.every(k => !k.exists));
  for (const row of cleanup.registry) {
    const key = `${row.hive === "CurrentUser" ? "HKCU" : "HKLM"}\\${row.key}`;
    const value = ps(`& reg.exe query '${key}' /reg:${row.view === "Registry32" ? 32 : 64} 2>$null;` +
      `if($LASTEXITCODE -eq 0){throw 'QA registry remains'};[Console]::Write('ABSENT')`);
    assert.equal(value, "ABSENT");
  }
  for (const shortcut of journal.shortcuts) assert(!fs.existsSync(shortcut));
  report.checks.push("Both absent-before hives/views and default shortcuts remain clean after actual uninstall and scoped QA cleanup");
  const live = rows();
  assert(!r.known.some(p => live.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
  assert.equal(listeners(r.launches.map(l => l.port)).length, 0);
  assert(!live.some(p => p.ExecutablePath && path.resolve(p.ExecutablePath).toLowerCase().startsWith(path.resolve(run).toLowerCase() + path.sep)));
  report.ownedProcessIdentities = r.known.length; report.ports = r.launches.map(l => l.port);
  report.checks.push("Both shortcut-launched Player process trees, setup temporary processes and CDP ports absent");
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
