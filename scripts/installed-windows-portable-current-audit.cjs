"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { validatePortableEvidence } = require("./lib/windows-portable-current-evidence.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const nativeUI = process.argv.includes("--native-ui");
const attempt = process.argv[2] || "05", auditNumber = process.argv[3] || "01";
assert(/^\d{2}$/.test(attempt) && /^\d{2}$/.test(auditNumber));
const base = "F:/AgentVN/QA/Windows-Package-20261021-01", run = path.join(base, `runtime-${attempt}`), out = path.join(base, `runtime-audit-${auditNumber}`);
fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const file = path.join(run, "report.json"), r = read(file);
const report = { status: "RUNNING", at: new Date().toISOString(), source: { path: file, sha256: sha(file) }, checks: [] };
try {
  const context = nativeUI
    ? require("./lib/windows-current-native-source.cjs").loadNativeSource(r.sourceReport.path, r.sourceAudit.path) : undefined;
  Object.assign(report, validatePortableEvidence(r, { editorVersion: context?.editorVersion || "1.9.16",
    candidateBinding: context?.candidateBinding, nativeAuditPath: r.sourceAudit.path }));
  const source = read(r.sourceReport.path);
  if (context?.candidateBinding) report.candidateBinding = context.candidateBinding;
  for (const f of [r.sourceReport, r.sourceAudit, r.sourceArtifact, r.executable, ...source.protectedFiles])
    assert.equal(sha(f.path), f.sha256, f.path);
  const resourceRoot = path.join(path.dirname(r.sourceArtifact.path), "embedded-cartridge");
  const copiedRoot = path.join(run, "client/embedded-cartridge"), buildAudit = read(r.sourceAudit.path);
  const embedded = nativeUI
    ? buildAudit.groups.find(g => g.name === "observed-input-cartridge-and-embedded-bytes").detail.entries
    : buildAudit.embedded;
  for (const f of embedded) {
    const expected = nativeUI ? f.outputSha256 : f.sha256;
    assert.equal(sha(path.join(resourceRoot, f.name)), expected);
    assert.equal(sha(path.join(copiedRoot, f.name)), expected);
  }
  if (nativeUI) assert.deepEqual(fs.readFileSync(path.join(resourceRoot, "startup-index.json")),
    fs.readFileSync(path.join(copiedRoot, "startup-index.json")));
  report.checks.push("Produced EXE/resources and source-report hashes unchanged");
  for (const s of r.screenshots) {
    assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
    const bytes = fs.readFileSync(s.path);
    const dpr = nativeUI ? [1, 2].find(v => Math.abs(s.before.dpr - v) <= 1e-6) : s.before.dpr;
    assert(dpr !== undefined, "Actual DPR must match an intended display combination");
    assert.equal(bytes.readUInt32BE(16), s.before.width * dpr);
    assert.equal(bytes.readUInt32BE(20), s.before.height * dpr);
  }
  report.checks.push("15 PNG hashes and real before/after viewport/DPR/media/pixel geometry");
  const restoration = read(path.join(run, "profile-restoration.json")), protection = read(path.join(run, "profile-protection.json"));
  assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
  assert.equal(restoration.records.length, 2);
  for (const p of restoration.records) {
    assert(p.qaRemoved);
    const idText = ps(`fsutil.exe file queryfileid '${p.original}'`).toLowerCase();
    assert(idText.includes(p.directoryId));
    const original = protection.records.find(o => o.original === p.original);
    assert.equal(fs.existsSync(original.held), false); assert.equal(fs.existsSync(original.retained), false);
    if (p.originalByteInventory)
      for (const f of original.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
  }
  for (const f of r.finalLegacy) {
    const archived = path.join(run, "profile-roaming/saves/preview_gamecli", f.name);
    assert.equal(sha(archived), f.sha256);
  }
  const target = r.launches[0].storage.targetDirectory;
  assert.equal(path.resolve(target), path.resolve(run, "client/saves", r.gameId, "preview_gamecli"));
  for (const f of r.finalSaves) assert.equal(sha(path.join(target, f.name)), f.sha256);
  report.checks.push("Original profile NTFS identity and roaming bytes restored; all QA legacy/save bytes retained");
  const live = rows();
  assert(!r.knownProcesses.some(p => live.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
  assert.equal(listeners(r.launches.map(l => l.port)).length, 0);
  report.ownedProcessIdentities = r.knownProcesses.length; report.ports = r.launches.map(l => l.port);
  report.checks.push("Two exact Player process trees/ports cleared; no physical-close claim");
  report.tools = fs.readdirSync(path.join(run, "tools")).map(name => ({ name, sha256: sha(path.join(run, "tools", name)) }));
  assert.equal(report.tools.length, context?.candidateBinding ? 6 : 5); report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
