"use strict";
// Reuse the frozen all-page assertions with the genuine later installation.
// Only receipt binding and fresh output locations change; no product changes.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const base = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Editor-1.9.35-20261101-01";
const layoutRoot = "F:/AgentVN/QA/Installed-Layout-20261101-01";
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01";
const actualPath = "F:/AgentVN/QA/Functional-Continuation-20261101/installed-editor-20261101-02/actual-installation.json";
const actual = { path: actualPath,
  sha256: "fed6f66ec01be240dc58f2cabdbfca0c69255cdd7ac2ced1271bd7bbb95c1a1a" };
const fixed = { version: "1.9.35", agentvnNavigation: "existing", qa, actual };
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
function validateCandidateConfig(value) {
  assert.deepEqual(value, fixed, "Only the frozen later candidate and original actual NSIS receipt are allowed");
  assert.equal(sha(actual.path), actual.sha256);
  return { ...value, qa: path.resolve(value.qa) };
}
function relocate(source) {
  const edits = [];
  for (const [before, after] of [
    ["F:/AgentVN/QA/Installed-Layout-20261021-01", layoutRoot],
    ["F:/AgentVN/QA/Native-Runtime-State-20261020-01", playerRoot],
  ]) {
    const count = source.split(before).length - 1;
    if (count) {
      source = source.replaceAll(before, after);
      edits.push({ before, after, reason: `Fresh output directory only (${count} occurrences)` });
    }
  }
  return { source, edits };
}
function build(original, receipt, options) {
  const result = base.build(original, receipt, options), moved = relocate(result.source);
  assert.equal(moved.edits.length, 1);
  return { source: moved.source, adaptations: [...result.adaptations, ...moved.edits] };
}
function worker(file, source, argv) {
  new vm.Script(Module.wrap(source));
  // Existing cache helper already supports an explicit exact editor-run root.
  // This is consumed by the QA helper only, not a product data-directory override.
  process.env.AGENTVN_INSTALLED_GUI_QA_ROOT = path.resolve(layoutRoot);
  process.argv = [process.execPath, file, ...argv];
  const loaded = new Module(file, module);
  loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded.require = function (request) {
    if (request === "./candidate-layout-consumption.cjs")
      return { ...base, build, validateCandidateConfig };
    return Module.prototype.require.call(this, request);
  };
  loaded._compile(source, file);
}
function selfTest() {
  const descriptor = deriveActual(actual, fixed.version);
  assert.equal(descriptor.executable.sha256,
    "a1ece0a5d69cc0c319fd5d8fe6a9cdca8259f88fd7eeaeae1cc18e88c4fb5dd8");
  validateCandidateConfig(structuredClone(fixed));
  for (const mutate of [
    c => c.version = "1.9.34", c => c.agentvnNavigation = "new",
    c => c.qa = "C:/", c => c.actual.path = qa + "/invented-receipt.json",
    c => c.actual.sha256 = "0".repeat(64), c => c.extra = true,
  ]) {
    const bad = structuredClone(fixed); mutate(bad);
    assert.throws(() => validateCandidateConfig(bad));
  }
  const author = build(fs.readFileSync(path.join(__dirname, "installed-layout-pages-current.cjs"), "utf8"),
    qa + "/self-test-only.json", { version: fixed.version, agentvnNavigation: "existing" });
  new vm.Script(Module.wrap(author.source));
  for (const name of ["installed-authored-layout-roundtrip.cjs", "installed-authored-layout-player.cjs",
    "candidate-layout-consumption-audit.cjs"]) {
    const moved = relocate(fs.readFileSync(path.join(__dirname, name), "utf8"));
    assert(moved.edits.length > 0); new vm.Script(Module.wrap(moved.source));
  }
  const valid = { present: true, count: 1, background: "rgba(38, 55, 70, 0.78)", opacity: "1",
    visible: true, rect: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    viewport: { width: 1920, height: 1080 }, overflow: 0, focusUnavailable: false };
  const style = { backgroundColor: "#263746" };
  base.materialAssertion(valid, style, "about");
  for (const patch of [{ present: false }, { count: 2 }, { background: "rgb(1, 2, 3)" },
    { opacity: "0" }, { visible: false }, { overflow: 50 }, { focusUnavailable: true },
    { rect: { ...valid.rect, right: 2000 } }])
    assert.throws(() => base.materialAssertion({ ...valid, ...patch }, style, "about"));
  return { status: "PASS", candidate: descriptor.executable, invalidConfigurationsRejected: 6,
    invalidMaterialEvidenceRejected: 8, compiledWorkflows: 4, productChanges: 0, modelRequests: 0 };
}
function run(mode, attempt) {
  assert(["author", "roundtrip", "player", "audit"].includes(mode));
  assert.match(attempt, /^\d{2}$/);
  const config = validateCandidateConfig(fixed);
  const descriptor = deriveActual(config.actual, config.version);
  fs.mkdirSync(qa, { recursive: true });
  const configFile = path.join(qa, "current-layout-candidate.json");
  if (fs.existsSync(configFile)) assert.deepEqual(read(configFile), fixed);
  else fs.writeFileSync(configFile, JSON.stringify(fixed, null, 2), { flag: "wx" });
  const prep = path.join(qa, mode === "author" ? `layout-consumption-preparation-${attempt}`
    : `layout-closure-${mode}-preparation-${attempt}`);
  fs.mkdirSync(prep, { recursive: false });
  let filename, result, argv;
  if (mode === "author") {
    const receipt = path.join(prep, "derived-actual-installation.json");
    fs.writeFileSync(receipt, JSON.stringify(descriptor, null, 2), { flag: "wx" });
    filename = path.join(__dirname, "installed-layout-pages-current.cjs");
    result = build(fs.readFileSync(filename, "utf8"), receipt,
      { version: config.version, agentvnNavigation: config.agentvnNavigation });
    argv = ["author", attempt, "--matrix", "--codex-cache-view"];
  } else {
    const files = { roundtrip: "installed-authored-layout-roundtrip.cjs",
      player: "installed-authored-layout-player.cjs", audit: "candidate-layout-consumption-audit.cjs" };
    filename = path.join(__dirname, files[mode]);
    const moved = relocate(fs.readFileSync(filename, "utf8"));
    result = { source: moved.source, adaptations: moved.edits };
    const authorReport = `${layoutRoot}/editor-02/report.json`;
    const roundtripReport = `${layoutRoot}/editor-03/report.json`;
    const playerReport = `${playerRoot}/authored-layout-${config.version}-01/report.json`;
    argv = mode === "roundtrip" ? [configFile, authorReport, attempt]
      : mode === "player" ? [configFile, roundtripReport, attempt]
        : ["02", attempt, `--candidate-config=${configFile}`, "--roundtrip=03", `--player-report=${playerReport}`];
  }
  new vm.Script(Module.wrap(result.source));
  const executed = path.join(prep, mode === "author" ? "executed-layout-pages.cjs" : "adapted-executed-test.cjs");
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(prep, "frozen-adapter.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
    version: config.version, mode, actual: config.actual,
    options: { version: config.version, agentvnNavigation: config.agentvnNavigation },
    source: describe(filename), executed: describe(executed), adapter: describe(__filename),
    adaptations: result.adaptations, arguments: argv, productChanges: 0, modelRequests: 0,
    boundaries: ["Original installation receipt retained in place; no new installation claimed",
      "Historical assertions unchanged; fresh output directories and exact candidate binding only"],
  }, null, 2), { flag: "wx" });
  worker(filename, result.source, argv);
}
if (require.main === module) {
  const [mode, attempt = "01"] = process.argv.slice(2);
  if (mode === "self-test") console.log(JSON.stringify(selfTest()));
  else run(mode, attempt);
}
module.exports = { selfTest, build, relocate, validateCandidateConfig };
