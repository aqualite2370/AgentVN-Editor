"use strict";
// Separate artifact scope: retain the failed publishing/close result verbatim.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module"), vm = require("node:vm");
const { validateArtifactTerminal } = require("./lib/android-artifact-terminal.cjs");
const original = path.join(__dirname, "android-native-upgrade-package-audit.cjs");
const validatorFile = path.join(__dirname, "lib/android-upgrade-package-evidence.cjs");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(hash(original), "d797329c2b5c1cde913aca4e03cfd4c90b40d1cd80806eb73f767d29f908c55c");
assert.equal(hash(validatorFile), "6e3aac6771b120bbb246d78923abe7459b903cb6edba26eca06c45b056e37752");
assert.equal(hash(path.join(__dirname, "lib/android-artifact-terminal.cjs")),
  "40b6629edd9bfd934d920aab261caf3c04976876a400f97fc039be62782b5610");
function validateArtifact({ build, admin, origin, task, restored }) {
  const scope = validateArtifactTerminal({ build, admin, task });
  assert.equal(build.version, "1.9.24");
  assert.equal(build.currentNativeUI, true);
  assert.equal(build.modelRequests, 0); assert.equal(build.productChanges, 0);
  assert.equal(build.sourceBuilderInvocation, false); assert.deepEqual(build.errors, []);
  assert.equal(build.normalClose, undefined, "Do not manufacture a normal-close receipt");
  assert.equal(admin.status, "CHECK_EDITOR_REPORT"); assert.equal(admin.taskEngine, true);
  assert.equal(origin.originIsElevated, false); assert.equal(origin.taskEngine, true);
  assert.equal(origin.originProcessId, admin.originProcessId); assert.equal(origin.userSid, admin.userSid);
  assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
  assert.equal(restored.rows.length, 4); assert(restored.rows.every(row => row.physicalTestCache === true));
  return scope;
}
function exact(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  return source.replace(before, after);
}
function adapt(input) {
  let source = input;
  for (const [before, after] of [
    ['assert.equal(build.version, "1.9.22")', 'assert.equal(build.version, "1.9.24")'],
    ['assert.equal(installation.version, "1.9.22")', 'assert.equal(installation.executable.version, "1.9.24")'],
    ['assert.equal(metadata.editorVersion, "1.9.22")', 'assert.equal(metadata.editorVersion, "1.9.24")'],
    ['assert.equal(metadata.gameVersion, "0.1.1")', 'assert.equal(metadata.gameVersion, "0.1.2")'],
    ['        assert.equal(admin.physicalProtectionRestoration, "PASS");',
      '        assert.equal(admin.physicalProtectionRestoration, "PASS");\n' +
      '        module.validateArtifact({ build, admin, origin, task, restored: load(path.join(source, "cache-restoration.json")) });'],
    ['  const load = f => { r.sources.push(desc(f)); return read(f); };',
      '  for (const [name, text] of [["executed-business.cjs", module.auditSource], ["executed-validator.cjs", module.validatorSource]]) {\n' +
      '    const file = path.join(out, name); fs.writeFileSync(file, text, { flag: "wx" }); r.sources.push(desc(file));\n' +
      '  }\n' +
      '  r.inputMethodScope = "USER_MANUAL_NATIVE_FOLDER_ONLY_NO_NORMAL_CLOSE_CLAIM";\n' +
      '  const load = f => { r.sources.push(desc(f)); return read(f); };'],
    ['if (require.main === module)', 'if (module.qaRun)'],
  ]) source = exact(source, before, after);
  new vm.Script(Module.wrap(source), { filename: __filename });
  return source;
}
const input = fs.readFileSync(original, "utf8"), source = adapt(input);
const validatorSource = fs.readFileSync(validatorFile, "utf8")
  .replaceAll('"0.1.1"', '"0.1.2"').replaceAll("1001", "1002");
new vm.Script(Module.wrap(validatorSource), { filename: validatorFile });
if (process.argv[2] === "--self-test") {
  const error = "Error: Timeout Computer Use normal Editor close: not ready\ncontrolled";
  const good = {
    build: { status: "FAILED", finishedAt: "terminal", stage: "WAIT_NATIVE_EDITOR_CLOSE", error,
      steps: [{ status: "PASS" }, { status: "PASS" }, { status: "PASS" },
        { label: "Normal native elevated Editor close", status: "FAILED", error }],
      builds: 1, featureStatus: "PASS", normalUIExportStatus: "PASS_NATIVE_UI", protectedUnchanged: true,
      cleanups: [{ status: "PASS", normalCloseClaimed: false, killed: ["owned-identity"] }],
      version: "1.9.24", currentNativeUI: true, modelRequests: 0, productChanges: 0,
      sourceBuilderInvocation: false, errors: [] },
    admin: { finishedAt: "terminal", isElevated: true, probe: { isElevated: true, success: true },
      exitCode: 1, error: null, policyRestoration: "PASS", physicalProtectionRestoration: "PASS",
      status: "CHECK_EDITOR_REPORT", taskEngine: true, originProcessId: 11, userSid: "qa" },
    origin: { originIsElevated: false, taskEngine: true, originProcessId: 11, userSid: "qa" },
    task: { status: "TERMINAL", cleanup: "PASS", finishedAt: "terminal" },
    restored: { status: "PASS", deletedUserFiles: 0, rows: Array.from({ length: 4 }, () => ({ physicalTestCache: true })) },
  };
  assert.deepEqual(validateArtifact(good), { artifactBuildStatus: "PASS", normalCloseStatus: "FAILED",
    publishingWorkflowStatus: "FAILED", cleanupMode: "ATTRIBUTED_FORCED_CLEANUP" });
  const invalid = [
    v => v.build.status = "PASS", v => v.build.steps[0].status = "FAILED",
    v => v.build.steps[3].status = "PASS", v => v.build.error = "Different product failure",
    v => v.build.builds = 2, v => v.build.normalClose = {}, v => v.build.cleanups[0].normalCloseClaimed = true,
    v => v.build.cleanups[0].killed = [], v => v.build.cleanupError = "failed",
    v => v.admin.isElevated = false, v => v.admin.probe.success = false,
    v => v.admin.policyRestoration = "FAILED", v => v.admin.physicalProtectionRestoration = "FAILED",
    v => v.origin.originIsElevated = true, v => v.origin.originProcessId = 12,
    v => v.origin.userSid = "other", v => v.task.cleanup = "FAILED",
    v => v.task.status = "RUNNING", v => delete v.task.finishedAt,
    v => v.restored.rows = [], v => v.restored.rows[0].physicalTestCache = false,
    v => v.restored.deletedUserFiles = 1, v => v.build.modelRequests = 1,
    v => v.build.productChanges = 1, v => v.build.errors.push("unexplained"),
  ];
  for (const mutate of invalid) {
    const value = structuredClone(good); mutate(value);
    assert.throws(() => validateArtifact(value));
  }
  assert.throws(() => adapt(input.replace('assert.equal(build.version, "1.9.22")', "SOURCE_DRIFT")));
  console.log(JSON.stringify({ status: "PASS", invalidReceiptsRejected: invalid.length,
    sourceDriftRejected: 1, publishingWorkflowStatus: "FAILED_RETAINED", deviceOperations: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2), ["17", "01", "--apk-artifact"]);
  const validator = new Module(validatorFile, module);
  validator.filename = validatorFile; validator.paths = module.paths; validator._compile(validatorSource, validatorFile);
  const worker = new Module(__filename, module), requireOriginal = worker.require.bind(worker);
  worker.filename = __filename; worker.paths = module.paths;
  worker.require = id => id === "./lib/android-upgrade-package-evidence.cjs" ? validator.exports : requireOriginal(id);
  Object.assign(worker, { qaRun: true, validateArtifact, auditSource: source, validatorSource });
  worker._compile(source, __filename);
}
