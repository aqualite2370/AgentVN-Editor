"use strict";

// QA-only adapter for the existing 14-flow project-directory acceptance.
// It binds the current installed receipt and current file-protection baseline;
// the business test remains archived in each output directory.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("node:module");
const vm = require("node:vm");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const original = path.join(__dirname, "project-directory-installed-current.cjs");
const originalSha = "f4beb8aefd6e44d19d13e155294843e347e94fb18447794dcf1ab1fcc204bdc8";
const installationFile =
  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-62/derived-installation-receipt.json";
const protectedSourceFile =
  "F:/AgentVN/QA/Installed-Assets-20261021-01/protected-1.9.28-current.json";
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(sha(original), originalSha);
const installation = JSON.parse(fs.readFileSync(installationFile, "utf8"));
assert.equal(installation.status, "PASS");
assert.equal(installation.version, "1.9.28");
assert.equal(sha(installation.executable.path), installation.executable.sha256);
const protectedSource = JSON.parse(fs.readFileSync(protectedSourceFile, "utf8"));
assert.equal(protectedSource.status, "PASS");
assert(Array.isArray(protectedSource.protectedFiles) && protectedSource.protectedFiles.length > 0);
for (const file of protectedSource.protectedFiles) assert.equal(sha(file.path), file.sha256, file.path);

let source = fs.readFileSync(original, "utf8");
const changes = [];
function replace(before, after, count = 1) {
  assert.equal(source.split(before).length - 1, count, before);
  source = source.split(before).join(after);
  changes.push({ before, after, count });
}

replace(
  '"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
  JSON.stringify(installationFile),
);
replace('assert.equal(read(audit).version,"1.9.22")', 'assert.equal(read(audit).version,"1.9.28")');
replace(
  '"189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc"',
  JSON.stringify(installation.executable.sha256),
);
replace(
  '"F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json"',
  JSON.stringify(protectedSourceFile),
);
replace('version:"1.9.22"', 'version:"1.9.28"');
replace(
  'scope:"ACTUAL_INSTALLED_1_9_22_PROJECT_DIRECTORY_NATIVE_CHOOSER_AND_CLOSE"',
  'scope:"ACTUAL_INSTALLED_1_9_28_PROJECT_DIRECTORY_NATIVE_CHOOSER_AND_CLOSE"',
);
replace(
  'PROJECT_EXPORT_DIRECTORY_INVALID|拒绝访问|Access is denied|无法创建工程包临时文件',
  'PROJECT_EXPORT_DIRECTORY_INVALID|PROJECT_EXPORT_DIRECTORY_WRITE_FAILED|拒绝访问|Access is denied|无法创建工程包临时文件',
);
replace('`Project-Directory-Installed-1922-${path.basename(out)}`',
  '`Project-Directory-Installed-1928-${path.basename(out)}`');
replace(
  'fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);',
  'fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);\n' +
    'fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});\n' +
    'fs.writeFileSync(path.join(out,"adaptations.json"),JSON.stringify(module.qaChanges,null,2),{flag:"wx"});',
);

new vm.Script(Module.wrap(source), { filename: __filename });
let replay = fs.readFileSync(original, "utf8");
for (const change of changes) {
  assert.equal(replay.split(change.before).length - 1, change.count);
  replay = replay.split(change.before).join(change.after);
}
assert.equal(source, replay);
for (const required of [
  'assert.equal(report.cases.length,finishing?5:continuing?8:14)',
  'assert.deepEqual(report.cleanups.at(-1).killed,[])',
  'assert.equal(await label(),p.directory)',
  'assert.deepEqual(ownedFiles(downloads,p),before',
  'assert.equal(sha(old.path),old.sha256)',
  'assert.equal(sha(artifact.path),artifact.sha256)',
  'await A.nativeInput({page,trigger,out,name:"portable-native-open"',
]) assert(source.includes(required), required);

if (process.argv[2] === "--self-test") {
  console.log(JSON.stringify({
    status: "PASS",
    scope: "CURRENT_1_9_28_INSTALLATION_AND_PROTECTED_BASELINE_BINDING_ONLY",
    transformations: changes.length,
    installation: { version: installation.version, sha256: sha(installationFile) },
    output: "F:/AgentVN/QA/Project-Directory-Installed-20261022-01/editor-09",
  }));
} else {
  assert.deepEqual(process.argv.slice(2), ["09"], "Fresh full native flow only");
  const out = "F:/AgentVN/QA/Project-Directory-Installed-20261022-01/editor-09";
  assert(!fs.existsSync(out));
  process.argv[2] = out;
  const worker = new Module(__filename, module);
  worker.filename = __filename;
  worker.paths = module.paths;
  worker.qaSource = source;
  worker.qaChanges = changes;
  worker._compile(source, __filename);
}
