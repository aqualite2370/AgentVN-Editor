"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),qa="F:/AgentVN/QA/Runtime-Screen-Polish-20261022-01";
const [matrixName,gatesName,name]=process.argv.slice(2);
assert(/^matrix-\d{2}$/.test(matrixName||"")&&/^gates-\d{2}$/.test(gatesName||"")&&/^\d{2}$/.test(name||""));
const output=path.join(qa,`terminal-${name}.json`);assert(!fs.existsSync(output));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read=dir=>JSON.parse(fs.readFileSync(path.join(qa,dir,"report.json")));
const report={status:"RUNNING",at:new Date().toISOString(),scope:"INDEPENDENT_SOURCE_DEV_AND_CLEANUP_NOT_RELEASE_OR_DEVICE",checks:[]};
(async()=>{
  const matrix=read(matrixName),gates=read(gatesName);assert.equal(matrix.status,"PASS");assert.equal(gates.status,"PASS");
  assert.equal(matrix.cleanup.status,"PASS");assert.equal(matrix.cases.length,168);assert.equal(matrix.screenshots.length,24);
  assert(matrix.cases.every(row=>row.status==="PASS"));
  const combinations=new Map();
  for(const row of matrix.cases){const key=[row.type,row.width,row.height,row.dpr,row.reduced].join(":");combinations.set(key,(combinations.get(key)||0)+1);}
  assert.equal(combinations.size,24);assert([...combinations.values()].every(n=>n===7));
  const safetyName=process.argv.find(arg=>arg.startsWith("--safety="))?.split("=")[1];
  assert(/^safety-\d{2}$/.test(safetyName||""),"Keyboard/frame supplement required");
  const safety=read(safetyName);assert.equal(safety.status,"PASS");assert.equal(safety.cleanup.status,"PASS");
  assert.equal(safety.cases.length,48);assert(safety.cases.every(row=>row.status==="PASS"));
  const flips=safety.cases.filter(row=>row.label==="page-slide-and-interrupt");assert.equal(flips.length,24);
  assert(flips.every(row=>row.evidence.keyboard.length>0&&row.evidence.unmountDuringFlip));
  const safetyCombinations=new Map();
  for(const row of safety.cases){const key=[row.type,row.width,row.height,row.dpr,row.reduced].join(":");
    safetyCombinations.set(key,(safetyCombinations.get(key)||0)+1);}
  assert.deepEqual([...safetyCombinations.keys()].sort(),[...combinations.keys()].sort());
  assert([...safetyCombinations.values()].every(n=>n===2));
  let sampledFrames=0,maxGeometryDelta=0;
  for(const row of flips)for(const samples of [row.evidence.frames,row.evidence.keyboard]){
    assert(samples.length>=2);
    assert(samples.filter(frame=>frame.layers.some(layer=>layer.opacity>.05&&layer.opacity<.95
      &&layer.transform!=="none")).length>=2,"No continuous translated intermediate frames");
    assert(samples.every(frame=>frame.layers.length&&frame.layers.filter(layer=>!layer.inert).length===1),
      "More than one functional pagination layer");
    for(const field of ["viewport","screen","back","navigation","toolbar"]){
      const first=samples[0][field];assert(first);
      for(const frame of samples)for(const key of ["x","y","width","height"]){
        assert(Number.isFinite(frame[field]?.[key]));
        const delta=Math.abs(frame[field][key]-first[key]);maxGeometryDelta=Math.max(maxGeometryDelta,delta);
        assert(delta<=.25,`Pagination changed fixed ${field}.${key}`);
      }
    }
    sampledFrames+=samples.length;
  }
  report.checks.push({name:"independent-keyboard-mouse-frame-and-fixed-geometry-recalculation",
    status:"PASS",combinations:safetyCombinations.size,sampledFrames,maxGeometryDelta});
  assert.equal(sha(path.join(qa,safetyName,"executed.cjs")),safety.executedSha256);
  for(const source of safety.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);
  report.safety={path:path.join(qa,safetyName,"report.json"),sha256:sha(path.join(qa,safetyName,"report.json")),cases:48};
  assert.equal(sha(path.join(qa,matrixName,"report.json")),gates.matrix.sha256);
  assert.equal(sha(path.join(qa,matrixName,"executed.cjs")),matrix.executedSha256);
  report.screenshots=[];
  for(const shot of matrix.screenshots){const png=fs.readFileSync(shot.path);assert.equal(png.readUInt32BE(16),shot.width*shot.dpr);assert.equal(png.readUInt32BE(20),shot.height*shot.dpr);}
  report.screenshots=matrix.screenshots.map(shot=>({...shot,sha256:sha(shot.path)}));
  report.checks.push({name:"full-nonempty-24-layout-display-combinations-168-groups-and-real-png-pixels",status:"PASS"});
  for(const source of gates.sources)assert.equal(sha(path.join(root,source.file)),source.sha256);
  assert.equal(sha(gates.devAfter.path),gates.devAfter.sha256);
  assert.equal(sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")),gates.devAfter.sha256);
  assert.equal(sha(gates.devBefore.backup),gates.devBefore.sha256);
  assert.equal(sha(gates.installer.path),gates.installer.sha256);assert.equal(sha(gates.database.path),gates.database.sha256);
  assert(!fs.existsSync(path.join(root,"AgentVN Dev.pending.exe")));
  for(const row of gates.resources.bundled)assert.equal(sha(path.join(root,"editor/src-tauri/bundle-workspace",row.file)),row.sha256);
  const editor=JSON.parse(fs.readFileSync("F:/AgentVN/QA/Editor-Sibling-Motion-20261021-01/gates-03/report.json"));
  for(const row of editor.sources)assert.equal(sha(path.join(root,row.file)),row.sha256,"Runtime block changed protected Editor motion");
  report.checks.push({name:"source-bundled-resources-dev-debug-old-dev-frozen-installer-db-and-editor-motion",status:"PASS",dev:gates.devAfter});
  const pids=new Set(),urls=new Set();
  const collect=value=>{
    if(!value||typeof value!=="object")return;
    for(const [key,item]of Object.entries(value)){
      if(["pid","editorPid","backendPid"].includes(key)&&Number.isInteger(item))pids.add(item);
      if(["url","backendUrl"].includes(key)&&typeof item==="string"&&/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(item))urls.add(item);
      if(typeof item==="object")collect(item);
    }
  };
  report.attempts=[];
  for(const dir of fs.readdirSync(qa)){
    const file=path.join(qa,dir,"report.json");
    if(!/^(red|green|matrix|gates|safety)-\d{2}$/.test(dir)||!fs.existsSync(file))continue;
    const old=JSON.parse(fs.readFileSync(file));collect(old.owner);report.attempts.push({dir,status:old.status,cleanup:old.cleanup});
  }
  for(const step of gates.steps){if(step.pid)pids.add(step.pid);if(step.evidence){
    assert.equal(sha(step.evidence.path),step.evidence.sha256);const data=JSON.parse(fs.readFileSync(step.evidence.path));
    collect(data.owner);collect(data.service);
  }}
  for(const pid of pids){let exists=true;try{process.kill(pid,0);}catch(error){if(error.code==="ESRCH")exists=false;else throw error;}
    assert(!exists,`Recorded PID exists: verify creation/owner before claiming cleanup: ${pid}`);}
  await Promise.all([...urls].map(async url=>{
    let answered=false;try{await fetch(url,{signal:AbortSignal.timeout(800)});answered=true;}catch{}
    assert(!answered,`Acceptance service still responds: ${url}`);
  }));
  const log=fs.readFileSync(path.join(qa,gatesName,"complete-dev/command.log"),"utf8");
  const configs=[...log.matchAll(/--config ([A-Z]:[^\r\n]+?\.json)/g)].map(match=>match[1]);
  assert(configs.length>0);for(const file of configs)assert(!fs.existsSync(file),`Build temporary config remains: ${file}`);
  report.checks.push({name:"owned-pids-ports-and-build-config-clean",status:"PASS",pids:[...pids],urls:[...urls],configs});
  report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack);process.exitCode=1;})
  .finally(()=>{report.finishedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:"wx"});
    console.log(JSON.stringify({status:report.status,output,error:report.error}));});
