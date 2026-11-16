"use strict";
// Read-only reconciliation after duplicate retirement raced the automatic path.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),
  assert=require("node:assert/strict"),crypto=require("node:crypto");
const {DatabaseSync}=require("node:sqlite");
const base="F:/testavn/Windows-Isolated-1982-20261116-01";
const output=path.join(base,"account-retirement-readonly-03.json");
assert(!fs.existsSync(output),"Preserve prior evidence");
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report={status:"RUNNING",startedAt:new Date().toISOString(),productLaunches:0,
  accountMutations:0,deletedFiles:0,scope:"READONLY_TERMINAL_RECONCILIATION_NOT_ORIGINAL_RETIREMENT_RECEIPT"};
try{
  const controller=read(path.join(base,"account-controller.json")),run=read(path.join(base,"resource-01/report.json"));
  const failed=read(path.join(base,"account-retirement-01.json"));
  assert.equal(controller.status,"FINISHED");assert.equal(run.status,"PASS");assert.equal(run.cleanupStatus,"PASS");
  assert(controller.cleanup.accountDisabled&&!controller.cleanup.profileLoaded&&!controller.cleanup.ownedProcesses.length);
  assert.equal(failed.status,"FAILED");assert.match(failed.error,/ResolvePathCommand/);
  assert.equal(failed.functionalStatus,"PASS");
  assert.equal(failed.controller.sha256,sha(path.join(base,"account-controller.json")));
  report.originalFailure={path:path.join(base,"account-retirement-01.json"),sha256:sha(path.join(base,"account-retirement-01.json"))};
  const sid=controller.account.sid,profile=controller.cleanup.profilePath;
  assert.equal(sid,"S-1-5-21-2093805479-91935561-747405786-1138");
  assert.equal(profile,"C:\\Users\\AVNQA93122EA0");
  const processList=JSON.stringify(run.editorKnown.map(p=>({pid:p.ProcessId,created:p.Created})));
  const query=`$ErrorActionPreference='Stop';$sid='${sid}';$ports=@(${run.launches.flatMap(l=>l.ports).join(",")});`+
    `$expected=ConvertFrom-Json '${processList}';$live=@(Get-CimInstance Win32_Process);`+
    `$owned=@(foreach($p in $live){foreach($e in $expected){if($p.ProcessId -eq $e.pid -and `+
    `$p.CreationDate.ToUniversalTime().ToString('o') -ceq $e.created){$p.ProcessId;break}}});`+
    `@{accounts=@(Get-CimInstance Win32_UserAccount -Filter "SID='$sid'").Count;`+
    `profiles=@(Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ $sid).Count;owned=$owned;`+
    `listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In $ports).Count}`+
    `|ConvertTo-Json -Compress`;
  const state=JSON.parse(cp.execFileSync("powershell.exe",["-NoProfile","-Command",query],
    {encoding:"utf8",windowsHide:true,timeout:60000}).replace(/^\uFEFF/,""));
  assert.equal(state.accounts,0);assert.equal(state.profiles,0);assert.equal(state.listeners,0);
  assert.deepEqual(state.owned,[]);assert(!fs.existsSync(profile));
  const database=path.join(base,"verified-qa-default.db");
  const db=new DatabaseSync(database,{readOnly:true});
  try{
    const saved=JSON.parse(db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?")
      .get("qa-editor-organize-1982").project_json);
    const graph=p=>({nodes:p.nodes.map(n=>({id:n.id,data:n.data,position:n.position})),
      edges:p.edges.map(({selected,...e})=>e)});
    assert.deepEqual(graph(saved),read(path.join(base,"resource-01/arranged-graph.json")));
  }finally{db.close();}
  report.databaseEvidence={path:database,sha256:sha(database),scope:"Retained default QA database; graph verified structurally"};
  report.account={name:controller.account.name,sid,profile};report.currentState=state;
  report.processScope="All recorded product processes by PID and creation time; account absent. No full-machine per-process SID scan.";
  report.cleanup={accountDeleted:true,profileDeleted:true,ownedProcesses:0,ports:run.launches.flatMap(l=>l.ports)};
  report.cause="A duplicate manual retirement was launched while automatic controller retirement was already in progress. Original FAILED retained. No retirement was retried for this audit.";
  report.status="PASS";
}catch(error){report.status="FAILED";report.error=error.stack;process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify(report,null,2));
}
