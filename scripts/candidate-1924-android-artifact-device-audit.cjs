"use strict";
// Device evidence from an audited APK must not turn the failed Editor close green.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module"), vm = require("node:vm");
const { validateArtifactTerminal } = require("./lib/android-artifact-terminal.cjs");
const original = path.join(__dirname, "android-native-upgrade-runtime-audit.cjs");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(hash(original), "d257e2d5244b311b7f733ebc83f7551f7b889b3b7312b4207ca709e85ad06b60");
function validateSources({ owner, runtime, request, packageAudit, build, admin, task }) {
  assert.equal(packageAudit.status, "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN");
  assert.equal(packageAudit.checks.length, 5);
  assert(packageAudit.checks.every(check => check.status === "PASS"));
  const failedPublishing = validateArtifactTerminal({ build, admin, task });
  assert.deepEqual(packageAudit.publishingWorkflow, failedPublishing);
  assert.deepEqual(owner.sourcePublishingWorkflow, failedPublishing);
  assert.equal(build.version, "1.9.24"); assert.equal(build.modelRequests, 0);
  assert.equal(build.productChanges, 0); assert.deepEqual(build.errors, []);
  assert.equal(request.upgradePair.current.versionName, "0.1.2");
  assert.equal(request.upgradePair.current.versionCode, 1002);
  assert.deepEqual(request.upgradePair, { old: packageAudit.upgradePair.old, current: packageAudit.upgradePair.current });
  assert.equal(runtime.sourceApks.current.sha256, packageAudit.upgradePair.currentApk.sha256);
  assert.equal(runtime.sourceApks.current.sha256, request.apk.sha256);
  assert.equal(build.artifacts.length, 1); assert.equal(build.artifacts[0].kind, "android_apk");
  assert.equal(build.artifacts[0].sha256, request.apk.sha256);
  assert.equal(runtime.sourceApks.old.sha256, request.oldApk.sha256);
}
function adapt(input) {
  let source = input;
  for (const [before, after] of [
    ['"device-upgrade-12-"', '"device-upgrade-17-"'],
    ["`device-upgrade-audit-12-${device}-${audit}`", "`device-upgrade-audit-17-${device}-${audit}`"],
    ['      assert.equal(owner.sourcePublishingWorkflow.normalCloseStatus, "FAILED");\n' +
      '      assert.equal(owner.sourcePublishingWorkflow.publishingWorkflowStatus, "FAILED");',
      '      const packageAudit = load(request.packageAudit.path);\n' +
      '      const build = load(path.join(root, "editor-17/report.json"));\n' +
      '      const admin = load(path.join(root, "administrator-17/result.json"));\n' +
      '      const task = load(path.join(root, "administrator-17/task-engine.json"));\n' +
      '      assert.equal(fileEvidence(request.packageAudit.path).sha256, request.packageAudit.sha256);\n' +
      '      module.validateSources({ owner, runtime, request, packageAudit, build, admin, task });'],
    ['      assert.equal(runtime.sourceApks.current.sha256, "118f2efe1ffedd860d444e704e23904e1295559f5a0d6d8bf8eb61a46511a8e0");',
      '      assert.equal(runtime.sourceApks.current.sha256, request.apk.sha256);'],
    ['    const owner = load(path.join(source, "report.json"));',
      '    for (const [name, text] of [["executed-audit.cjs", module.auditSource], ["adapter.cjs", fs.readFileSync(__filename, "utf8")]]) {\n' +
      '      const file = path.join(output, name); fs.writeFileSync(file, text, { flag: "wx" }); result.sources.push(fileEvidence(file));\n' +
      '    }\n    const owner = load(path.join(source, "report.json"));'],
    ["if (require.main === module)", "if (module.qaRun)"],
  ]) {
    assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, after);
  }
  new vm.Script(Module.wrap(source), { filename: __filename }); return source;
}
const input = fs.readFileSync(original, "utf8"), source = adapt(input);
if (process.argv[2] === "--self-test") {
  const error = "Error: Timeout Computer Use normal Editor close: not ready\ncontrolled";
  const current = { versionName: "0.1.2", versionCode: 1002 }, old = { versionName: "0.1.0", versionCode: 1000 };
  const failedPublishing = { artifactBuildStatus: "PASS", normalCloseStatus: "FAILED",
    publishingWorkflowStatus: "FAILED", cleanupMode: "ATTRIBUTED_FORCED_CLEANUP" };
  const good = {
    owner: { sourcePublishingWorkflow: failedPublishing },
    runtime: { sourceApks: { current: { sha256: "current" }, old: { sha256: "old" } } },
    request: { upgradePair: { old, current }, apk: { sha256: "current" }, oldApk: { sha256: "old" } },
    packageAudit: { status: "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN",
      checks: Array.from({ length: 5 }, () => ({ status: "PASS" })),
      publishingWorkflow: failedPublishing, upgradePair: { old, current, currentApk: { sha256: "current" } } },
    build: { status: "FAILED", finishedAt: "terminal", stage: "WAIT_NATIVE_EDITOR_CLOSE", error,
      steps: [{ status: "PASS" }, { status: "PASS" }, { status: "PASS" },
        { label: "Normal native elevated Editor close", status: "FAILED", error }],
      builds: 1, featureStatus: "PASS", normalUIExportStatus: "PASS_NATIVE_UI", protectedUnchanged: true,
      cleanups: [{ status: "PASS", normalCloseClaimed: false, killed: ["owned"] }],
      version: "1.9.24", modelRequests: 0, productChanges: 0, errors: [],
      artifacts: [{ kind: "android_apk", sha256: "current" }] },
    admin: { finishedAt: "terminal", isElevated: true, probe: { isElevated: true, success: true },
      exitCode: 1, error: null, policyRestoration: "PASS", physicalProtectionRestoration: "PASS" },
    task: { status: "TERMINAL", cleanup: "PASS", finishedAt: "terminal" },
  };
  validateSources(good);
  const invalid = [
    v => v.packageAudit.status = "FAILED", v => v.packageAudit.checks = [],
    v => v.packageAudit.checks[0].status = "FAILED", v => v.build.status = "PASS",
    v => v.build.steps[0].status = "FAILED", v => v.build.steps[3].status = "PASS",
    v => v.build.artifacts[0].sha256 = "different", v => v.runtime.sourceApks.current.sha256 = "different",
    v => v.request.upgradePair.current.versionCode = 1001, v => v.request.upgradePair.current.versionName = "0.1.1",
    v => v.admin.isElevated = false, v => v.task.cleanup = "FAILED",
    v => v.owner.sourcePublishingWorkflow = { ...failedPublishing, normalCloseStatus: "PASS" },
    v => v.packageAudit.publishingWorkflow = { ...failedPublishing, publishingWorkflowStatus: "PASS" },
  ];
  for (const mutate of invalid) { const value = structuredClone(good); mutate(value); assert.throws(() => validateSources(value)); }
  assert.throws(() => adapt(input.replace('"device-upgrade-12-"', "SOURCE_DRIFT")));
  console.log(JSON.stringify({ status: "PASS", invalidSourceReceiptsRejected: invalid.length,
    sourceDriftRejected: 1, normalClose: "FAILED_RETAINED", deviceOperations: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2), ["03", "01"]);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  Object.assign(worker, { qaRun: true, validateSources, auditSource: source }); worker._compile(source, __filename);
}
