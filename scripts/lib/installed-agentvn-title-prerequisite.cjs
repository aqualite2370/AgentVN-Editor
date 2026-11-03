"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha256 } = require("./installed-acceptance.cjs");
const { validateDefaultTitleInput } = require("./agentvn-default-title.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
function checked(item) {
  assert(item?.path && item.sha256, "Hashed evidence required");
  assert.equal(sha256(fs.readFileSync(item.path)), item.sha256, `Evidence changed: ${item.path}`);
  return item.path;
}
function validateInstalledDefaultTitle(file, { auditFile, fixture }) {
  const r = read(file), audit = read(auditFile);
  assert.equal(r.status, "INSTALLED_AGENTVN_DEFAULT_TITLE_WINDOWS_PASS");
  assert.equal(r.fixture.projectId, fixture.projectId);
  assert.equal(fixture.layoutType, "agentvn"); assert.equal(r.fixture.layoutSource, "absent-project-default");
  assert.equal(r.fixtureEvidence.sha256, sha256(fs.readFileSync(checked(r.fixtureEvidence))));
  assert.equal(read(r.fixtureEvidence.path).sha256, fixture.sha256);
  assert.equal(sha256(fs.readFileSync(fixture.input)), fixture.sha256);
  assert.equal(audit.status, "PASS");
  const installed = audit.deployments.filter(d => d.kind === "NSIS actual isolated installation");
  assert.equal(installed.length, 1);
  assert.equal(path.resolve(r.installRoot), path.resolve(installed[0].installedRoot));
  assert.equal(path.resolve(checked(r.executable)), path.resolve(path.join(r.installRoot, "agentvn-editor.exe")));
  assert.equal(r.executable.sha256, installed[0].executable.sha256);
  assert.equal(checked(r.installationAudit), path.resolve(auditFile));
  assert.equal(r.editorCleanup.editor.exitCode, 0); assert.equal(r.editorCleanup.backend.exitCode, 0);
  assert.deepEqual(r.errors, []);
  assert(r.resources.length >= 5);
  for (const resource of r.resources) {
    checked(resource.source); checked(resource.installed);
    assert.equal(resource.source.sha256, resource.installed.sha256);
    assert.equal(path.resolve(resource.installed.path), path.resolve(path.join(r.installRoot, resource.relative)));
  }
  const ui = read(checked(r.uiExport));
  assert.equal(ui.status, "RESULT_READY"); assert.match(ui.result, /Windows[\s\S]*构建成功/);
  assert(r.commands.some(c => c.name === "native-project-import" && c.exitCode === 0 && c.status === "PASS"));
  assert(r.commands.some(c => c.name === "windows-ui-export" && c.exitCode === 0 && c.status === "PASS"));
  checked(r.player);
  validateDefaultTitleInput(fixture, read(checked(r.cartridge.manifest)), read(checked(r.cartridge.layout)));
  assert.equal(r.cases.length, 12, "Exactly 12 native title combinations required");
  const keys = new Set();
  for (const row of r.cases) {
    assert.equal(row.status, "PASS"); assert.equal(row.cleanup.exitCode, 0);
    const v = row.viewport;
    assert([[1920, 1080], [2560, 1440], [3840, 2160]].some(([w, h]) => v.width === w && v.height === h));
    assert([1, 2].includes(v.dpr)); assert.equal(typeof v.reduced, "boolean");
    const key = JSON.stringify(v); assert(!keys.has(key), "Duplicate title combination"); keys.add(key);
    assert(row.viewportChecks.length >= 3);
    for (const sample of row.viewportChecks) assert.deepEqual(sample, v);
    assert.equal(row.metrics.text, fixture.title); assert.equal(row.metrics.color, "rgb(246, 248, 255)");
    assert.equal(row.metrics.renpyCount, 0); assert(row.contrast >= 3 && Number.isFinite(row.contrast));
    assert.equal(row.screenshots.length, 3, "Title/return/playing evidence required");
    for (const shot of row.screenshots) {
      const png = fs.readFileSync(checked(shot));
      assert.deepEqual(shot.before, v); assert.deepEqual(shot.after, v);
      assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
      assert.equal(png.readUInt32BE(16), v.width * v.dpr);
      assert.equal(png.readUInt32BE(20), v.height * v.dpr);
    }
  }
  return { status: "VERIFIED_INSTALLED_AGENTVN_DEFAULT_TITLE_WINDOWS", currentInstallationVerified: true,
    scope: "Default-title/settings-return/start only, not full-story or Android", matrix: keys.size,
    installRoot: r.installRoot, player: r.player };
}
module.exports = { validateInstalledDefaultTitle };
