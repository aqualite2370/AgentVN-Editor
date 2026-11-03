"use strict";
// Independent terminal reread: no product, cache or process mutation.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{gunzipSync}=require("node:zlib");
const {rows,listeners}=require("./lib/current-native-editor-session.cjs");
const {candidateEvidence}=require("./lib/candidate-1924-runtime-session.cjs");
const {validateNativeViewport}=require("./lib/current-native-capture.cjs");
const attempt=process.argv[2];assert(/^\d{2}$/.test(attempt||""));
const options=process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ?require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate():null;
const current=!!options||process.argv.includes("--candidate=1.9.30");
const version=options?.version||(current?"1.9.30":"1.9.24"),stamp=version.replaceAll(".","");
const authorArg=process.argv.slice(3).find(a=>a.startsWith("--authored-export="));
assert(!authorArg||options);
assert.deepEqual(process.argv.slice(2),current?[attempt,`--candidate=${version}`,...(authorArg?[authorArg]:[])]:[attempt]);
const run=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/candidate-${stamp}-save-${attempt}`;
const out=options?path.join(options.base,`save-audit-${attempt}`)
  :`F:/AgentVN/QA/Editor-${current?"1.9.30-20261026":"1.9.24-20261024"}-01/save-audit-${attempt}`;
assert(!fs.existsSync(out));fs.mkdirSync(out);
const sha=f=>createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const describe=f=>({path:path.resolve(f),sha256:sha(f)});
const report={status:"RUNNING",startedAt:new Date().toISOString(),checks:[],modelRequests:0,
  scope:`INSTALLED_${version.replaceAll(".","_")}_SAVE_GRID_AND_PAGE_RECEIPT_AUDIT_NOT_FULL_ACCEPTANCE`};
function summary(r){
  assert.equal(r.status,"PASS");
  assert.equal(r.cases.length,48);assert.equal(r.screenshots.length,48);assert.equal(r.traces.length,96);
  assert.equal(r.launches.length,2);assert.equal(r.profiles.length,2);assert.equal(r.writes.length,2);
  assert.equal(r.boundaryChecks.length,3);
  assert(r.cases.every(c=>c.status==="PASS")&&r.traces.every(t=>t.status==="PASS"));
  for(const layout of ["agentvn","renpy"]){
    for(const width of [1920,2560,3840])for(const dpr of [1,2])for(const reduced of [false,true]){
      const same=r.cases.filter(c=>c.layout===layout&&c.width===width&&c.dpr===dpr&&c.reduced===reduced);
      assert.equal(same.length,2);assert.deepEqual(same.map(c=>c.state).sort(),["empty","populated"]);
      const traces=r.traces.filter(c=>c.layout===layout&&c.width===width&&c.dpr===dpr&&c.reduced===reduced);
      assert.deepEqual(traces.map(t=>t.label).sort(),["keyboard","leave-during-flip","next","rapid-reverse"]);
    }
  }
}
try{
  const r=read(path.join(run,"report.json"));report.input=describe(path.join(run,"report.json"));
  if(options){
    assert.equal(r.scope,authorArg?`INSTALLED_${version.replaceAll(".","_")}_AUTHOR_UI_TWO_COLUMN_RENPY_CONSUMPTION_NOT_SETUP_UPGRADE_OR_ANDROID`
      :`INSTALLED_${version.replaceAll(".","_")}_BUNDLED_PLAYER_PREVIEW_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID`);
    for(const key of ["modelRequests","productChanges","builds"])assert.equal(r[key],0);
    assert.deepEqual(r.evidence,candidateEvidence(options.installation,run));
  }
  summary(r);report.checks.push({name:"exact nonempty matrix and four independent transition paths",status:"PASS"});
  if(authorArg){
    assert.deepEqual(r.authoredExport,describe(authorArg.slice(18)));
    const author=read(r.authoredExport.path);
    assert.equal(author.status,"PASS");assert.equal(author.version,version);
    assert.equal(author.scope,"CURRENT_INSTALLED_TWO_COLUMN_RENPY_AUTHOR_UI_EXPORT_NOT_PLAYER_SETUP_UPGRADE_OR_ANDROID");
    assert.equal(author.matrix.length,12);assert(author.matrix.every(c=>c.status==="PASS"&&c.preview.columns===2));
    assert.equal(author.nativeCacheRestoration,"PASS");assert.equal(author.steps.length,3);
    assert(author.steps.every(s=>s.status==="PASS"));assert.equal(author.cartridges.length,2);
    assert.equal(author.authored.settings.runtimeUILayoutProfiles.profiles.renpy.renpy.save_load.saveColumns,2);
    for(const f of [author.installation,author.fixture,author.portable,author.tool,...author.cartridges])
      assert.equal(sha(f.path),f.sha256);
    const before=read(author.fixture.path).editor_settings.runtimeUILayoutProfiles;
    const after=structuredClone(author.authored.settings.runtimeUILayoutProfiles);
    delete after.profiles.renpy.renpy.save_load.saveColumns;assert.deepEqual(after,before);
    // ZIP bytes are independently checked by the async author consumer. Here
    // retain its exact, non-rewritten author source and both immutable exports.
    for(const layout of ["agentvn","renpy"]){
      const exported=author.cartridges.find(c=>c.layout===layout);
      const fixture=r.fixtures.find(f=>path.basename(f.path)===`${layout}.vncart`);
      assert.equal(fixture.sha256,exported.sha256);
    }
    report.checks.push({name:"actual installed two-column UI author, restart, native package and unchanged AgentVN bound to consumed bytes",status:"PASS"});
  }
  for(const bad of [{...r,cases:[]},{...r,traces:r.traces.slice(1)},{...r,screenshots:[]}]){
    assert.throws(()=>summary(bad));
  }
  report.checks.push({name:"zero-case, missing-transition and missing-screenshot receipts rejected",status:"PASS"});
  for(const f of [...r.tools,...r.fixtures,r.fixtureSource])assert.equal(sha(f.path),f.sha256,f.path);
  for(const screenshot of r.screenshots){
    assert.equal(sha(screenshot.path),screenshot.sha256);
    const b=fs.readFileSync(screenshot.path);
    assert(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.deepEqual(screenshot.before,screenshot.after);
    const dpr=Math.round(screenshot.before.dpr);
    assert([1,2].includes(dpr));
    validateNativeViewport(screenshot.before,{...screenshot.before,dpr});
    assert.equal(b.readUInt32BE(16),screenshot.before.width*dpr);
    assert.equal(b.readUInt32BE(20),screenshot.before.height*dpr);
    assert.equal(b.readUInt32BE(16),screenshot.png.width);
    assert.equal(b.readUInt32BE(20),screenshot.png.height);
  }
  const inside=(a,b)=>a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
  for(const c of r.cases){
    assert.deepEqual(c.before,c.after);
    assert.equal(c.before.width,c.width);assert.equal(c.before.height,c.height);
    assert(Math.abs(c.before.dpr-c.dpr)<=1e-6);assert.equal(c.before.reduced,c.reduced);
    const g=c.geometry;assert.equal(g.cards.length,6);assert(g.scrollHeight<=g.clientHeight+1);assert.equal(g.overflow,0);
    if(authorArg&&c.layout==="renpy")assert.equal(g.columns,2);
    for(const card of g.cards){
      assert(card.hit&&card.preview.height>0&&card.populated===(c.state==="populated"));
      assert([card.rect,card.button,card.copy,...card.text].every(b=>inside(b,g.grid)));
      assert([card.preview,card.copy,...card.text].every(b=>inside(b,card.rect)));
      if(c.state==="populated")assert(card.image?.naturalWidth>0&&card.image.fit==="contain"&&inside(card.image.rect,card.preview));
    }
  }
  report.checks.push({name:"48 raw geometries, saved image boxes and native PNG/DPR/media agreement",status:"PASS"});
  report.frames=0;
  for(const t of r.traces){
    assert.equal(sha(t.trace.path),t.trace.sha256);
    const frames=JSON.parse(gunzipSync(fs.readFileSync(t.trace.path)));
    assert.equal(frames.length,t.frames);report.frames+=frames.length;
    const moving=frames.filter(f=>f.layers.some(l=>l.opacity>.05&&l.opacity<.95&&l.transform!=="none"));
    assert(moving.length>=2);assert.equal(moving.length,t.moving);
    const clocks=frames.flatMap(f=>f.layers.flatMap(l=>l.animations));
    assert(clocks.length&&clocks.every(a=>a.duration===(t.reduced?220:420)));
    const live=frames.filter(f=>f.layers.length);assert(live.length);
    assert(live.every(f=>f.grids===1&&f.layers.filter(l=>!l.inert).length===1));
    assert(frames.every(f=>!f.unavailableFocus&&f.overflow===0));
    for(const key of ["viewport","screen","navigation","toolbar","back"]){
      assert(live.every(f=>f[key]));
      for(const f of live)for(const prop of ["x","y","width","height"])
        assert(Math.abs(f[key][prop]-live[0][key][prop])<=.25);
    }
    assert.equal(frames.at(-1).layers.length,t.label==="leave-during-flip"?0:1);
  }
  report.checks.push({name:"96 raw traces: 420/220ms, intermediate frames, fixed chrome and unique input/focus owner",status:"PASS"});
  for(const write of r.writes){
    assert.equal(write.files.length,6);
    assert.deepEqual(write.files.map(f=>f.slot).sort((a,b)=>a-b),[1,2,3,4,5,6]);
    for(const file of write.files){
      assert.equal(sha(file.path),file.sha256);
      const save=read(file.path);assert.equal(save.save_kind,"manual");
      assert.equal(save.game_id,authorArg?write.gameId:`qa-native-grid-${write.layout}`);assert.equal(save.install_id,"preview_gamecli");
      assert.equal(save.slot,file.slot);assert(save.preview_image.startsWith("data:image/"));
    }
  }
  for(const p of r.profiles){
    assert.equal(p.status,"RESTORED");assert.equal(sha(p.restoration.path),p.restoration.sha256);
    const restored=read(p.restoration.path);assert.equal(restored.status,"PASS");assert.equal(restored.deletedUserFiles,0);
    for(const original of restored.restored)for(const file of original.files)
      assert.equal(sha(path.join(original.original,file.relative)),file.sha256);
  }
  const processes=rows();
  for(const launch of r.launches){
    assert.equal(launch.cleanup.status,"PASS");
    assert.equal(listeners([launch.port]).length,0);
    assert(launch.knownProcesses.every(p=>!processes.some(n=>n.ProcessId===p.ProcessId&&n.Created===p.Created)));
  }
  candidateEvidence(options?.installation||(current?"F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json":"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"),run);
  report.checks.push({name:"12 disk saves, profile byte restoration, exact process/port cleanup and installed sources",status:"PASS"});
  report.status="PASS";
}catch(error){report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify(report,null,2));
}
