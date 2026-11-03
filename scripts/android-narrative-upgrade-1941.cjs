"use strict";
// Existing, traceable 0.1.7 APK -> actual 1.9.41 exported 0.1.8 APK.
// Preserve the complete install-r/data guards of the previous upgrade workflow.
const fs = require("node:fs"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const previous = require.resolve("./android-narrative-upgrade-1940.cjs");
function one(s, a, b, count = 1) {
  assert.equal(s.split(a).length - 1, count, a); return s.split(a).join(b);
}
function validateCandidate(c) {
  const file = require.resolve("./android-candidate-1940-device.cjs");
  let s = fs.readFileSync(file, "utf8");
  s = one(s, 'assert.equal(c.version, "1.9.40"); assert.equal(c.attempt, "41");',
    'assert.equal(c.version, "1.9.41"); assert.equal(c.attempt, "43");');
  s = one(s, 'assert.equal(c.gameVersion, "0.1.7"); assert.equal(c.versionCode, 1007);',
    'assert.equal(c.gameVersion, "0.1.8"); assert.equal(c.versionCode, 1008);');
  s += "\nmodule.exports.currentValidator=validateCurrentConfig;\n";
  const w = new Module(file, module); w.filename = file; w.paths = module.paths;
  new vm.Script(Module.wrap(s)); w._compile(s, file); return w.exports.currentValidator(c);
}
function adapter() {
  let s = fs.readFileSync(previous, "utf8");
  s = one(s, "F:/AgentVN/QA/Android-Candidate-1940-20261103-04",
    "F:/AgentVN/QA/Android-Candidate-1941-20261103-02");
  s = one(s, 'const prefix = "device-story-upgrade-41-";', 'const prefix = "device-story-upgrade-43-";');
  const begin = s.indexOf("function validateCurrentCandidate(c) {"), end = s.indexOf("function one(", begin);
  assert(begin >= 0 && end > begin);
  s = s.slice(0, begin) + "function validateCurrentCandidate(c) { return module.validateCandidate(c); }\n" + s.slice(end);
  s = one(s, '[["story-artifact-36-audit-05", "1.9.35", "0.1.6", 1006],\n' +
    '    ["story-artifact-41-audit-01", "1.9.40", "0.1.7", 1007]]',
    '[["story-artifact-41-audit-01", "1.9.40", "0.1.7", 1007],\n' +
    '    ["story-artifact-43-audit-01", "1.9.41", "0.1.8", 1008]]');
  s = one(s, "1165d4705c7f64fd7d4abec0adadc3fef6ad1ecf3febfe560e3118354221f349",
    "dcbfc4749f3b3f9ef1721b25286d15df077895ca362b23981c7c6f53ddf76379");
  s = one(s, `'titleVersion("0.1.7")', 3`, `'titleVersion("0.1.8")', 3`);
  s = one(s, `'titleVersion("0.1.6")', 2`, `'titleVersion("0.1.7")', 2`);
  s = one(s, "String.raw`/versionCode=1007\\b/`", "String.raw`/versionCode=1008\\b/`", 2);
  s = one(s, "String.raw`/versionName=0\\.1\\.7\\b/`", "String.raw`/versionName=0\\.1\\.8\\b/`", 2);
  s = one(s, `'n === 1 ? "1.9.40" : "1.9.35"'`, `'n === 1 ? "1.9.41" : "1.9.40"'`);
  s = one(s, 'return ["android-candidate-1940-device.cjs",',
    'return ["android-narrative-upgrade-1940.cjs", "android-candidate-1940-device.cjs",');
  s = one(s, "auditAdapter([1006, 1007]", "auditAdapter([1007, 1008]");
  s = one(s, "n + 6", "n + 7");
  s = one(s, "module.exports = { run:",
    "module.exports = { prepare: n => adapter().prepare(n), launch: f => adapter().launch(f), audit, run:");
  const w = new Module(__filename, module); w.filename = __filename; w.paths = module.paths;
  w.validateCandidate = validateCandidate; new vm.Script(Module.wrap(s)); w._compile(s, __filename);
  return w.exports;
}
module.exports = { run: (...a) => adapter().run(...a) };
if (require.main === module) Promise.resolve().then(() => {
  const [action, arg, number] = process.argv.slice(2), a = adapter();
  if (action === "self-test") return a.selfTest();
  if (action === "prepare") return a.prepare(arg);
  if (action === "audit") return a.audit(arg, number);
  assert.equal(action, "launch"); return a.launch(arg);
}).then(r => { if (r) console.log(JSON.stringify(r)); })
  .catch(e => { console.error(e); process.exitCode = 1; });
