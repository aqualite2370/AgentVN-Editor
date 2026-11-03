"use strict";
// A current candidate must follow its real installation and terminal build
// audit. A version string alone cannot promote historical or foreign evidence.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { validate } = require("../installed-windows-native-ui-current-audit.cjs");
const qa = path.resolve("F:/AgentVN/QA");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function bounded(file) {
  const relative = path.relative(qa, path.resolve(file));
  assert(relative && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..",
    "Candidate evidence must be inside the QA root");
}
function loadNativeSource(sourceFile, auditFile) {
  bounded(sourceFile); bounded(auditFile);
  const source = read(sourceFile), audit = read(auditFile);
  assert.equal(audit.status, "PASS"); assert.equal(audit.source.sha256, sha(sourceFile));
  assert.equal(path.resolve(audit.source.path), path.resolve(sourceFile));
  assert.equal(audit.groups.length, 6); assert(audit.groups.every(g => g.status === "PASS"));
  let options = {}, candidateBinding, validateSource = validate;
  if (audit.candidateBinding) {
    const record = audit.candidateBinding; bounded(record.path);
    assert.equal(sha(record.path), record.sha256);
    const binding = read(record.path), config = binding.config;
    if (config.nativeAutomation !== undefined) {
      assert.equal(config.nativeAutomation, "repository-native-v1");
      validateSource = require("../installed-windows-repository-native-audit.cjs").validate;
    }
    assert.equal(binding.status, "PREPARED_NOT_PRODUCT_TESTED");
    assert.equal(path.resolve(binding.out), path.dirname(path.resolve(sourceFile)));
    for (const f of binding.sources) assert.equal(sha(f.path), f.sha256, f.path);
    assert.deepEqual(source.bindingSources, binding.sources.slice(0, 3));
    bounded(config.actualInstallation.path);
    assert.deepEqual(record.actualInstallation, config.actualInstallation);
    assert.equal(sha(config.actualInstallation.path), config.actualInstallation.sha256);
    const actual = read(config.actualInstallation.path);
    assert.equal(actual.status, "PASS"); assert.equal(actual.exitCode, 0); assert(actual.registryRestored);
    assert.equal(sha(actual.installer.path), config.installerSHA256);
    assert.equal(sha(actual.executable.path), actual.executable.sha256);
    const sealed = read(source.installation.path);
    assert.equal(sealed.version, config.version);
    assert.deepEqual(sealed.executable, actual.executable);
    assert.equal(path.resolve(sealed.installRoot), path.resolve(actual.installRoot));
    assert.equal(sha(source.installation.path), source.installation.sha256);
    options = { editorVersion: config.version, environmentCacheRedirected: false };
    if (binding.upgradeFixture) {
      const expected = require("./windows-upgrade-fixture-policy.cjs").fixtureFor(config);
      assert.deepEqual(binding.upgradeFixture, expected);
      options.expectedUpgradeFixture = expected;
    }
    candidateBinding = record;
  }
  validateSource(source, options);
  for (const f of [source.windowsPortable, source.windowsInstaller, ...source.protectedFiles])
    assert.equal(sha(f.path), f.sha256, f.path);
  return { source, audit, options, editorVersion: options.editorVersion || "1.9.22",
    ...(candidateBinding ? { candidateBinding } : {}) };
}
function validatePortablePreparation(prep) {
  assert.equal(prep.status, "PASS");
  assert.equal(prep.scope, "ACTUAL_INSTALLED_EDITOR_GENERATED_WINDOWS_PORTABLE");
  assert.equal(prep.nativeUIBuildSource, true);
  assert.equal(sha(prep.sourceReport.path), prep.sourceReport.sha256);
  assert.equal(sha(prep.sourceAudit.path), prep.sourceAudit.sha256);
  const context = loadNativeSource(prep.sourceReport.path, prep.sourceAudit.path);
  assert.equal(prep.editorVersion, context.editorVersion);
  assert(context.candidateBinding, "An explicit current candidate binding is required");
  assert.deepEqual(prep.nativeCandidateBinding, context.candidateBinding);
  assert.equal(prep.executable.sha256, context.source.windowsPortable.sha256);
  assert.equal(sha(prep.executable.path), prep.executable.sha256);
  return context;
}
function validateRetained1924Source(source) {
  const files = [
    ["editor-05/report.json", "3ea19fb4aec99169f078e3c9ca4df916e296e8aef6a588fb332e612c3f279a33"],
    ["native-ui-audit-04/report.json", "1e7b522a1a10468cf48c0aa957bfcc1919bc9d074aaaede83692f64e6f9ad428"],
    ["setup-payload-audit-04/report.json", "f642a22c822f988d280b6c42481e42834770900ebc57ee8e554eca86a8e2df94"],
  ].map(([relative, sha256]) => ({ path: path.join(qa, "Windows-Package-20261021-01", relative), sha256 }));
  for (const file of files) assert.equal(sha(file.path), file.sha256);
  assert.deepEqual(source, read(files[0].path), "Require the exact retained release report");
  const fixture = require("./windows-1924-upgrade-fixture.cjs").expectedFixture();
  validate(source, { editorVersion: "1.9.24", expectedUpgradeFixture: fixture.current });
  assert.deepEqual(source.priorUpgradeFixture, fixture.previous);
  const audit = read(files[1].path), payload = read(files[2].path);
  assert.equal(audit.status, "PASS"); assert.equal(audit.groups.length, 6);
  assert(audit.groups.every(group => group.status === "PASS"));
  assert.equal(audit.source.sha256, files[0].sha256);
  assert.equal(payload.status, "PASS"); assert.equal(payload.source.sha256, files[0].sha256);
  assert.equal(payload.buildAudit.sha256, files[1].sha256);
  assert.equal(payload.pe.fileVersion, "1.0.2");
  assert.equal(payload.gameId, source.projectId);
  assert.equal(payload.installer.sha256, source.windowsInstaller.sha256);
  for (const file of [source.windowsInstaller, source.windowsPortable, payload.executable, ...payload.resources])
    assert.equal(sha(file.path), file.sha256);
  return { version: "1.9.24", gameVersion: "1.0.2", files };
}
function validateRetained1934Source(source) {
  const files = [
    ["editor-16/report.json", "a4989f7f168878e50d5f4f0f798e56283b0228b0fed0f4f5d1c1b932060d62b7"],
    ["native-ui-audit-07/report.json", "4e1158ec4d92e58d37ccdc2e568c34661391d68beb8b51aee0af485c157446af"],
    ["setup-payload-audit-07/report.json", "22a816f4cb29bb6a168ddd5ef51d4510e327d201fd4b288ca481391bbad5aaed"],
  ].map(([relative, sha256]) => ({ path: path.join(qa, "Windows-Package-20261021-01", relative), sha256 }));
  for (const file of files) assert.equal(sha(file.path), file.sha256);
  const context = loadNativeSource(files[0].path, files[1].path);
  assert.deepEqual(source, context.source);
  assert.equal(context.editorVersion, "1.9.34");
  const payload = read(files[2].path);
  assert.equal(payload.status, "PASS"); assert.equal(payload.source.sha256, files[0].sha256);
  assert.equal(payload.buildAudit.sha256, files[1].sha256);
  assert.deepEqual(payload.candidateBinding, context.candidateBinding);
  assert.equal(payload.pe.fileVersion, "1.0.3"); assert.equal(payload.gameId, source.projectId);
  assert.equal(payload.installer.sha256, source.windowsInstaller.sha256);
  for (const file of [source.windowsInstaller, source.windowsPortable, payload.executable, ...payload.resources])
    assert.equal(sha(file.path), file.sha256);
  return { version: "1.9.34", gameVersion: "1.0.3", files, candidateBinding: context.candidateBinding };
}
module.exports = { loadNativeSource, validatePortablePreparation, validateRetained1924Source, validateRetained1934Source };
if (require.main === module) {
  assert.equal(process.argv[2], "portable-preparation");
  validatePortablePreparation(read(process.argv[3]));
  console.log("PASS: exact installed candidate and exported portable provenance");
}
