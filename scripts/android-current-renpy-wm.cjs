"use strict";
// QA only. Reuse the frozen installed candidate and official-GUI fixture;
// one controlled directory response, process-owned WM_CLOSE, no product edits.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const current = require("./installed-android-current-functional.cjs");
const wm = require("./android-current-controlled-wm.cjs");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Functional-Continuation-20261101";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
function one(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "Exact QA seam required");
  return source.replace(before, () => after);
}
function prepare(attempt) {
  assert.match(attempt, /^\d{2}$/);
  const original = read(path.join(qa, "android-current-config-34.json"));
  const configFile = path.join(qa, `android-renpy-current-config-${attempt}.json`);
  const c = { ...original, attempt, fixtureKind: "renpy-official",
    preparation: path.join(qa, `android-renpy-current-preparation-${attempt}`) };
  assert(!fs.existsSync(configFile)); validateConfig(c);
  const fixture = require("./lib/candidate-1924-renpy-android-fixture.cjs").selfTest();
  assert.equal(fixture.status, "PASS");
  fs.writeFileSync(configFile, JSON.stringify(c, null, 2), { flag: "wx" });
  current.adapter().prepare(c, configFile);
  const businessFile = path.join(c.preparation, "business.cjs");
  const generated = wm.business(fs.readFileSync(businessFile, "utf8"));
  new vm.Script(Module.wrap(generated)); fs.writeFileSync(businessFile, generated);
  const bindingFile = path.join(c.preparation, "binding.json"), b = read(bindingFile);
  b.sources = b.sources.map(f => desc(f.path));
  b.sources.push(...[__filename, require.resolve("./android-current-controlled-wm.cjs"),
    require.resolve("./lib/editor-upgrade-wm-close.cjs"),
    require.resolve("./lib/windows-repository-native.cjs")].map(desc));
  b.inputBoundary = { directory: "CONTROLLED_ONCE", close: "WM_CLOSE", physicalInput: false };
  fs.writeFileSync(bindingFile, JSON.stringify(b, null, 2));
  return { status: "PREPARED_NOT_LAUNCHED", configFile, binding: desc(bindingFile),
    launcher: path.join(c.preparation, "launcher.ps1"), fixture,
    productChanges: 0, buildInvocations: 0, modelRequests: 0 };
}
function adapter() {
  const file = require.resolve("./android-candidate-renpy.cjs");
  let source = fs.readFileSync(file, "utf8");
  source = one(source, '  assert(b.normalClose?.receipt.interaction.includes("Computer Use"));',
    '  module.validateActualClose(b);');
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  worker.validateActualClose = wm.validateClose;
  worker._compile(source, file); return worker.exports;
}
function selfTest(configFile) {
  const c = read(configFile); validateConfig(c); assert.equal(c.fixtureKind, "renpy-official");
  const source = wm.business(current.adapter().build("business", c).source);
  assert(source.includes("selectControlledPackageOutput"));
  assert(source.includes('Real WM_CLOSE and natural exit; physical input NOT_RUN'));
  assert(!source.includes('report.nativeOutput = await nativeInput'));
  adapter();
  const b = read(path.join(c.preparation, "binding.json"));
  for (const f of b.sources) assert.equal(sha(f.path), f.sha256);
  return { status: "PASS", installedCandidateAndSourcesBound: true,
    fixture: require("./lib/candidate-1924-renpy-android-fixture.cjs").selfTest(),
    nativePicker: "NOT_RUN_CONTROLLED_INPUT", productChanges: 0, builds: 0, modelRequests: 0 };
}
module.exports = { adapter };
if (require.main === module) {
  const [mode, arg, number] = process.argv.slice(2);
  if (mode === "prepare") console.log(JSON.stringify(prepare(arg)));
  else if (mode === "self-test") console.log(JSON.stringify(selfTest(arg)));
  else { assert.equal(mode, "audit"); adapter().audit(arg, number).catch(e => { console.error(e); process.exitCode = 1; }); }
}
