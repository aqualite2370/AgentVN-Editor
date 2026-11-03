"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {rows,listeners}=require("./lib/current-native-editor-session.cjs");
const attempt=process.argv[2];assert(/^\d{2}$/.test(attempt||""));
const run=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/junction-installed-1924-${attempt}`;
const base="F:/AgentVN/QA/Editor-1.9.24-20261024-01",out=path.join(base,`junction-audit-${attempt}`);
assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const report={status:"RUNNING",startedAt:new Date().toISOString(),checks:[],modelRequests:0,
  scope:"INSTALLED_1_9_24_JUNCTION_LIBRARY_SAVE_EXIT_RESTART_NOT_STANDALONE_UPGRADE_OR_ANDROID"};
function summary(r){
  assert.equal(r.status,"PASS");assert(r.finishedAt&&!r.cleanupError&&!r.observerError);
  assert.equal(r.cells.length,24);assert.equal(r.nativeCases.length,6);
  assert.equal(r.screenshots.length,24);assert.equal(r.launches.length,4);
  assert(r.cells.every(c=>c.status==="PASS"));assert(r.nativeCases.every(c=>c.status==="PASS"&&c.writes.length===2));
  for(const layout of ["agentvn","renpy"]){
    for(const width of [1920,2560,3840])for(const dpr of [1,2])for(const reduced of [false,true])
      assert.equal(r.cells.filter(c=>c.layout===layout&&c.width===width&&c.dpr===dpr&&c.reduced===reduced).length,1);
    for(const kind of ["manual","auto","quick"])
      assert.equal(r.nativeCases.filter(c=>c.layout===layout&&c.kind===kind).length,1);
  }
}
try{
  const file=path.join(run,"report.json"),r=read(file);summary(r);
  report.input={path:file,sha256:sha(file)};
  for(const bad of [{...r,cells:[]},{...r,nativeCases:r.nativeCases.slice(1)},{...r,launches:[]}])
    assert.throws(()=>summary(bad));
  for(const f of [r.prep.executable,r.prep.installation,r.prep.exported,...r.prep.cartridges,...r.tools])
    assert.equal(sha(f.path),f.sha256);
  const installed=read(r.prep.installation.path);assert.equal(installed.executable.version,"1.9.24");
  assert.equal(installed.status,"PASS");assert.equal(installed.metadataRestoration,"PASS");
  assert.equal(path.resolve(r.prep.executable.path),path.resolve(installed.installRoot,"agentvn-player.exe"));
  for(const f of [installed.executable,...installed.resources,...installed.protectedFiles])assert.equal(sha(f.path),f.sha256);
  report.checks.push({name:"sealed actual installation and exact matrix; incomplete receipts rejected",status:"PASS"});
  for(const c of r.nativeCases){
    for(const w of c.writes){
      assert.deepEqual(w.actual,w.value);
      const own=w.files.find(f=>f.data.save_kind===c.kind);assert(own);assert.deepEqual(own.data,w.value);
    }
    const final=c.writes.at(-1).files.find(f=>f.data.save_kind===c.kind);
    assert.equal(sha(final.path),final.sha256);assert.deepEqual(read(final.path),c.writes.at(-1).value);
  }
  for(const c of r.cells){
    const g=c.hit,b=g.rect;assert(g.enabled&&g.hit&&g.overflow<=1);
    assert(b.width>0&&b.height>0&&b.left>=-1&&b.top>=-1&&b.right<=g.width+1&&b.bottom<=g.height+1);
    assert(!c.disk.some(f=>f.path.endsWith(".tmp")));
    assert(c.disk.some(f=>f.data.save_kind==="manual"&&f.data.slot===1));
  }
  report.checks.push({name:"six native writer cases, first/replace bytes and 24 actual UI save hits",status:"PASS"});
  const observed=rows(),known=new Map();
  for(const p of r.knownProcesses)known.set(`${p.ProcessId}:${p.Created}`,p);
  assert(!observed.some(p=>known.has(`${p.ProcessId}:${p.Created}`)));
  assert.equal(listeners(r.launches.map(l=>l.port)).length,0);
  for(const layout of ["agentvn","renpy"]){
    const launch=r.launches.filter(l=>l.layout===layout);assert.equal(launch.length,2);
    assert.equal(launch[0].confirmedExit.code,0);assert.equal(launch[0].confirmedExit.forceStopBeforeExit,false);
    assert.equal(launch[0].cleanup.method,"PROCESS_ALREADY_EXITED_BEFORE_CLEANUP");
    assert(launch[0].automatic.length);
    for(const automatic of launch[0].automatic)assert.equal(sha(automatic.path),automatic.sha256);
    assert(launch[1].restart);assert.deepEqual(launch[1].restored.actual,launch[1].restored.expected);
    assert.notEqual(launch[0].identity.Created,launch[1].identity.Created);
    assert(launch.every(l=>l.cleanup.status==="PASS"&&l.storage.portable===false));
  }
  report.checks.push({name:"two natural confirmed exits, automatic disk saves and fresh-process UI restores",status:"PASS"});
  for(const shot of r.screenshots){
    assert.equal(sha(shot.path),shot.sha256);assert.deepEqual(shot.before,shot.after);
    const png=fs.readFileSync(shot.path);
    assert.equal(png.readUInt32BE(16),shot.before.width*shot.before.dpr);
    assert.equal(png.readUInt32BE(20),shot.before.height*shot.before.dpr);
  }
  assert.equal(sha(r.restoration.path),r.restoration.sha256);
  const restored=read(r.restoration.path);assert.equal(restored.status,"PASS");assert.equal(restored.deletedUserFiles,0);
  const protection=read(path.join(run,"profile-protection.json"));
  for(const original of protection.records){
    assert(!fs.existsSync(original.held));assert.equal(fs.existsSync(original.original),original.existed);
    for(const f of original.files)assert.equal(sha(path.join(original.original,f.relative)),f.sha256);
  }
  assert.deepEqual(r.pageErrors,[]);assert.deepEqual(r.cleanup.survivors,[]);assert.deepEqual(r.cleanup.listeners,[]);
  report.checks.push({name:"24 PNG parameters, exact process/port cleanup and restored profile bytes",status:"PASS"});
  report.status="PASS";
}catch(error){report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify(report,null,2));
}
