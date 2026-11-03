"use strict";
// Preserve the original author receipt/tool hash and failed audit01. Adapt
// only the actual-install receipt schema for audit02 and its dependent steps.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const requestedMode = process.argv[2];
const options = process.argv.slice(3);
const profileArgs = options.filter(a => a.startsWith("--profile-author="));
const directoryArgs = options.filter(a => a.startsWith("--directory-attempt="));
assert(profileArgs.length <= 1 && directoryArgs.length <= 1, "Duplicate baseline options");
assert.equal(profileArgs.length, directoryArgs.length, "Select both profile and protection baselines");
const explicitBaseline = profileArgs.length === 1;
assert((explicitBaseline
  ? ["self-test", "prepare", "author", "author-audit", "roundtrip", "player"]
  : ["self-test", "author-audit", "roundtrip", "player"]).includes(requestedMode));
let profileAuthor, directoryAttempt;
if (explicitBaseline) {
  profileAuthor = profileArgs[0].slice("--profile-author=".length);
  directoryAttempt = directoryArgs[0].slice("--directory-attempt=".length);
  assert.match(profileAuthor, /^\d{2}$/);
  assert.match(directoryAttempt, /^\d{2}$/);
  assert.equal(options.filter(a => a.startsWith("--candidate-config=")).length, 1);
  process.argv = process.argv.filter(a => !profileArgs.includes(a) && !directoryArgs.includes(a));
}
const file = path.join(__dirname, "candidate-controls.cjs");
assert.equal(sha(file), "c0c684bd685bad434c54086020f9f7ade60de37f4de50db23dd757325e97632f");
let text = fs.readFileSync(file, "utf8");
function replace(before, after) {
  assert.equal(text.split(before).length - 1, 1, before);
  text = text.replace(before, after);
}
if (explicitBaseline) {
  replace(
    'const profilesFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-92/report.json";',
    `const profilesFile = ${JSON.stringify(`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${profileAuthor}/report.json`)};`,
  );
  replace(
    'path.join(config.qa, "project-directory-preparation-12/derived-installed.json")',
    `path.join(config.qa, ${JSON.stringify(`project-directory-preparation-${directoryAttempt}/derived-installed.json`)})`,
  );
}
replace('`control-author-${author}-audit-01`', '`control-author-${author}-audit-02`');
replace(
  '    for (const before of [\'assert.equal(install.executable.version, "1.9.24");\', \'assert.equal(l.executable.version, "1.9.24");\'])\n' +
  '      replace(before, before.replace(\'"1.9.24"\', \'module.qaConfig.version\'));',
  '    replace(\'assert.equal(install.executable.version, "1.9.24");\',\n' +
  '      \'assert.equal(install.version, module.qaConfig.version);\\n\' +\n' +
  '      \'      assert.equal(ps("(Get-Item -LiteralPath \\\'" + install.executable.path.replaceAll("\\\'", "\\\'\\\'") + "\\\').VersionInfo.FileVersion"), module.qaConfig.version);\');\n' +
  '    replace(\'assert.equal(l.executable.version, "1.9.24");\',\n' +
  '      \'assert.deepEqual(l.executable, install.executable);\');'
);
replace(
  '    replace(\'assert.equal(installation.executable.version, "1.9.24");\',\n' +
  '      \'assert.equal(installation.executable.version, module.qaConfig.version);\');',
  '    replace(\'assert.equal(installation.executable.version, "1.9.24");\',\n' +
  '      \'assert.equal(installation.version, module.qaConfig.version);\');'
);
new vm.Script(Module.wrap(text), { filename: __filename });
const worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths;
worker._compile(text, __filename);
