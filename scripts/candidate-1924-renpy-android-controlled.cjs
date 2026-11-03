"use strict";
// Supplemental native-builder evidence. The normal picker and close gates stay
// blocked/failed; this is never reported as a complete normal publish workflow.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
const base = "F:/AgentVN/QA/Android-Package-20261021-01";
const original = path.join(base, "editor-18/executed-business.cjs");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const audit = read(path.join(base, "renpy-export-18-audit-01/report.json"));
assert.equal(audit.status, "EXPORT_EVIDENCE_PASS_ANDROID_BLOCKED_NATIVE_INPUT");
assert.equal(audit.groups.length, 4); assert(audit.groups.every(group => group.status === "PASS"));
assert.equal(hash(fs.readFileSync(audit.export.sourceReport.path)), audit.export.sourceReport.sha256);
assert.equal(read(audit.export.sourceReport.path).builds, 0, "Do not duplicate an APK build");
function adapt(input = fs.readFileSync(original)) {
  assert.equal(hash(input), "12273257b27fdbd6879630978865a0f393f128f4cc985bd57ff3339f382a1636");
  let source = input.toString("utf8"); const changes = [];
  function replace(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); changes.push({ before, after, count });
  }
  replace('assert.equal(attempt, "18");', 'assert.equal(attempt, "19");');
  replace("candidate-1924-renpy-android-cache.ps1", "candidate-1924-renpy-android-controlled-cache.ps1", 2);
  const start = '  if (nativeUpgrade) {\n    await step("Real Android publish UI, native picker and one elevated APK build",';
  const end = '  await step("Actual native upload and installed Android builder with real elevation, not source or picker",';
  assert.equal(source.split(start).length - 1, 1);
  assert.equal(source.split(end).length - 1, 1);
  const before = source.slice(source.indexOf(start), source.indexOf(end));
  assert(before.endsWith("  }\n"));
  replace(before,
    '  report.scope = "SUPPLEMENTAL_INSTALLED_UI_EXPORT_CONTROLLED_NATIVE_ANDROID_BUILD_NOT_NORMAL_PUBLISH";\n' +
    '  report.normalUIExportStatus = "BLOCKED_PRIOR_NATIVE_PICKER"; report.currentNativeUI = false;\n' +
    '  report.boundaries = { nativePicker: false, normalEditorClose: false, device: false, fullAcceptance: false };\n' +
    '  report.priorExportAudit = ' + JSON.stringify({ path: path.join(base, "renpy-export-18-audit-01/report.json"),
      sha256: hash(fs.readFileSync(path.join(base, "renpy-export-18-audit-01/report.json"))) }) + ';\n');
  replace('androidApplicationId: "com.agentvn.qa.androidcurrent20261021"', "androidApplicationId: upgrade.applicationId");
  replace('report.modelRequests, 0); unchanged(); report.status = "PASS";',
    'report.modelRequests, 0); unchanged(); report.status = "PASS_SUPPLEMENTAL_NATIVE_BUILD_NOT_NORMAL_PUBLISH";');
  new vm.Script(Module.wrap(source), { filename: __filename });
  return { source, changes };
}
if (process.argv[2] === "--self-test") {
  const adapted = adapt();
  for (const bad of [Buffer.from("wrong"), Buffer.concat([fs.readFileSync(original), Buffer.from("\n")])])
    assert.throws(() => adapt(bad));
  console.log(JSON.stringify({ status: "PASS", transformations: adapted.changes.length,
    sourceDriftRejected: 2, originalBuilds: 0, priorExportAuditGroups: 4, productLaunches: 0, apkBuilds: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2), ["19", "--physical-package-cache", "--physical-environment-cache",
    "--administrator-launch=F:\\AgentVN\\QA\\Android-Package-20261021-01\\administrator-19", "--native-upgrade"]);
  const adapted = adapt(), worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  Object.assign(worker, { qaSource: adapted.source, qaChanges: adapted.changes });
  worker._compile(adapted.source, __filename);
}
