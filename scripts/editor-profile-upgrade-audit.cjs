"use strict";
// Independent terminal review, no product launch or IndexedDB mutation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { normalize } = require("./lib/editor-profile-upgrade-flow.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const [configFile] = process.argv.slice(2), c = read(configFile);
assert.equal(c.profileUpgrade, true);
require("./editor-candidate-upgrade.cjs").validateConfig(c);
assert.match(c.out, /^F:\/AgentVN\/QA\/Editor-Profile-Upgrade-1934-20261029-\d{2}$/);
const rawFile = path.join(c.out, "report.json"), r = read(rawFile);
const report = { status: "RUNNING", at: new Date().toISOString(),
  scope: "INDEPENDENT_OLD_UI_PROFILE_SAME_DIRECTORY_UPGRADE_REVIEW",
  raw: { path: rawFile, sha256: sha(rawFile) }, checks: [], realModelRequests: 0, productChanges: 0 };
function check(name, fn) {
  try { report.checks.push({ name, status: "PASS", evidence: fn() }); }
  catch (e) { report.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
check("six-original-business-flows-and-three-additional-profile-flows", () => {
  assert.equal(r.status, "PASS"); assert.equal(r.cleanupStatus, "PASS");
  assert.equal(r.steps.length, 6); assert(r.steps.every(s => s.status === "PASS"));
  assert.equal(r.profileUpgradeCases.length, 3); assert(r.profileUpgradeCases.every(s => s.status === "PASS"));
  assert.equal(r.productChanges, 0); assert.equal(r.modelRequests, 0); assert.deepEqual(r.errors, []);
  assert.equal(read(path.join(c.out, "InstallOld.json")).actualVersion, c.oldVersion);
  assert.equal(read(path.join(c.out, "InstallNew.json")).actualVersion, c.version);
  assert(Date.parse(r.profileUpgradeCases[0].finishedAt) < Date.parse(r.steps[3].at));
  return { originalFlows: 6, profileFlows: 3 };
});
check("original-inquiry-creation-and-image-component-exact-content", () => {
  const before = read(path.join(c.out, "profile-old-records.json"));
  assert.equal(before.conversations.length, 2); assert.equal(before.components.length, 1);
  assert.deepEqual(before.conversations.map(s => s.mode).sort(), ["creation", "inquiry"]);
  assert.equal(new Set(before.conversations.map(s => s.projectId)).size, 1);
  const image = path.join(c.out, "升级依赖.png"), asset = before.components[0].assets[0];
  assert.equal(asset.sha256, sha(image)); assert.equal(asset.byteLength, fs.statSync(image).size);
  assert(before.components[0].html.includes(asset.id));
  assert(before.components[0].html.includes('data-action="open_about"'));
  for (const phase of ["new", "restart"]) {
    const after = read(path.join(c.out, `profile-${phase}-records.json`));
    assert.deepEqual(normalize(after.conversations), normalize(before.conversations));
    assert.deepEqual(after.components, before.components);
  }
  return { conversations: 2, components: 1, dependency: { path: image, sha256: sha(image) }, phases: 3 };
});
check("controlled-model-two-submissions-and-no-upgrade-resubmission", () => {
  assert.equal(r.controlledProfileSubmissions.length, 2); assert.equal(r.profileModelRequests.length, 2);
  assert.equal(r.controlledProfileSubmissions[0].path, "/api/assistant/chat_stream");
  assert.equal(r.controlledProfileSubmissions[1].path, "/api/assistant/creation/processes");
  assert.equal(r.profileModelRequests[0].marker, "HISTORY_A");
  assert.equal(r.profileModelRequests[0].creation, false); assert.equal(r.profileModelRequests[0].tools.length, 0);
  assert.equal(r.profileModelRequests[1].marker, "QUEUE_A"); assert.equal(r.profileModelRequests[1].creation, true);
  assert.equal(r.profileProviderCleanup.stopped, true); assert.equal(r.profileProviderCleanup.requests, 2);
  return { controlledRequests: 2, paidRequests: 0, resubmission: 0 };
});
check("three-actual-window-closes-and-strict-native-screenshots", () => {
  assert.equal(r.launches.length, 3); assert.equal(r.cleanups.length, 3);
  for (const l of r.launches) {
    const receipt = read(path.join(c.out, l.label + "-close-completed.json"));
    assert.equal(receipt.pid, l.pid); assert.equal(receipt.method, "Computer Use Alt+F4");
    assert(r.cleanups.some(s => s.label === l.label && s.normalClose && s.status === "PASS" && s.killed.length === 0));
    assert.equal(l.defaultDataPath, true); assert.equal(l.defaultWebViewPath, true);
    assert.equal(l.manualBackendSpawn, false);
  }
  assert(r.screenshots.length >= 13);
  for (const shot of r.screenshots) {
    const p = shot.path || shot.file, png = fs.readFileSync(p);
    assert.equal(sha(p), shot.sha256);
    assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
  }
  return { normalCloses: 3, screenshots: r.screenshots.length,
    matrixLimit: "1080p DPR1 normal only; not full display matrix" };
});
check("preserved-workflow-review-and-retained-profile-cleanup", () => {
  const basic = read(path.join(c.out, "audit-01.json"));
  assert.equal(basic.status, "PASS"); assert.equal(basic.checks.length, 4);
  assert(basic.checks.every(v => v.status === "PASS"));
  assert.equal(basic.source.sha256, sha(rawFile));
  const cleanup = read(path.join(c.out, "retained-cleanup-01.json"));
  assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.deletedUserFiles, 0);
  return { originalAudit: { path: path.join(c.out, "audit-01.json"), sha256: sha(path.join(c.out, "audit-01.json")) },
    cleanup: { path: path.join(c.out, "retained-cleanup-01.json"), sha256: sha(path.join(c.out, "retained-cleanup-01.json")) } };
});
report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
const target = path.join(c.out, "profile-audit-01.json");
fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks, target }));
if (report.status !== "PASS") process.exitCode = 1;
