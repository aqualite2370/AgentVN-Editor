"use strict";
// Independent audit of the new UI run; old reports and validator stay intact.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), crypto = require("node:crypto");
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const original = path.join(__dirname, "android-native-upgrade-package-audit.cjs");
const validatorFile = path.join(__dirname, "lib/android-upgrade-package-evidence.cjs");
assert.equal(hash(original), "d797329c2b5c1cde913aca4e03cfd4c90b40d1cd80806eb73f767d29f908c55c");
assert.equal(hash(validatorFile), "6e3aac6771b120bbb246d78923abe7459b903cb6edba26eca06c45b056e37752");
function validateAction(receipt) {
  assert(["USER_MANUAL", "COMPUTER_USE"].includes(receipt.performedBy));
  assert.equal(typeof receipt.interaction, "string");
  if (receipt.performedBy === "USER_MANUAL") assert.match(receipt.interaction, /^User manual\b/);
  else assert.match(receipt.interaction, /^Computer Use\b/);
}
function exact(source, before, after, count = 1) {
  assert.equal(source.split(before).length - 1, count, before);
  return source.split(before).join(after);
}
function validateTerminal({ build, admin, origin, restored, task }) {
  assert.equal(build.status, "PASS"); assert(build.finishedAt);
  assert.equal(build.version, "1.9.24"); assert.equal(build.builds, 1);
  assert.equal(build.steps.length, 4); assert(build.steps.every(s => s.status === "PASS"));
  assert.equal(build.normalUIExportStatus, "PASS_NATIVE_UI");
  assert.equal(build.modelRequests, 0); assert.equal(build.productChanges, 0);
  assert.deepEqual(build.errors, []); assert.equal(build.cleanupError, undefined);
  assert.equal(admin.status, "BUILD_PASS_DEVICE_PENDING");
  assert.equal(admin.isElevated, true); assert.equal(origin.originIsElevated, false);
  assert.equal(admin.originProcessId, origin.originProcessId);
  assert.equal(admin.userSid, origin.userSid); assert(admin.finishedAt);
  assert(admin.probe?.success && admin.probe.isElevated);
  assert.equal(admin.policyRestoration, "PASS");
  if (origin.taskEngine) {
    assert.equal(admin.physicalProtectionRestoration, "PASS");
    assert.equal(task.status, "TERMINAL"); assert.equal(task.cleanup, "PASS"); assert(task.finishedAt);
  }
  assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
  assert.equal(restored.rows.length, 4); assert(restored.rows.every(r => r.physicalTestCache));
  validateAction(build.nativeOutput.result);
  validateAction(build.normalClose.receipt);
  assert.equal(build.cleanups.length, 1); assert.deepEqual(build.cleanups[0].killed, []);
}
function adapt() {
  let source = fs.readFileSync(original, "utf8");
  source = exact(source, 'assert.equal(build.version, "1.9.22")', 'assert.equal(build.version, "1.9.24")');
  source = exact(source, 'assert.equal(installation.version, "1.9.22")', 'assert.equal(installation.executable.version, "1.9.24")');
  source = exact(source, 'assert.equal(metadata.editorVersion, "1.9.22")', 'assert.equal(metadata.editorVersion, "1.9.24")');
  source = exact(source, 'assert.equal(metadata.gameVersion, "0.1.1")', 'assert.equal(metadata.gameVersion, "0.1.2")');
  source = exact(source, '        assert.equal(admin.physicalProtectionRestoration, "PASS");',
    '        module.validateTerminal({ build, admin, origin, task, restored: load(path.join(source, "cache-restoration.json")) });');
  source = exact(source, 'assert.match(selected.result.interaction, /User manual native folder selection/);',
    'module.validateAction(selected.result);');
  source = exact(source, '  const load = f => { r.sources.push(desc(f)); return read(f); };',
    '  for (const [name, text] of [["executed-business.cjs", module.auditSource], ["executed-validator.cjs", module.validatorSource]]) {\n' +
    '    const snapshot = path.join(out, name); fs.writeFileSync(snapshot, text, { flag: "wx" }); r.sources.push(desc(snapshot));\n' +
    '  }\n' +
    '  r.inputMethodScope = "EXPLICIT_USER_MANUAL_OR_COMPUTER_USE_ACTION_PER_RECEIPT";\n' +
    '  const load = f => { r.sources.push(desc(f)); return read(f); };');
  source = exact(source, 'if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });',
    'main().catch(e => { console.error(e); process.exitCode = 1; });');
  new vm.Script(Module.wrap(source));
  const validator = fs.readFileSync(validatorFile, "utf8").replaceAll('"0.1.1"', '"0.1.2"').replaceAll('1001', '1002');
  new vm.Script(Module.wrap(validator));
  return { source, validator };
}
if (process.argv[2] === "--self-test") {
  adapt();
  const valid = {
    build: { status: "PASS", finishedAt: "2026-10-25T00:00:00Z", version: "1.9.24", builds: 1,
      steps: Array.from({ length: 4 }, () => ({ status: "PASS" })), normalUIExportStatus: "PASS_NATIVE_UI",
      modelRequests: 0, productChanges: 0, errors: [],
      nativeOutput: { result: { performedBy: "COMPUTER_USE", interaction: "Computer Use" } },
      normalClose: { receipt: { performedBy: "COMPUTER_USE", interaction: "Computer Use" } }, cleanups: [{ killed: [] }] },
    admin: { status: "BUILD_PASS_DEVICE_PENDING", isElevated: true, originProcessId: 12, userSid: "qa",
      finishedAt: "2026-10-25T00:00:00Z", probe: { success: true, isElevated: true }, policyRestoration: "PASS" },
    origin: { originIsElevated: false, originProcessId: 12, userSid: "qa" },
    restored: { status: "PASS", deletedUserFiles: 0, rows: Array.from({ length: 4 }, () => ({ physicalTestCache: true })) },
  };
  validateTerminal(valid);
  const manual = structuredClone(valid);
  manual.build.nativeOutput.result = { performedBy: "USER_MANUAL", interaction: "User manual native folder selection" };
  manual.build.normalClose.receipt = { performedBy: "USER_MANUAL", interaction: "User manual close; Computer Use observed closure" };
  manual.origin.taskEngine = true;
  manual.admin.physicalProtectionRestoration = "PASS";
  manual.task = { status: "TERMINAL", cleanup: "PASS", finishedAt: "2026-10-25T00:00:00Z" };
  validateTerminal(manual);
  const bad = [
    v => v.build.status = "FAILED", v => v.build.steps = [], v => v.build.steps[0].status = "FAILED",
    v => v.build.builds = 2, v => v.build.version = "1.9.22", v => v.build.modelRequests = 1,
    v => v.build.errors.push("error"), v => v.admin.isElevated = false, v => v.admin.probe.success = false,
    v => v.admin.originProcessId = 13, v => v.origin.originIsElevated = true,
    v => v.admin.policyRestoration = "FAILED", v => v.restored.rows = [],
    v => v.restored.deletedUserFiles = 1, v => v.build.cleanups[0].killed.push("forced"),
    v => v.build.nativeOutput.result.interaction = "injected",
    v => v.build.nativeOutput.result.performedBy = "UNKNOWN",
    v => v.build.nativeOutput.result.performedBy = "USER_MANUAL",
    v => v.build.normalClose.receipt.performedBy = "UNKNOWN",
  ];
  for (const mutate of bad) { const value = structuredClone(valid); mutate(value); assert.throws(() => validateTerminal(value)); }
  const badTask = [
    v => v.task.cleanup = "NOT_RUN", v => v.task.status = "RUNNING", v => delete v.task.finishedAt,
    v => v.admin.physicalProtectionRestoration = "FAILED", v => v.restored.rows[0].physicalTestCache = false,
  ];
  for (const mutate of badTask) { const value = structuredClone(manual); mutate(value); assert.throws(() => validateTerminal(value)); }
  console.log(JSON.stringify({ status: "PASS", invalidReceiptsRejected: bad.length + badTask.length,
    validInputMethods: ["COMPUTER_USE", "USER_MANUAL"], launches: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2), ["16", "01", "--apk-terminal"]);
  const adapted = adapt(), validator = new Module(validatorFile, module);
  validator.filename = validatorFile; validator.paths = module.paths; validator._compile(adapted.validator, validatorFile);
  const worker = new Module(__filename, module), requireOriginal = worker.require.bind(worker);
  worker.filename = __filename; worker.paths = module.paths;
  worker.require = id => id === "./lib/android-upgrade-package-evidence.cjs" ? validator.exports : requireOriginal(id);
  worker.validateTerminal = validateTerminal;
  Object.assign(worker, { validateAction, auditSource: adapted.source, validatorSource: adapted.validator });
  worker._compile(adapted.source, __filename);
}
