"use strict";
// Reuse the existing installed UI workflow without changing frozen products.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), crypto = require("node:crypto");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const original = path.join(__dirname, "installed-android-package-current.cjs");
assert.equal(sha(original), "f59eb1602d70e6ce1bdd6bcd72184059532c23e576b8082ed4c14a3d9c7d41c0");
const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const sealed = JSON.parse(fs.readFileSync(installationFile, "utf8"));
assert.equal(sealed.status, "PASS"); assert.equal(sealed.executable.version, "1.9.24");
for (const f of [sealed.package, sealed.executable, ...sealed.resources, ...sealed.protectedFiles])
  assert.equal(sha(f.path), f.sha256, f.path);
function adapt() {
  let source = fs.readFileSync(original, "utf8"); const changes = [];
  function replace(before, after, expected = 1) {
    assert.equal(source.split(before).length - 1, expected, before);
    source = source.split(before).join(after); changes.push({ before, after, occurrences: expected });
  }
  replace('nativeUpgrade ? "1.9.22" :', 'nativeUpgrade ? "1.9.24" :');
  replace('read(nativeUpgrade ? "F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json" :',
    'read(nativeUpgrade ? ' + JSON.stringify(installationFile) + ' :');
  replace('read(nativeUpgrade ? "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/actual-installation.json" :',
    'read(nativeUpgrade ? ' + JSON.stringify(installationFile) + ' :');
  replace('nativeUpgrade ? "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json" :',
    'nativeUpgrade ? ' + JSON.stringify(installationFile) + ' :');
  replace('ELEVATED_ACTUAL_INSTALLED_1_9_22_NATIVE_UI_ANDROID_SAME_GAME_UPGRADE_BUILD',
    'ELEVATED_ACTUAL_INSTALLED_1_9_24_NATIVE_UI_ANDROID_SAME_GAME_BUILD_NOT_DEVICE');
  replace('"scripts/android-current-cache-session.ps1"', '"scripts/candidate-1924-android-package-cache.ps1"', 2);
  replace('  const upgrade = nativeUpgrade ? retainedAndroidFixture() : null;',
    '  const upgrade = nativeUpgrade ? retainedAndroidFixture() : null;\n' +
    '  if (upgrade) { upgrade.gameVersion = "0.1.2"; upgrade.versionCode = 1002; }\n' +
    '  process.env.AGENTVN_TEST_PROJECT = path.join(out, "Android 隔离小工程.vnproj");\n' +
    '  process.env.AGENTVN_WORKSPACE_OUTPUT = out;');
  replace('  const project = upgrade?.project || fixture(`qa_android_pkg_20261021_${attempt}`);',
    '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
    '  fs.writeFileSync(path.join(out, "candidate-adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });\n' +
    '  const project = upgrade?.project || fixture(`qa_android_pkg_20261021_${attempt}`);');
  new vm.Script(Module.wrap(source), { filename: __filename });
  return { source, changes };
}
if (process.argv[2] === "--self-test") {
  console.log(JSON.stringify({ status: "PASS", transformations: adapt().changes.length,
    frozenVersion: sealed.executable.version, productLaunches: 0, apkBuilds: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2, 5),
    ["13", "--physical-package-cache", "--physical-environment-cache"]);
  assert(process.argv.includes("--native-upgrade"));
  assert(process.argv.includes("--administrator-launch=F:\\AgentVN\\QA\\Android-Package-20261021-01\\administrator-13"));
  const adapted = adapt(), worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  Object.assign(worker, { qaSource: adapted.source, qaChanges: adapted.changes });
  worker._compile(adapted.source, __filename);
}
