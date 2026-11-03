"use strict";
// Reuse completed APKs after the original QA mistook Gradle outputs for source.
// Never rewrites the original FAILED build report or starts another build.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence, verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Android-Exit-20261024-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const same = f => assert.equal(fileEvidence(f.path).sha256, f.sha256, f.path);
function generatedAndroidOutput(relative) {
  const name = relative.replaceAll("\\", "/");
  if (path.isAbsolute(relative) || name.split("/").includes("..")) return false;
  return /^GameCli_framework\/vendor\/tauri-plugin-fs\/android\/(?:build\/|\.tauri\/tauri-api\/build\/)/.test(name);
}
function main() {
  const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
  const buildRoot = path.resolve(base, "apk-build-" + attempt);
  const out = path.resolve(base, "apk-build-audit-" + attempt);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "AUDIT_COMPLETED_APKS_NOT_NEW_BUILD_OR_DEVICE_PASS", differences: [], modelRequests: 0 };
  try {
    const prepFile = path.join(buildRoot, "preparation.json"), p = read(prepFile);
    const buildFile = path.join(buildRoot, "build-report.json"), b = read(buildFile);
    const adminFile = path.join(buildRoot, "administrator.json"), admin = read(adminFile);
    assert.equal(b.status, "FAILED"); assert(b.finishedAt && admin.finishedAt);
    assert.match(b.error, /validatePrepared/); assert.match(b.restorationError, /validatePrepared/);
    assert.equal(admin.isElevated, true);
    assert(admin.permission.success && admin.permission.isElevated);
    assert(!rows().some(n => (n.ProcessId === admin.processId && n.Created === admin.created)
      || (n.ProcessId === admin.nodePid && n.Created === admin.nodeCreated)));
    assert.equal(p.sources.length, p.copies.length); assert(p.sources.length > 100);
    for (const f of [...p.sources, ...p.tools, p.prerequisites.build, p.prerequisites.native,
      ...p.prerequisites.frozen]) same(f);
    for (let i = 0; i < p.sources.length; i++) {
      const original = p.sources[i], copy = p.copies[i];
      const relative = path.relative(path.resolve(__dirname, ".."), original.path);
      assert.equal(path.resolve(copy.path), path.resolve(p.workspace, relative));
      assert.equal(copy.sha256, original.sha256);
      const actual = fileEvidence(copy.path);
      if (actual.sha256 !== copy.sha256) {
        r.differences.push({ relative, expected: copy.sha256, actual });
        assert(generatedAndroidOutput(relative), "Changed non-generated source: " + relative);
      }
    }
    assert(r.differences.length > 0, "Must explain the original mismatch");
    assert.equal(b.cells.length, 2);
    assert.deepEqual(b.cells.map(c => c.layout), ["agentvn", "renpy"]);
    for (const c of b.cells) {
      assert.equal(c.status, "PASS"); assert.equal(c.exitCode, 0); assert(c.finishedAt);
      [c.cartridge, c.apk, c.provenance, c.manifest, ...c.signingReports].forEach(same);
      assert.equal(read(c.manifest.path).status, "PASS");
      assert.equal(verifyProvenance(c.apk.path, read(c.provenance.path)).status, "PASS");
      assert.equal(read(c.provenance.path).sourceCartridge.sha256, c.cartridge.sha256);
      assert.equal(c.signingReports.length, 1); assert.equal(read(c.signingReports[0].path).signed, true);
    }
    r.build = fileEvidence(buildFile); r.preparation = fileEvidence(prepFile);
    r.administrator = fileEvidence(adminFile); r.tool = fileEvidence(__filename);
    r.counts = { originalFilesUnchanged: p.sources.length, cloneFilesChecked: p.copies.length,
      generatedCloneDifferences: r.differences.length, completedApks: 2 };
    r.status = "APKS_VERIFIED_ORIGINAL_QA_FAILURE_PRESERVED";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, out, counts: r.counts, error: r.error }));
}
if (require.main === module) main();
module.exports = { generatedAndroidOutput };
