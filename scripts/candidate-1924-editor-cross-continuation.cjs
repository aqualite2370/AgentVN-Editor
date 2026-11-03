"use strict";
// Continue from the real migrated QA database. Does not rerun old installation,
// old UI creation or native migration, and never alters their failed reports.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {DatabaseSync}=require("node:sqlite");
const {installedReleaseSession}=require("./lib/installed-release-session.cjs");
const {until,rows,listeners}=require("./lib/current-native-editor-session.cjs");
const {sha256,settleEditor}=require("./lib/installed-acceptance.cjs");
const source="F:/AgentVN/QA/Editor-Cross-1924-20261025-03";
const out="F:/AgentVN/QA/Editor-Cross-1924-20261025-continuation-02";
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const hash=f=>sha256(fs.readFileSync(f));
const legacy=read(path.join(source,"old-project.vnproj")),prep=read(path.join(source,"protection.json"));
const sourceDB=path.join(prep.records[0].retained,"backend/vn_engine.db");
function project(database){
  const db=new DatabaseSync(database,{readOnly:true});
  try{assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    const r=db.prepare("SELECT project_id,project_json FROM editor_project_details").all();
    assert.equal(r.length,1);assert.equal(r[0].project_id,legacy.project_id);return JSON.parse(r[0].project_json);
  }finally{db.close();}
}
function sameContent(actual,expectedSummary){
  assert.equal(actual.project_metadata.projectId,legacy.project_id);
  assert.equal(actual.project_metadata.title,legacy.title);assert.equal(actual.project_metadata.author,legacy.author);
  const g=actual.project_graph;
  assert.deepEqual(g.nodes.map(n=>n.id),legacy.nodes.map(n=>n.id));assert.deepEqual(g.edges,legacy.edges);
  for(const n of legacy.nodes.filter(n=>n.data?.scene)){
    const a=g.nodes.find(x=>x.id===n.id);
    assert.equal(a.data.scene.scene_id,n.data.scene.scene_id);
    assert.deepEqual(a.data.scene.commands,n.data.scene.commands);
    assert.equal(a.data.scene.summary,expectedSummary);
    assert.equal(a.data.description,expectedSummary);
  }
}
const originalSummary="真实旧版1.7.1跨代保留正文与场景",marker="实际跨代后新保存1.9.24";
assert.equal(project(sourceDB).nodes.find(n=>n.id==="node_scene_opening").data.scene.summary,originalSummary);
assert.equal(read(path.join(source,"report.json")).cleanupStatus,"PASS");
assert.equal(read(path.join(source,"Restore.json")).status,"PASS");
if(process.argv[2]==="--self-test"){
  const p={project_metadata:{projectId:legacy.project_id,title:legacy.title,author:legacy.author},
    project_graph:{nodes:legacy.nodes,edges:legacy.edges}};
  sameContent(p,originalSummary);
  for(const mutate of [x=>x.project_metadata.projectId="wrong",x=>x.project_graph.edges.push({id:"extra"}),
    x=>x.project_graph.nodes[1].data.scene.summary="lost"]){
    const q=structuredClone(p);mutate(q);assert.throws(()=>sameContent(q,originalSummary));
  }
  console.log("PASS: actual migrated SQLite matches old JSON; three data-loss cases rejected; no product launch");
}else{
  assert.deepEqual(process.argv.slice(2),["run"]);assert(!fs.existsSync(out));
  fs.mkdirSync(path.join(out,"data/backend"),{recursive:true});
  const sources=[{source:sourceDB,target:path.join(out,"data/backend/vn_engine.db")}];
  for(const f of sources){f.sha256=hash(f.source);fs.copyFileSync(f.source,f.target,fs.constants.COPYFILE_EXCL);assert.equal(hash(f.target),f.sha256);}
  // This is a replay of an already migrated DB, not a new consent test. Block
  // unrelated legacy discovery explicitly; retain original real consent in 03.
  fs.writeFileSync(path.join(out,"data/backend/database-migration-decision.json"),
    JSON.stringify({approved:false,sources:[],qaReplayOnly:true}),{flag:"wx"});
  // WEBVIEW2_USER_DATA_FOLDER is the parent of EBWebView, not EBWebView itself.
  fs.cpSync(prep.records[1].retained,path.join(out,"webview"),{recursive:true,errorOnExist:true});
  const report={status:"RUNNING",at:new Date().toISOString(),scope:"REAL_MIGRATED_QA_PROFILE_REPLAY_SAVE_RESTART_NOT_NEW_UPGRADE",
    source:{report:path.join(source,"report.json"),sha256:hash(path.join(source,"report.json")),sources},
    oldNativeCloseStatus:"FAILED",replayMigrationDisabled:true,productChanges:0,modelRequests:0,
    launches:[],cleanups:[],screenshots:[],errors:[],steps:[]};
  const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
  save();
  const s=installedReleaseSession({installationFile:"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json",
    out,report,save,input:path.join(source,"old-project.vnproj")});
  let page;
  async function step(name,run){const r={name,status:"RUNNING"};report.steps.push(r);save();console.log("START",name);
    try{r.detail=await run();r.status="PASS";}catch(e){r.status="FAILED";r.error=String(e.stack||e);throw e;}
    finally{save();console.log(r.status,name);}}
  async function normalClose(label){
    const request={label,pid:s.current.pid,created:s.current.created,exe:s.current.executable.path,
      requestedAt:new Date().toISOString(),completion:path.join(out,label+"-close-completed.json")};
    fs.writeFileSync(path.join(out,label+"-computer-use-request.json"),JSON.stringify(request,null,2),{flag:"wx"});
    console.log("COMPUTER_USE_CLOSE",JSON.stringify(request));
    await until(()=>fs.existsSync(request.completion),"real native normal-close receipt",600000);
    const r=read(request.completion);assert.equal(r.pid,request.pid);assert.equal(r.method,"Computer Use Alt+F4");
    await until(()=>!rows().some(p=>p.ProcessId===request.pid&&p.Created===request.created)&&listeners(s.current.ports).length===0,
      "natural current Editor and backend close",30000);
    await s.stop("NORMAL_CLOSE_VERIFIED_"+label);assert.deepEqual(report.cleanups.at(-1).killed,[]);
    return request;
  }
  (async()=>{
    await step("actual-migrated-old-project-and-theme-preserved",async()=>{
      page=await s.start();
      await page.getByRole("button",{name:"继续上次编辑",exact:true}).click();await settleEditor(page);
      sameContent(await s.api("/api/project/state"),originalSummary);
      const tone=await page.evaluate(()=>localStorage.getItem("agentvn.themeTone"));
      assert.equal(tone,read(path.join(source,"old-baseline.json")).preference);
      await s.shot("migrated-old-content");return {projectId:legacy.project_id,tone};
    });
    await step("actual-current-edit-native-save-and-normal-close",async()=>{
      {
        const p=page;
        await p.locator('.react-flow__node[data-id="node_scene_opening"]').getByText("开场",{exact:true}).click();
        await p.getByRole("textbox",{name:/^场景摘要(?: 场景摘要)?$/}).fill(marker);
        await p.getByRole("button",{name:"保存工程",exact:true}).click();
        const dialog=p.getByTestId("project-save-confirmation");await dialog.waitFor();
        const native=(await dialog.innerText()).match(/C:\\Users\\1\\Downloads\\[^\r\n]+\.vnproj/)?.[0];assert(native);
        const retained=path.join(out,"new-project.vnproj"),digest=hash(native);
        fs.copyFileSync(native,retained,fs.constants.COPYFILE_EXCL);assert.equal(hash(retained),digest);
        report.download={source:native,retained,sha256:digest,removed:false};save();
        await dialog.getByRole("button",{name:"OK",exact:true}).click();
        await until(async()=>{try{sameContent(await s.api("/api/project/state"),marker);return true;}catch{return false;}},
          "saved graph agrees with actual UI and package",30000);
        await s.shot("new-saved-content");
      }
      await normalClose("saved");return {marker};
    });
    await step("new-process-restores-new-save-and-normal-close",async()=>{
      page=await s.start();
      await page.getByRole("button",{name:"继续上次编辑",exact:true}).click();await settleEditor(page);
      sameContent(await s.api("/api/project/state"),marker);
      await s.shot("restart-new-content");await normalClose("restart");
      assert.equal(project(path.join(out,"data/backend/vn_engine.db")).nodes.find(n=>n.id==="node_scene_opening").data.scene.summary,marker);
      return {diskIntegrity:"ok",restoredMarker:marker};
    });
    assert.equal(report.steps.length,3);assert.equal(report.errors.length,0);assert.equal(report.modelRequests,0);
    for(const f of sources)assert.equal(hash(f.source),f.sha256);
    report.status="PASS";
  })().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;})
    .finally(async()=>{
      try{
        await s.stop("FINALLY");
        if(report.download){assert.equal(hash(report.download.source),report.download.sha256);
          assert.equal(hash(report.download.retained),report.download.sha256);fs.unlinkSync(report.download.source);report.download.removed=true;}
        report.cleanupStatus="PASS";
      }catch(e){report.status="FAILED";report.cleanupStatus="FAILED";report.cleanupError=String(e.stack||e);process.exitCode=1;}
      report.finishedAt=new Date().toISOString();save();
      console.log(JSON.stringify({status:report.status,error:report.error,cleanupStatus:report.cleanupStatus,out}));
    });
}
