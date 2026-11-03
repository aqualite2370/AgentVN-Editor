"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./installed-runtime-session.cjs");
const original = path.join(__dirname, "windows-current-native-source.cjs");
assert.equal(sha(original), "1ea8aaca04a1c6c2623366b92bb994a526adeccdc9f2ce4c7c64cebaa1f0bbd4");
let source = fs.readFileSync(original, "utf8");
const one = (before, after) => {
  assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, () => after);
};
one('validateSource = require("../installed-windows-repository-native-audit.cjs").validate;',
  'validateSource = require(config.gameVersion === "1.0.5" ? "../installed-windows-next-build-audit.cjs" : "../installed-windows-repository-native-audit.cjs").validate;');
one('require("./windows-upgrade-fixture-policy.cjs").fixtureFor(config)',
  'require("./windows-next-upgrade-fixture.cjs").fixtureFor(config)');
new vm.Script(Module.wrap(source));
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
function validateRetained1935Source(value) {
  const base = "F:/AgentVN/QA/Windows-Package-20261021-01";
  const files = [
    ["editor-18/report.json", "dd43869ff75d93be03b9f29f762ccba3d44daef9aaae314fed8ac3c2ec8ca90d"],
    ["native-ui-audit-09/report.json", "7ab5a3235c44a1188490a78f40f069ff5df6fe04cf2564112ec954653ca99834"],
    ["setup-payload-audit-09/report.json", "a47e7804d2291ed790279f3878d5521bf4d3360c337b53578f31754596bd46d4"],
  ].map(([relative, sha256]) => ({ path: path.join(base, relative), sha256 }));
  for (const f of files) assert.equal(sha(f.path), f.sha256);
  const context = worker.exports.loadNativeSource(files[0].path, files[1].path);
  assert.equal(context.editorVersion, "1.9.35"); assert.deepEqual(value, context.source);
  const payload = JSON.parse(fs.readFileSync(files[2].path, "utf8"));
  assert.equal(payload.status, "PASS"); assert.equal(payload.source.sha256, files[0].sha256);
  assert.equal(payload.buildAudit.sha256, files[1].sha256);
  assert.deepEqual(payload.candidateBinding, context.candidateBinding);
  assert.equal(payload.pe.fileVersion, "1.0.4"); assert.equal(payload.gameId, value.projectId);
  assert.equal(payload.installer.sha256, value.windowsInstaller.sha256);
  for (const f of [payload.executable, ...payload.resources]) assert.equal(sha(f.path), f.sha256);
  return { version: "1.9.35", gameVersion: "1.0.4", files, candidateBinding: context.candidateBinding };
}
module.exports = { ...worker.exports, validateRetained1935Source };
