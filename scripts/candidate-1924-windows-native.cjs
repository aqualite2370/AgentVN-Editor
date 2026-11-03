"use strict";
// Preserve the prior UI workflow; bind only the frozen candidate and a new run.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-windows-native-ui-current.cjs");
assert.equal(sha(original), "9ad4f1d4a29b657d00a32a5d888bd4a1b6ba5dacf7f51615e838a381672e9953");
const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const installation = JSON.parse(fs.readFileSync(installationFile, "utf8"));
assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, "1.9.24");
for (const f of [installation.executable, ...installation.resources, ...installation.protectedFiles])
  assert.equal(sha(f.path), f.sha256);
function adapt() {
  let source = fs.readFileSync(original, "utf8"); const changes = [];
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after); changes.push({ before, after });
  };
  replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
    JSON.stringify(installationFile));
  replace('assert.equal(sealed.version,"1.9.22")', 'assert.equal(sealed.executable.version,"1.9.24")');
  replace('ACTUAL_INSTALLED_1_9_22_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD',
    'ACTUAL_INSTALLED_1_9_24_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD');
  replace('read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json").protectedFiles', 'sealed.protectedFiles');
  replace('const upgrade=process.argv.includes("--upgrade-from-retained")?retainedUpgradeFixture():null;',
    'const priorUpgrade=retainedUpgradeFixture();\n' +
    'const upgrade=structuredClone(priorUpgrade); upgrade.version="1.0.2"; upgrade.newEditorVersion="1.9.24";\n' +
    'for(const command of upgrade.project.nodes[1].data.scene.commands) command.text=command.text.replace("新版1.0.1","新版1.0.2");\n' +
    'report.priorUpgradeFixture=priorUpgrade;');
  replace('read(f.path).editorVersion==="1.9.22"', 'read(f.path).editorVersion==="1.9.24"');
  replace('  fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);',
    '  fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);\n' +
    '  fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});\n' +
    '  fs.writeFileSync(path.join(out,"candidate-adaptations.json"),JSON.stringify(module.qaChanges,null,2),{flag:"wx"});');
  new vm.Script(Module.wrap(source), { filename: __filename });
  return { source, changes };
}
if (process.argv[2] === "--self-test") {
  console.log(JSON.stringify({ status: "PASS", transformations: adapt().changes.length, productLaunches: 0 }));
} else {
  assert.equal(process.argv[2], "05");
  const checkpoint = "F:/AgentVN/Checkpoints/Installed-Windows-1924-20261025-01";
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
  for (const f of [__filename, original, "scripts/installed-layout-cache-session.ps1",
    "scripts/windows-package-cache-session.ps1", "scripts/lib/installed-release-session.cjs", "plans/ACTIVE_TASKS.md"])
    fs.copyFileSync(f, path.join(checkpoint, path.basename(f)), fs.constants.COPYFILE_EXCL);
  const adapted = adapt(), worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  Object.assign(worker, { qaSource: adapted.source, qaChanges: adapted.changes });
  worker._compile(adapted.source, __filename);
}
