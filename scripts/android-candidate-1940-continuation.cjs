"use strict";
// Current installation -> the preserved narrative publishing workflow. Historical
// source files/receipts remain unchanged. This adapter never changes the product.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const current = require("./installed-android-current-functional.cjs");
const wm = require("./android-current-controlled-wm.cjs");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const base = "F:/AgentVN/QA/Android-Candidate-1940-20261103-04";
const databasePaths = ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]
  .map(name => "C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\" + name);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function one(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "Frozen QA seam changed: " + before);
  return source.replace(before, () => after);
}
function compile(file, source, extras = {}) {
  new vm.Script(Module.wrap(source));
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  Object.assign(worker, extras); worker._compile(source, file); return worker.exports;
}
function narrative() {
  const file = require.resolve("./android-current-story-package.cjs");
  return compile(file, one(fs.readFileSync(file, "utf8"), "module.exports = { narrativeFixture };",
    "module.exports = { narrativeFixture, business };"));
}
function config() {
  const file = path.join(base, "config.json"), c = read(file); validateConfig(c);
  assert.equal(c.version, "1.9.40"); assert.equal(c.attempt, "41");
  assert.equal(c.gameVersion, "0.1.7"); assert.equal(c.versionCode, 1007);
  assert.equal(c.outputDirectoryMode, "controlled-once");
  assert.equal(sha(c.storyFixture.path), c.storyFixture.sha256);
  narrative().narrativeFixture(c.storyFixture.path); return { file, c };
}
function business(c) {
  let source = narrative().business(c, current.adapter().build("business", c).source);
  source = one(source, 'if (!f.path.endsWith("\\\\Roaming\\\\com.agentvn.editor\\\\backend\\\\vn_engine.db"))',
    `if (!${JSON.stringify(databasePaths)}.includes(f.path))`);
  // The cache owner later archives to native-standalone-package. Keep the early
  // build-input copy separate so successful finally cannot collide with it.
  return one(source, 'path.join(out, "native-standalone-package", relative)',
    'path.join(out, "observed-standalone-inputs", relative)');
}
function prepare() {
  for (const name of ["config.json", "verified-existing-installation.json", "preparation"])
    assert(!fs.existsSync(path.join(base, name)), "Existing prepared input must not be overwritten");
  fs.mkdirSync(base, { recursive: true });
  const receiptFile = "F:/AgentVN/QA/Original-Component-Replay-20261103-01/installation-02/installation.json";
  const actualFile = "F:/AgentVN/QA/Windows-Candidate-1940-20261103-01/derived-actual-installation.json";
  const original = read(receiptFile), actual = read(actualFile);
  assert.equal(original.status, "PASS"); assert.equal(original.version, "1.9.40");
  assert.equal(original.metadataRestoration, "PASS");
  assert.equal(actual.status, "PASS"); assert.equal(actual.registryRestored, true);
  assert.equal(path.resolve(actual.sourceReceipt.path), path.resolve(receiptFile));
  assert.equal(actual.sourceReceipt.sha256, sha(receiptFile));
  for (const name of ["version", "installer", "executable", "installRoot", "exitCode"])
    assert.deepEqual(actual[name], original[name], name);
  const sealedFile = path.join(base, "verified-existing-installation.json");
  const protectedFiles = [...new Map([original.executable, ...original.resources, ...original.protectedFiles]
    .map(f => [path.resolve(f.path).toLowerCase(), desc(f.path)])).values()];
  assert(protectedFiles.length >= 4);
  fs.writeFileSync(sealedFile, JSON.stringify({ ...original, protectedFiles, actualInstallation: desc(actualFile),
    sourceReceipt: desc(receiptFile), scope: "SCHEMA_ADAPTER_OF_ACTUAL_INSTALLATION_NOT_NEW_INSTALLATION" }, null, 2), { flag: "wx" });
  const previous = read("F:/AgentVN/QA/Functional-Continuation-20261101/android-story-current-config-36.json");
  const c = { ...previous, version: "1.9.40", attempt: "41", gameVersion: "0.1.7", versionCode: 1007,
    preparation: path.join(base, "preparation"), installation: desc(sealedFile), actualInstallation: desc(actualFile) };
  const file = path.join(base, "config.json"); validateConfig(c);
  fs.writeFileSync(file, JSON.stringify(c, null, 2), { flag: "wx" });
  current.adapter().prepare(c, file);
  const launcherFile = path.join(c.preparation, "launcher.ps1");
  let launcher = fs.readFileSync(launcherFile, "utf8");
  // The actual unredirected host has none of these three DB files; the desktop
  // package view has all three. Snapshot their real existence/bytes before and
  // after, just as the original workflow already does for the main DB.
  launcher = one(launcher,
    "if($file.path -cne 'C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\vn_engine.db') {",
    "if($file.path -cnotin @('C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\vn_engine.db'," +
    "'C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\vn_engine.db-wal'," +
    "'C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\vn_engine.db-shm')) {");
  launcher = one(launcher, "$ErrorActionPreference='Stop'",
    "$ErrorActionPreference='Stop'\ntrap {\n" +
    "  $diagnostic=@{status='FAILED_BEFORE_TERMINAL_RECEIPT';at=[DateTime]::UtcNow.ToString('o');" +
    "action=$Action;pid=$PID;error=$_.Exception.ToString();stack=$_.ScriptStackTrace}\n" +
    "  [IO.File]::WriteAllText(" + "'" + path.join(base, "uncaught-launcher-error.json") + "'," +
    "($diagnostic|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))\n  break\n}");
  fs.writeFileSync(launcherFile, launcher);
  const businessFile = path.join(c.preparation, "business.cjs");
  fs.writeFileSync(businessFile, business(c));
  const bindingFile = path.join(c.preparation, "binding.json"), b = read(bindingFile);
  b.sources = b.sources.map(f => desc(f.path));
  b.sources.push(...[__filename, receiptFile, c.storyFixture.path,
    require.resolve("./android-current-story-package.cjs"),
    require.resolve("./android-current-controlled-wm.cjs"),
    require.resolve("./lib/editor-upgrade-wm-close.cjs"),
    require.resolve("./lib/windows-repository-native.cjs")].map(desc));
  b.inputBoundary = { directory: "CONTROLLED_ONCE", close: "WM_CLOSE", physicalInput: false };
  b.earlyInputArchive = "observed-standalone-inputs";
  fs.writeFileSync(bindingFile, JSON.stringify(b, null, 2));
  const checkpoint = "F:/AgentVN/Checkpoints/Android-Candidate-1940-20261103-04";
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
  for (const input of [__filename, file, sealedFile, bindingFile, receiptFile]) {
    const destination = path.join(checkpoint, path.basename(input));
    fs.copyFileSync(input, destination, fs.constants.COPYFILE_EXCL); assert.equal(sha(destination), sha(input));
  }
  return { status: "PREPARED_NOT_LAUNCHED", config: file, binding: desc(bindingFile), checkpoint,
    launcher: path.join(c.preparation, "launcher.ps1"), builds: 0, modelRequests: 0, productChanges: 0 };
}
function selfTest() {
  const { c } = config(), b = read(path.join(c.preparation, "binding.json"));
  for (const f of b.sources) assert.equal(sha(f.path), f.sha256);
  const generated = business(c);
  assert.equal(generated, fs.readFileSync(path.join(c.preparation, "business.cjs"), "utf8"));
  assert(generated.includes('upgrade.gameVersion = "0.1.7"; upgrade.versionCode = 1007'));
  assert(generated.includes('path.join(out, "observed-standalone-inputs", relative)'));
  assert(!generated.includes('path.join(out, "native-standalone-package", relative)'));
  assert(generated.includes("selectControlledPackageOutput")); assert(generated.includes("Real WM_CLOSE"));
  const launcher = fs.readFileSync(path.join(c.preparation, "launcher.ps1"), "utf8");
  assert(launcher.includes("vn_engine.db-wal")); assert(launcher.includes("vn_engine.db-shm"));
  assert(launcher.includes("Unredirected original file changed"));
  assert(launcher.includes("uncaught-launcher-error.json"));
  const physical = read("F:/AgentVN/QA/Android-Candidate-1940-20261103-02/physical-baseline-check.json");
  assert.equal(physical.status, "OBSERVED"); assert(physical.isElevated);
  const start = generated.indexOf("      const baselineProtected =");
  const end = generated.indexOf("      report.scope =", start);
  assert(start > 0 && end > start);
  const snippet = generated.slice(start, end);
  const baseline = read(c.installation.path).protectedFiles;
  const files = physical.files.map(f => ({ path: f.path, existed: f.exists,
    ...(f.exists ? { sha256: f.actual } : {}) }));
  const simulate = entries => {
    const report = {};
    vm.runInNewContext(snippet, { nativeUpgrade: true, prep: { protectedFiles: baseline },
      protection: { status: "PASS", files: entries }, assert, report, protectionFile: "physical",
      desc: p => ({ path: p }) }, { timeout: 1000 });
    return report;
  };
  const simulated = simulate(files);
  assert.equal(simulated.protectedFiles.length, 10);
  assert.equal(simulated.physicalHostAbsentFiles.length, 3);
  for (const mutate of [v => v.pop(), v => v[0].sha256 = "bad", v => v[0].path = "F:\\unapproved.exe"]) {
    const bad = structuredClone(files); mutate(bad); assert.throws(() => simulate(bad));
  }
  const present = structuredClone(files);
  for (const row of present) if (databasePaths.includes(row.path)) {
    row.existed = true; row.sha256 = "a".repeat(64);
  }
  assert.equal(simulate(present).protectedFiles.length, 13);
  const rejected = [v => v.versionCode = 1006, v => v.version = "1.9.35",
    v => v.preparation = "F:/AgentVN", v => v.installation.sha256 = "0".repeat(64)];
  for (const mutate of rejected) { const bad = structuredClone(c); mutate(bad); assert.throws(() => validateConfig(bad)); }
  return { status: "PASS", rejected: rejected.length, physicalGuardRejected: 3, physicalProtectionCases: 5,
    version: c.version, sameAuthoredFixture: true,
    nonCollidingArchive: true, builds: 0, modelRequests: 0, productChanges: 0 };
}
async function audit(number) {
  assert.match(number, /^\d{2}$/); const { c, file: configFile } = config();
  const helper = require.resolve("./android-candidate-renpy.cjs");
  let commonSource = one(fs.readFileSync(helper, "utf8"),
    '  assert(b.normalClose?.receipt.interaction.includes("Computer Use"));', "  module.validateActualClose(b);");
  commonSource = one(commonSource, 'path.join(source, "native-standalone-package", relative)',
    'path.join(source, "observed-standalone-inputs", relative)');
  const common = compile(helper, commonSource, { validateActualClose: wm.validateClose });
  const sealed = read(c.installation.path), originalAudit = require.resolve("./android-current-story-audit.cjs");
  let source = one(fs.readFileSync(originalAudit, "utf8"),
    'const common = require("./android-current-renpy-wm.cjs").adapter();', "const common = module.currentCommon;");
  source = one(source, '"a1ece0a5d69cc0c319fd5d8fe6a9cdca8259f88fd7eeaeae1cc18e88c4fb5dd8"',
    JSON.stringify(sealed.executable.sha256));
  source = one(source, "sources: [desc(__filename)],", "sources: [desc(__filename), desc(module.currentAdapter)],");
  const worker = compile(originalAudit, source + "\nmodule.exports = { audit };\n",
    { currentCommon: common, currentAdapter: __filename });
  return worker.audit(configFile, number);
}
module.exports = { prepare, selfTest, audit };
if (require.main === module) Promise.resolve().then(() => {
  const [action, number] = process.argv.slice(2);
  if (action === "prepare") return prepare();
  if (action === "self-test") return selfTest();
  assert.equal(action, "audit"); return audit(number);
}).then(result => { if (result) console.log(JSON.stringify(result)); })
  .catch(error => { console.error(error); process.exitCode = 1; });
