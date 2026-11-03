"use strict";
// Tool correctness checks, explicitly not product acceptance.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process"),{sha256}=require("./lib/installed-acceptance.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-paged-20261019-01";
const work="F:/AgentVN/QA/Runtime-Voice-Paged-20261019-01";
const dest=path.join(base,"support-tests.json");assert(!fs.existsSync(dest));
const files=["installed-runtime-voice-paged-fixtures.cjs","installed-runtime-voice-paged-playwright.cjs",
  "installed-runtime-voice-paged-session.cjs","installed-runtime-voice-paged-audit.cjs",
  "voice-runtime-observer-test.cjs","lib/voice-runtime-observer.cjs"];
const commands=[...files.map(f=>[process.execPath,["--check",`scripts/${f}`]]),
  [process.execPath,["scripts/voice-runtime-observer-test.cjs"]],
  [process.execPath,["scripts/full-regression-evidence-test.cjs"]],
  ["powershell.exe",["-NoProfile","-Command",
    "$files=@('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-assistant-recovery-session.ps1',"+
    "'D:\\AgentVN\\scripts\\installed-runtime-voice-paged-abort.ps1');foreach($file in $files){"+
    "$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)|Out-Null;"+
    "if($errors.Count){throw ($errors|Out-String)};Write-Output ('PASS parser '+$file)}"]]];
const rows=[];
for(const [i,[exe,args]]of commands.entries()){
  const r=spawnSync(exe,args,{cwd:"D:/AgentVN",windowsHide:true,encoding:"utf8",timeout:30000});
  const log=path.join(work,`support-${String(i+1).padStart(2,"0")}.log`);
  fs.writeFileSync(log,(r.stdout||"")+(r.stderr||""),{flag:"wx"});
  rows.push({exe,args,exitCode:r.status,error:r.error?String(r.error):null,log,
    sha256:sha256(fs.readFileSync(log)),status:r.status===0?"PASS":"FAILED"});
}
const report={status:rows.every(r=>r.status==="PASS")?"PASS":"FAILED",at:new Date().toISOString(),
  scope:"QA_SYNTAX_OBSERVER_AND_EVIDENCE_VALIDATOR_NOT_PRODUCT_ACCEPTANCE",commands:rows,
  observerRegressionCases:5,evidenceValidatorCases:22,newProductUiCases:0};
fs.writeFileSync(dest,JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify(report));
if(report.status!=="PASS")process.exitCode=1;
