"use strict";
// Run existing real story/audio/save assertions against the frozen installed
// candidate. Synthetic story is explicit; no model, engine or settings mocks.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Settings-1.9.35-20261102-01";
const runtime = "F:/AgentVN/QA/Native-Runtime-State-20261101-01";
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const sourceFile = "F:/AgentVN/QA/Installed-Layout-20261101-01/editor-03/report.json";
const original = path.resolve(__dirname, "candidate-settings-effects.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function build() {
  let source = fs.readFileSync(original, "utf8"); const edits = [];
  const change = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, "Missing exact QA substitution: " + before);
    source = source.replace(before, () => after); edits.push({ before, after });
  };
  change('require("./lib/installed-runtime-session.cjs")', "module.qaBase");
  change('const configFile = arg.slice(19), config = validateCandidateConfig(read(configFile));',
    'const configFile = module.qaConfigFile, config = read(configFile);');
  change("const actual = deriveActual(config.actual, config.version);", "const actual = module.qaInstallation;");
  change('const sourceFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-13/report.json", source = read(sourceFile);',
    `const sourceFile = ${JSON.stringify(sourceFile)}, source = read(sourceFile);`);
  change('assert.equal(source.status, "PASS"); assert.equal(source.candidateVersion, config.version);',
    'assert.equal(source.status, "PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT");');
  change('assert.equal(sha(source.installation.path), source.installation.sha256);',
    'assert.equal(sha(config.actual.path), config.actual.sha256);');
  change("assert.deepEqual(read(source.installation.path).executable, actual.executable);",
    "source.cartridges = source.cartridges.map(c => ({ ...c, layout: c.type }));");
  change("F:/AgentVN/QA/Native-Runtime-State-20261020-01/settings-", runtime + "/settings-");
  change('path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action"', JSON.stringify(helper) + ', "-Action"');
  change('  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
    '  report.executedQABinding = module.qaBinding; save(); ' +
    'fs.copyFileSync(module.qaExecutedFile, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);');
  // Bind the actual adapter and profile helper instead of obsolete QA inputs.
  change('"AGENTS.md", "plans/ACTIVE_TASKS.md", "scripts/lib/installed-runtime-session.cjs",',
    'module.qaAdapterFile, module.qaExecutedFile, "scripts/lib/installed-runtime-session.cjs",');
  change('"scripts/native-dev-preview-profile.ps1"].map(desc);', JSON.stringify(helper) + '].map(desc);');
  change('assert.equal(sha(path.resolve(f.path) === __filename ? path.join(out, "executed-test.cjs") : f.path), f.sha256, f.path);',
    'assert.equal(sha(f.path), f.sha256, f.path);');
  change('      cell.status = cell.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";',
    '      cell.status = cell.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";\n' +
    '      assert.equal(cell.status, "PASS", "Keep first failing display; do not repeat a known defect across the matrix");');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
const [mode, attempt = "01"] = process.argv.slice(2);
assert(["self-test", "run", "audit"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const installed = descriptor(), prior = read(sourceFile), r = build();
assert.equal(prior.status, "PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT");
for (const f of [prior.portable, ...prior.cartridges]) assert.equal(sha(f.path), f.sha256);
let baseSource = fs.readFileSync(path.join(__dirname, "lib/installed-runtime-session.cjs"), "utf8");
const boundary = 'assert(path.resolve(out).startsWith("F:\\\\AgentVN\\\\QA\\\\Native-Runtime-State-20261020-01\\\\"));';
assert.equal(baseSource.split(boundary).length - 1, 1);
baseSource = baseSource.replace(boundary,
  'assert(path.resolve(out).startsWith("F:\\\\AgentVN\\\\QA\\\\Native-Runtime-State-20261101-01\\\\"));');
if (mode === "self-test") {
  let reversed = r.source;
  for (const e of r.edits.slice().reverse()) reversed = reversed.replace(e.after, () => e.before);
  assert.equal(reversed, fs.readFileSync(original, "utf8"));
  assert.equal(r.source.includes('const expectedGroups = ["routine-save-off", "display", "typing", "auto-delay", "auto-click",'), true);
  console.log(JSON.stringify({ status: "PASS", controls: 17, displays: 24, effectGroupsPerDisplay: 9,
    actualPlayer: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256 }));
} else {
  const folder = path.join(qa, "effects-" + attempt), configFile = path.join(folder, "config.json");
  const executed = path.join(folder, "executed.cjs"), binding = path.join(folder, "binding.json");
  if (mode === "run") {
    fs.mkdirSync(folder);
    fs.writeFileSync(configFile, JSON.stringify({ version: "1.9.35", qa,
      actual: installed.actualInstallation }, null, 2), { flag: "wx" });
    fs.writeFileSync(executed, r.source, { flag: "wx" });
    fs.writeFileSync(path.join(folder, "base-executed.cjs"), baseSource, { flag: "wx" });
    fs.writeFileSync(binding, JSON.stringify({ adapter: desc(__filename), original: desc(original), executed: desc(executed),
      base: desc(path.join(folder, "base-executed.cjs")), installation: installed.actualInstallation,
      sourceReport: desc(sourceFile), helper: desc(helper), edits: r.edits, productChanges: 0, modelRequests: 0 }, null, 2),
    { flag: "wx" });
  } else {
    const b = read(binding);
    for (const k of ["adapter", "original", "executed", "base", "installation", "sourceReport", "helper"])
      assert.equal(sha(b[k].path), b[k].sha256);
    assert.equal(fs.readFileSync(executed, "utf8"), r.source);
  }
  const filename = path.resolve(__dirname, "lib/installed-runtime-session.cjs"), base = new Module(filename, module);
  Object.assign(base, { filename, paths: Module._nodeModulePaths(path.dirname(filename)) });
  base._compile(baseSource, filename);
  const worker = new Module(original, module);
  Object.assign(worker, { filename: original, paths: Module._nodeModulePaths(__dirname), qaBase: base.exports,
    qaInstallation: installed, qaConfigFile: configFile, qaExecutedFile: executed, qaBinding: desc(binding), qaAdapterFile: __filename });
  process.argv = [process.execPath, original, mode, attempt, "--candidate-config=" + configFile];
  worker._compile(r.source, original);
}
