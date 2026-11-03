"use strict";
// Re-read the completed run. Never launch or modify an installed product.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { normalize } = require("./lib/editor-profile-upgrade-flow.cjs");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const close = require("./lib/editor-upgrade-wm-close.cjs");
const [configFile, resourceReceipt, output] = process.argv.slice(2);
assert(configFile && resourceReceipt && output && !fs.existsSync(output));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const config = read(configFile), out = config.out, source = path.join(out, "report.json");
const raw = read(source), candidate = verifiedInstalledCandidate(resourceReceipt);
assert.equal(candidate.sourceReceipt.actualInstallation.sha256, config.actualInstallation.sha256);
assert.equal(path.resolve(candidate.sourceReceipt.actualInstallation.path), path.resolve(config.actualInstallation.path));
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
  source: { path: source, sha256: sha(source) },
  installedCandidate: candidate.sourceReceipt, nativeClose: "WM_CLOSE_NOT_PHYSICAL_INPUT",
  productChanges: 0, builds: 0, paidRequests: 0,
  limitations: ["1080p DPR1 upgrade flow, not full UI matrix",
    "Recent 1.9.34 upgrade only, not cross-generation migration",
    "WM_CLOSE, not Computer Use or physical Alt+F4; no live-process upgrade",
    "Development host, not clean-machine compatibility", "Controlled local HTTP, not real-model quality"],
};
function check(name, fn) {
  try { report.checks.push({ name, status: "PASS", detail: fn() }); }
  catch (error) { report.checks.push({ name, status: "FAILED", error: String(error.stack || error) }); }
}
check("frozen inputs and actual same-directory NSIS upgrade", () => {
  const binding = read(path.join(config.preparation, "binding.json"));
  assert.deepEqual(binding.config, config);
  for (const file of binding.files) assert.equal(sha(file.path), file.sha256, file.path);
  assert.equal(raw.status, "PASS"); assert.equal(raw.cleanupStatus, "PASS");
  assert.equal(raw.steps.length, 6); assert(raw.steps.every(s => s.status === "PASS"));
  assert.deepEqual(raw.errors, []);
  const before = read(path.join(out, "InstallOld.json")), after = read(path.join(out, "InstallNew.json"));
  assert.equal(before.actualVersion, config.oldVersion); assert.equal(after.actualVersion, config.version);
  assert.equal(before.installRoot, after.installRoot);
  assert.equal(after.actualSha256, candidate.executable.sha256);
  assert.equal(after.sha256, config.installerSHA256);
  assert.equal(sha(config.oldInstaller.path), config.oldInstaller.sha256);
  assert.equal(read(path.join(out, "Uninstall.json")).status, "PASS");
  assert(!fs.existsSync(path.join(after.installRoot, "agentvn-editor.exe")));
  return { oldVersion: config.oldVersion, version: config.version, editorSHA256: candidate.executable.sha256 };
});
check("three real normal exits with exact process identity and no forced termination", () => {
  assert.equal(raw.closeInput, "REPOSITORY_WM_CLOSE_NATURAL_EXIT");
  assert.equal(raw.launches.length, 3); assert.equal(raw.cleanups.length, 3);
  for (const launch of raw.launches) {
    assert.equal(launch.defaultDataPath, true); assert.equal(launch.defaultWebViewPath, true);
    assert.equal(launch.backendPortOverride, false); assert.equal(launch.manualBackendSpawn, false);
    close.validate(read(path.join(out, launch.label + "-close-completed.json")), launch, raw.known);
    const cleanup = raw.cleanups.find(c => c.label === launch.label);
    assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.normalClose, true);
    assert.deepEqual(cleanup.killed, []);
  }
  return { actualNormalExits: 3, forcedTerminations: 0, physicalInput: false };
});
check("old-authored conversations, creation draft and component asset preserved twice", () => {
  assert.equal(raw.profileUpgradeCases.length, 3);
  assert(raw.profileUpgradeCases.every(c => c.status === "PASS"));
  const baseline = read(path.join(out, "profile-old-records.json"));
  assert.equal(baseline.conversations.length, 2); assert.equal(baseline.components.length, 1);
  assert.equal(new Set(baseline.conversations.map(c => c.mode)).size, 2);
  assert.equal(baseline.components[0].assets.length, 1);
  assert.equal(baseline.components[0].assets[0].sha256, sha(path.join(out, "升级依赖.png")));
  for (const phase of ["new", "restart"]) {
    const records = read(path.join(out, "profile-" + phase + "-records.json"));
    assert.deepEqual(normalize(records.conversations), normalize(baseline.conversations));
    assert.deepEqual(records.components, baseline.components);
  }
  assert.equal(raw.modelRequests, 0); assert.equal(raw.productChanges, 0);
  assert.equal(raw.profileModelRequests.length, 2);
  assert.equal(raw.profileModelRequests[0].creation, false);
  assert.deepEqual(raw.profileModelRequests[0].tools, []);
  assert.equal(raw.profileModelRequests[1].creation, true);
  assert.equal(raw.profileProviderCleanup.stopped, true);
  assert.equal(raw.profileProviderCleanup.requests, 2);
  return { conversations: 2, components: 1, restartVerifications: 2, controlledHttpRequests: 2, paidRequests: 0 };
});
check("independent default-profile restoration and archived QA cleanup", () => {
  const audit = read(path.join(out, "audit-01.json"));
  assert.equal(audit.status, "PASS"); assert.equal(audit.source.sha256, report.source.sha256);
  assert.equal(audit.checks.length, 4); assert(audit.checks.every(c => c.status === "PASS"));
  const cleanup = read(path.join(out, "retained-cleanup-01.json"));
  assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.deletedUserFiles, 0);
  assert.equal(cleanup.records.length, 3);
  assert(cleanup.records.every(c => c.removed && !fs.existsSync(c.source)));
  for (const record of cleanup.records) for (const file of record.files)
    assert.equal(sha(path.join(record.archive, file.relative)), file.sha256);
  return { auditSHA256: sha(path.join(out, "audit-01.json")),
    cleanupSHA256: sha(path.join(out, "retained-cleanup-01.json")), bytesRemovedFromC: cleanup.bytesRemovedFromC };
});
report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks, output }));
if (report.status !== "PASS") process.exitCode = 1;
