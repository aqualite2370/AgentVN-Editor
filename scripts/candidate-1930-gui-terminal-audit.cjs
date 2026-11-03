"use strict";
// Whole GUI workflow reconciliation, including independent persisted project
// inspection. Reads only completed evidence; never starts Editor or Player.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {DatabaseSync}=require("node:sqlite");
const JSZip=require("../editor/node_modules/jszip");
const {sha}=require("./lib/installed-runtime-session.cjs");
const {rows,listeners,ps}=require("./lib/current-native-editor-session.cjs");
const {validateNativeViewport}=require("./lib/current-native-capture.cjs");
const base="F:/AgentVN/QA/Editor-1.9.30-20261026-01";
const portableRoot="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-67";
const read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
const desc=f=>({path:path.resolve(f),sha256:sha(f),bytes:fs.statSync(f).size});
const hash=b=>require("node:crypto").createHash("sha256").update(b).digest("hex");
const inputs=["gui-library-audit-01","gui-negative-audit-02","gui-directory-audit-01"]
  .map(d=>path.join(base,d,"report.json"));
const p=read(path.join(portableRoot,"report.json"));
const source=read(p.source.path);
function terminal(r) {
  assert.equal(r.status,"PASS");assert(r.finishedAt&&!r.error&&!r.cleanupError);
  assert.equal(r.cases.length,3);assert(r.cases.every(c=>c.status==="PASS"&&c.finishedAt));
  assert.deepEqual(r.errors,[]);assert.equal(r.launches.length,2);
  assert.equal(r.cleanups.length,2);assert(r.cleanups.every(c=>c.status==="PASS"&&!c.normalCloseClaimed));
  assert.equal(r.modelRequests+r.productChanges+r.builds,0);
  assert(r.sourceFilesUnchanged&&r.cases[2].detail.localLibraryNotBundled&&r.cases[2].detail.bothLayouts);
  for(const c of [r.cases[0],r.cases[2]]) {
    assert.equal(c.detail.resources.length,26);
    assert.equal(new Set(c.detail.resources.map(a=>a.id)).size,26);
  }
  assert.equal(r.downloadCleanup.status,"PASS");assert.equal(r.screenshots.length,1);
  assert.equal(r.cases[2].detail.input.result.cancelled,false);
}
const out=path.join(base,"gui-terminal-audit-01");
assert(!fs.existsSync(out));fs.mkdirSync(out);
const result={status:"RUNNING",at:new Date().toISOString(),groups:[],inputs:[...inputs,path.join(portableRoot,"report.json")].map(desc),
  modelRequests:0,productChanges:0,builds:0,
  scope:"INSTALLED_1930_OFFICIAL_GUI_LIBRARY_AND_PORTABLE_CHAIN_NOT_DEFAULT_PROFILE_UPGRADE_SETUP_ANDROID_OR_FULL_RENPY"};
async function group(name,fn) {
  const g={name,status:"RUNNING"};result.groups.push(g);
  try{g.detail=await fn();g.status="PASS";}
  catch(e){g.status="FAILED";g.error=String(e.stack||e);throw e;}
}
(async()=>{
  await group("Completed author Player negative native-directory and portable evidence",()=>{
    for(const f of inputs) {
      const a=read(f);assert.equal(a.status,"PASS");
      assert(a.groups.length>=3&&a.groups.every(g=>g.status==="PASS"));
      assert.equal(sha(a.tool.path),a.tool.sha256);
    }
    terminal(p);
    const bad=[
      r=>r.cases.pop(),r=>r.cases[0].detail.resources.pop(),
      r=>r.cases[2].detail.localLibraryNotBundled=false,r=>r.cleanups[0].status="FAILED",
      r=>r.downloadCleanup.status="FAILED",r=>r.cases[2].detail.input.result.cancelled=true,
    ];
    for(const m of bad){const r=structuredClone(p);m(r);assert.throws(()=>terminal(r));}
    return {linkedAudits:3,portableStages:3,invalidPortableEvidenceRejected:bad.length};
  });
  await group("Actual portable ZIP and independent fresh SQLite resource/layout bytes",async()=>{
    assert.equal(sha(p.source.path),p.source.sha256);assert.equal(sha(p.portable.path),p.portable.sha256);
    assert.equal(sha(path.join(portableRoot,"executed-test.cjs")),sha(path.join(__dirname,"candidate-1930-gui-portable.cjs")));
    const z=await JSZip.loadAsync(fs.readFileSync(p.portable.path),{checkCRC32:true});
    const project=JSON.parse(await z.file("project.json").async("string"));
    assert.equal(project.project_id,source.savedProject.projectId);assert.equal(project.asset_manifest.length,26);
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles,source.savedProject.settings.runtimeUILayoutProfiles);
    assert.deepEqual(project.editor_settings.runtimeUILayout,source.savedProject.settings.runtimeUILayout);
    assert(!JSON.stringify(project).includes("projectExportDirectories"));
    const launch=p.launches[1],dbFile=path.join(launch.data,"backend/vn_engine.db");
    const db=new DatabaseSync(dbFile,{readOnly:true});let actual;
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM editor_project_details").get().n,1);
      actual=JSON.parse(db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?")
        .get(project.project_id).project_json);
    }finally{db.close();}
    assert.equal(actual.asset_manifest.length,26);
    assert.deepEqual(actual.editor_settings.runtimeUILayoutProfiles,project.editor_settings.runtimeUILayoutProfiles);
    assert.deepEqual(actual.editor_settings.runtimeUILayout,project.editor_settings.runtimeUILayout);
    for(const a of actual.asset_manifest) {
      const expected=source.assetProofs.find(x=>x.id===a.asset_id);assert(expected);
      const portable=project.asset_manifest.find(x=>x.asset_id===a.asset_id);assert(portable);
      assert.equal(hash(await z.file(portable.metadata.project_path).async("nodebuffer")),expected.sha256);
      const root=path.resolve(launch.data,"backend/project_assets");
      const relative=path.relative(root,a.metadata.filePath);
      assert(relative&&!relative.startsWith("..")&&!path.isAbsolute(relative));
      assert.equal(sha(a.metadata.filePath),expected.sha256);
    }
    const request=read(path.join(portableRoot,"native-input-request.json"));
    const receipt=read(request.completion);
    assert.equal(receipt.requestId,request.requestId);assert.equal(receipt.ownerPid,launch.pid);
    assert.equal(receipt.selectedPath,p.portable.path);assert.equal(receipt.cancelled,false);
    assert.equal(receipt.status,"INPUT_COMPLETED");assert(/Computer Use/.test(receipt.interaction));
    return {database:desc(dbFile),resources:26,bothLayouts:true,nativePicker:true,portable:p.portable};
  });
  await group("Frozen installed identity PNG original cache and complete cleanup",()=>{
    const installed=read(path.join(base,"derived-components-installation-01.json"));
    for(const f of [installed.executable,...installed.resources,...installed.protectedFiles])assert.equal(sha(f.path),f.sha256);
    for(const l of p.launches) {
      assert.equal(l.executable.sha256,installed.executable.sha256);
      assert(l.dataDirectoryOverride&&l.webviewDirectoryOverride&&!l.manualBackendSpawn&&!l.sourceServer);
    }
    const s=p.screenshots[0];assert.equal(sha(s.path),s.sha256);assert.deepEqual(s.before,s.after);
    validateNativeViewport(s.before,{width:1920,height:1080,dpr:1,reduced:false});
    const png=fs.readFileSync(s.path);assert.equal(png.readUInt32BE(16),1920);assert.equal(png.readUInt32BE(20),1080);
    const cache=read(path.join(portableRoot,"native-cache-protection.json"));
    const restore=read(path.join(portableRoot,"native-cache-restoration.json"));
    assert.equal(restore.status,"PASS");assert.equal(restore.deletedUserFiles,0);
    assert(ps(`fsutil file queryfileid '${cache.original}'`).includes(cache.directoryId));
    assert(!fs.existsSync(cache.held));
    for(const f of cache.files)assert.equal(sha(path.join(cache.original,f.relative)),f.sha256);
    const current=rows();
    for(const n of p.knownProcesses)assert(!current.some(c=>c.ProcessId===n.ProcessId&&c.Created===n.Created));
    assert.deepEqual(listeners(p.launches.flatMap(l=>l.ports)),[]);
    assert(!fs.existsSync(p.downloadCleanup.removed));assert.equal(sha(p.downloadCleanup.retained.path),p.portable.sha256);
    const negative=read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-64/report.json");
    for(const f of negative.protectedSource)assert.equal(sha(f.path),f.sha256);
    return {installedVersion:installed.version,png:1,ownedProcesses:0,ports:0,downloadRemoved:true,originalSourceUnchanged:true};
  });
  result.status="PASS";
})().catch(e=>{result.status="FAILED";result.error=String(e.stack||e);process.exitCode=1;})
  .finally(()=>{
    result.finishedAt=new Date().toISOString();result.tool=desc(__filename);
    fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(result,null,2),{flag:"wx"});
    fs.copyFileSync(__filename,path.join(out,"executed-audit.cjs"),fs.constants.COPYFILE_EXCL);
    console.log(JSON.stringify({status:result.status,out,error:result.error}));
  });
