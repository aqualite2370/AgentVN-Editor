"use strict";
// Reuse the complete existing asset business tests with an explicit candidate
// capability object. No mutation of the historical shared candidate selector.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const Module=require("node:module"),vm=require("node:vm");
const {sha}=require("./lib/installed-runtime-session.cjs");
const installationFile="F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const installed=JSON.parse(fs.readFileSync(installationFile,"utf8"));
assert.equal(installed.status,"PASS");assert.equal(installed.executable.version,"1.9.24");
for(const f of [installed.executable,...installed.resources,...installed.protectedFiles])
  assert.equal(sha(f.path),f.sha256,f.path);
const candidate={
  current:true,editor:{version:"1.9.24",sha256:installed.executable.sha256},
  player:{sha256:"6e7f4ec17d8388a99937123f88ddf7cebbe161fac39a19cfe3a3bc849e642168",multiframeVideo:true},
  installationFile,protectedSourceFile:installationFile,
};
const entries={
  author:["installed-assets-current.cjs","b85d9c42ecec1dc3261a85db368993a1dc1e5fef111cb74eec1d88e78572f38b"],
  player:["installed-assets-current-player.cjs","5a30fa9ab7b55e83aacdf9216e361ed8f50cde02e3c8164b07a4efae3b64e158"],
  "author-audit":["installed-assets-current-audit.cjs","ea742d3e37908506498733d91cd99c57e6cd70c1f07c3f24666495b71da7b389"],
  "player-audit":["installed-assets-current-player-audit.cjs","39d92ff173420968b1697e6adaf1e00c881ba7b543750942c52d746880e216d6"],
};
function adapt(action){
  const [name,expected]=entries[action],original=path.join(__dirname,name);
  assert.equal(sha(original),expected);let source=fs.readFileSync(original,"utf8");const changes=[];
  const replace=(before,after)=>{
    assert.equal(source.split(before).length-1,1,before);source=source.replace(before,after);
    changes.push({before,after});
  };
  replace('const candidate = require("./lib/installed-assets-candidate.cjs");',
    `const candidate = Object.freeze(${JSON.stringify(candidate)});`);
  if(action==="author-audit")
    replace('candidate.current ? installation.version : installation.executable.version',
      'installation.executable.version');
  const declaration='const save = () => fs.writeFileSync';
  replace(declaration,
    'fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});\n'+
    'fs.writeFileSync(path.join(out,"candidate-adaptations.json"),JSON.stringify(module.qaChanges,null,2),{flag:"wx"});\n'+
    `report.currentCandidateBinding=${JSON.stringify({installationFile,sha256:sha(installationFile),
      originalBusiness:{path:original,sha256:expected},version:"1.9.24"})};\n`+declaration);
  new vm.Script(Module.wrap(source),{filename:__filename});
  let replay=fs.readFileSync(original,"utf8");
  for(const c of changes){assert.equal(replay.split(c.before).length-1,1);replay=replay.replace(c.before,c.after);}
  assert.equal(replay,source);return{source,changes};
}
if(process.argv[2]==="--self-test"){
  console.log(JSON.stringify({status:"PASS",transformations:Object.fromEntries(Object.keys(entries)
    .map(k=>[k,adapt(k).changes.length])),scope:"CANDIDATE_BINDING_AND_EXECUTED_SOURCE_ARCHIVE_ONLY"}));
}else{
  const action=process.argv[2];assert(entries[action]);
  assert.deepEqual(process.argv.slice(3),action==="author"?["06"]:
    action==="player"?["06","06"]:["06","01"]);
  const adapted=adapt(action);process.argv.splice(2,1);
  const worker=new Module(__filename,module);worker.filename=__filename;worker.paths=module.paths;
  worker.qaSource=adapted.source;worker.qaChanges=adapted.changes;worker._compile(adapted.source,__filename);
}
