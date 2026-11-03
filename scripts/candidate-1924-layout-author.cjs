"use strict";
// Reuse the full installed authoring matrix against the explicit new receipt.
// No synthetic installation audit, rewritten old report, or workspace fallback.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-layout-pages-current.cjs");
const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const installed = JSON.parse(fs.readFileSync(installationFile, "utf8").replace(/^\uFEFF/, ""));
assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
assert.equal(installed.executable.version, "1.9.24");
assert.equal(sha(original), "9dc888ddf8288cb2413a32b510d904c2ea89617c4c09998de3a507467885d099");
for (const f of [installed.executable, ...installed.resources, ...installed.protectedFiles])
  assert.equal(sha(f.path), f.sha256, f.path);
assert(!process.argv.some(arg => arg.startsWith("--audit=")), "Use the recorded actual installation directly");
let source = fs.readFileSync(original, "utf8");
const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('let installationFile = "F:/AgentVN/QA/Editor-1.9.13-20261021-01/installation.json";',
  `let installationFile = ${JSON.stringify(installationFile)};`);
const provenance = { expectedVersion: "1.9.24", installation: { path: installationFile, sha256: sha(installationFile) },
  originalBusiness: { path: original, sha256: sha(original) },
  boundary: "Current installation, isolated small authoring fixture; not native picker, standalone/setup or Android" };
replace("const save = () => fs.writeFileSync", `report.candidateBinding = ${JSON.stringify(provenance)};
const save = () => fs.writeFileSync`);
replace('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
  'fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
  'fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
  `fs.writeFileSync(path.join(out, "candidate-source-adaptations.json"), JSON.stringify({ original: ${
    JSON.stringify(provenance.originalBusiness)}, changes: module.qaChanges }, null, 2), { flag: "wx" });`);
new vm.Script(Module.wrap(source), { filename: original });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(original, "utf8");
  for (const change of changes) {
    assert.equal(replay.split(change.before).length - 1, 1);
    replay = replay.replace(change.before, change.after);
  }
  assert.equal(replay, source);
  for (const required of ["assert.equal(report.pages.length, expectedPages * displayMatrix.length)",
    "assert.deepEqual(after.settings.runtimeUILayoutProfiles, report.profiles)",
    "assert.deepEqual(profiles.profiles[other], isolated)", "assert.equal(report.modelRequests, 0)"])
    assert(source.includes(required), required);
  console.log(JSON.stringify({ status: "PASS", transformations: changes.length,
    scope: "CURRENT_INSTALLED_AUTHORING_BINDING_ONLY_NO_UI_RUN" }));
} else {
  assert.equal(process.argv[2], "author"); assert.equal(process.argv[3], "50");
  assert(process.argv.includes("--matrix") && process.argv.includes("--codex-cache-view"));
  const out = path.resolve("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-50");
  assert(!fs.existsSync(out));
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes;
  worker._compile(source, __filename);
}
