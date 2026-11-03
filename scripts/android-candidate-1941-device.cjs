"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const held = require("./lib/android-dialog-held-input.cjs");
const prior = require.resolve("./android-candidate-1940-device.cjs");
function one(s, a, b) {
  assert.equal(s.split(a).length - 1, 1, a); return s.replace(a, () => b);
}
function extendRuntime(s) {
  s = one(s, '  run(["shell", "input", "swipe", String(x), String(y), String(x), String(y), "120"]);',
    `  const heldAdvance = label === "full-story advance one page or command";
  const heldHelper = require(${JSON.stringify(require.resolve("./lib/android-dialog-held-input.cjs"))});
  const heldTrial = heldAdvance ? await heldHelper.before(cdp, label, selector) : null;
  run(["shell", "input", "swipe", String(x), String(y), String(x), String(y), heldAdvance ? "650" : "120"]);`);
  s = one(s, '  await delay(650);\n}\n\nasync function ensureQuickMenuExpanded',
    `  await delay(650);
  if (heldTrial) {
    try { await heldHelper.after(cdp, heldTrial, report); }
    finally { fs.writeFileSync(path.join(outputDir, "runtime-smoke-report.json"), JSON.stringify(report, null, 2)); }
  }
}

async function ensureQuickMenuExpanded`);
  new vm.Script(s); return s;
}
function adapter() {
  let s = fs.readFileSync(prior, "utf8");
  s = one(s, 'assert.equal(c.version, "1.9.40"); assert.equal(c.attempt, "41");',
    'assert.equal(c.version, "1.9.41"); assert.equal(c.attempt, "43");');
  s = one(s, 'assert.equal(c.gameVersion, "0.1.7"); assert.equal(c.versionCode, 1007);',
    'assert.equal(c.gameVersion, "0.1.8"); assert.equal(c.versionCode, 1008);');
  s = one(s, 'return one(nvl.runtimeSource(),', 'return module.extendRuntime(one(nvl.runtimeSource(),');
  s = one(s, '    await exerciseInstalledFullStory(cdp);`);',
    '    await exerciseInstalledFullStory(cdp);`));');
  s = one(s, 'sources([module.adapterFile, module.aspectFile,',
    `sources(['${prior.replaceAll("\\", "/")}', module.adapterFile, module.aspectFile,`);
  s = one(s, "module.exports = { validate:", "module.exports = { prepare: (...a) => adapter().prepare(...a), validate:");
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.extendRuntime = extendRuntime; new vm.Script(Module.wrap(s)); worker._compile(s, __filename);
  return worker.exports;
}
module.exports = { validate: (...a) => adapter().validate(...a), launch: (...a) => adapter().launch(...a) };
if (require.main === module) Promise.resolve().then(() => {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "self-test") return { ...adapter().selfTest(args[0]), heldInput: held.selfTest() };
  assert.equal(mode, "prepare");
  return adapter().prepare(...args);
}).then(r => { if (r) console.log(JSON.stringify(r)); })
  .catch(e => { console.error(e); process.exitCode = 1; });
