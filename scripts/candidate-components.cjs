"use strict";
// Reuse the complete established component workflows, explicitly bound to an
// actual installed candidate. No historical business PASS is inherited.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const Module=require("node:module"),vm=require("node:vm");
const {sha}=require("./lib/installed-runtime-session.cjs");
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const args=process.argv.slice(2),mode=args.shift();
assert(["self-test","author","player","audit"].includes(mode));
const configArgs=args.filter(a=>a.startsWith("--candidate-config="));assert.equal(configArgs.length,1);
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const config=validateCandidateConfig(read(configArgs[0].slice(19)));
const numbers=args.filter(a=>!a.startsWith("--"));assert.equal(args.length,numbers.length+1);
assert.equal(numbers.length,mode==="audit"?3:mode==="player"?2:1);
for(const n of numbers)assert.match(n,/^\d{2}$/);
const authorAttempt=numbers[0],actual=deriveActual(config.actual,config.version);
const preparation=path.join(config.qa,`components-preparation-${authorAttempt}`);
const installationFile=path.join(preparation,"derived-installed.json");
const candidate={current:true,expected:{version:config.version,sha256:actual.executable.sha256},
  installationFile,protectedSourceFile:installationFile};
const files={
  author:["installed-components-current.cjs","83300842d7d386a6793907b57e5c5f0bb331dd88a1c11534dc0a4c82ac71bc9f"],
  player:["installed-components-current-player.cjs","85838cdc3d33f66e0b08ed35e4419e4329faf1b28cefe0c883f28198ca8a252a"],
  audit:["installed-components-current-audit.cjs","16c864a0930f9b5863ec4301b2b3b9570f71836fae427cf57a9aa232259163d8"]
};
function build(kind){
  const file=path.join(__dirname,files[kind][0]);assert.equal(sha(file),files[kind][1]);
  let source=fs.readFileSync(file,"utf8");const changes=[];
  const replace=(before,after)=>{
    assert.equal(source.split(before).length-1,1,`${kind}: ${before}`);
    source=source.replace(before,after);changes.push({before,after});
  };
  replace('const candidate = require("./lib/installed-components-candidate.cjs");',`const candidate = ${JSON.stringify(candidate)};`);
  if(kind==="author"){
    const start=source.indexOf('    const operation = page.getByTestId("package-environment-operation-dialog");');
    const end=source.indexOf('    await page.locator(\'[data-help-key="package.mode"]\').click();',start);
    assert(start>0&&end>start);
    replace(source.slice(start,end),`    await until(async () => {
      const operation = page.getByTestId("package-environment-operation-dialog");
      if (await operation.isVisible()) {
        const phase = await operation.getAttribute("data-environment-phase");
        if (!["completed", "failed"].includes(phase)) return false;
        report.incidentalEnvironment={phase,text:await operation.innerText(),scope:"QA Junction, not default environment acceptance"};save();
        await operation.getByRole("button",{name:phase==="completed"?"完成":"关闭",exact:true}).click();
        await operation.waitFor({state:"detached"});
      }
      try { await page.locator('[data-package-stage="settings"]').click({timeout:750}); } catch { return false; }
      return page.locator('[data-help-key="package.mode"]').isVisible();
    }, "actual installed publishing settings", 180000);
`);
    replace('        if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)\n          await host.shot',
      '        await host.shot');
    replace('  unchanged(); report.gitBefore = git();','  unchanged(); report.gitBefore = git();\n'+
      '  fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});\n'+
      '  fs.writeFileSync(path.join(out,"binding.json"),JSON.stringify(module.qaBinding,null,2),{flag:"wx"});');
  }else if(kind==="player"){
    replace('installed-components-current-${attempt}',`components-installed-${config.version.replaceAll(".","")}-\${attempt}`);
    replace('path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out]',
      'path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"]');
    replace('    if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)\n      report.screenshots.push',
      '    report.screenshots.push');
    replace('  unchanged(); save();','  unchanged(); save();\n'+
      '  fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});\n'+
      '  fs.writeFileSync(path.join(out,"binding.json"),JSON.stringify(module.qaBinding,null,2),{flag:"wx"});');
  }else{
    replace('installed-components-current-${playerAttempt}',`components-installed-${config.version.replaceAll(".","")}-\${playerAttempt}`);
    replace('  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
      '  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n'+
      '  fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});\n'+
      '  fs.writeFileSync(path.join(out,"binding.json"),JSON.stringify(module.qaBinding,null,2),{flag:"wx"});');
  }
  if(kind!=="audit")replace('  report.finishedAt = new Date().toISOString(); save();',
    '  report.finishedAt = new Date().toISOString(); report.tool=desc(__filename);save();');
  new vm.Script(Module.wrap(source),{filename:__filename});
  return {source,changes,file};
}
const generated=["author","player","audit"].map(kind=>({kind,...build(kind)}));
if(mode==="self-test"){
  for(const g of generated){
    let replay=fs.readFileSync(g.file,"utf8");
    for(const c of g.changes){assert.equal(replay.split(c.before).length-1,1);replay=replay.replace(c.before,c.after);}
    assert.equal(replay,g.source);
  }
  assert(generated[0].source.includes('assert.equal(cs.length, expectedComponents)'));
  assert(generated[0].source.includes('validate(report, candidate.expected)'));
  assert(generated[1].source.includes('c.actions.length === 3'));
  assert(generated[2].source.includes('new DatabaseSync'));
  const fixture=read(path.join(__dirname,"../output/installed-components-20261018-01/fixtures.json"));
  for(const f of fixture.images)assert.equal(sha(f.path),f.sha256);
  console.log(JSON.stringify({status:"PASS",version:config.version,workflows:3,
    adaptations:generated.map(g=>({kind:g.kind,count:g.changes.length})),fixtureImages:fixture.images.length,
    actualInstalledSource:true,oldResultsInherited:false,productChanges:0,modelRequests:0}));
}else{
  if(mode==="author"){
    fs.mkdirSync(preparation,{recursive:false});
    fs.writeFileSync(installationFile,JSON.stringify({...actual,protectedFiles:[actual.executable,...actual.resources]},null,2),{flag:"wx"});
  }else{
    const retained=read(installationFile),{protectedFiles,...base}=retained;
    assert.deepEqual(base,actual);assert.deepEqual(protectedFiles,[actual.executable,...actual.resources]);
  }
  const g=generated.find(g=>g.kind===mode);
  process.argv=[process.argv[0],__filename,...numbers];
  const worker=new Module(__filename,module);worker.filename=__filename;worker.paths=module.paths;
  worker.qaSource=g.source;worker.qaBinding={mode,version:config.version,actualInstallation:config.actual,
    source:{path:g.file,sha256:sha(g.file)},adaptations:g.changes,authorAttempt,oldResultsInherited:false};
  worker._compile(g.source,__filename);
}
