"use strict";
// Preserve editor-63 FAILED. Re-run the full eight-stage flow with only its
// obsolete export oracle corrected, after checking the retained real ZIP.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const Module=require("node:module"),vm=require("node:vm");
const JSZip=require("../editor/node_modules/jszip");
const {sha}=require("./lib/installed-runtime-session.cjs");
const {expectedExportLayout}=require("./lib/gui-export-title-oracle.cjs");
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const configArgs=process.argv.filter(a=>a.startsWith("--candidate-config="));
assert(configArgs.length<=1);
const config=configArgs.length?validateCandidateConfig(read(configArgs[0].slice("--candidate-config=".length))):null;
const selfTest=process.argv.includes("--self-test");
const attempt=config?(selfTest?"80":process.argv[2]):"66";
assert.match(attempt,/^\d{2}$/);
if(config)assert.deepEqual(process.argv.slice(2),[selfTest?"--self-test":attempt,configArgs[0]]);
const candidateInstallation=config?deriveActual(config.actual,config.version):null;
const preparation=config?path.join(config.qa,`gui-author-preparation-${attempt}`):null;
const boundInstallation=preparation&&path.join(preparation,"derived-installed.json");
const base="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-63";
const sealed=path.join(base,"executed-business.cjs");
assert.equal(sha(sealed),"203f9cc19cfb69fd05881917cfb69054badbaec890f3f5227040cc49f53f1658");
let source=fs.readFileSync(sealed,"utf8");const changes=[];
function replace(before,after) {
  assert.equal(source.split(before).length-1,1,before);
  source=source.replace(before,after);changes.push({before,after});
}
replace('assert.equal(attempt, "63"); assert.equal(process.argv.length, 3);',
  `assert.equal(attempt, "${attempt}"); assert.equal(process.argv.length, ${config?4:3});`);
if(config) {
  replace('const installationFile = "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json";',
    `const installationFile = ${JSON.stringify(boundInstallation)};`);
  replace('assert.equal(baseline.version, "1.9.30");',`assert.equal(baseline.version, "${config.version}");`);
  replace('assert.equal(baseline.executable.sha256, "a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577");',
    `assert.equal(baseline.executable.sha256, "${candidateInstallation.executable.sha256}");`);
  replace('`installed-gui-library-1930-${attempt}`',`\`installed-gui-library-${config.version.replaceAll(".","")}-\${attempt}\``);
  replace('const report = { status: "RUNNING", startedAt:',`const report = { version: "${config.version}", status: "RUNNING", startedAt:`);
  replace('"ACTUAL_INSTALLED_1930_COMPLETE_OFFICIAL_GUI_LIBRARY_SCOPE_REVISION_RESTART_EXPORT"',
    `"ACTUAL_INSTALLED_${config.version}_COMPLETE_OFFICIAL_GUI_LIBRARY_SCOPE_REVISION_RESTART_EXPORT"`);
  replace('...baseline.protectedFiles]', '...(baseline.protectedFiles ?? [])]');
}
const begin=source.indexOf('    const builtinTitleTypes = new Set(');
const end=source.indexOf('    assert.deepEqual(skin, expectedSkin);',begin);
assert(begin>0&&end>begin);
replace(source.slice(begin,end),
  '    const normalizedExpected = require("./lib/gui-export-title-oracle.cjs").expectedExportLayout(expectedSkin);\n');
replace('    assert.deepEqual(skin, expectedSkin);','    assert.deepEqual(skin, normalizedExpected);');
new vm.Script(Module.wrap(source),{filename:__filename});
(async()=>{
  const r=JSON.parse(fs.readFileSync(path.join(base,"report.json"),"utf8"));
  assert.equal(r.status,"FAILED");assert.equal(r.steps.length,8);
  assert(r.steps.slice(0,7).every(s=>s.status==="PASS"));assert.equal(r.nativeCacheRestoration,"PASS");
  assert.equal(sha(r.completedDownload.path),r.completedDownload.sha256);
  const z=await JSZip.loadAsync(fs.readFileSync(r.completedDownload.path),{checkCRC32:true});
  const actual=JSON.parse(await z.file("ui/layout.json").async("string"));
  const expected=expectedExportLayout(r.savedProject.settings.runtimeUILayout);
  assert.deepEqual(actual,expected);
  let rejected=0;
  for(const alter of [
    x=>{x.screens.find(s=>s.screen_id==="title").components.find(c=>c.component_type==="main_menu_start_button").style.fontSize=99;},
    x=>{x.screens.find(s=>s.screen_id==="title").components.find(c=>c.component_type==="main_menu_start_button").visible=false;},
    x=>{x.renpy.shared.x=999;},
    x=>{x.screens.find(s=>s.screen_id==="title").components.find(c=>c.component_type==="main_menu_save_load_button").titleButtonStyleSource="other";}
  ]) {const c=structuredClone(actual);alter(c);assert.throws(()=>assert.deepEqual(c,expected));rejected++;}
  if(selfTest) {
    if(config) {
      assert.equal(candidateInstallation.version,config.version);
      assert.deepEqual(candidateInstallation.actualInstallation,config.actual);
      assert.equal(candidateInstallation.metadataRestoration,"PASS");
    }
    assert(source.includes('assert.equal(report.matrix.length, 12)'));
    assert(source.includes('assert.equal(report.steps.length, 8)'));
    assert(source.includes('assert.equal(currentProject.assetManifest.length, 26)'));
    assert(source.includes('assert.deepEqual(actualBase, baseStyle'));
    assert(source.includes('cache("Restore")'));
    console.log(JSON.stringify({status:"PASS",retainedActualExportChecked:true,badChangesRejected:rejected,
      transformations:changes.length,productChanges:0,version:config?.version??"1.9.30",
      actualInstallationChecked:!!config,oldResultsInherited:false}));return;
  }
  if(config) {
    fs.mkdirSync(preparation,{recursive:false});
    assert.equal(candidateInstallation.version,config.version);
    assert.deepEqual(candidateInstallation.actualInstallation,config.actual);
    fs.writeFileSync(boundInstallation,JSON.stringify(candidateInstallation,null,2),{flag:"wx"});
    fs.writeFileSync(path.join(preparation,"binding.json"),JSON.stringify({
      version:config.version,actualInstallation:config.actual,sealed:{path:sealed,sha256:sha(sealed)},
      adapter:{path:__filename,sha256:sha(__filename)},adaptations:changes,
      executedSourceSha256:require("node:crypto").createHash("sha256").update(source).digest("hex"),
      oldResultsInherited:false,productChanges:0,modelRequests:0
    },null,2),{flag:"wx"});
  } else assert.deepEqual(process.argv.slice(2),["66"]);
  const worker=new Module(__filename,module);worker.filename=__filename;worker.paths=module.paths;
  worker.qaSource=source;worker.qaChanges=changes;worker._compile(source,__filename);
})().catch(e=>{console.error(e);process.exitCode=1;});
