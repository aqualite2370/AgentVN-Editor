"use strict";
// QA only: keep the rejected close FAILED while independently validating and
// consuming its signed APK. No product permissions, builds or picker changes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const auditBase = require("./android-candidate-package-audit.cjs");
const device = require("./android-candidate-device.cjs");
const controlled = require("./android-default-controlled.cjs");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const status = "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN";
function replace(s, a, b) {
  assert.equal(s.split(a).length - 1, 1, a); return s.replace(a, b);
}
function validateTerminal(c, { build: b, admin: a, origin: o, task: t, restored: r }) {
  assert.equal(b.version, c.version); assert.equal(b.status, "FAILED"); assert(b.finishedAt);
  assert.equal(b.stage, "WAIT_PROGRAMMATIC_NATIVE_EDITOR_CLOSE");
  assert.match(b.error, /Command plugin:window\|close not allowed by ACL/);
  assert.equal(b.builds, 1); assert.equal(b.featureStatus, "PASS");
  assert.equal(b.currentNativeUI, true); assert.equal(b.sourceBuilderInvocation, false);
  assert.equal(b.productChanges, 0); assert.equal(b.modelRequests, 0); assert.deepEqual(b.errors, []);
  assert.equal(b.steps.length, 4); assert(b.steps.slice(0, 3).every(s => s.status === "PASS"));
  assert.equal(b.steps[3].status, "FAILED"); assert.equal(b.normalClose, undefined);
  assert.equal(b.protectedUnchanged, true); assert.equal(b.cleanupError, undefined);
  controlled.validateSelection(b, path.join(root, "editor-" + c.attempt));
  assert.equal(b.nativeCloseInput.command, "plugin:window|close");
  assert.equal(b.nativeCloseInput.physicalInput, false);
  assert.equal(b.nativeCloseInput.ownerPid, b.launches[0].pid);
  assert.equal(b.cleanups.length, 1); assert.equal(b.cleanups[0].status, "PASS");
  assert.equal(b.cleanups[0].normalCloseClaimed, false); assert(b.cleanups[0].killed.length > 0);
  assert.equal(o.originIsElevated, false); assert.equal(o.taskEngine, true);
  assert.equal(a.isElevated, true); assert.equal(a.taskEngine, true);
  assert.equal(a.originProcessId, o.originProcessId); assert.equal(a.userSid, o.userSid);
  assert(a.probe?.success && a.probe.isElevated); assert(a.finishedAt);
  assert.equal(a.status, "CHECK_EDITOR_REPORT"); assert.equal(a.exitCode, 1); assert.equal(a.error, null);
  assert.equal(a.policyRestoration, "PASS"); assert.equal(a.physicalProtectionRestoration, "PASS");
  assert.equal(t.status, "TERMINAL"); assert.equal(t.cleanup, "PASS"); assert(t.finishedAt);
  assert.equal(r.status, "PASS"); assert.equal(r.deletedUserFiles, 0);
  assert.equal(r.rows.length, 4); assert(r.rows.every(x => x.physicalTestCache === true));
  return { artifactBuildStatus: "PASS", normalCloseStatus: "FAILED", publishingWorkflowStatus: "FAILED",
    cleanupMode: "ATTRIBUTED_FORCED_CLEANUP", directory: "CONTROLLED_ONCE",
    close: "NATIVE_IPC_REJECTED_BY_ACL", physicalInput: false };
}
async function dex(r, out) {
  const inspect = require("./android-runtime-lifecycle-dex-audit.cjs");
  const tool = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain/Sdk/build-tools/36.0.0/dexdump.exe";
  r.sources.push(desc(tool), desc(require.resolve("./android-runtime-lifecycle-dex-audit.cjs")));
  const apk = r.upgradePair.currentApk; assert.equal(desc(apk.path).sha256, apk.sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(apk.path), { checkCRC32: true });
  const entries = Object.values(zip.files).filter(e => /^classes(?:\d+)?\.dex$/.test(e.name));
  assert(entries.length); const dumps = [], methods = []; let classes = 0;
  for (const e of entries) {
    const file = path.join(out, e.name), dump = file + ".txt";
    fs.writeFileSync(file, await e.async("nodebuffer"), { flag: "wx" });
    const fd = fs.openSync(dump, "wx"); let result;
    try { result = spawnSync(tool, [file], { windowsHide: true, stdio: ["ignore", fd, "pipe"], timeout: 90000 }); }
    finally { fs.closeSync(fd); }
    assert.equal(result.status, 0, result.stderr?.toString());
    const text = fs.readFileSync(dump, "utf8"), v = inspect.inspectLifecycle(text, r.upgradePair.current.packageName);
    classes += v.classCount; methods.push(...v.methods); dumps.push(text);
    r.sources.push(desc(file), desc(dump));
  }
  assert.equal(classes, 1); assert.equal(methods.length, 5);
  return { classes, methods, inheritedGetter: inspect.inspectPluginBridge(dumps.join("\n"), r.upgradePair.current.packageName) };
}
function audit(c, file, number) {
  assert.match(number, /^\d{2}$/);
  const adapted = auditBase.adapt(c, file); let s = adapted.source;
  const start = s.indexOf('      await check(artifactOnly ? "Artifact build eligibility');
  const end = s.indexOf('      await check("Actual signed current APK', start);
  assert(start > 0 && end > start);
  s = s.slice(0, start) + `      await check("Artifact build eligibility; controlled input and rejected close remain explicit", () => {
        const adminRoot = path.join(qa, "administrator-" + attempt);
        r.publishingWorkflow = module.validateTerminal({
          build, admin: load(path.join(adminRoot, "result.json")),
          origin: load(path.join(adminRoot, "origin.json")), task: load(path.join(adminRoot, "task-engine.json")),
          restored: load(path.join(source, "cache-restoration.json")) });
        return r.publishingWorkflow;
      });
` + s.slice(end);
  s = replace(s, '    r.status = artifactOnly ? "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN"',
    '    if (terminal) await check("Final optimized DEX retains lifecycle and inherited JNI entrypoints", () => module.dex(r, out));\n' +
    '    r.status = artifactOnly ? "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN"');
  new vm.Script(Module.wrap(s));
  const original = require.resolve("./android-native-upgrade-package-audit.cjs");
  const validatorFile = require.resolve("./lib/android-upgrade-package-evidence.cjs");
  const validator = new Module(validatorFile, module);
  validator.filename = validatorFile; validator.paths = module.paths; validator._compile(adapted.validator, validatorFile);
  const worker = new Module(original, module), originalRequire = worker.require.bind(worker);
  worker.filename = original; worker.paths = module.paths;
  worker.require = id => id === "./lib/android-upgrade-package-evidence.cjs" ? validator.exports : originalRequire(id);
  Object.assign(worker, { qaRun: true, dex, validateTerminal: v => validateTerminal(c, v),
    snapshots: { ...adapted.snapshots, "executed-audit.cjs": s, "artifact-adapter.cjs": fs.readFileSync(__filename, "utf8") },
    candidateBinding: { config: desc(file), adapter: desc(__filename), editor: c.version,
      game: c.gameVersion, code: c.versionCode, physicalInput: false } });
  process.argv = [process.argv[0], original, c.attempt, number, "--apk-artifact"]; worker._compile(s, original);
}
function validateCandidate(file, auditFile) {
  const c = read(file), a = device.auditCandidate(c, file, auditFile);
  assert.equal(a.status, status); assert.equal(a.checks.length, 6); assert(a.checks.every(x => x.status === "PASS"));
  assert.equal(a.publishingWorkflow.close, "NATIVE_IPC_REJECTED_BY_ACL");
  assert.equal(a.publishingWorkflow.normalCloseStatus, "FAILED"); return { c, a };
}
function navigation() {
  const original = require.resolve("./android-candidate-navigation.cjs");
  const originalText = fs.readFileSync(original, "utf8");
  const baseNavigation = require(original);
  let s = originalText;
  const start = s.indexOf("function validateCandidate("), end = s.indexOf("function runnerSource(", start);
  s = s.slice(0, start) + "function validateCandidate(...args) { return module.validateCandidate(...args); }\n" + s.slice(end);
  s = replace(s, "const source = runnerSource(c, a), start = startSource(startFile, runnerFile);",
    "const source = module.runnerSource(c, a), start = startSource(startFile, runnerFile);");
  s = replace(s, "sources: [__filename, historical,", "sources: [__filename, module.adapterFile, historical,");
  s = replace(s, "JSON.stringify(__filename)", "JSON.stringify(module.adapterFile)");
  s = replace(s, "if (require.main === module)", "if (module.qaRun)");
  const worker = new Module(original, module); worker.filename = original; worker.paths = module.paths;
  Object.assign(worker, { qaRun: false, adapterFile: __filename, validateCandidate, runnerSource: (c, a) => {
    let source = baseNavigation.runnerSource(c, a);
    source = replace(source, '"APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN"', JSON.stringify(status));
    source = replace(source,
      '  assert(audit.checks.some(row => row.name.startsWith("Terminal single native UI build and normal close") && row.status === "PASS"));',
      '  assert.equal(audit.publishingWorkflow.close,"NATIVE_IPC_REJECTED_BY_ACL");\n' +
      '  assert.equal(audit.publishingWorkflow.normalCloseStatus,"FAILED");');
    new vm.Script(Module.wrap(source)); return source;
  } });
  worker._compile(s, original); return worker.exports;
}
async function selfTest(file) {
  const c = read(file), source = path.join(root, "editor-" + c.attempt);
  const actual = { build: read(path.join(source, "report.json")),
    admin: read(path.join(root, "administrator-" + c.attempt, "result.json")),
    origin: read(path.join(root, "administrator-" + c.attempt, "origin.json")),
    task: read(path.join(root, "administrator-" + c.attempt, "task-engine.json")),
    restored: read(path.join(source, "cache-restoration.json")) };
  validateTerminal(c, actual);
  const mutations = [
    v => v.build.status = "PASS", v => v.build.error = "unrelated failure",
    v => v.build.steps[2].status = "FAILED", v => v.build.builds = 2,
    v => v.build.nativeCloseInput.physicalInput = true, v => v.build.cleanups[0].normalCloseClaimed = true,
    v => v.admin.isElevated = false, v => v.admin.policyRestoration = "FAILED",
    v => v.restored.deletedUserFiles = 1, v => v.task.cleanup = "FAILED",
    v => v.build.controlledOutput.result.calls = 2,
  ];
  for (const change of mutations) { const v = structuredClone(actual); change(v); assert.throws(() => validateTerminal(c, v)); }
  navigation();
  return { status: "PASS", actualFailedCloseRetained: true, rejected: mutations.length, productLaunches: 0, builds: 0 };
}
module.exports = { validateTerminal, validateCandidate,
  runPrepared: (...args) => navigation().runPrepared(...args),
  launchPrepared: (...args) => navigation().launchPrepared(...args) };
if (require.main === module) {
  (async () => {
    const [mode, file, number, next] = process.argv.slice(2);
    if (mode === "self-test") console.log(JSON.stringify(await selfTest(file)));
    else if (mode === "audit") audit(read(file), file, number);
    else { assert.equal(mode, "navigation"); console.log(JSON.stringify(navigation().prepare(file, number, next))); }
  })().catch(e => { console.error(e); process.exitCode = 1; });
}
