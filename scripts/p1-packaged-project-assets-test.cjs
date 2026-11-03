"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),net=require("node:net"),crypto=require("node:crypto");
const {spawn,spawnSync}=require("node:child_process");
const {fixture}=require("./lib/editor-ui-acceptance.cjs");
const root=path.resolve(__dirname,"..");
assert(process.env.AGENTVN_WORKSPACE_OUTPUT,"Explicit isolated output required");
const out=path.join(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT),"packaged-assets",new Date().toISOString().replace(/[:.]/g,"-"));
fs.mkdirSync(out,{recursive:true});
const executable=path.join(root,"editor/src-tauri/binaries/creator-backend.exe");
const database=path.join(out,"isolated-data/backend/vn_engine.db");
const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#91aabb"/></svg>');
const report={status:"RUNNING",scope:"Actual packaged sidecar asset persistence/read/restart; not installed Editor UI or release export",
  executable,exeSha256:crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex"),database,checks:[],owners:[],cleanup:[]};
let child;
async function stop(){
  if(!child)return;
  const owned=child;child=null;
  if(owned.exitCode!==null||owned.signalCode!==null){report.cleanup.push({pid:owned.pid,alreadyExited:true});return;}
  const result=spawnSync("taskkill.exe",["/PID",String(owned.pid),"/T","/F"],{windowsHide:true,encoding:"utf8"});
  report.cleanup.push({pid:owned.pid,exitCode:result.status});assert.equal(result.status,0,"Owned sidecar cleanup failed");
}
async function start(){
  const port=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once("error",reject);
    probe.listen(0,"127.0.0.1",()=>{const selected=probe.address().port;probe.close(error=>error?reject(error):resolve(selected));});});
  const url=`http://127.0.0.1:${port}`;
  child=spawn(executable,[],{cwd:out,windowsHide:true,stdio:"ignore",env:{...process.env,
    DATABASE_PATH:database,AGENTVN_EDITOR_DATA_DIR:path.join(out,"isolated-data"),
    AGENTVN_BACKEND_DATA_DIR:path.dirname(database),AGENTVN_BACKEND_PORT:String(port),AGENTVN_LEGACY_DATABASE_PATHS:"",
    AGENTVN_BACKEND_LOG:path.join(out,`backend-${port}.log`)}});
  report.owners.push({pid:child.pid,url,executable,database});
  let startupError;child.once("error",error=>{startupError=error;});
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    if(startupError)throw startupError;
    assert.equal(child.exitCode,null,"Owned sidecar exited before readiness");
    try{if((await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1000)})).ok)return url;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error("Packaged sidecar readiness timed out");
}
async function api(url,endpoint,init={}){
  const response=await fetch(`${url}${endpoint}`,{...init,headers:{"Content-Type":"application/json",...init.headers},signal:AbortSignal.timeout(10000)});
  const result=await response.json();assert(response.ok,JSON.stringify(result));return result.data;
}
async function verify(url,project,label){
  const asset=project.asset_manifest[0],source=asset.metadata.url;
  assert(source.startsWith(`${url}/api/project/assets/`),"Asset must resolve against this actual packaged sidecar");
  const response=await fetch(source,{signal:AbortSignal.timeout(10000)});assert(response.ok);
  assert(Buffer.from(await response.arrayBuffer()).equals(bytes),"Persisted/reopened bytes must match replacement");
  report.checks.push({label,status:"PASS",assetUrl:source,sha256:crypto.createHash("sha256").update(bytes).digest("hex")});
}
(async()=>{
  const project=fixture("p1-packaged-assets");project.asset_manifest=[{asset_id:"background",asset_type:"background",
    metadata:{filename:"升级素材.svg",mime_type:"image/svg+xml",data_url:`data:image/svg+xml;base64,${bytes.toString("base64")}`}}];
  let url=await start();
  const saved=await api(url,`/api/project/projects/${project.project_id}`,{method:"PUT",body:JSON.stringify(project)});
  await verify(url,saved,"save-new-bytes-current-port");
  await api(url,"/api/project/state",{method:"POST",body:JSON.stringify({project_metadata:{projectId:project.project_id,assetManifest:saved.asset_manifest}})});
  await stop();url=await start();
  const reopened=await api(url,`/api/project/projects/${project.project_id}`);await verify(url,reopened,"restart-rebind-project");
  const shared=await api(url,"/api/project/state?include_recent_projects=false");
  assert.equal(shared.project_metadata.assetManifest[0].metadata.url,reopened.asset_manifest[0].metadata.url);
  const stale=await api(url,"/api/project/state",{method:"POST",body:JSON.stringify({project_metadata:{projectId:project.project_id,assetManifest:saved.asset_manifest}})});
  assert.equal(stale.project_metadata.assetManifest[0].metadata.url,reopened.asset_manifest[0].metadata.url);
  report.checks.push({label:"shared-state-and-stale-snapshot-rebind",status:"PASS"});assert.equal(report.checks.length,3);
  report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
  .finally(async()=>{
    try{await stop();}catch(error){report.status="FAILED";report.cleanupError=String(error);process.exitCode=1;}
    fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));console.log(`Evidence: ${out}`);
  });
