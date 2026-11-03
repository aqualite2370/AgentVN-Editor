"use strict";
// QA only. Reuse the real three-category old-save workflow against the frozen
// 1.9.35 official-GUI APK; never rebuild old packages or alter old reports.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const file = require.resolve("./android-renpy-upgrade.cjs");
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const configFile = "F:/AgentVN/QA/Functional-Continuation-20261101/android-renpy-current-config-35.json";
const currentAuditFile = path.join(root, "renpy-artifact-35-audit-01/report.json");
const oldAuditFile = path.join(root, "renpy-artifact-30-audit-02/report.json");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function pair() {
  const c = read(configFile);
  const current = require("./android-candidate-renpy.cjs").loadAudit(configFile, currentAuditFile).a;
  const old = read(oldAuditFile);
  assert.equal(old.status, "RENPY_CANDIDATE_APK_BYTES_PASS_INPUT_ARCHIVE_NOT_RETAINED_DEVICE_NOT_RUN");
  assert.equal(old.identity.versionName, "0.1.4"); assert.equal(old.identity.versionCode, 1004);
  assert.equal(current.identity.versionName, "0.1.5"); assert.equal(current.identity.versionCode, 1005);
  assert.equal(c.version, "1.9.35");
  assert.equal(old.identity.signerSha256, current.identity.signerSha256);
  assert.equal(old.apk.sha256, "0fa02a46030050960d9f0ed6ab132092314e43a07a085562bea0fe1b339501db");
  return [oldAuditFile, currentAuditFile].map((auditFile, n) => {
    const a = n ? current : old;
    assert.equal(a.checks.length, 5); assert(a.checks.every(row => row.status === "PASS"));
    for (const f of [a.apk, a.build]) assert.equal(desc(f.path).sha256, f.sha256);
    const b = read(a.build.path); assert.equal(b.version, n ? "1.9.35" : "1.9.34");
    return { audit: desc(auditFile), apk: a.apk, identity: a.identity, assets: a.embeddedAssets,
      publishingWorkflow: a.checks[0].evidence };
  });
}
function adapter() {
  let source = fs.readFileSync(file, "utf8");
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  };
  const begin = source.indexOf("function pair() {"), end = source.indexOf("function validateRequest(", begin);
  assert(begin >= 0 && end > begin);
  source = source.slice(0, begin) + "function pair() { return module.currentPair(); }\n" + source.slice(end);
  one('const candidate = path.resolve("F:/AgentVN/QA/Editor-1.9.34-20261029-01");',
    'const candidate = path.resolve("F:/AgentVN/QA/Functional-Continuation-20261101");');
  assert.equal(source.split("device-renpy-upgrade-30-").length - 1, 6);
  source = source.replaceAll("device-renpy-upgrade-30-", "device-renpy-upgrade-35-");
  // Replace the previous current version first so the old->new substitutions
  // cannot accidentally move the old fixture through both versions.
  assert.equal(source.split('titleVersion("0.1.4")').length - 1, 3);
  source = source.replaceAll('titleVersion("0.1.4")', 'titleVersion("0.1.5")');
  assert.equal(source.split('titleVersion("0.1.3")').length - 1, 2);
  source = source.replaceAll('titleVersion("0.1.3")', 'titleVersion("0.1.4")');
  one(String.raw`/versionCode=1004\b/`, String.raw`/versionCode=1005\b/`);
  one(String.raw`/versionName=0\.1\.4\b/`, String.raw`/versionName=0\.1\.5\b/`);
  const installedBytes = label => String.raw`
    const installedPath = text(["shell", "pm", "path", q.package])
      .match(/^package:(\/data\/app\/[^\r\n]+\.apk)$/m)?.[1];
    assert(installedPath && !installedPath.includes(".."));
    const installedSha = text(["shell", "sha256sum", installedPath]).split(/\s+/)[0];
    assert.equal(installedSha, q.${label === "old" ? "oldApk" : "apk"}.sha256);
    (r.installedPackageBytes ??= []).push({ label: "${label}", path: installedPath, sha256: installedSha });
`;
  one('    assert.match(text(["install", c.staged[0]]), /Success/);',
    '    assert.match(text(["install", c.staged[0]]), /Success/);' + installedBytes("old"));
  one('    assert.match(text(["install", "-r", c.staged[1]]), /Success/);',
    '    assert.match(text(["install", "-r", c.staged[1]]), /Success/);' + installedBytes("current"));
  one('`require(${JSON.stringify(__filename)}).run(',
    '`require(${JSON.stringify(module.currentAdapter)}).run(');
  one('const files = [__filename, original, startFile, runnerFile,',
    'const files = [__filename, module.currentAdapter, module.currentConfig, original, startFile, runnerFile,');
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  Object.assign(worker, { currentPair: pair, currentAdapter: __filename, currentConfig: configFile });
  new vm.Script(Module.wrap(source)); worker._compile(source, file); return worker.exports;
}
function selfTestSource() {
  const tool = adapter(); tool.runnerSource();
  const scenario = tool.scenario.toString();
  assert(scenario.includes('titleVersion("0.1.5")'));
  assert(scenario.includes('titleVersion("0.1.4")'));
  assert(!scenario.includes('titleVersion("0.1.3")'));
  assert(scenario.includes('["manual", 1], ["auto", 2], ["quick", 3]'));
  assert(scenario.includes("equalFiles(baseline, after)"));
  assert(scenario.includes('assert.deepEqual(await settings(), pref)'));
  assert(scenario.includes('assert.equal(installedSha, q.oldApk.sha256)'));
  assert(scenario.includes('assert.equal(installedSha, q.apk.sha256)'));
  auditAdapter([
    { identity: { versionName: "0.1.4", versionCode: 1004 }, apk: { sha256: "0".repeat(64) } },
    { identity: { versionName: "0.1.5", versionCode: 1005 }, apk: { sha256: "1".repeat(64) } },
  ]);
  console.log(JSON.stringify({ status: "PASS", realThreeCategoryScenarioRetained: true,
    oldExitAndCurrentVersionAssertionsRetained: true, installedBytesChecked: true,
    deviceOperations: 0, builds: 0, modelRequests: 0 }));
}
function selfTestBound(bindingFile) {
  const tool = adapter(), b = read(bindingFile);
  assert.deepEqual(b.pair, pair());
  for (const f of b.sources) assert.equal(desc(f.path).sha256, f.sha256);
  const q = { scope: "installed-native-upgrade", package: "com.agentvn.qa.renpygui20261025",
    sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554", runId: path.basename(b.output),
    outputDir: path.join(b.output, "runtime"), oldApk: b.pair[0].apk, apk: b.pair[1].apk,
    upgradePair: b.pair.map(p => p.identity), adbPort: 58101, cdpPort: 58102,
    coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: 58103, grpcPort: 58104 } };
  tool.validateRequest(q, b);
  const bad = [
    q => q.scope = "other", q => q.package = "other", q => q.sdk = "C:\\other",
    q => q.outputDir += "-other", q => q.runId = "device-renpy-upgrade-30-01",
    q => q.coldBoot.avd = "other", q => q.cdpPort = q.adbPort,
    q => q.upgradePair[1].versionCode = q.upgradePair[0].versionCode,
    q => q.upgradePair[1].signerSha256 = "0".repeat(64),
    q => q.apk.sha256 = "0".repeat(64), q => q.oldApk.path = q.apk.path,
  ];
  for (const mutate of bad) { const invalid = structuredClone(q); mutate(invalid);
    assert.throws(() => tool.validateRequest(invalid, b)); }
  console.log(JSON.stringify({ status: "PASS", actualBoundPairAccepted: true,
    rejectedRequests: bad.length, deviceOperations: 0, builds: 0, modelRequests: 0 }));
}
async function run(bindingFile, requestFile, only) {
  return adapter().run(bindingFile, requestFile, only);
}
function auditAdapter(actualPair) {
  const auditFile = require.resolve("./android-renpy-upgrade-audit.cjs");
  let source = fs.readFileSync(auditFile, "utf8");
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  };
  one("device-renpy-upgrade-30-", "device-renpy-upgrade-35-");
  const begin = source.indexOf("      for (const [n, version, code, sha256] of [");
  const end = source.indexOf("        const p = b.pair[n];", begin);
  assert(begin >= 0 && end > begin);
  source = source.slice(0, begin) + "      for (const [n, version, code, sha256] of " +
    JSON.stringify(actualPair.map((p, n) => [n, p.identity.versionName, p.identity.versionCode, p.apk.sha256])) +
    ") {\n" + source.slice(end);
  one('n === 1 ? "1.9.34" : "1.9.31"', 'n === 1 ? "1.9.35" : "1.9.34"');
  one('Artifact pair only; current Editor normal close remains FAILED',
    'Current installed Editor WM_CLOSE PASS; old Editor close failure preserved, native picker controlled');
  one(String.raw`/versionCode=1004\b/`, String.raw`/versionCode=1005\b/`);
  one(String.raw`/versionName=0\.1\.4\b/`, String.raw`/versionName=0\.1\.5\b/`);
  one('      assert.deepEqual(runtime.sourceApks, { old: b.pair[0].apk, current: b.pair[1].apk });',
    '      assert.deepEqual(runtime.sourceApks, { old: b.pair[0].apk, current: b.pair[1].apk });\n' +
    '      assert.deepEqual(runtime.installedPackageBytes.map(p => [p.label, p.sha256]),\n' +
    '        [["old", b.pair[0].apk.sha256], ["current", b.pair[1].apk.sha256]]);');
  one('  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
    '  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n' +
    '  r.sources.push(desc(module.currentAdapter));\n' +
    '  fs.writeFileSync(path.join(out, "executed-adapted-audit.cjs"), module.currentSource, { flag: "wx" });');
  one('if (require.main === module) {', 'module.exports = { audit, selfTest };\nif (require.main === module) {');
  const worker = new Module(auditFile, module); worker.filename = auditFile; worker.paths = module.paths;
  Object.assign(worker, { currentAdapter: __filename, currentSource: source });
  worker._compile(source, auditFile);
  return worker.exports;
}
async function audit(bindingFile, number) {
  const b = read(bindingFile), actualPair = pair();
  assert.deepEqual(b.pair, actualPair);
  const tool = auditAdapter(actualPair);
  tool.selfTest(bindingFile);
  return tool.audit(bindingFile, number);
}
module.exports = { run };
if (require.main === module) {
  const [mode, arg, number] = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (mode === "self-test-source") return selfTestSource();
    if (mode === "self-test-bound") return selfTestBound(arg);
    if (mode === "prepare") return adapter().prepare(arg);
    if (mode === "launch") return adapter().launch(arg);
    if (mode === "audit") return audit(arg, number);
    throw Error("Expected self-test-source, prepare NUMBER, or launch BINDING");
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
