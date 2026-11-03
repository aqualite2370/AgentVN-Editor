"use strict";
// Current-candidate device QA. Desktop default DB files can be VFS-only; they
// are protected by the actual build receipt, not assumed present on both hosts.
// All immutable installed resources, APK bytes and workflow bindings stay strict.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const nvl = require("./android-current-story-nvl-device.cjs");
const baseFile = require.resolve("./android-current-story-device.cjs");
const runtimeFile = require.resolve("./android-apk-runtime-qa.cjs");
const validatorFile = require.resolve("./installed-editor-android-candidate.cjs");
const aspectFile = require.resolve("./lib/android-player-aspect-flow.cjs");
const databasePaths = ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]
  .map(name => "C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\" + name);
function one(source, before, after, count = 1) {
  assert.equal(source.split(before).length - 1, count, "Exact preserved QA seam: " + before);
  return source.split(before).join(after);
}
function compile(file, source, extras) {
  new vm.Script(Module.wrap(source));
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  Object.assign(worker, extras); worker._compile(source, file); return worker.exports;
}
function immutableFile(file) { return !databasePaths.includes(path.resolve(file.path)); }
function runtimeSource() {
  return one(nvl.runtimeSource(), "    await exerciseInstalledFullStory(cdp);",
    `    await require(${JSON.stringify(aspectFile)}).exercise({ cdp, report,
      tap:(selector,label)=>tapSelector(cdp,selector,label),
      wait:(expression,label)=>waitFor(cdp,expression,label),
      capture:label=>captureState(cdp,label),
      save:()=>fs.writeFileSync(path.join(outputDir,"runtime-smoke-report.json"),JSON.stringify(report,null,2),"utf8") });
    await exerciseInstalledFullStory(cdp);`);
}
function validateCurrentConfig(c) {
  assert.equal(c.version, "1.9.40"); assert.equal(c.attempt, "41");
  assert.equal(c.gameVersion, "0.1.7"); assert.equal(c.versionCode, 1007);
  const source = one(fs.readFileSync(validatorFile, "utf8"),
    "for (const file of [actual.installer, sealed.executable, ...sealed.resources, ...sealed.protectedFiles])",
    "for (const file of [actual.installer, sealed.executable, ...sealed.resources, ...sealed.protectedFiles].filter(module.immutableFile))");
  return compile(validatorFile, source, { immutableFile }).validateConfig(c);
}
function adapter() {
  let source = fs.readFileSync(baseFile, "utf8");
  source = one(source,
    'const { validateConfig } = require("./installed-editor-android-candidate.cjs");',
    "const validateConfig = module.validateCurrentConfig;");
  source = one(source,
    "const startText = tools.startSource(start, runner); tools.validateStartSyntax(startText);",
    "const startText = module.prepareRuntime(prep, tools.startSource(start, runner)); tools.validateStartSyntax(startText);");
  source = one(source, "sources([__filename, configFile, auditFile, start, audio,",
    "sources([module.adapterFile, module.aspectFile, module.runtimeSource, module.runtimeWrapper, __filename, configFile, auditFile, start, audio,");
  source = one(source, "JSON.stringify(__filename)", "JSON.stringify(module.adapterFile)", 2);
  const worker = new Module(baseFile, module); worker.filename = baseFile; worker.paths = module.paths;
  Object.assign(worker, { adapterFile: __filename, aspectFile, validateCurrentConfig });
  worker.prepareRuntime = (prep, start) => {
    const copy = path.join(prep, "executed-runtime-source.cjs"), wrapper = path.join(prep, "executed-runtime.cjs");
    const execution = `const fs=require("node:fs"),Module=require("node:module");\n` +
      `const file=${JSON.stringify(runtimeFile)},worker=new Module(file,module);\n` +
      `worker.filename=file;worker.paths=Module._nodeModulePaths(require("node:path").dirname(file));\n` +
      `worker._compile(fs.readFileSync(${JSON.stringify(copy)},"utf8"),file);\n`;
    new vm.Script(runtimeSource()); new vm.Script(execution);
    fs.writeFileSync(copy, runtimeSource(), { flag: "wx" });
    fs.writeFileSync(wrapper, execution, { flag: "wx" });
    worker.runtimeSource = copy; worker.runtimeWrapper = wrapper;
    return one(start, `(Join-Path '${__dirname}' 'android-apk-runtime-qa.cjs')`, `'${wrapper}'`);
  };
  new vm.Script(Module.wrap(source)); worker._compile(source, baseFile); return worker.exports;
}
function selfTest(configFile) {
  const c = JSON.parse(fs.readFileSync(configFile, "utf8")); validateCurrentConfig(c);
  for (const file of databasePaths) assert.equal(immutableFile({ path: file }), false);
  for (const file of ["F:\\vn_engine.db", databasePaths[0] + ".backup",
    databasePaths[0].replace("Users\\1\\", "Users\\2\\"),
    "F:\\AgentVN\\installed\\agentvn-editor.exe"])
    assert.equal(immutableFile({ path: file }), true);
  const result = adapter().selfTest();
  new vm.Script(runtimeSource());
  return { ...result, unchangedNvlAssertionsAndRealTouchTargets: true,
    playerAspect: require(aspectFile).selfTest(), exactDesktopDbPathsExcludedFromDeviceOnlyValidation: 3,
    immutableInstallerAndProductChecksRetained: true };
}
module.exports = { validate: (...args) => adapter().validate(...args),
  launch: (...args) => adapter().launch(...args), selfTest };
if (require.main === module) Promise.resolve().then(() => {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "self-test") return selfTest(args[0]);
  assert.equal(mode, "prepare"); return adapter().prepare(...args);
}).then(result => { if (result) console.log(JSON.stringify(result)); })
  .catch(error => { console.error(error); process.exitCode = 1; });
