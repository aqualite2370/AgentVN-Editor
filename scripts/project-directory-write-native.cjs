"use strict";
// Actual current Dev + actual Rust command and ACL. Preference preseed is fixture
// setup, not native directory-picker acceptance or frozen installation evidence.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process"),JSZip=require("../editor/node_modules/jszip");
const A=require("./lib/installed-acceptance.cjs"),{fixture}=require("./lib/editor-ui-acceptance.cjs");
const {nativeSession,until}=require("./lib/current-native-editor-session.cjs");
const {installedReleaseSession}=require("./lib/installed-release-session.cjs");
const installationFile=process.argv.find(a=>a.startsWith("--installed="))?.slice("--installed=".length);
if(installationFile)assert.equal(path.resolve(installationFile),
 path.resolve("F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json"));
const base=installationFile?"F:/AgentVN/QA/Editor-Repair-Release-20261024-01/directory"
 :"F:/AgentVN/QA/Project-Directory-Write-20261024-01",attempt=process.argv[2],single=process.argv.includes("--single");
assert.match(attempt||"",/^(?:red|green)-\d{2}$/);
assert(process.argv.slice(3).every(a=>a==="--single"||a.startsWith("--installed=")));
const out=path.join(base,attempt);assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=p=>A.sha256(fs.readFileSync(p)),desc=p=>({path:p,sha256:sha(p),bytes:fs.statSync(p).size});
const input=path.join(out,"isolated-small.vnproj"),project=fixture(`directory-write-${attempt}`);
project.title=`QA-directory-write-${attempt}`;project.schema_version="1.1.0";
project.nodes[0].data.loadingAnimation={kind:"default"};project.nodes[0].data.openingAudio=[];
fs.writeFileSync(input,JSON.stringify(project),{flag:"wx"});
const directory=path.join(out,"owned-save-directory");fs.mkdirSync(directory);
// An existing package is never overwritten or removed by the failure path.
const old=path.join(directory,"old.vnproj");fs.writeFileSync(old,"existing-test-package",{flag:"wx"});
const installation=installationFile?JSON.parse(fs.readFileSync(installationFile,"utf8").replace(/^\uFEFF/,"")):undefined;
if(installation)assert.equal(installation.executable.version,"1.9.23");
const report={status:"RUNNING",at:new Date().toISOString(),scope:installationFile
 ?"ACTUAL_INSTALLED_1_9_23_REAL_ACL_AND_RUST_IO_NOT_NATIVE_PICKER_ACCEPTANCE"
 :"CURRENT_DEV_REAL_ACL_AND_RUST_IO_NOT_INSTALLED_OR_PICKER_ACCEPTANCE",
 modelRequests:0,controlled:["fixture imported through public backend","machine-local directory preference preseed",
 "actual owned-directory write-deny ACL"],executable:desc(installation?.executable.path||"D:/AgentVN/AgentVN Dev.exe"),
 ...(installationFile?{installation:desc(installationFile)}:{}),
 input:desc(input),sources:["editor/src-tauri/src/main.rs","editor/src/components/editor/EditorToolbar.tsx",__filename].map(p=>desc(path.resolve(p))),
 old:desc(old),launches:[],cleanups:[],screenshots:[],cases:[],errors:[]};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const owner=installationFile?installedReleaseSession({out,input,report,save,installationFile})
 :nativeSession({out,input,report,save}),receipt=path.join(out,"acl-before.json");
let page,denied=false;
function acl(mode){
 const r=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
  path.join(__dirname,"project-directory-write-acl.ps1"),"-Mode",mode,"-Directory",directory,"-Receipt",receipt],
 {encoding:"utf8",windowsHide:true,timeout:30000});
 assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout.replace(/^\uFEFF/,"").trim());
}
const files=dir=>fs.readdirSync(dir).filter(n=>n.startsWith(project.title)&&/\.vnproj(?:\.tmp)?$/.test(n))
 .map(n=>desc(path.join(dir,n)));
(async()=>{
 save();page=await owner.start();
 const imported=await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`,{
  method:"POST",headers:{"content-type":"application/octet-stream","X-AgentVN-Filename":"isolated-small.vnproj"},
  body:fs.readFileSync(input),signal:AbortSignal.timeout(30000)});
 const importedValue=await imported.json();
 assert(imported.ok&&importedValue.ok&&importedValue.data.project_id===project.project_id,JSON.stringify(importedValue));
 await page.evaluate(({id,directory})=>localStorage.setItem("agentvn.projectExportDirectories.v1",JSON.stringify({[id]:directory})),
  {id:project.project_id,directory});
 await page.reload();await page.locator(".project-home").waitFor();
 await page.locator(".recent-project-open:not(:disabled):visible").filter({hasText:project.title}).click();
 await page.locator(".editor-toolbar").waitFor();await A.settleEditor(page);await A.dismissEnvironmentCompletion(page);
 let downloads=0;page.on("download",()=>downloads++);
 const downloadDir=path.join(process.env.USERPROFILE,"Downloads"),beforeDownloads=files(downloadDir);
 const errorRoot=installationFile?path.join(owner.installation.installRoot,"error_log"):"D:/AgentVN/error_log",
  oldErrors=new Set(fs.existsSync(errorRoot)?fs.readdirSync(errorRoot):[]);
 denied=true;report.denial=acl("deny");save();
 const matrix=single?[[1920,1080,1,false]]:[1920,2560,3840].flatMap((w,i)=>[1,2].flatMap(dpr=>
  [false,true].map(reduced=>[w,[1080,1440,2160][i],dpr,reduced])));
 for(const [width,height,dpr,reduced]of matrix){
  const row={width,height,dpr,reduced,status:"RUNNING"};report.cases.push(row);save();
  await owner.metrics({width,height,dpr,reduced});await A.settleEditor(page);
  await page.getByRole("button",{name:"保存工程",exact:true}).click();
  const toast=page.locator(".toast-status.is-error:visible");await toast.waitFor();row.notice=await toast.innerText();
  const raw=await until(()=>{
   for(const name of fs.existsSync(errorRoot)?fs.readdirSync(errorRoot):[]){
    if(oldErrors.has(name)||!/^AgentVN-Error-\d+\.txt$/.test(name))continue;
    const file=path.join(errorRoot,name),text=fs.readFileSync(file,"utf8");
    if(text.includes(project.project_id)&&text.includes("Source: 保存工程")){oldErrors.add(name);return{file,text};}
   }
  },"new actual native error report");
  const errorFile=path.join(out,`error-${report.cases.length}.txt`);
  fs.copyFileSync(raw.file,errorFile,fs.constants.COPYFILE_EXCL);row.error=desc(errorFile);
  row.summary=raw.text.split("== Developer Diagnosis ==")[0];
  assert.equal(await page.getByTestId("project-save-confirmation").count(),0);
  assert.equal(downloads,0);assert.deepEqual(files(downloadDir),beforeDownloads);
  assert.deepEqual(fs.readdirSync(directory),["old.vnproj"]);assert.equal(sha(old),report.old.sha256);
  row.noFallbackNoPartialNoOverwrite=true;
  row.geometry=await toast.evaluate(node=>{
   const r=node.getBoundingClientRect();return{rect:r.toJSON(),overflow:document.documentElement.scrollWidth-innerWidth,
    hit:node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
  });
  assert(row.geometry.hit&&row.geometry.overflow<=1&&row.geometry.rect.left>=0&&row.geometry.rect.right<=width+1);
  await owner.shot(`denied-${width}-${dpr}-${reduced}`);
  save();
  assert(row.summary.includes("PROJECT_EXPORT_DIRECTORY_WRITE_FAILED")&&row.summary.includes(directory),
   "Directory IO failure must identify its error category and actual target directory");
  assert(/权限|空间/.test(row.summary)&&/重新选择|重选/.test(row.summary));
  assert(!row.summary.includes("请确认素材仍可在素材库中预览"),"Directory failure must not suggest repairing assets");
  row.status="PASS";save();await toast.waitFor({state:"hidden",timeout:20000});
 }
 report.restoration=acl("restore");denied=false;save();
 await page.getByRole("button",{name:"保存工程",exact:true}).click();
 const confirmation=page.getByTestId("project-save-confirmation");await confirmation.waitFor();
 const added=files(directory);assert.equal(added.length,1);assert((await confirmation.innerText()).includes(added[0].path));
 const zip=await JSZip.loadAsync(fs.readFileSync(added[0].path));
 const portable=JSON.parse(await zip.file("project.json").async("string"));
 assert.equal(portable.project_id,project.project_id);
 assert(!JSON.stringify(portable).includes("projectExportDirectories"));assert.equal(sha(old),report.old.sha256);
 report.retryPackage=added[0];await confirmation.getByRole("button",{name:"OK",exact:true}).click();
 // Call the actual host command with a nonexistent SOURCE, not a mocked error.
 // Output remains writable, so a source read error must not blame the directory.
 const sourceFailure=await page.evaluate(async({directory,project})=>{
  try{
   return {value:await window.__TAURI_INTERNALS__.invoke("write_project_bundle",{
    fileName:"missing-source.vnproj",outputDirectory:directory,
    projectJson:JSON.stringify({...project,asset_manifest:[{asset_id:"missing",asset_type:"background",
     metadata:{project_path:"assets/background/missing.png"}}]}),
    assets:[{zipPath:"assets/background/missing.png",filePath:directory+"\\nonexistent-source.png",temporary:false}]
   })};
  }catch(error){return{error:String(error)};}
 },{directory,project});
 assert(sourceFailure.error?.includes("无法读取素材")&&!sourceFailure.error.includes("PROJECT_EXPORT_DIRECTORY_"),
  JSON.stringify(sourceFailure));
 assert(!fs.existsSync(path.join(directory,"missing-source.vnproj"))&&!fs.existsSync(path.join(directory,"missing-source.vnproj.tmp")));
 report.sourceFailure=sourceFailure;
 report.status="PASS";assert.equal(report.cases.length,single?1:12);assert.deepEqual(report.errors,[]);
})().catch(e=>{
 report.status="FAILED";report.error=String(e.stack||e);
 if(report.cases.at(-1)?.status==="RUNNING")report.cases.at(-1).status="FAILED";
}).finally(async()=>{
 try{if(denied&&fs.existsSync(receipt)){report.restoration=acl("restore");denied=false;}}
 catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";}
 try{await owner.stop("owned QA teardown; no normal-close claim");}catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";}
 report.finishedAt=new Date().toISOString();save();
 console.log(JSON.stringify({status:report.status,out,cases:report.cases.length,error:report.error,cleanupError:report.cleanupError}));
 if(report.status!=="PASS")process.exitCode=1;
});
