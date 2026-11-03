"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),qa="F:/AgentVN/QA/Asset-Audit-20261021-01";
const out=path.join(qa,`terminal-${process.argv[2]}.json`);assert(!fs.existsSync(out));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report={status:"RUNNING",scope:"INDEPENDENT_SOURCE_DEV_ARTIFACT_AND_CLEANUP_CHECK_NOT_INSTALLED",at:new Date().toISOString(),checks:[]};
(async()=>{
 const matrixPath=path.join(qa,"ui-matrix-02/report.json"),gatesPath=path.join(qa,"gates-01/report.json");
 const matrix=JSON.parse(fs.readFileSync(matrixPath)),gates=JSON.parse(fs.readFileSync(gatesPath));
 assert.equal(matrix.status,"PASS");assert.equal(gates.status,"PASS");
 assert.equal(matrix.cases.length,204);assert.equal(sha(matrixPath),gates.matrix.sha256);
 const bundles=matrix.cases.filter(c=>c.name==="real-save-bundle-bytes-reopen");
 assert.equal(bundles.length,12);
 for(const row of bundles){
  assert.equal(sha(row.packagePath),row.sha256);
  const png=fs.readFileSync(row.screenshotPath);
  assert.equal(png.readUInt32BE(16),row.width*row.dpr);assert.equal(png.readUInt32BE(20),row.height*row.dpr);
  assert.deepEqual(row.actual,{width:row.width,height:row.height,dpr:row.dpr,reduced:row.reduced});
 }
 report.checks.push({name:"matrix-twelve-real-parameter-png-and-package-pairs",status:"PASS",cases:204,pairs:12});
 for(const source of gates.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);
 assert.equal(sha(gates.devAfter.path),gates.devAfter.sha256);
 assert.equal(sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")),gates.devAfter.sha256);
 assert.equal(sha(gates.devBefore.backupPath),gates.devBefore.sha256);
 assert.equal(sha(gates.installer.path),gates.installer.sha256);
 assert.equal(sha(gates.defaultDatabase.path),gates.defaultDatabase.beforeSha256);
 report.checks.push({name:"source-dev-debug-old-dev-backup-frozen-installer-default-db",status:"PASS",
  dev:gates.devAfter,installer:gates.installer,database:gates.defaultDatabase,sources:gates.sources});
 const attempts=["ui-red-05","ui-red-06","ui-green-03","ui-green-04","ui-green-05","ui-green-06","ui-matrix-01","ui-matrix-02"];
 const pids=new Set(),urls=new Set();
 report.attempts=attempts.map(attempt=>{
  const data=JSON.parse(fs.readFileSync(path.join(qa,attempt,"report.json")));
  assert.equal(data.cleanup.status,"PASS");
  pids.add(data.owner.pid);pids.add(data.owner.backendPid);
  urls.add(data.owner.url);urls.add(`${data.owner.backendUrl}/api/health`);
  return {attempt,status:data.status,cleanup:data.cleanup,owner:data.owner};
 });
 for(const pid of pids){
  let exists=true;try{process.kill(pid,0);}catch(e){if(e.code==="ESRCH")exists=false;else throw e;}
  assert(!exists,`Recorded PID still exists; inspect ownership before declaring cleanup: ${pid}`);
 }
 await Promise.all([...urls].map(async url=>{
  let responded=false;try{await fetch(url,{signal:AbortSignal.timeout(800)});responded=true;}catch{}
  assert(!responded,`Recorded acceptance port still responds: ${url}`);
 }));
 const devLog=fs.readFileSync(path.join(qa,"gates-01/7-complete-dev.log"),"utf8");
 const configPaths=[...devLog.matchAll(/--config (C:[^\r\n]+?\.json)/g)].map(m=>m[1]);
 assert(configPaths.length>0);
 for(const file of configPaths)assert(!fs.existsSync(file),`Build temp config remains: ${file}`);
 report.checks.push({name:"owned-processes-ports-and-build-temp-configs-clean",status:"PASS",
  pids:[...pids],urls:[...urls],configPaths});
 report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack);process.exitCode=1;})
.finally(()=>{report.finishedAt=new Date().toISOString();fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:"wx"});
 console.log(JSON.stringify({status:report.status,out,error:report.error}));});
