"use strict";
// Tooling support checks only; never count them as new product UI tests.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process"),{sha256}=require("./lib/installed-acceptance.cjs");
const base="D:/AgentVN/output/installed-runtime-voice-20261019-01";
const work="F:/AgentVN/QA/Runtime-Voice-20261019-01";
const destination=path.join(base,"support-tests.json");assert(!fs.existsSync(destination));
const commands=[
  ...["installed-runtime-voice-fixtures.cjs","installed-runtime-voice-playwright.cjs",
    "installed-runtime-voice-matrix.cjs","installed-runtime-voice-audit.cjs",
    "installed-runtime-abilities-export.cjs","full-regression-stage-evidence-receipt.cjs"]
    .map(f=>[process.execPath,["--check",`scripts/${f}`]]),
  [process.execPath,["scripts/full-regression-evidence-test.cjs"]],
  ["powershell.exe",["-NoProfile","-Command",
    "$files=@('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-assistant-recovery-session.ps1'); "+
    "foreach($file in $files){$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)|Out-Null; "+
    "if($errors.Count){$errors|ForEach-Object {Write-Error $_};exit 1};Write-Output ('PASS parser '+$file)}"]]
];
const rows=[];
for(const [i,[executable,args]]of commands.entries()){
  const result=spawnSync(executable,args,{cwd:"D:/AgentVN",encoding:"utf8",windowsHide:true,timeout:30000});
  const bytes=Buffer.from((result.stdout||"")+(result.stderr||""));
  const log=path.join(work,`support-${String(i+1).padStart(2,"0")}.log`);
  fs.writeFileSync(log,bytes,{flag:"wx"});
  rows.push({executable,args,exitCode:result.status,error:result.error?String(result.error):null,
    log,sha256:sha256(bytes),status:result.status===0?"PASS":"FAILED"});
}
const report={status:rows.every(r=>r.status==="PASS")?"PASS":"FAILED",at:new Date().toISOString(),
  scope:"QA_SYNTAX_AND_EVIDENCE_VALIDATOR_NOT_PRODUCT_UI",commands:rows,
  productTests:0,evidenceValidatorCases:22};
fs.writeFileSync(destination,JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify(report));
if(report.status!=="PASS")process.exitCode=1;
