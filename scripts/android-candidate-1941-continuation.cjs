"use strict";
// QA adapter for the actual 1.9.41 installation. Preserve the prior candidate's
// executed workflow and failures; no product rebuilding or source edits here.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const base = "F:/AgentVN/QA/Android-Candidate-1941-20261103-01";
const originalFile = require.resolve("./android-candidate-1940-continuation.cjs");
const receiptFile = "F:/AgentVN/QA/Dialog-Pointer-Sequence-20261103-01/installation-02/installation.json";
const actualFile = path.join(base, "derived-actual-installation.json");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function one(s, a, b) {
  assert.equal(s.split(a).length - 1, 1, "Preserved exact QA seam: " + a);
  return s.replace(a, () => b);
}
function adaptedSource() {
  let s = fs.readFileSync(originalFile, "utf8");
  s = one(s, 'const base = "F:/AgentVN/QA/Android-Candidate-1940-20261103-04";',
    'const base = "F:/AgentVN/QA/Android-Candidate-1941-20261103-01";');
  s = one(s, "Original-Component-Replay-20261103-01/installation-02/installation.json",
    "Dialog-Pointer-Sequence-20261103-01/installation-02/installation.json");
  s = one(s, "F:/AgentVN/QA/Windows-Candidate-1940-20261103-01/derived-actual-installation.json", actualFile.replaceAll("\\", "/"));
  s = s.replaceAll('"1.9.40"', '"1.9.41"').replaceAll('"0.1.7"', '"0.1.8"');
  s = one(s, 'assert.equal(c.attempt, "41")', 'assert.equal(c.attempt, "42")');
  s = one(s, 'assert.equal(c.versionCode, 1007)', 'assert.equal(c.versionCode, 1008)');
  s = one(s, 'attempt: "41"', 'attempt: "42"');
  s = one(s, 'versionCode: 1007', 'versionCode: 1008');
  s = one(s, "F:/AgentVN/Checkpoints/Android-Candidate-1940-20261103-04",
    "F:/AgentVN/Checkpoints/Android-Candidate-1941-20261103-01/prepared");
  const start = s.indexOf("function selfTest() {"), end = s.indexOf("async function audit(number)", start);
  assert(start > 0 && end > start);
  s = s.slice(0, start) + "function selfTest() { return module.currentSelfTest(); }\n" + s.slice(end);
  s = one(s, "module.exports = { prepare, selfTest, audit };",
    "module.exports = { prepare, selfTest, audit, config, business };");
  new vm.Script(Module.wrap(s)); return s;
}
function adapter() {
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.currentSelfTest = selfTest; worker._compile(adaptedSource(), __filename); return worker.exports;
}
function prepare() {
  assert(!fs.existsSync(base), "New candidate QA directory required");
  const original = read(receiptFile);
  assert.equal(original.status, "PASS"); assert.equal(original.version, "1.9.41");
  assert.equal(original.metadataRestoration, "PASS"); assert.equal(original.exitCode, 0);
  for (const f of [original.installer, original.executable, ...original.resources, ...original.protectedFiles])
    assert.equal(sha(f.path), f.sha256, f.path);
  const checkpoint = "F:/AgentVN/Checkpoints/Android-Candidate-1941-20261103-01";
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
  const inputs = [__filename, originalFile, receiptFile, path.resolve("AGENTS.md"), path.resolve("plans/ACTIVE_TASKS.md")];
  for (let i = 0; i < inputs.length; i++) {
    const target = path.join(checkpoint, i + "-" + path.basename(inputs[i]));
    fs.copyFileSync(inputs[i], target, fs.constants.COPYFILE_EXCL); assert.equal(sha(target), sha(inputs[i]));
  }
  fs.mkdirSync(base);
  fs.writeFileSync(actualFile, JSON.stringify({
    ...original, registryRestored: original.metadataRestoration === "PASS", sourceReceipt: desc(receiptFile),
    schemaScope: "DERIVED_FIELDS_FROM_EXISTING_ACTUAL_NSIS_RECEIPT_NOT_NEW_INSTALLATION",
  }, null, 2), { flag: "wx" });
  return adapter().prepare();
}
function selfTest() {
  const a = adapter(), { c } = a.config();
  const b = read(path.join(c.preparation, "binding.json"));
  for (const f of b.sources) assert.equal(sha(f.path), f.sha256, f.path);
  const generated = a.business(c);
  assert.equal(generated, fs.readFileSync(path.join(c.preparation, "business.cjs"), "utf8"));
  assert(generated.includes('upgrade.gameVersion = "0.1.8"; upgrade.versionCode = 1008'));
  assert(generated.includes('path.join(out, "observed-standalone-inputs", relative)'));
  assert(!generated.includes('path.join(out, "native-standalone-package", relative)'));
  assert(generated.includes("selectControlledPackageOutput")); assert(generated.includes("Real WM_CLOSE"));
  const launcher = fs.readFileSync(path.join(c.preparation, "launcher.ps1"), "utf8");
  assert(launcher.includes("vn_engine.db-wal")); assert(launcher.includes("vn_engine.db-shm"));
  assert(launcher.includes("Unredirected original file changed")); assert(launcher.includes("uncaught-launcher-error.json"));
  const { validateConfig } = require("./installed-editor-android-candidate.cjs");
  const rejected = [v => v.versionCode = 1007, v => v.version = "1.9.40",
    v => v.preparation = "F:/AgentVN", v => v.installation.sha256 = "0".repeat(64)];
  for (const mutate of rejected) { const bad = structuredClone(c); mutate(bad); assert.throws(() => validateConfig(bad)); }
  const baseline = read(c.installation.path).protectedFiles;
  const databasePaths = ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"].map(name =>
    "C:\\Users\\1\\AppData\\Roaming\\com.agentvn.editor\\backend\\" + name);
  const files = baseline.map(f => ({ path: f.path, existed: !databasePaths.includes(f.path),
    ...(!databasePaths.includes(f.path) ? { sha256: f.sha256 } : {}) }));
  const start = generated.indexOf("      const baselineProtected =");
  const end = generated.indexOf("      report.scope =", start); assert(start > 0 && end > start);
  const simulate = rows => {
    const report = {};
    vm.runInNewContext(generated.slice(start, end), { nativeUpgrade: true, prep: { protectedFiles: baseline },
      protection: { status: "PASS", files: rows }, assert, report, protectionFile: "synthetic-self-test",
      desc: p => ({ path: p }) }, { timeout: 1000 }); return report;
  };
  const simulated = simulate(files);
  assert.equal(simulated.protectedFiles.length, baseline.length - 3);
  assert.equal(simulated.physicalHostAbsentFiles.length, 3);
  for (const mutate of [v => v.pop(), v => v[0].sha256 = "bad", v => v[0].path = "F:\\unapproved.exe"]) {
    const bad = structuredClone(files); mutate(bad); assert.throws(() => simulate(bad));
  }
  return { status: "PASS", version: c.version, rejectedConfigs: rejected.length, syntheticPhysicalGuards: 3,
    protectedCount: baseline.length, sameAuthoredFixture: true,
    modelRequests: 0, builds: 0, productChanges: 0, deviceOperations: 0 };
}
module.exports = { prepare, selfTest, audit: number => adapter().audit(number) };
if (require.main === module) Promise.resolve().then(() => {
  const [action, number] = process.argv.slice(2);
  if (action === "prepare") return prepare();
  if (action === "continue-prepare") {
    assert.deepEqual(fs.readdirSync(base).sort(), ["derived-actual-installation.json", "preparation-failure-01.json"]);
    assert.equal(read(actualFile).sourceReceipt.sha256, sha(receiptFile));
    return adapter().prepare();
  }
  if (action === "self-test") return selfTest();
  assert.equal(action, "audit"); return adapter().audit(number);
}).then(r => { if (r) console.log(JSON.stringify(r)); })
  .catch(e => { console.error(e); process.exitCode = 1; });
