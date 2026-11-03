"use strict";
const fs=require("node:fs"), path=require("node:path"), crypto=require("node:crypto"),
  assert=require("node:assert/strict");
const root="D:/AgentVN", installed=process.argv[3] || "D:/agentvntest/AgentVN Editor", destination=process.argv[2];
const kind=process.argv[4] || "MSI";
assert(["MSI","NSIS"].includes(kind),"Explicit installer kind required");
assert(destination&&!fs.existsSync(destination),"Fresh actual-install resource audit required");
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const report={status:"RUNNING",scope:kind==="NSIS"?"ACTUAL_NSIS_INSTALLED_FILES_NOT_EXTRACTION":"ACTUAL_MSI_I_INSTALLED_FILES_NOT_ADMINISTRATIVE_EXTRACTION",
  startedAt:new Date().toISOString(),installedRoot:installed,files:[],error:null};
try{
  const hashes={
    "agentvn-editor.exe":kind==="NSIS"?"f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c":"5c38db3d8569b8f4fcd2553fbbe5e74179f948cfd720e60b315f6968d4752ee9",
    "creator-backend.exe":"db44bd510997a73aee80ba5419d0c9c55e6f73f9a01ad65003915ea089eb5155",
    "agentvn-player.exe":"71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a",
    "build-versions.json":"c990aec0b05368eba767fdecaf45ebd918cc34518c03e99994cd5ac02300024a"
  };
  for(const [relative,expected] of Object.entries(hashes)){
    const file=path.join(installed,relative),actual=sha(file);
    assert.equal(actual,expected,relative);report.files.push({relative,sha256:actual,bytes:fs.statSync(file).size});
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed,"build-versions.json"),"utf8")).editorVersion,"1.9.9");
  const names=JSON.parse(fs.readFileSync(path.join(root,"scripts/standalone-build-scripts.json"),"utf8")).scripts;
  assert.equal(names.length,19);
  for(const name of names){
    const relative="scripts/"+name,file=path.join(installed,relative),actual=sha(file);
    assert.equal(actual,sha(path.join(root,relative)),relative);
    report.files.push({relative,sha256:actual,bytes:fs.statSync(file).size});
  }
  for(const relative of ["GameCli_framework/package.json","shared/cartridge/types.ts",
    "GameCli_framework/node_modules/lucide-react/dist/cjs/lucide-react.js",
    "GameCli_framework/node_modules/sharp/dist/index.cjs","windows-offline-tools/NSIS/Bin/makensis.exe"]){
    const file=path.join(installed,relative);assert(fs.statSync(file).size>0,relative);
    report.files.push({relative,sha256:sha(file),bytes:fs.statSync(file).size});
  }
  report.scriptCount=names.length;report.status="PASS";
}catch(error){report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(destination,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,files:report.files.length,error:report.error}));}
