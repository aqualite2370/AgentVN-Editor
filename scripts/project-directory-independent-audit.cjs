"use strict";
// Audit actual completed native-install evidence, without replaying UI or
// promoting the unresolved native chooser/normal-close requirements.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const JSZip=require("../editor/node_modules/jszip");
const A=require("./lib/installed-acceptance.cjs");
const {rows,listeners}=require("./lib/current-native-editor-session.cjs");
const [run,out]=process.argv.slice(2),read=f=>JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
assert(run&&out&&!fs.existsSync(out));
assert(path.resolve(run).startsWith(path.resolve("F:/AgentVN/QA/Project-Directory-Installed-20261022-01")+path.sep));
assert(path.resolve(out).startsWith(path.resolve(run)+path.sep));
const report=read(path.join(run,"report.json")),sha=f=>A.sha256(fs.readFileSync(f));
const result={status:"RUNNING",at:new Date().toISOString(),source:path.join(run,"report.json"),
  sourceSha256:sha(path.join(run,"report.json")),checks:[],featureStatus:"BLOCKED_NATIVE_INPUT",
  nativeChooserClaim:false,normalCloseClaim:false};
async function check(name,fn){
  const row={name,status:"RUNNING"};result.checks.push(row);
  try{row.detail=await fn();row.status="PASS";}catch(error){row.status="FAILED";row.error=String(error.stack||error);throw error;}
}
const caseByName=name=>{const row=report.cases.find(c=>c.name===name);assert(row&&row.status==="PASS");return row.detail;};
(async()=>{
  await check("Scope, current sealed installation and real isolated host launches",()=>{
    assert.equal(report.status,"PASS");assert(report.finishedAt&&!report.cleanupError);
    assert.equal(report.version,"1.9.22");assert.equal(report.featureStatus,"BLOCKED_NATIVE_INPUT");
    assert.equal(report.nativeInputCompleted,false);assert.equal(report.normalCloseClaimed,false);
    assert.equal(report.modelRequests,0);assert.equal(report.productChanges,0);assert.equal(report.builds,0);
    assert.equal(report.cases.length,6);assert(report.cases.every(c=>c.status==="PASS"));
    assert.equal(report.launches.length,3);
    const install=read(path.join(run,"sealed-installation-receipt.json"));assert.equal(install.version,"1.9.22");
    assert.equal(sha(install.executable.path),install.executable.sha256);
    for(const file of install.resources)assert.equal(sha(file.path),file.sha256);
    for(const launch of report.launches){
      assert.equal(launch.executable.sha256,install.executable.sha256);
      assert.equal(launch.manualBackendSpawn,false);assert.equal(launch.sourceServer,false);
      assert(launch.dataDirectoryOverride&&launch.webviewDirectoryOverride);
      assert.equal(sha(launch.backend.ExecutablePath),launch.backend.sha256);
      assert(launch.data.startsWith(run)&&launch.webview.startsWith(run));
    }
    assert.equal(new Set(report.launches.map(l=>l.pid)).size,3);
    return {version:install.version,hostStarts:3,installationSha256:install.executable.sha256};
  });
  await check("Native system-Downloads packages retain complete graphs and exclude machine-directory mapping",async()=>{
    const expectedIds=new Set(report.projects.map(p=>p.projectId));
    assert.equal(report.artifacts.length,7);
    for(const artifact of report.artifacts){
      const retained=report.downloadRetention.find(r=>r.path===artifact.path);assert(retained);
      assert.equal(sha(retained.archive),artifact.sha256);assert.equal(fs.statSync(retained.archive).size,artifact.bytes);
      assert.equal(path.dirname(artifact.path),path.join(process.env.USERPROFILE,"Downloads"));
      const zip=await JSZip.loadAsync(fs.readFileSync(retained.archive));
      const project=JSON.parse(await zip.file("project.json").async("string"));
      assert(expectedIds.has(project.project_id)&&project.project_id===artifact.projectId);
      assert.equal(project.nodes.length,2);assert.equal(project.edges.length,1);
      const text=JSON.stringify(project);assert(!text.includes("projectExportDirectories")&&!text.includes(run));
    }
    const sequence=caseByName("unconfigured-a-b-a-native-save-to-system-downloads").artifacts.map(a=>a.projectId);
    assert.deepEqual(sequence,[report.projects[0].projectId,report.projects[1].projectId,report.projects[0].projectId]);
    return {nativePackages:7,projectIds:[...expectedIds],nativeChooserUsed:false};
  });
  await check("Actually occupied filename causes suffix and preserves original bytes",()=>{
    const collision=caseByName("occupied-default-filename-preserves-prior-package-bytes");
    assert(report.collision.reserved.length>=90);
    const source=collision.saved.path.replace(/-\d+\.vnproj$/,".vnproj");
    assert(report.collision.reserved.some(f=>f.path===source));
    for(const file of report.collision.reserved){
      const retained=report.downloadRetention.find(r=>r.path===file.path);assert(retained);
      assert.equal(sha(retained.archive),file.sha256);
    }
    return {reserved:report.collision.reserved.length,collisionSource:source,suffixed:collision.saved.path};
  });
  await check("Forced restart and public reimport remain distinct from normal-close and native-picker acceptance",()=>{
    const restart=caseByName("owned-forced-stop-and-actual-host-backend-relaunch");
    assert.notEqual(restart.before.editorPid,restart.after.editorPid);
    assert.notEqual(restart.before.backendPid,restart.after.backendPid);
    assert.equal(restart.before.databasePath,restart.after.databasePath);
    assert.equal(restart.before.webviewRoot,restart.after.webviewRoot);
    assert.equal(restart.normalCloseClaimed,false);assert.equal(restart.customDirectoryPersistenceClaim,false);
    const imported=caseByName("portable-package-public-import-in-new-db-and-webview");
    assert.equal(imported.nativeFilePickerClaim,false);assert(imported.publicBackendImport);
    assert.notEqual(imported.freshDatabase,restart.before.databasePath);
    return {realHostRestart:true,freshDatabase:imported.freshDatabase,normalCloseClaim:false,nativeOpenClaim:false};
  });
  await check("Twelve actual WebView combinations, PNG dimensions, hit geometry and disabled reset semantics",()=>{
    const matrix=caseByName("default-directory-controls-real-12-combination-matrix"),keys=new Set();
    assert.equal(matrix.length,12);assert.equal(report.screenshots.length,12);
    for(const sample of matrix){
      const key=`${sample.width}/${sample.height}/${sample.dpr}/${sample.reduced}`;assert(!keys.has(key));keys.add(key);
      const image=sample.screenshot;assert.equal(sha(image.path),image.sha256);
      const bytes=fs.readFileSync(image.path);
      assert.equal(bytes.readUInt32BE(16),sample.width*sample.dpr);assert.equal(bytes.readUInt32BE(20),sample.height*sample.dpr);
      assert.deepEqual(image.before,image.after);
      assert.equal(image.before.width,sample.width);assert.equal(image.before.height,sample.height);
      assert(Math.abs(image.before.dpr-sample.dpr)<=1e-6);assert.equal(image.before.reduced,sample.reduced);
      const controls=sample.geometry.controls;assert.equal(controls.length,2);
      assert.equal(controls.filter(c=>c.disabled).length,1);assert(sample.geometry.overflow<=1);
      for(const c of controls)assert(c.hit&&!c.clipped&&c.rect.left>=0&&c.rect.right<=sample.width&&c.rect.top>=0&&c.rect.bottom<=sample.height);
    }
    for(const [w,h]of [[1920,1080],[2560,1440],[3840,2160]])for(const d of [1,2])for(const r of [false,true])assert(keys.has(`${w}/${h}/${d}/${r}`));
    return {combinations:keys.size,verifiedPngs:12,physical4kClaim:false};
  });
  await check("Downloads retention, owned processes/ports, cache and protected artifacts",()=>{
    assert(report.defaultDownloadsBaseline.every(p=>p.files.length===0));
    assert.equal(report.downloadRetention.length,report.artifacts.length+report.collision.reserved.length);
    for(const file of report.downloadRetention){assert(file.sourceRemoved&&!fs.existsSync(file.path));assert.equal(sha(file.archive),file.sha256);}
    assert.equal(report.cleanups.length,3);assert(report.cleanups.every(c=>c.status==="PASS"&&!c.normalCloseClaimed));
    const current=rows();
    for(const p of report.allKnownProcesses)assert(!current.some(c=>c.ProcessId===p.ProcessId&&c.Created===p.Created));
    const ports=[...new Set(report.launches.flatMap(l=>l.ports))];assert.equal(listeners(ports).length,0);
    const cache=read(path.join(run,"native-cache-restoration.json"));assert.equal(cache.status,"PASS");assert.equal(cache.deletedUserFiles,0);
    for(const f of cache.originalFiles)assert.equal(sha(path.join(cache.originalDirectory,f.relative)),f.sha256);
    for(const file of report.protected)assert.equal(sha(file.path),file.sha256);
    assert.equal(sha(report.originalInstallationReport.path),report.originalInstallationReport.sha256);
    return {retained:report.downloadRetention.length,remainingOwnedProcesses:0,remainingPorts:0,
      protectedFiles:report.protected.length,cacheFiles:cache.originalFiles.length,userFilesDeleted:0};
  });
  result.status="PASS";
})().catch(error=>{result.status="FAILED";result.error=String(error.stack||error);process.exitCode=1;})
  .finally(()=>{result.finishedAt=new Date().toISOString();fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:"wx"});
    console.log(JSON.stringify({status:result.status,checks:result.checks.length,out,error:result.error}));});
