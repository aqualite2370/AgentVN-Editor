"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha256 } = require("./installed-acceptance.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
function checked(evidence) {
  assert.equal(sha256(fs.readFileSync(evidence.path)), evidence.sha256, `Evidence SHA hash changed: ${evidence.path}`);
  return evidence.path;
}
function validateWindowsPrerequisite(file, { auditFile, fixture }) {
  const report = read(file);
  if (report.status === "INSTALLED_PORTABLE_SAVE_FLOW_PASS")
    return { status: "HISTORICAL_PORTABLE_SAVE_SCOPE_ONLY", currentInstallationVerified: false,
      evidenceStatus: report.status };
  assert.equal(report.status, "INSTALLED_CURRENT_WINDOWS_PASS", "Unsupported or unfinished Windows proof");
  assert.equal(report.fixture.projectId, fixture.projectId, "Different project");
  const actual = read(auditFile);
  assert.equal(actual.status, "PASS");
  const installations = actual.deployments.filter(d => d.kind === "NSIS actual isolated installation");
  assert.equal(installations.length, 1);
  const installed = installations[0];
  assert.equal(path.resolve(report.installRoot), path.resolve(installed.installedRoot), "Different installation");
  assert.equal(path.resolve(report.executable.path),
    path.resolve(path.join(installed.installedRoot, "agentvn-editor.exe")), "Different installation executable");
  checked(report.executable);
  assert.equal(report.executable.sha256, installed.executable.sha256, "Installation executable SHA differs");
  const previous = read(checked(report.installationAudit));
  const prior = previous.deployments.filter(d => d.kind === "NSIS actual isolated installation");
  assert.equal(previous.status, "PASS"); assert.equal(prior.length, 1);
  assert.equal(path.resolve(prior[0].installedRoot), path.resolve(installed.installedRoot), "Different installation audit");
  assert.equal(prior[0].executable.sha256, installed.executable.sha256);
  assert.equal(report.editorCleanup.editor.exitCode, 0, "Editor cleanup failed");
  assert.equal(report.editorCleanup.backend.exitCode, 0, "Backend cleanup failed");
  assert.deepEqual(report.errors, []);
  assert.equal(report.cases.length, 12, "Exactly 12 native matrix combinations required");
  const keys = new Set(), players = new Set();
  for (const row of report.cases) {
    assert.equal(row.status, "PASS");
    assert([[1920, 1080], [2560, 1440], [3840, 2160]].some(([w, h]) => row.width === w && row.height === h));
    assert([1, 2].includes(row.dpr)); assert.equal(typeof row.reduced, "boolean");
    const key = `${row.width}/${row.height}/${row.dpr}/${row.reduced}`;
    assert(!keys.has(key), `Duplicate matrix ${key}`); keys.add(key);
    const native = read(checked(row.report));
    assert.equal(native.status, "INSTALLED_FULL_STORY_RUNTIME_PASS");
    assert.equal(native.scope, "Actual installed-editor export; native player with WebView CDP viewport emulation");
    assert.deepEqual(native.viewport, { width: row.width, height: row.height, dpr: row.dpr, reduced: row.reduced });
    assert(native.cases.length > 0 && native.cases.every(c => c.status === "PASS"), "Empty/failed native flows");
    assert.equal(native.cleanupExitCode, 0, "Native cleanup failed"); assert.deepEqual(native.errors, []);
    assert(native.viewportChecks?.length > 0, "Actual viewport samples required, not requested DPR labels");
    for (const sample of native.viewportChecks) assert.deepEqual(sample, native.viewport, "Actual viewport changed during flow");
    assert.deepEqual(native.finalViewport, native.viewport, "Final viewport differs");
    assert(native.screenshots?.length > 0, "Native screenshot proof required");
    for (const shot of native.screenshots) {
      assert.deepEqual(shot.before, native.viewport, "Pre-capture viewport differs");
      assert.deepEqual(shot.after, native.viewport, "Post-capture viewport differs");
      const png = fs.readFileSync(checked(shot));
      assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Invalid PNG proof");
      assert.equal(png.readUInt32BE(16), row.width * row.dpr, "Actual screenshot device pixel width differs");
      assert.equal(png.readUInt32BE(20), row.height * row.dpr, "Actual screenshot device pixel height differs");
    }
    checked({ path: native.executable, sha256: native.executableSha256 });
    players.add(`${path.resolve(native.executable)}:${native.executableSha256}`);
  }
  assert.equal(players.size, 1, "Matrix must exercise one unchanged exported player");
  return { status: "VERIFIED_CURRENT_INSTALLED_WINDOWS", currentInstallationVerified: true,
    evidenceStatus: report.status, installRoot: installed.installedRoot, matrix: keys.size };
}
module.exports = { validateWindowsPrerequisite };
