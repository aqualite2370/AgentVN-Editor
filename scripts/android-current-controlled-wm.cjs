"use strict";
// QA only: user-authorized transient directory response, real installed builder,
// and process-owned WM_CLOSE. No product edits, native-picker or physical-input claims.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const current = require("./installed-android-current-functional.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const close = require("./lib/editor-upgrade-wm-close.cjs");
const qa = "F:/AgentVN/QA/Functional-Continuation-20261101";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function one(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "Exact QA seam required");
  return source.replace(before, () => after);
}
function business(source) {
  const start = source.indexOf('    await step("Normal native elevated Editor close"');
  const end = source.indexOf('    assert.equal(report.steps.length, 4);', start);
  assert(start > 0 && end > start);
  const replacement = `    await step("Real WM_CLOSE and natural exit; physical input NOT_RUN", async () => {
      const launch = { ...host.current, label: "android", exe: host.current.executable.path };
      report.stage = "WAIT_OWNED_WM_CLOSE"; save();
      report.normalClose = await require("./lib/editor-upgrade-wm-close.cjs").close({
        launch, known: [...report.knownProcesses, ...report.buildKnownProcesses], out
      });
      await host.stop("Observed owned WM_CLOSE natural exit; no physical input claim");
      assert.deepEqual(report.cleanups.at(-1).killed, []);
      save(); return report.normalClose;
    });
`;
  const result = source.slice(0, start) + replacement + source.slice(end);
  assert(result.includes("selectControlledPackageOutput"));
  assert(!result.includes('report.nativeOutput = await nativeInput'));
  assert(!result.includes('until(() => fs.existsSync(request.completion)'));
  new vm.Script(Module.wrap(result)); return result;
}
function validateClose(b) {
  assert.equal(b.normalClose.method, close.METHOD);
  assert.equal(b.normalClose.physicalInput, false);
  const launch = { ...b.launches[0], label: "android", exe: b.launches[0].executable.path };
  close.validate(b.normalClose, launch, [...b.knownProcesses, ...b.buildKnownProcesses]);
  assert.equal(b.cleanups.length, 1); assert.equal(b.cleanups[0].status, "PASS");
  assert.deepEqual(b.cleanups[0].killed, []);
}
function prepare(attempt) {
  assert.match(attempt, /^\d{2}$/);
  const sourceConfig = read(path.join(qa, "android-current-config-33.json"));
  const configFile = path.join(qa, `android-current-config-${attempt}.json`);
  assert(!fs.existsSync(configFile));
  const c = { ...sourceConfig, attempt, outputDirectoryMode: "controlled-once",
    preparation: path.join(qa, `android-current-preparation-${attempt}`) };
  validateConfig(c);
  fs.writeFileSync(configFile, JSON.stringify(c, null, 2), { flag: "wx" });
  current.adapter().prepare(c, configFile);
  const file = path.join(c.preparation, "business.cjs");
  fs.writeFileSync(file, business(fs.readFileSync(file, "utf8")));
  const bindingFile = path.join(c.preparation, "binding.json"), b = read(bindingFile);
  b.sources = b.sources.map(f => desc(f.path));
  b.sources.push(...[__filename, require.resolve("./lib/editor-upgrade-wm-close.cjs"),
    require.resolve("./lib/windows-repository-native.cjs")].map(desc));
  b.inputBoundary = { directory: "CONTROLLED_ONCE", close: "WM_CLOSE", physicalInput: false };
  fs.writeFileSync(bindingFile, JSON.stringify(b, null, 2));
  return { status: "PREPARED_NOT_LAUNCHED", configFile, binding: desc(bindingFile),
    launcher: path.join(c.preparation, "launcher.ps1"), productChanges: 0, modelRequests: 0 };
}
function audit(configFile, number) {
  const c = read(configFile); validateConfig(c);
  assert.equal(c.outputDirectoryMode, "controlled-once");
  const file = require.resolve("./android-default-controlled.cjs");
  let source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("function validateClose(b) {"), end = source.indexOf("function config(file) {", start);
  assert(start > 0 && end > start);
  source = source.slice(0, start) + "function validateClose(b) { return module.validateActualClose(b); }\n" + source.slice(end);
  source = one(source, 'game: c.gameVersion, code: c.versionCode,\n      inputBoundary: { directory: "CONTROLLED_ONCE", close: "NATIVE_IPC_CLOSE", physicalInput: false',
    'game: c.gameVersion, code: c.versionCode,\n      inputBoundary: { directory: "CONTROLLED_ONCE", close: "WM_CLOSE", physicalInput: false');
  source = one(source, 'adapter: desc(__filename), editor: c.version',
    'adapter: desc(module.currentAdapter), editor: c.version');
  source = one(source, 'snapshots: { ...adapted.snapshots, "executed-audit.cjs": s,',
    'snapshots: { ...adapted.snapshots, "current-wm-adapter.cjs": fs.readFileSync(module.currentAdapter, "utf8"), "executed-audit.cjs": s,');
  source += "\nmodule.exports.audit = audit;\n";
  new vm.Script(Module.wrap(source));
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  worker.validateActualClose = validateClose; worker.currentAdapter = __filename;
  worker._compile(source, file);
  return worker.exports.audit(c, configFile, number);
}
function selfTest(configFile) {
  const c = read(configFile); validateConfig(c); assert.equal(c.outputDirectoryMode, "controlled-once");
  const generated = business(current.adapter().build("business", c).source);
  assert.throws(() => business(generated), /Exact|assert|false|true/i);
  const wrong = { normalClose: { method: "Computer Use", physicalInput: true } };
  assert.throws(() => validateClose(wrong));
  return { status: "PASS", helper: close.selfTest(), generatedBusinessParsed: true,
    wrongPhysicalClaimRejected: true, doubleTransformationRejected: true,
    productLaunches: 0, apkBuilds: 0, modelRequests: 0 };
}
module.exports = { business, validateClose, prepare, audit, selfTest };
if (require.main === module) {
  const [mode, arg, number] = process.argv.slice(2);
  if (mode === "prepare") console.log(JSON.stringify(prepare(arg)));
  else if (mode === "self-test") console.log(JSON.stringify(selfTest(arg)));
  else { assert.equal(mode, "audit"); audit(arg, number); }
}
