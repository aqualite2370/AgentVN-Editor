"use strict";
// Independent terminal audit of actual old-authored data, not a profile fixture replay.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { normalize } = require("./lib/editor-profile-upgrade-flow.cjs");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const [configFile, installationFile, output] = process.argv.slice(2);
assert(configFile && installationFile && output && !fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const config = read(configFile), out = config.out, r = read(path.join(out, "report.json"));
const candidate = verifiedInstalledCandidate(installationFile);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
  source: { path: path.join(out, "report.json"), sha256: sha(path.join(out, "report.json")) },
  nativeClose: "BLOCKED", physicalInput: false, modelBoundary: "CONTROLLED_HTTP_ONLY",
  paidModelRequests: 0, productChanges: 0, builds: 0,
  limitations: ["1080p DPR1 upgrade flow, not full UI matrix",
    "Recent 1.9.34 upgrade only, not cross-generation database migration",
    "Owned termination after saving; native close, Alt+F4 and live-process upgrade NOT_RUN",
    "Development host, not clean-machine compatibility"] };
function check(name, fn) {
  try { report.checks.push({ name, status: "PASS", detail: fn() }); }
  catch (e) { report.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
check("real old installation and same-directory frozen-candidate upgrade", () => {
  assert.equal(r.status, "PASS"); assert.equal(r.cleanupStatus, "PASS");
  const before = read(path.join(out, "InstallOld.json")), after = read(path.join(out, "InstallNew.json"));
  assert.equal(before.actualVersion, config.oldVersion); assert.equal(after.actualVersion, config.version);
  assert.equal(after.actualSha256, candidate.executable.sha256);
  assert.equal(after.sha256, config.installerSHA256);
  assert.equal(sha(config.oldInstaller.path), config.oldInstaller.sha256);
  assert.equal(before.installRoot, after.installRoot);
  assert.equal(r.steps.length, 6); assert(r.steps.every(s => s.status === "PASS"));
  assert.equal(r.closeInput, "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");
  assert.equal(r.cleanups.length, 3); assert(r.cleanups.every(c => c.normalClose === false));
  return { old: config.oldVersion, current: config.version, editorSHA256: candidate.executable.sha256 };
});
check("old-authored inquiry, isolated draft, library and dependency bytes survive upgrade and restart", () => {
  assert.equal(r.profileUpgradeCases.length, 3);
  assert(r.profileUpgradeCases.every(c => c.status === "PASS"));
  const baseline = read(path.join(out, "profile-old-records.json"));
  assert.equal(baseline.conversations.length, 2); assert.equal(baseline.components.length, 1);
  assert.equal(new Set(baseline.conversations.map(c => c.mode)).size, 2);
  const component = baseline.components[0]; assert.equal(component.assets.length, 1);
  assert.equal(component.assets[0].sha256, sha(path.join(out, "升级依赖.png")));
  for (const phase of ["new", "restart"]) {
    const records = read(path.join(out, `profile-${phase}-records.json`));
    assert.deepEqual(normalize(records.conversations), normalize(baseline.conversations));
    assert.deepEqual(records.components, baseline.components);
  }
  return { conversations: 2, components: 1, dependencySHA256: component.assets[0].sha256 };
});
check("controlled model is not resubmitted during upgrade or restart", () => {
  assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0);
  assert.equal(r.profileModelRequests.length, 2);
  assert.equal(r.profileModelRequests[0].creation, false);
  assert.equal(r.profileModelRequests[0].tools.length, 0);
  assert.equal(r.profileModelRequests[1].creation, true);
  assert.equal(r.profileProviderCleanup.stopped, true);
  assert.equal(r.profileProviderCleanup.requests, 2);
  return { localHttpRequests: 2, paidRequests: 0 };
});
check("independent default-profile, cache and uninstall audit completed", () => {
  const audit = read(path.join(out, "audit-01.json"));
  assert.equal(audit.status, "PASS"); assert.equal(audit.source.sha256, report.source.sha256);
  assert.equal(audit.checks.length, 4); assert(audit.checks.every(c => c.status === "PASS"));
  const cleanup = read(path.join(out, "retained-cleanup-01.json"));
  assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.deletedUserFiles, 0);
  assert.equal(cleanup.records.length, 3);
  assert(cleanup.records.every(c => c.removed && !fs.existsSync(c.source)));
  return { auditSHA256: sha(path.join(out, "audit-01.json")),
    cleanupSHA256: sha(path.join(out, "retained-cleanup-01.json")) };
});
report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks, output }));
if (report.status !== "PASS") process.exitCode = 1;
