"use strict";
// Use the real NVL advance button. Do not weaken exact physical hit testing.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const nine = require("./android-current-story-nine-device.cjs");
const baseFile = path.join(__dirname, "android-current-story-device.cjs");
const runtimeFile = path.join(__dirname, "android-apk-runtime-qa.cjs");
const before = `await exerciseFullStory({ cdp, script: script.data, report, geometry,
    tap: (selector, label) => tapSelector(cdp, selector, label),`;
const after = `await exerciseFullStory({ cdp, script: script.data, report, geometry,
    tap: async (selector, label) => tapSelector(cdp,
      selector === ".dialog-box" && await cdp.evaluate(
        "document.querySelector('.dialog-box')?.dataset.dialogueLayoutMode === 'nvl'")
        ? ".nvl-advance-surface" : selector, label),`;
function replaceOnce(source, old, replacement) {
  assert.equal(source.split(old).length - 1, 1, `Expected one QA anchor: ${old}`);
  return source.replace(old, replacement);
}
function runtimeSource() { return replaceOnce(nine.runtimeSource(), before, after); }
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
    const copy = path.join(prep, "executed-runtime-source.cjs"), wrapper = path.join(prep, "executed-runtime.cjs");
    const execution = `const fs=require("node:fs"),Module=require("node:module");\n` +
      `const file=${JSON.stringify(runtimeFile)},worker=new Module(file,module);\n` +
      `worker.filename=file;worker.paths=Module._nodeModulePaths(require("node:path").dirname(file));\n` +
      `worker._compile(fs.readFileSync(${JSON.stringify(copy)},"utf8"),file);\n`;
    new vm.Script(runtimeSource()); new vm.Script(Module.wrap(execution));
    fs.writeFileSync(copy, runtimeSource(), { flag: "wx" });
    fs.writeFileSync(wrapper, execution, { flag: "wx" });
    loaded.runtimeSource = copy; loaded.runtimeWrapper = wrapper;
    return replaceOnce(startText, `(Join-Path '${__dirname}' 'android-apk-runtime-qa.cjs')`, `'${wrapper}'`);
  };
  loaded._compile(source, baseFile); return loaded.exports;
}
function selfTest() {
  const changed = runtimeSource(), original = fs.readFileSync(runtimeFile, "utf8");
  assert.equal(changed.replace(after, before).replace("rotatedBar.buttons !== 9", "rotatedBar.buttons !== 8"), original);
  new vm.Script(changed);
  assert.throws(() => replaceOnce(before + before, before, after));
  return { ...adaptedBase().selfTest(), exactAssertionChanges: 1, inputTargetChanges: 1,
    physicalHitChecksUnchanged: true, originalSourcesUnchanged: true };
}
if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "self-test") console.log(JSON.stringify(selfTest()));
  else { assert.equal(mode, "prepare"); console.log(JSON.stringify(adaptedBase().prepare(...args))); }
}
module.exports = { runtimeSource, selfTest };
