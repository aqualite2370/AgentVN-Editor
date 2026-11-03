"use strict";
// QA adapter only: the approved Ren'Py bar has nine items including Hide.
// Preserve the historical runner and the first run's sealed binding verbatim.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const baseFile = path.join(__dirname, "android-current-story-device.cjs");
const runtimeFile = path.join(__dirname, "android-apk-runtime-qa.cjs");
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `Expected one QA anchor: ${before}`);
  return source.replace(before, after);
}
function runtimeSource() {
  return replaceOnce(fs.readFileSync(runtimeFile, "utf8"),
    "rotatedBar.buttons !== 8", "rotatedBar.buttons !== 9");
}
function adaptedBase() {
  let source = fs.readFileSync(baseFile, "utf8");
  source = replaceOnce(source,
    "const startText = tools.startSource(start, runner); tools.validateStartSyntax(startText);",
    "const startText = module.prepareRuntime(prep, tools.startSource(start, runner)); tools.validateStartSyntax(startText);");
  source = replaceOnce(source, "sources([__filename, configFile, auditFile, start, audio,",
    "sources([module.adapterFile, module.runtimeSource, module.runtimeWrapper, __filename, configFile, auditFile, start, audio,");
  const loaded = new Module(baseFile, module);
  loaded.filename = baseFile; loaded.paths = module.paths; loaded.adapterFile = __filename;
  loaded.prepareRuntime = (prep, startText) => {
    const copy = path.join(prep, "executed-runtime-source.cjs");
    const wrapper = path.join(prep, "executed-runtime.cjs");
    const execution = `const fs=require("node:fs"),Module=require("node:module");\n` +
      `const file=${JSON.stringify(runtimeFile)},worker=new Module(file,module);\n` +
      `worker.filename=file;worker.paths=Module._nodeModulePaths(require("node:path").dirname(file));\n` +
      `worker._compile(fs.readFileSync(${JSON.stringify(copy)},"utf8"),file);\n`;
    new vm.Script(runtimeSource()); new vm.Script(Module.wrap(execution));
    fs.writeFileSync(copy, runtimeSource(), { flag: "wx" });
    fs.writeFileSync(wrapper, execution, { flag: "wx" });
    loaded.runtimeSource = copy; loaded.runtimeWrapper = wrapper;
    const original = `(Join-Path '${__dirname}' 'android-apk-runtime-qa.cjs')`;
    return replaceOnce(startText, original, `'${wrapper}'`);
  };
  loaded._compile(source, baseFile); return loaded.exports;
}
function selfTest() {
  const original = fs.readFileSync(runtimeFile, "utf8"), changed = runtimeSource();
  assert.equal(changed.replace("rotatedBar.buttons !== 9", "rotatedBar.buttons !== 8"), original);
  assert.throws(() => replaceOnce("missing", "needle", "new"));
  assert.throws(() => replaceOnce("needle needle", "needle", "new"));
  new vm.Script(changed);
  const base = adaptedBase(); const checked = base.selfTest();
  return { ...checked, exactAssertionChanges: 1, originalRunnerUnchanged: true };
}
if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "self-test") console.log(JSON.stringify(selfTest()));
  else { assert.equal(mode, "prepare"); console.log(JSON.stringify(adaptedBase().prepare(...args))); }
}
module.exports = { runtimeSource, selfTest };
