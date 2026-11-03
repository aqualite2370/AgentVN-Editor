"use strict";
// A same-value fill is not an author edit. Keep the original failed fixture;
// exercise explicit non-default values so persistence has an observable input.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const extra = process.argv.slice(5);
let seedBinding;
if (extra.length) {
  assert.equal(extra.length, 2, "Explicit author seed and current protected installation are both required");
  assert(extra[0].startsWith("--author-seed=") && extra[1].startsWith("--protected-install="));
  const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
  const seedFile = extra[0].slice("--author-seed=".length);
  const protectedFile = extra[1].slice("--protected-install=".length);
  const configFile = process.argv[4]?.slice("--candidate-config=".length);
  assert(process.argv[4]?.startsWith("--candidate-config="));
  const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
  const { deriveActual } = require("./installed-profile-data-replay.cjs");
  const config = validateCandidateConfig(read(configFile)), actual = deriveActual(config.actual, config.version);
  const boundary = path.resolve("F:/AgentVN/QA") + path.sep;
  assert(path.resolve(seedFile).startsWith(boundary));
  assert.equal(path.dirname(path.resolve(protectedFile)), path.resolve(config.qa));
  const seed = read(seedFile), seedInstall = read(seed.installation), protection = read(protectedFile);
  assert.equal(seed.status, "PASS"); assert.equal(seed.nativeCacheRestoration, "PASS");
  assert.equal(seed.profiles.activeType, "renpy");
  assert.equal(seed.candidateVersion, seedInstall.version);
  assert.deepEqual(seedInstall.executable, deriveActual(seedInstall.actualInstallation, seedInstall.version).executable);
  assert.equal(protection.status, "PASS"); assert.equal(protection.metadataRestoration, "PASS");
  assert.deepEqual(protection.actualInstallation, config.actual);
  assert.deepEqual(protection.executable, actual.executable);
  for (const f of [...protection.resources, ...protection.protectedFiles]) assert.equal(sha(f.path), f.sha256);
  seedBinding = { seed: describe(seedFile), seedInstallation: describe(seed.installation),
    sourceVersion: seed.candidateVersion, targetVersion: config.version,
    protectedInstallation: describe(protectedFile),
    scope: "PRIOR_LAYOUT_FIXTURE_ONLY_NEW_AUTHOR_EDITS_RESTART_AND_EXPORT_REQUIRE_CURRENT_INSTALLED_EDITOR" };
}
const file = path.join(__dirname, "candidate-role-author.cjs");
assert.equal(sha(file), "4e6f8a3f857a364da82ea465987bf51950f7d3d4e7de158adcb41d438f12b4dc");
let source = fs.readFileSync(file, "utf8");
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, after);
}
if (seedBinding) {
  replace('const priorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-92/report.json", prior = read(priorFile);',
    'const priorFile = module.qaSeedBinding.seed.path, prior = read(priorFile);');
  replace('assert.equal(read(prior.installation).executable.sha256, actual.executable.sha256);',
    'assert.equal(sha(priorFile), module.qaSeedBinding.seed.sha256);\n' +
    'assert.equal(sha(prior.installation), module.qaSeedBinding.seedInstallation.sha256);');
  replace('const protection = read(path.join(config.qa, "control-preparation-98/derived-installed.json"));',
    'assert.equal(sha(module.qaSeedBinding.protectedInstallation.path), module.qaSeedBinding.protectedInstallation.sha256);\n' +
    'const protection = read(module.qaSeedBinding.protectedInstallation.path);');
}
replace('const expected = Object.fromEntries',
  'for (const role of roles) for (const key of Object.keys(role[2]))\n' +
  '  role[2][key] += ({width: 8, height: 4, fontSize: 1, paddingX: 1, paddingY: 1})[key];\n' +
  'const expected = Object.fromEntries');
replace('opacity: [1, 1, .95, .65][j]', 'opacity: [.96, .99, .95, .65][j]');
replace('const report = { status: "RUNNING", startedAt:',
  'const report = { status: "RUNNING", ...(module.qaSeedBinding ? { seedBinding: module.qaSeedBinding } : {}), ' +
  'executedBusinessSha256: module.qaSourceSha256, originalBusiness: module.qaOriginal, startedAt:');
replace('  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
  '  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
  '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });');
new vm.Script(Module.wrap(source), { filename: __filename });
const worker = new Module(__filename, module);
Object.assign(worker, { filename: __filename, paths: module.paths, qaSource: source,
  qaSeedBinding: seedBinding,
  qaSourceSha256: require("node:crypto").createHash("sha256").update(source).digest("hex"),
  qaOriginal: { path: file, sha256: sha(file) } });
worker._compile(source, __filename);
