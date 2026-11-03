"use strict";
// One explicit candidate binding for the preserved complete Android package audit.
// Never modifies products, historical reports, the live build, or device state.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), vm = require("node:vm"), Module = require("node:module");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const { validateArtifactTerminal } = require("./lib/android-artifact-terminal.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const original = path.join(__dirname, "android-native-upgrade-package-audit.cjs");
const validatorFile = path.join(__dirname, "lib/android-upgrade-package-evidence.cjs");
const preserved = [
  [original, "d797329c2b5c1cde913aca4e03cfd4c90b40d1cd80806eb73f767d29f908c55c"],
  [validatorFile, "6e3aac6771b120bbb246d78923abe7459b903cb6edba26eca06c45b056e37752"],
  [path.join(__dirname, "lib/android-artifact-terminal.cjs"),
    "40b6629edd9bfd934d920aab261caf3c04976876a400f97fc039be62782b5610"],
];
function replace(source, before, after, expected = 1) {
  assert.equal(source.split(before).length - 1, expected, before);
  return source.split(before).join(after);
}
function validateAction(receipt) {
  assert(["COMPUTER_USE", "USER_MANUAL"].includes(receipt.performedBy));
  assert.match(receipt.interaction, receipt.performedBy === "COMPUTER_USE" ? /^Computer Use\b/ : /^User manual\b/);
}
function terminal(c, { build, admin, origin, task, restored }, artifactOnly) {
  assert.equal(build.version, c.version); assert.equal(build.currentNativeUI, true);
  assert.equal(build.modelRequests, 0); assert.equal(build.productChanges, 0);
  assert.equal(build.sourceBuilderInvocation, false); assert.deepEqual(build.errors, []);
  assert.equal(admin.originProcessId, origin.originProcessId);
  assert.equal(admin.userSid, origin.userSid);
  assert.equal(origin.originIsElevated, false); assert.equal(origin.taskEngine, true);
  assert.equal(admin.taskEngine, true); assert.equal(admin.isElevated, true);
  assert.equal(admin.error, null); assert.equal(admin.policyRestoration, "PASS");
  assert.equal(admin.physicalProtectionRestoration, "PASS"); assert(admin.finishedAt);
  assert(admin.probe?.success && admin.probe.isElevated);
  assert.equal(task.status, "TERMINAL"); assert.equal(task.cleanup, "PASS"); assert(task.finishedAt);
  assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
  assert.equal(restored.rows.length, 4); assert(restored.rows.every(row => row.physicalTestCache === true));
  validateAction(build.nativeOutput.result);
  if (artifactOnly) {
    assert.equal(admin.status, "CHECK_EDITOR_REPORT"); assert.equal(build.normalClose, undefined);
    return validateArtifactTerminal({ build, admin, task });
  }
  assert.equal(build.status, "PASS"); assert(build.finishedAt);
  assert.equal(build.steps.length, 4); assert(build.steps.every(step => step.status === "PASS"));
  assert.equal(build.builds, 1); assert.equal(build.featureStatus, "PASS");
  assert.equal(build.normalUIExportStatus, "PASS_NATIVE_UI"); assert.equal(build.cleanupError, undefined);
  assert.equal(build.protectedUnchanged, true); assert.equal(admin.status, "BUILD_PASS_DEVICE_PENDING");
  assert.equal(admin.exitCode, 0);
  assert.equal(build.cleanups.length, 1); assert.equal(build.cleanups[0].status, "PASS");
  assert.deepEqual(build.cleanups[0].killed, []); validateAction(build.normalClose.receipt);
}
function adapt(c, configFile, sample) {
  for (const [file, digest] of preserved) assert.equal(sha(file), digest, file);
  let source = sample ?? fs.readFileSync(original, "utf8");
  for (const target of ["build.version", "installation.version", "metadata.editorVersion"])
    source = replace(source, `assert.equal(${target}, "1.9.22")`,
      `assert.equal(${target}, ${JSON.stringify(c.version)})`);
  source = replace(source, 'assert.equal(metadata.gameVersion, "0.1.1")',
    `assert.equal(metadata.gameVersion, ${JSON.stringify(c.gameVersion)})`);
  source = replace(source, 'assert.match(selected.result.interaction, /User manual native folder selection/);',
    "module.validateAction(selected.result);");
  source = replace(source, '        assert.equal(admin.physicalProtectionRestoration, "PASS");',
    '        assert.equal(admin.physicalProtectionRestoration, "PASS");\n' +
    '        module.validateTerminal({ build, admin, origin, task, restored: load(path.join(source, "cache-restoration.json")) }, artifactOnly);');
  source = replace(source, '  const load = f => { r.sources.push(desc(f)); return read(f); };',
    '  for (const [name, text] of Object.entries(module.snapshots)) {\n' +
    '    const file = path.join(out, name); fs.writeFileSync(file, text, { flag: "wx" }); r.sources.push(desc(file));\n' +
    '  }\n  r.candidateBinding = module.candidateBinding;\n' +
    '  const load = f => { r.sources.push(desc(f)); return read(f); };');
  source = replace(source, "if (require.main === module)", "if (module.qaRun)");
  let validator = replace(fs.readFileSync(validatorFile, "utf8"), '"0.1.1"', JSON.stringify(c.gameVersion), 2);
  validator = replace(validator, "1001", String(c.versionCode));
  for (const text of [source, validator]) new vm.Script(Module.wrap(text));
  return { source, validator, snapshots: {
    "candidate-audit-adapter.cjs": fs.readFileSync(__filename, "utf8"),
    "candidate-config.json": fs.readFileSync(configFile, "utf8"),
    "executed-audit.cjs": source, "executed-validator.cjs": validator,
  }};
}
function loadValidator(source) {
  const worker = new Module(validatorFile, module);
  worker.filename = validatorFile; worker.paths = module.paths;
  worker._compile(source, validatorFile); return worker.exports;
}
async function selfTest(c, file) {
  validateConfig(c);
  const adapted = adapt(c, file), validator = loadValidator(adapted.validator);
  assert.throws(() => adapt(c, file,
    fs.readFileSync(original, "utf8").replace('assert.equal(build.version, "1.9.22")', "DRIFT")));
  const good = {
    build: { version: c.version, currentNativeUI: true, modelRequests: 0, productChanges: 0,
      sourceBuilderInvocation: false, errors: [], status: "PASS", finishedAt: "terminal",
      steps: Array.from({ length: 4 }, () => ({ status: "PASS" })), builds: 1, featureStatus: "PASS",
      normalUIExportStatus: "PASS_NATIVE_UI", protectedUnchanged: true, cleanups: [{ status: "PASS", killed: [] }],
      nativeOutput: { result: { performedBy: "USER_MANUAL", interaction: "User manual native folder selection" } },
      normalClose: { receipt: { performedBy: "COMPUTER_USE", interaction: "Computer Use normal close" } } },
    admin: { status: "BUILD_PASS_DEVICE_PENDING", isElevated: true, originProcessId: 12, userSid: "qa",
      taskEngine: true, error: null, finishedAt: "terminal", exitCode: 0,
      probe: { success: true, isElevated: true }, policyRestoration: "PASS", physicalProtectionRestoration: "PASS" },
    origin: { originProcessId: 12, userSid: "qa", originIsElevated: false, taskEngine: true },
    task: { status: "TERMINAL", cleanup: "PASS", finishedAt: "terminal" },
    restored: { status: "PASS", deletedUserFiles: 0, rows: Array.from({ length: 4 }, () => ({ physicalTestCache: true })) },
  };
  terminal(c, good, false);
  const invalid = [
    v => v.build.version = "1.9.22", v => v.build.modelRequests = 1, v => v.build.productChanges = 1,
    v => v.build.sourceBuilderInvocation = true, v => v.build.errors.push("failed"),
    v => v.build.status = "FAILED", v => v.build.steps = [], v => v.build.steps[1].status = "FAILED",
    v => v.build.builds = 2, v => v.build.cleanupError = "failed", v => v.build.cleanups[0].killed.push("owned"),
    v => v.admin.isElevated = false, v => v.admin.probe.success = false, v => v.admin.error = "failed",
    v => v.origin.originIsElevated = true, v => v.origin.userSid = "other",
    v => v.task.cleanup = "FAILED", v => delete v.task.finishedAt,
    v => v.restored.rows = [], v => v.restored.rows[0].physicalTestCache = false,
    v => v.build.nativeOutput.result.performedBy = "UNKNOWN",
    v => v.build.normalClose.receipt.interaction = "injected",
  ];
  for (const change of invalid) {
    const copy = structuredClone(good); change(copy); assert.throws(() => terminal(c, copy, false));
  }
  const build = read(`F:/AgentVN/QA/Android-Package-20261021-01/editor-${c.attempt}/report.json`);
  const old = read("F:/AgentVN/QA/Android-Package-20261021-01/editor-10/Android 隔离小工程.vnproj");
  const JSZip = require("../editor/node_modules/jszip");
  assert.equal(sha(build.cartridge.path), build.cartridge.sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(build.cartridge.path), { checkCRC32: true });
  const json = async name => JSON.parse(await zip.file(name).async("string"));
  validator.validateCartridge(old, read(build.input.path), await json("manifest.json"),
    await json("script.json"), await json("ui/layout.json"));
  return { status: "PASS", negativeReceipts: invalid.length, driftRejected: 1,
    actualCandidateCartridge: "PASS", apkBuilds: 0, deviceOperations: 0, productChanges: 0 };
}
module.exports = { terminal, adapt, selfTest };
if (require.main === module) {
  (async () => {
    const [action, configFile, audit, scope] = process.argv.slice(2), c = read(configFile);
    if (action === "self-test") return console.log(JSON.stringify(await selfTest(c, configFile)));
    assert.equal(action, "run"); validateConfig(c);
    assert.match(audit, /^\d{2}$/); assert(["--cartridge-only", "--apk-terminal", "--apk-artifact"].includes(scope));
    const adapted = adapt(c, configFile), validator = loadValidator(adapted.validator);
    const worker = new Module(original, module), originalRequire = worker.require.bind(worker);
    worker.filename = original; worker.paths = module.paths;
    worker.require = id => id === "./lib/android-upgrade-package-evidence.cjs" ? validator : originalRequire(id);
    Object.assign(worker, { qaRun: true, validateAction, validateTerminal: (value, artifactOnly) => terminal(c, value, artifactOnly),
      snapshots: adapted.snapshots, candidateBinding: { config: { path: path.resolve(configFile), sha256: sha(configFile) },
        adapter: { path: __filename, sha256: sha(__filename) }, editor: c.version, game: c.gameVersion, code: c.versionCode } });
    process.argv = [process.argv[0], original, c.attempt, audit, scope];
    worker._compile(adapted.source, original);
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
