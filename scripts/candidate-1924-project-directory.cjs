"use strict";
// Preserve the complete existing 14-flow business test; bind only the frozen
// current installation and fresh evidence. Native inputs require real receipts.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const original = path.join(__dirname, "project-directory-installed-current.cjs");
assert.equal(sha(original), "f4beb8aefd6e44d19d13e155294843e347e94fb18447794dcf1ab1fcc204bdc8");
const candidate1930 = process.argv.includes("--candidate=1.9.30");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const configArgs=process.argv.slice(2).filter(a=>a.startsWith("--candidate-config="));assert(configArgs.length<=1);
const config=configArgs.length?validateCandidateConfig(read(configArgs[0].slice(19))):null;
assert(!config||!candidate1930);
const selfTest=process.argv[2]==="--self-test";
const attempt=config?(selfTest?process.argv[3]:process.argv[2]):candidate1930?"10":"06";
assert.match(attempt??"",/^\d{2}$/);
assert.deepEqual(process.argv.slice(2),config
  ?[...(selfTest?["--self-test"]:[]),attempt,configArgs[0]]
  :[selfTest?"--self-test":attempt,...(candidate1930?["--candidate=1.9.30"]:[])]);
const version = config?.version??(candidate1930 ? "1.9.30" : "1.9.24");
const preparation=config?path.join(config.qa,`project-directory-preparation-${attempt}`):null;
const installationFile = config?path.join(preparation,"derived-installed.json"):candidate1930
  ? "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json"
  : "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
let installation;
if(config){
  const actual=deriveActual(config.actual,version);
  const old=read("F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json");
  const paths=[...new Set([...old.protectedFiles.map(f=>f.path),actual.executable.path,...actual.resources.map(f=>f.path)])];
  installation={...actual,
    protectedFiles:paths.filter(f=>fs.existsSync(f)).map(f=>({path:f,sha256:sha(f),bytes:fs.statSync(f).size})),
    protectedAbsent:paths.filter(f=>!fs.existsSync(f)),
    protectionScope:"Fresh current hashes and absent-file boundaries, not preservation since historical 1.9.24"};
}else installation=read(installationFile);
assert.equal(installation.status, "PASS");
assert.equal(config||candidate1930 ? installation.version : installation.executable.version, version);
assert.equal(installation.executable.sha256, config?deriveActual(config.actual,version).executable.sha256:candidate1930
  ? "a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577"
  : "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");
if (config||candidate1930) {
  assert.equal(sha(installation.actualInstallation.path), installation.actualInstallation.sha256);
  const actual = JSON.parse(fs.readFileSync(installation.actualInstallation.path, "utf8").replace(/^\uFEFF/, ""));
  assert(actual.status === "PASS" && actual.exitCode === 0 && actual.registryRestored);
  assert.equal(actual.executable.sha256, installation.executable.sha256);
}
for (const f of [installation.executable, ...installation.resources, ...installation.protectedFiles])
  assert.equal(sha(f.path), f.sha256, f.path);
let source = fs.readFileSync(original, "utf8");
const changes = [];
function replace(before, after, count = 1) {
  assert.equal(source.split(before).length - 1, count, before);
  source = source.split(before).join(after); changes.push({ before, after, count });
}
replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
  JSON.stringify(installationFile));
replace('assert.equal(read(audit).version,"1.9.22")', config||candidate1930
  ? `assert.equal(read(audit).version,${JSON.stringify(version)})`
  : 'assert.equal(read(audit).executable.version,"1.9.24")');
replace('"189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc"',
  JSON.stringify(installation.executable.sha256));
replace('"F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json"', JSON.stringify(installationFile));
replace('version:"1.9.22"', `version:"${version}"`);
replace('scope:"ACTUAL_INSTALLED_1_9_22_PROJECT_DIRECTORY_NATIVE_CHOOSER_AND_CLOSE"',
  `scope:"ACTUAL_INSTALLED_${version.replaceAll(".", "_")}_PROJECT_DIRECTORY_NATIVE_CHOOSER_AND_CLOSE"`);
replace('`Project-Directory-Installed-1922-${path.basename(out)}`',
  '`Project-Directory-Installed-' + version.replaceAll(".", "") + '-${path.basename(out)}`');
if (config||candidate1930) {
  // Current native writer has a specific directory IO error category. Retain
  // actual-path/recovery/no-fallback/old-byte assertions from the business test.
  replace('PROJECT_EXPORT_DIRECTORY_INVALID|拒绝访问|Access is denied|无法创建工程包临时文件',
    'PROJECT_EXPORT_DIRECTORY_INVALID|PROJECT_EXPORT_DIRECTORY_WRITE_FAILED|拒绝访问|Access is denied|无法创建工程包临时文件');
}
replace('fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);',
  'fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);\n' +
  'fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});\n' +
  'fs.writeFileSync(path.join(out,"adaptations.json"),JSON.stringify(module.qaChanges,null,2),{flag:"wx"});');
if(config){
  replace('assert.equal(sha(audit),report.originalInstallationReport.sha256);',
    'assert.equal(sha(audit),report.originalInstallationReport.sha256);\n'+
    `      report.protectedAbsent=${JSON.stringify(installation.protectedAbsent)};\n`+
    '      for(const file of report.protectedAbsent)assert(!fs.existsSync(file),file);');
}
new vm.Script(Module.wrap(source), { filename: __filename });
let replay = fs.readFileSync(original, "utf8");
for (const c of changes) {
  assert.equal(replay.split(c.before).length - 1, c.count);
  replay = replay.split(c.before).join(c.after);
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
  console.log(JSON.stringify({ status: "PASS", transformations: changes.length,
    version,attempt,protectedFiles:installation.protectedFiles.length,protectedAbsent:installation.protectedAbsent?.length,
    actualInstalledBinding:!!config,scope: "CURRENT_INSTALLATION_AND_FRESH_EVIDENCE_BINDING_NO_PRODUCT_RUN" }));
} else {
  const out = "F:/AgentVN/QA/Project-Directory-Installed-20261022-01/editor-" + attempt;
  assert(!fs.existsSync(out));
  if(config){
    assert(!fs.existsSync(preparation));fs.mkdirSync(preparation);
    fs.writeFileSync(installationFile,JSON.stringify(installation,null,2),{flag:"wx"});
  }
  process.argv=[process.argv[0],__filename,out];
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes;
  worker._compile(source, __filename);
}
