"use strict";
// Run historical complete story assertions against the actual frozen candidate.
// Preserve every business assertion; update only provenance, scope and outputs.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Runtime-Story-1.9.35-20261101-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Runtime-Story-QA-20261101-01";
const layoutRoot = "F:/AgentVN/QA/Installed-Layout-20261101-01";
const runtimeRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01";
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const actual = {
  path: "F:/AgentVN/QA/Functional-Continuation-20261101/installed-editor-20261101-02/actual-installation.json",
  sha256: "fed6f66ec01be240dc58f2cabdbfca0c69255cdd7ac2ced1271bd7bbb95c1a1a",
};
const version = "1.9.35", playerHash = "66945ed6a9d026ab2f17370c9fe1fa207cdc741b7005f61f1ccd539c56e46b0e";
// These values are also inserted into quoted JS source: keep literal-safe "/".
const receipt = qa + "/derived-actual-installation.json";
const currentCheckpoint = checkpoint + "/report.json";
const legacyCheckpoint = "F:/AgentVN/Checkpoints/Installed-Runtime-Story-1922-20261023-01/report.json";
const sources = { export: "installed-runtime-story-export-1922.cjs",
  session: "installed-runtime-story-1922.cjs", player: "installed-runtime-abilities-playwright.cjs",
  audit: "installed-runtime-story-audit.cjs" };
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
function replace(source, before, after, edits, required = true) {
  const count = source.split(before).length - 1;
  if (required) assert(count > 0, "Missing QA adaptation: " + before);
  if (!count) return source;
  edits.push({ before, after, count });
  return source.replaceAll(before, () => after);
}
function adapt(mode, source) {
  const edits = [];
  const update = (before, after, required = true) => source = replace(source, before, after, edits, required);
  update("F:/AgentVN/QA/Installed-Layout-20261021-01", layoutRoot, false);
  update("F:/AgentVN/QA/Native-Runtime-State-20261020-01", runtimeRoot, false);
  update(legacyCheckpoint, currentCheckpoint, false);
  update("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json",
    receipt, false);
  // The general root relocation above may already have changed this reference.
  update(layoutRoot + "/editor-38/derived-installation-receipt.json", receipt, false);
  update('"1.9.22"', JSON.stringify(version), false);
  update("a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59", playerHash, false);
  update("ACTUAL_1922_", "ACTUAL_1935_", false);
  update("installed-story-1922-", "installed-story-1935-", false);
  update("qa_story_1922_", "qa_story_1935_", false);
  if (mode === "export")
    update('page.locator(".recent-project-open:visible")',
      'page.locator(\'[data-help-key="home.recentProject"]:visible\')');
  if (mode === "session") {
    update('"scripts/native-dev-preview-profile.ps1", "-Action"', JSON.stringify(helper) + ', "-Action"');
    update('["scripts/installed-runtime-abilities-playwright.cjs", cell.out,',
      `[${JSON.stringify(__filename)}, "player", cell.out,`);
    update('["scripts/installed-runtime-abilities-playwright.cjs", cross,',
      `[${JSON.stringify(__filename)}, "player", cross,`);
  }
  new vm.Script(Module.wrap(source));
  return { source, edits };
}
function descriptor() {
  const installed = deriveActual(actual, version);
  assert.equal(installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256, playerHash);
  return installed;
}
function verifyFixture() {
  const old = read(legacyCheckpoint), reference = old.fixture;
  assert.equal(sha(reference.path), reference.sha256);
  const fixture = read(reference.path);
  assert.equal(sha(fixture.input), fixture.inputSha256);
  assert.equal(fixture.inputSha256, reference.inputSha256);
  return { reference, fixture };
}
function prepare() {
  const installed = descriptor(), { reference } = verifyFixture();
  fs.mkdirSync(qa, { recursive: false });
  fs.writeFileSync(receipt, JSON.stringify(installed, null, 2), { flag: "wx" });
  fs.writeFileSync(currentCheckpoint, JSON.stringify({
    status: "PASS", scope: "CURRENT_CANDIDATE_QA_CHECKPOINT_AND_EXISTING_SYNTHETIC_FIXTURE_NOT_PRODUCT_BUILD",
    startedAt: new Date().toISOString(), actual, fixture: reference,
    products: [installed.executable, ...installed.resources], modelRequests: 0, productChanges: 0,
    helper: describe(helper), legacyCheckpoint: describe(legacyCheckpoint),
  }, null, 2), { flag: "wx" });
}
function run(mode, args) {
  assert(Object.hasOwn(sources, mode));
  const installed = descriptor();
  assert.deepEqual(read(receipt), installed);
  const stored = read(currentCheckpoint);
  assert.deepEqual(stored.actual, actual); assert.equal(sha(helper), stored.helper.sha256);
  const original = path.join(__dirname, sources[mode]);
  const result = adapt(mode, fs.readFileSync(original, "utf8"));
  let folder;
  if (mode === "player") {
    const prepIndex = args.indexOf("--current-native-preparation");
    assert(prepIndex >= 0);
    const prep = read(args[prepIndex + 1]);
    assert.equal(prep.executable.sha256, playerHash);
    assert.equal(prep.sessionRoot, path.join(runtimeRoot, "installed-story-1935-01"));
    const relative = path.relative(prep.sessionRoot, path.resolve(args[0]));
    assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    folder = path.join(qa, "player-preparation-" + path.basename(args[0]));
  } else folder = path.join(qa, mode + "-preparation-" + (args[0] || "01"));
  fs.mkdirSync(folder, { recursive: false });
  const executed = path.join(folder, "executed.cjs");
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(folder, "frozen-adapter.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(folder, "binding.json"), JSON.stringify({
    mode, version, actual, original: describe(original), executed: describe(executed),
    adapter: describe(__filename), edits: result.edits, args, profileHelper: describe(helper),
    productChanges: 0, modelRequests: 0, builds: 0,
  }, null, 2), { flag: "wx" });
  process.env.AGENTVN_INSTALLED_GUI_QA_ROOT = path.resolve(layoutRoot);
  process.argv = [process.execPath, original, ...args];
  const worker = new Module(original, module);
  worker.filename = original; worker.paths = Module._nodeModulePaths(path.dirname(original));
  // Export/session files invoke their CLI only when require.main is themselves.
  require.main = worker; process.mainModule = worker;
  worker._compile(result.source, original);
}
if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "self-test") {
    descriptor(); verifyFixture();
    const counts = Object.entries(sources).map(([kind, name]) => {
      const source = fs.readFileSync(path.join(__dirname, name), "utf8"), result = adapt(kind, source);
      for (const edit of result.edits)
        if (edit.after.startsWith("F:/")) assert(!edit.after.includes("\\"),
          "Raw quoted source paths must use forward slashes");
      let reversed = result.source;
      for (const edit of [...result.edits].reverse())
        reversed = reversed.replaceAll(edit.after, () => edit.before);
      assert.equal(reversed, source, "Adapter must have no unrecorded modifications");
      return { mode: kind, edits: result.edits.length };
    });
    console.log(JSON.stringify({ status: "PASS", frozenPlayer: playerHash, workflows: counts, productChanges: 0 }));
  } else if (mode === "prepare") prepare();
  else run(mode, args);
}
module.exports = { adapt, descriptor };
