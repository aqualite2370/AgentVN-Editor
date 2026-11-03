"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),qa="F:/AgentVN/QA/Editor-Sibling-Motion-20261021-01";
const [matrixName,safetyName,gatesName,attempt]=process.argv.slice(2);
assert(/^matrix-\d{2}$/.test(matrixName||"") && /^safety-matrix-\d{2}$/.test(safetyName||"")
  && /^gates-\d{2}$/.test(gatesName||"") && /^\d{2}$/.test(attempt||""));
const output=path.join(qa,`terminal-${attempt}.json`);assert(!fs.existsSync(output));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read=name=>JSON.parse(fs.readFileSync(path.join(qa,name,"report.json")));
const report={status:"RUNNING",scope:"INDEPENDENT_EDITOR_SOURCE_DEV_AND_CLEANUP_NOT_INSTALLED_OR_RUNTIME",
  at:new Date().toISOString(),checks:[]};
(async()=>{
  const matrix=read(matrixName),safety=read(safetyName),gates=read(gatesName);
  for(const data of [matrix,safety,gates])assert.equal(data.status,"PASS");
  assert.equal(matrix.cases.length,96);assert.equal(safety.cases.length,40);
  assert.equal(matrix.screenshots.length,12);
  for(const shot of matrix.screenshots) {
    const png=fs.readFileSync(shot.path);
    assert.equal(png.readUInt32BE(16),shot.width*shot.dpr);assert.equal(png.readUInt32BE(20),shot.height*shot.dpr);
  }
  const shadows=safety.cases.filter(c=>c.label==="page-selection-no-shadow-and-real-hit");
  assert.equal(shadows.length,12);
  for(const row of shadows){
    assert.equal(row.styles.length,4);
    assert.deepEqual([...new Set(row.styles.map(s=>s.type))].sort(),["agentvn","renpy"]);
    assert(row.styles.every(s=>s.shadow==="none" && s.filter==="none" && s.hit));
  }
  assert.equal(sha(path.join(qa,matrixName,"report.json")),gates[matrixName].sha256);
  assert.equal(sha(path.join(qa,safetyName,"report.json")),gates[safetyName].sha256);
  report.checks.push({name:"nonempty-twelve-parameter-png-frame-and-dual-type-shadow-matrices",status:"PASS",
    contentCases:96,safetyCases:40,pngPairs:12});
  for(const source of gates.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);
  assert.equal(sha(gates.devAfter.path),gates.devAfter.sha256);
  assert.equal(sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")),gates.devAfter.sha256);
  assert.equal(sha(gates.devBefore.backup),gates.devBefore.sha256);
  assert.equal(sha(gates.installer.path),gates.installer.sha256);assert.equal(sha(gates.database.path),gates.database.sha256);
  assert(!fs.existsSync(path.join(root,"AgentVN Dev.pending.exe")));
  const bundled=["shared/ui/slowFocusGlow.css","shared/cartridge/uiLayoutProfiles.ts","GameCli_framework/src/app/App.tsx"]
    .map(file=>{
      const source=sha(path.join(root,file)),bundle=sha(path.join(root,"editor/src-tauri/bundle-workspace",file));
      assert.equal(source,bundle);return {file,sha256:source};
    });
  report.checks.push({name:"source-dev-debug-backup-frozen-installer-default-db-and-bundled-resources",status:"PASS",
    dev:gates.devAfter,installer:gates.installer,database:gates.database,bundled});
  const pids=new Set(),urls=new Set();
  const collect=node=>{
    if(!node || typeof node!=="object")return;
    for(const [key,value] of Object.entries(node)){
      if(["pid","editorPid","backendPid"].includes(key) && Number.isInteger(value))pids.add(value);
      if(["url","backendUrl"].includes(key) && typeof value==="string" && /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(value))
        urls.add(value);
      if(typeof value==="object")collect(value);
    }
  };
  report.attempts=[];
  for(const name of fs.readdirSync(qa)){
    const file=path.join(qa,name,"report.json");
    if(!fs.existsSync(file) || !/^(red|green|matrix|safety-(?:red|green|matrix)|gates)-\d{2}$/.test(name))continue;
    const data=JSON.parse(fs.readFileSync(file));collect(data.owner);
    report.attempts.push({name,status:data.status,cleanup:data.cleanup??null});
  }
  for(const step of gates.steps){
    if(step.pid)pids.add(step.pid);
    if(step.evidence)collect(JSON.parse(fs.readFileSync(step.evidence.path)).owner);
  }
  for(const pid of pids){
    let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==="ESRCH")alive=false;else throw e;}
    assert(!alive,`Recorded PID exists; inspect ownership before claiming clean: ${pid}`);
  }
  await Promise.all([...urls].map(async url=>{
    let answered=false;try{await fetch(url,{signal:AbortSignal.timeout(800)});answered=true;}catch{}
    assert(!answered,`Recorded acceptance endpoint still responds: ${url}`);
  }));
  const log=fs.readFileSync(path.join(qa,gatesName,"complete-dev/command.log"),"utf8");
  const configs=[...log.matchAll(/--config (C:[^\r\n]+?\.json)/g)].map(m=>m[1]);
  assert(configs.length>0,"Build config provenance missing");
  for(const file of configs)assert(!fs.existsSync(file),`Temporary build config remains: ${file}`);
  report.checks.push({name:"owned-pids-ports-build-configs-clean",status:"PASS",pids:[...pids],urls:[...urls],configs});
  report.status="PASS";
})().catch(e=>{report.status="FAILED";report.error=String(e.stack);process.exitCode=1;})
.finally(()=>{report.finishedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,output,error:report.error}));});
