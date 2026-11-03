"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {rows,listeners}=require("./lib/current-native-editor-session.cjs");
const base="F:/AgentVN/QA/Editor-1.9.24-20261024-01",attempt=process.argv[2];
assert(/^\d{2}$/.test(attempt||""));
const out=path.join(base,`terminal-${attempt}`);assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const desc=f=>({path:path.resolve(f),sha256:sha(f)});
const report={status:"RUNNING",startedAt:new Date().toISOString(),checks:[],inputs:[],modelRequests:0,
  scope:"CANDIDATE_BUILD_INSTALL_SAVE_TITLE_TERMINAL_AUDIT_NOT_FULL_REGRESSION_OR_UPGRADE"};
function input(relative){
  const file=path.join(base,relative),r=read(file);assert.equal(r.status,"PASS",file);
  report.inputs.push(desc(file));return r;
}
try{
  const build=input("build-01/report.json");
  assert.equal(build.candidateVersion,"1.9.24");assert.equal(build.commands.length,19);
  for(const c of build.commands){
    assert.equal(c.status,"PASS");assert.equal(c.exitCode,0);assert.equal(sha(c.logIdentity.path),c.logIdentity.sha256);
  }
  for(const f of [build.dev,build.player,...build.frozenProducts])assert.equal(sha(f.path),f.sha256);
  for(const f of build.sources.filter(f=>
    /[\\/]AgentVN[\\/](editor|GameCli_framework|backend|shared)[\\/]/i.test(f.path)
    &&!/[\\/]agentvnDocIndex\.generated\.ts$/.test(f.path)))assert.equal(sha(f.path),f.sha256,f.path);
  report.checks.push({name:"19 real build commands, log bytes, Dev/Player and unchanged product sources",status:"PASS"});
  const packaged=input("package-01/report.json"),payload=input("payload-01/report.json");
  const installed=read(path.join(base,"installation.json"));assert.equal(installed.status,"PASS");
  input("install-02/report.json");report.inputs.push(desc(path.join(base,"installation.json")));
  assert.equal(read(path.join(base,"install-01/report.json")).status,"FAILED");
  report.inputs.push(desc(path.join(base,"install-01/report.json")));
  for(const f of [packaged.installer,packaged.retainedInstaller,installed.executable,
    ...installed.resources,...installed.protectedFiles])assert.equal(sha(f.path),f.sha256);
  assert.equal(installed.executable.version,"1.9.24");assert.equal(installed.metadataRestoration,"PASS");
  assert.equal(payload.installerFormat,"nsis");assert.equal(installed.package.sha256,packaged.installer.sha256);
  assert.equal(payload.archived[0].sha256,packaged.installer.sha256);
  report.checks.push({name:"actual NSIS/installed resource bytes and preserved failed first attempt",status:"PASS"});
  input("save-audit-01/report.json");
  const title=input("title-01/report.json");
  assert.equal(title.cases.length,4);assert(title.cases.every(c=>c.status==="PASS"));
  assert.equal(title.matrix.length,12);assert.equal(title.screenshots.length,12);
  assert.equal(title.launches.length,2);assert.equal(title.cleanups.length,2);assert.deepEqual(title.errors,[]);
  assert.equal(title.modelRequests,0);assert.equal(title.installation.sha256,sha(path.join(base,"installation.json")));
  for(const width of [1920,2560,3840])for(const dpr of [1,2])for(const reduced of [false,true])
    assert.equal(title.matrix.filter(m=>m.params.width===width&&m.params.dpr===dpr&&m.params.reduced===reduced).length,1);
  for(const shot of title.screenshots){
    assert.equal(sha(shot.path),shot.sha256);assert.deepEqual(shot.before,shot.after);
    const png=fs.readFileSync(shot.path);
    assert.equal(png.readUInt32BE(16),shot.before.width*shot.before.dpr);
    assert.equal(png.readUInt32BE(20),shot.before.height*shot.before.dpr);
  }
  for(const f of title.tools)assert.equal(sha(f.path),f.sha256);
  const processes=rows();
  assert(title.knownProcesses.every(p=>!processes.some(n=>n.ProcessId===p.ProcessId&&n.Created===p.Created)));
  assert(title.cleanups.every(c=>c.status==="PASS"&&listeners(c.ports).length===0));
  report.checks.push({name:"four installed title authoring flows, two host processes, 12 real PNGs and exact cleanup",status:"PASS"});
  report.status="PASS";
}catch(error){report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify(report,null,2));
}
