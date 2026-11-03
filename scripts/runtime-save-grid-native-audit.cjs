"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {rows,listeners}=require("./lib/current-native-editor-session.cjs");
const {saveGridBuildEvidence}=require("./lib/save-grid-native-session.cjs");
const attempt=process.argv[2];assert(/^\d{2}$/.test(attempt||""));
const nativeRoot=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/save-grid-native02-${attempt}`;
const base="F:/AgentVN/QA/Runtime-Save-Grid-Fit-20261024-01",out=path.join(base,`native-audit-${attempt}`);
assert(!fs.existsSync(out));fs.mkdirSync(out);
const read=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const sha=file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const same=file=>assert.equal(sha(file.path),file.sha256,file.path);
const report={status:"RUNNING",modelRequests:0,cases:[],
  scope:"CURRENT_DEV_NATIVE_PLAYER_PREVIEW_NOT_INSTALLATION_EXPORT_UPGRADE_OR_ANDROID"};
try{
  const native=read(path.join(nativeRoot,"report.json"));assert.equal(native.status,"PASS");
  assert(native.finishedAt&&!native.cleanupError);
  const buildFile=path.join(base,"build-02/report.json"),build=saveGridBuildEvidence(buildFile,nativeRoot);
  assert.equal(native.build.sha256,build.receipt.sha256);assert.equal(native.player.sha256,build.player.sha256);
  assert.throws(()=>saveGridBuildEvidence("F:/AgentVN/QA/Runtime-SavePage-Handoff-20261024-01/build-03/report.json",nativeRoot));
  assert.throws(()=>saveGridBuildEvidence(buildFile,"F:/AgentVN/QA/Native-Runtime-State-20261020-01/save-page-handoff-native03-01"));
  report.receiptNegatives=2;
  for(const file of [...native.tools,...native.fixtures])same(file);
  assert.equal(native.cases.length,48);
  assert.equal(new Set(native.cases.map(c=>[c.layout,c.width,c.height,c.dpr,c.reduced,c.state].join(":"))).size,48);
  const inside=(a,b)=>a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
  for(const c of native.cases){
    assert.equal(c.status,"PASS");assert.deepEqual(c.before,c.after);
    assert.equal(c.before.width,c.width);assert.equal(c.before.height,c.height);
    assert(Math.abs(c.before.dpr-c.dpr)<1e-6);assert.equal(c.before.reduced,c.reduced);
    const g=c.geometry;assert.equal(g.cards.length,6);assert(g.scrollHeight<=g.clientHeight+1);assert.equal(g.overflow,0);
    assert(g.cards.every(s=>s.hit&&s.preview.height>0&&s.populated===(c.state==="populated")
      &&[s.rect,s.button,s.copy,...s.text].every(r=>inside(r,g.grid))
      &&[s.preview,s.copy,...s.text].every(r=>inside(r,s.rect))));
    if(c.state==="populated")assert(g.cards.every(s=>s.image?.complete&&s.image.naturalWidth>0
      &&s.image.fit==="contain"&&inside(s.image.rect,s.preview)));
    report.cases.push({layout:c.layout,width:c.width,dpr:c.dpr,reduced:c.reduced,state:c.state,status:"PASS"});
  }
  assert.equal(native.screenshots.length,48);
  for(const shot of native.screenshots){
    same(shot);assert.deepEqual(shot.before,shot.after);
    const png=fs.readFileSync(shot.path);
    assert.equal(png.readUInt32BE(16),shot.before.width*shot.before.dpr);
    assert.equal(png.readUInt32BE(20),shot.before.height*shot.before.dpr);
  }
  assert.equal(native.writes.length,2);
  for(const write of native.writes){
    assert.equal(write.files.length,6);
    assert.deepEqual(write.files.map(f=>f.slot).sort((a,b)=>a-b),[1,2,3,4,5,6]);
    for(const file of write.files){
      same(file);const data=read(file.path);
      assert.equal(data.slot,file.slot);assert.equal(data.save_kind,"manual");
      assert.equal(data.game_id,`qa-native-grid-${write.layout}`);assert.equal(data.install_id,"preview_gamecli");
      assert.equal(data.preview_image.length,file.previewBytes);
      assert(data.preview_image.startsWith("data:image/"));
    }
  }
  assert.equal(native.launches.length,2);const identities=new Set();
  for(const launch of native.launches){
    assert.equal(launch.cleanup.status,"PASS");assert(!launch.cleanupError);
    assert.equal(launch.normalCloseClaimed,false);assert.equal(launch.renderer.features.gpu_compositing,"enabled");
    assert.equal(launch.executable.sha256,build.player.sha256);
    assert(launch.knownProcesses.some(p=>p.ProcessId===launch.pid&&p.Created===launch.identity.Created
      &&path.resolve(p.ExecutablePath)===path.resolve(build.player.path)));
    for(const p of launch.knownProcesses)identities.add(`${p.ProcessId}:${p.Created}`);
  }
  assert.equal(listeners(native.launches.map(l=>l.port)).length,0);
  assert(!rows().some(p=>identities.has(`${p.ProcessId}:${p.Created}`)));
  assert.equal(native.profiles.length,2);
  for(const profile of native.profiles){
    assert.equal(profile.status,"RESTORED");same(profile.protection);same(profile.restoration);
    assert.equal(read(profile.restoration.path).status,"PASS");
    for(const record of read(profile.protection.path).records){
      assert.equal(fs.existsSync(record.held),false);
      assert.equal(fs.existsSync(record.original),record.existed);
      if(record.existed)assert.equal(fs.lstatSync(record.original).isSymbolicLink(),false);
      for(const file of record.files)assert.equal(sha(path.join(record.original,file.relative)),file.sha256);
    }
  }
  report.cleanup={status:"PASS",identities:identities.size,profilesRestored:2,normalCloseClaimed:false};
  report.status="PASS";
}catch(error){report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;}
report.finishedAt=new Date().toISOString();
fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
console.log(JSON.stringify({status:report.status,out,cases:report.cases.length,error:report.error}));
