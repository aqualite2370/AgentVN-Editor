"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{gunzipSync}=require("node:zlib");
const {rows,listeners}=require("./lib/current-native-editor-session.cjs");
const {openingCandidateEvidence}=require("./lib/candidate-1924-opening-session.cjs");
const attempt=process.argv[2];assert(/^\d{2}$/.test(attempt||""));
const nativeRoot=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/opening-installed-1924-${attempt}`;
const base="F:/AgentVN/QA/Editor-1.9.24-20261024-01",out=path.join(base,`opening-audit-${attempt}`);
assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const desc=f=>({path:path.resolve(f),sha256:sha(f)});
const report={status:"RUNNING",startedAt:new Date().toISOString(),checks:[],frames:0,modelRequests:0,
  scope:"INSTALLED_1_9_24_BUNDLED_OPENING_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID"};
function summary(r){
  assert.equal(r.status,"PASS");assert(r.finishedAt&&!r.cleanupError);
  assert.equal(r.cases.length,32);assert.equal(r.launches.length,32);assert.equal(r.screenshots.length,28);
  assert.equal(r.boundaryChecks.length,3);assert(r.cases.every(c=>c.status==="PASS"));
  const video=r.cases.filter(c=>c.kind==="video"&&!c.interrupt);assert.equal(video.length,24);
  for(const width of [1920,2560,3840])for(const dpr of [1,2])for(const reduced of [false,true])
    for(const layout of ["agentvn","renpy"])
      assert.equal(video.filter(c=>c.width===width&&c.dpr===dpr&&c.reduced===reduced&&c.layout===layout).length,1);
  for(const reduced of [false,true]){
    for(const kind of ["image_sequence","default","broken"])
      assert.equal(r.cases.filter(c=>c.reduced===reduced&&c.kind===kind&&c.layout==="renpy").length,1);
    assert.equal(r.cases.filter(c=>c.kind==="video"&&c.interrupt&&c.reduced===reduced&&c.layout==="agentvn").length,1);
  }
}
try{
  const file=path.join(nativeRoot,"report.json"),r=read(file);
  summary(r);report.input=desc(file);
  for(const bad of [{...r,cases:[]},{...r,cases:r.cases.slice(1)},{...r,screenshots:[]}]){
    assert.throws(()=>summary(bad));
  }
  report.checks.push({name:"32 exact flows and 28 screenshots; empty/incomplete receipts rejected",status:"PASS"});
  const evidence=openingCandidateEvidence(path.join(base,"installation.json"),nativeRoot);
  for(const f of [...r.tools,...r.fixtures,r.sourceOracle])assert.equal(sha(f.path),f.sha256);
  const observed=rows(),identities=new Map();
  for(const l of r.launches){
    assert.equal(l.cleanup.status,"PASS");assert(!l.cleanupError);assert.equal(l.mode,"preview");
    assert.equal(l.normalCloseClaimed,false);assert.equal(l.executable.sha256,evidence.executable.sha256);
    assert.equal(path.resolve(l.executable.path),path.resolve(evidence.executable.path));
    assert.equal(l.renderer.features.gpu_compositing,"enabled");
    assert(l.knownProcesses.some(p=>p.ProcessId===l.pid&&p.Created===l.identity.Created
      &&path.resolve(p.ExecutablePath)===path.resolve(evidence.executable.path)));
    for(const p of l.knownProcesses)identities.set(`${p.ProcessId}:${p.Created}`,p);
  }
  assert.equal(listeners(r.launches.map(l=>l.port)).length,0);
  assert(!observed.some(p=>identities.has(`${p.ProcessId}:${p.Created}`)));
  report.processes=identities.size;
  report.checks.push({name:"actual installed Player, GPU state and 32 exact process/port cleanups",status:"PASS"});
  for(const row of r.cases){
    assert(!row.captureError&&!row.cleanupError);
    assert.deepEqual(row.before,row.after);assert.equal(row.before.width,row.width);assert.equal(row.before.height,row.height);
    assert(Math.abs(row.before.dpr-row.dpr)<=1e-6);assert.equal(row.before.reduced,row.reduced);
    assert.equal(sha(row.trace.path),row.trace.sha256);
    const captured=JSON.parse(gunzipSync(fs.readFileSync(row.trace.path))),frames=captured.frames;
    report.frames+=frames.length;
    if(row.kind!=="broken")assert.equal(row.storyBlackoutPreserved,true);
    if(row.kind==="broken")assert.equal(row.errorVisible,true);
    if(["default","broken"].includes(row.kind))continue;
    const entry=frames.filter(f=>f.opening&&f.mediaOpacity>.02&&f.mediaOpacity<.98);
    const exit=frames.filter(f=>f.opening&&f.opacity>.02&&f.opacity<.98);
    assert(entry.length>=2);if(!row.interrupt)assert(exit.length>=2);
    assert.equal(entry.length,row.entranceFrames);assert.equal(exit.length,row.exitFrames);
    const clocks=frames.flatMap(f=>[...(f.mediaAnimations??[]),...(f.stageAnimations??[])]);
    assert(clocks.length&&clocks.every(a=>a.timing.duration===(row.reduced?180:420)));
    assert(frames.filter(f=>f.opening).every(f=>f.transform==="none"&&!f.cardMedia));
    const g=row.geometry;assert(!g.inCard&&g.stage&&g.overflow<=1);
    assert(Math.abs(g.stage.x)<1&&Math.abs(g.stage.y)<1
      &&Math.abs(g.stage.width-row.width)<1&&Math.abs(g.stage.height-row.height)<1);
    assert(g.media.width>=row.width-1&&g.media.height>=row.height-1);
    assert(g.fit==="contain"&&g.radius==="0px"&&g.border==="0px"&&g.shadow==="none");
    assert.deepEqual(row.input,{focused:true,backgroundInert:true,titleBlocked:true});
    if(row.kind==="video"){
      assert.deepEqual(captured.events,row.events);
      assert.equal(row.events.filter(e=>e.event==="ended").length,row.interrupt?0:1);
      assert(row.playing.duration>2&&!row.playing.paused);
      if(!row.interrupt){
        const ended=row.events.find(e=>e.event==="ended"),playing=frames.filter(f=>f.opening&&f.at<ended.at);
        assert(playing.length>2&&playing.every(f=>f.opacity>=.999));
        assert(playing.filter(f=>f.mediaOpacity>.02&&f.mediaOpacity<.98).length>=2);
        assert(frames.some(f=>f.opening&&f.time>1));
      }
    }
  }
  report.checks.push({name:"raw full-screen geometry, input ownership, 420/180ms frames, real ended and story blackout",status:"PASS"});
  for(const shot of r.screenshots){
    assert.equal(sha(shot.path),shot.sha256);assert.deepEqual(shot.before,shot.after);
    const png=fs.readFileSync(shot.path);
    assert.equal(png.readUInt32BE(16),shot.before.width*shot.before.dpr);
    assert.equal(png.readUInt32BE(20),shot.before.height*shot.before.dpr);
  }
  const protection=read(path.join(nativeRoot,"profile-protection.json"));
  const restoration=read(path.join(nativeRoot,"profile-restoration.json"));
  assert.equal(restoration.status,"PASS");assert.equal(restoration.deletedUserFiles,0);
  assert.equal(sha(r.profileRestoration.path),r.profileRestoration.sha256);
  for(const original of protection.records){
    assert(!fs.existsSync(original.held));assert.equal(fs.existsSync(original.original),original.existed);
    if(original.existed)assert(!fs.lstatSync(original.original).isSymbolicLink());
    for(const f of original.files)assert.equal(sha(path.join(original.original,f.relative)),f.sha256);
  }
  report.checks.push({name:"PNG device pixels/media unchanged and original Player profiles restored",status:"PASS"});
  report.status="PASS";
}catch(error){report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify(report,null,2));
}
