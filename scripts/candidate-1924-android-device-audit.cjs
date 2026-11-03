"use strict";
// Independent device audit bound to the task17 package audit, not old APK hashes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module"), vm = require("node:vm");
const original = path.join(__dirname, "android-native-upgrade-runtime-audit.cjs");
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
assert.equal(hash(original), "d257e2d5244b311b7f733ebc83f7551f7b889b3b7312b4207ca709e85ad06b60");
function validateSources({ owner, runtime, request, packageAudit, build }) {
  assert.equal(packageAudit.status, "APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN");
  assert.equal(packageAudit.checks.length > 0, true);
  assert(packageAudit.checks.every(c => c.status === "PASS"));
  assert.equal(build.status, "PASS"); assert.equal(build.version, "1.9.24");
  assert.equal(build.builds, 1); assert.equal(build.normalUIExportStatus, "PASS_NATIVE_UI");
  assert(build.normalClose && build.finishedAt); assert.equal(build.steps.length, 4);
  assert(build.steps.every(s => s.status === "PASS"));
  assert.equal(owner.sourcePublishingWorkflow.publishingWorkflowStatus, "PASS");
  assert.equal(request.upgradePair.current.versionName, "0.1.2");
  assert.equal(request.upgradePair.current.versionCode, 1002);
  assert.deepEqual(request.upgradePair, {
    old: packageAudit.upgradePair.old, current: packageAudit.upgradePair.current,
  });
  assert.equal(runtime.sourceApks.current.sha256, packageAudit.upgradePair.currentApk.sha256);
  assert.equal(runtime.sourceApks.current.sha256, request.apk.sha256);
  assert.equal(build.artifacts.filter(a => a.kind === "android_apk").length, 1);
  assert.equal(build.artifacts.find(a => a.kind === "android_apk").sha256, request.apk.sha256);
  assert.equal(runtime.sourceApks.old.sha256, request.oldApk.sha256);
}
function adapt(input) {
  let source = input;
  const replacements = [
    ['"device-upgrade-12-"', '"device-upgrade-17-"'],
    ["`device-upgrade-audit-12-${device}-${audit}`", "`device-upgrade-audit-17-${device}-${audit}`"],
    ['      assert.equal(owner.sourcePublishingWorkflow.normalCloseStatus, "FAILED");\n' +
      '      assert.equal(owner.sourcePublishingWorkflow.publishingWorkflowStatus, "FAILED");',
      '      const packageAudit = load(request.packageAudit.path);\n' +
      '      const build = load(path.join(root, "editor-17/report.json"));\n' +
      '      assert.equal(fileEvidence(request.packageAudit.path).sha256, request.packageAudit.sha256);\n' +
      '      module.validateSources({ owner, runtime, request, packageAudit, build });'],
    ['      assert.equal(runtime.sourceApks.current.sha256, "118f2efe1ffedd860d444e704e23904e1295559f5a0d6d8bf8eb61a46511a8e0");',
      '      assert.equal(runtime.sourceApks.current.sha256, request.apk.sha256);'],
    ['normalClose: "FAILED_RETAINED"', 'normalClose: "PASS_CURRENT_TASK17"'],
    ['    const owner = load(path.join(source, "report.json"));',
      '    for (const [name, text] of [["executed-audit.cjs", module.auditSource], ["adapter.cjs", fs.readFileSync(__filename, "utf8")]]) {\n' +
      '      const file = path.join(output, name); fs.writeFileSync(file, text, { flag: "wx" }); result.sources.push(fileEvidence(file));\n' +
      '    }\n    const owner = load(path.join(source, "report.json"));'],
    ["if (require.main === module)", "if (module.qaRun)"],
  ];
  for (const [before, after] of replacements) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after);
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  return source;
}
const input = fs.readFileSync(original, "utf8"), source = adapt(input);
if (process.argv[2] === "--self-test") {
  const current = { versionName: "0.1.2", versionCode: 1002 }, old = { versionName: "0.1.0", versionCode: 1000 };
  const fixture = {
    owner: { sourcePublishingWorkflow: { publishingWorkflowStatus: "PASS" } },
    runtime: { sourceApks: { current: { sha256: "current" }, old: { sha256: "old" } } },
    request: { upgradePair: { old, current }, apk: { sha256: "current" }, oldApk: { sha256: "old" } },
    packageAudit: { status: "APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN", checks: [{ status: "PASS" }],
      upgradePair: { old, current, currentApk: { sha256: "current" } } },
    build: { status: "PASS", version: "1.9.24", builds: 1, normalUIExportStatus: "PASS_NATIVE_UI",
      normalClose: {}, finishedAt: "unit-test", steps: Array.from({ length: 4 }, () => ({ status: "PASS" })),
      artifacts: [{ kind: "android_apk", sha256: "current" }] },
  };
  validateSources(fixture);
  const invalid = [
    x => x.packageAudit.status = "FAILED", x => x.packageAudit.checks = [],
    x => x.build.status = "FAILED", x => x.build.builds = 2, x => delete x.build.normalClose,
    x => x.build.steps = [], x => x.build.artifacts[0].sha256 = "other",
    x => x.request.upgradePair.current.versionCode = 1001,
    x => x.request.upgradePair.current.versionName = "0.1.1",
    x => x.runtime.sourceApks.current.sha256 = "other", x => x.owner.sourcePublishingWorkflow.publishingWorkflowStatus = "FAILED",
  ];
  for (const mutate of invalid) {
    const value = structuredClone(fixture); mutate(value);
    assert.throws(() => validateSources(value));
  }
  for (const before of ['"device-upgrade-12-"', "if (require.main === module)"])
    assert.throws(() => adapt(input.replace(before, "SOURCE_DRIFT")));
  console.log(JSON.stringify({ status: "PASS", invalidSourceReceiptsRejected: invalid.length,
    sourceDriftRejected: 2, deviceOperations: 0, launches: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2), ["01", "01"]);
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  Object.assign(worker, { qaRun: true, validateSources, auditSource: source });
  worker._compile(source, __filename);
}
