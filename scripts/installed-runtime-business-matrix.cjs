"use strict";
// Serial real-installed-Player business matrix. No model, product build or
// synthetic runtime/store responses. Every cell has a fresh test save identity.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {sha256}=require("./lib/installed-acceptance.cjs");
const attempt=process.argv[2]||"01",profileAttempt=Number(process.argv[3]||6);
assert(/^\d{2}$/.test(attempt));assert(Number.isInteger(profileAttempt)&&profileAttempt>=6&&profileAttempt<=9);
const onlyCell=process.argv.find(arg=>arg.startsWith("--only-cell="))?.slice("--only-cell=".length);
if(onlyCell)assert(/^(1920x1080|2560x1440|3840x2160)-dpr[12]-(normal|reduced)$/.test(onlyCell));
const root="D:/AgentVN",base=path.join(root,"output/installed-runtime-business-matrix-20261019-01");
const out=path.join(base,`attempt-${attempt}`);
const artifacts=`F:/AgentVN/QA/Runtime-Business-Matrix-20261019-01/attempt-${attempt}`;
assert(!fs.existsSync(out)&&!fs.existsSync(artifacts));
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(artifacts,{recursive:true});
const legacy=path.join(root,"output/installed-runtime-abilities-20261018-01");
const protection=path.join(root,"output/installed-layout-author-review-20261019-01");
const prepFile=path.join(protection,"preparation.json");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const sha=p=>sha256(fs.readFileSync(p));
const fixture=read(path.join(legacy,"fixtures-02.json"));
const prep=read(prepFile),exported=read(path.join(legacy,"export-03/report.json"));
assert.equal(sha(fixture.input),fixture.inputSha256);
assert.equal(exported.status,"PASS");assert.equal(exported.cartridges.length,2);
for(const c of exported.cartridges)assert.equal(sha(c.path),c.sha256);
assert.equal(sha(path.join(prep.installRoot,"agentvn-player.exe")),
  "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
const runner=path.join(root,"scripts/installed-runtime-abilities-playwright.cjs");
const env={...process.env,AGENTVN_TEST_PROJECT:fixture.input,AGENTVN_WORKSPACE_OUTPUT:out};
const report={status:"RUNNING",at:new Date().toISOString(),cells:[],commands:[],error:null,cleanupError:null,
  modelRequests:0,productChanges:0,newBuilds:0,
  scope:onlyCell?"SINGLE_DIAGNOSTIC_CELL_NOT_FULL_MATRIX":
    "ACTUAL_INSTALLED_LIBRARY_PLAYER_COMPLETE_STORY_BUSINESS_MATRIX_NOT_WINDOWS_SETUP_OR_ANDROID",
  onlyCell:onlyCell||null,expectedCells:onlyCell?1:12,
  inputs:{fixture:{path:fixture.input,sha256:sha(fixture.input)},
    exports:{path:path.join(legacy,"export-03/report.json"),sha256:sha(path.join(legacy,"export-03/report.json"))},
    profilePreparation:{path:prepFile,sha256:sha(prepFile)},cartridges:exported.cartridges,
    runner:{path:runner,sha256:sha(runner)},wrapper:{path:__filename,sha256:sha(__filename)}},
  environment:{AGENTVN_TEST_PROJECT:env.AGENTVN_TEST_PROJECT,AGENTVN_WORKSPACE_OUTPUT:env.AGENTVN_WORKSPACE_OUTPUT},
  screenshotsOnF:true,artifacts,profileAttempt};
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
function command(exe,args,label){
  return new Promise((resolve,reject)=>{
    const log=path.join(artifacts,`${label}.log`);
    assert(!fs.existsSync(log));fs.writeFileSync(log,"",{flag:"wx"});
    const child=spawn(exe,args,{cwd:root,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    const item={executable:exe,args,label,pid:child.pid,log,startedAt:new Date().toISOString(),exitCode:null};
    report.commands.push(item);save();
    for(const stream of [child.stdout,child.stderr])stream.on("data",bytes=>{
      fs.appendFileSync(log,bytes);process.stdout.write(bytes);
    });
    child.once("error",reject);
    child.once("exit",(code,signal)=>{
      item.exitCode=code;item.signal=signal;item.finishedAt=new Date().toISOString();save();resolve(code);
    });
  });
}
function profile(action,label){
  return command("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(root,"scripts/installed-preview-session.ps1"),"-Suite","layout-author-review",
    "-Action",action,"-Attempt",String(profileAttempt)],label);
}
let protectedProfiles=false;
(async()=>{
  assert.equal(await profile("ResumeQA","profile-resume"),0);
  protectedProfiles=true;
  for(const [width,height]of [[1920,1080],[2560,1440],[3840,2160]])
    for(const dpr of [1,2])for(const reduced of [false,true]){
      const name=`${width}x${height}-dpr${dpr}-${reduced?"reduced":"normal"}`;
      if(onlyCell&&name!==onlyCell)continue;
      const cellOut=path.join(out,name),cellArtifacts=path.join(artifacts,name);
      const row={viewport:{width,height,dpr,reduced},status:"RUNNING",path:cellOut};report.cells.push(row);save();
      const args=[runner,cellOut,"--business-viewport",String(width),String(height),String(dpr),String(reduced),
        "--profile-preparation",prepFile,"--artifact-root",cellArtifacts];
      row.exitCode=await command(process.execPath,args,name);
      assert(fs.existsSync(path.join(cellOut,"report.json")),"Child must retain a terminal report");
      const raw=read(path.join(cellOut,"report.json"));row.reportSha256=sha(path.join(cellOut,"report.json"));
      assert.equal(sha(runner),report.inputs.runner.sha256,"Do not change a test during the matrix");
      row.status=raw.status;row.checks=raw.checks.map(c=>({name:c.name,layout:c.layout,status:c.status}));
      row.screenshots=raw.screenshots.length;row.nativeSaves=raw.nativeSaves.length;
      row.errors=raw.layoutErrors||raw.error;save();
      // Continue independent cells after a product/test assertion failure,
      // but never move profiles or start another cell over a live owner.
      assert(raw.launches.length>0&&raw.launches.every(l=>l.cleanup?.status==="PASS"),
        "Player cleanup must finish before the next independent cell");
      assert(!raw.cleanupError,"Unresolved cleanup blocks further launches");
      console.log(`${row.status} complete business cell ${name}`);
    }
  assert.equal(report.cells.length,report.expectedCells);
  report.status=report.cells.every(c=>c.status==="PASS"&&c.exitCode===0)?"PASS":"FAILED";
  if(report.status!=="PASS")process.exitCode=1;
})().catch(e=>{report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1})
.finally(async()=>{
  if(protectedProfiles){
    try{
      assert.equal(await profile("Restore","profile-restore"),0);
      const restored=path.join(protection,`profile-restoration-${String(profileAttempt).padStart(2,"0")}.json`);
      assert.equal(read(restored).status,"PASS");
      report.profileRestoration={path:restored,sha256:sha(restored),status:"PASS"};
    }catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1}
  }
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,cells:report.cells.length,
    passed:report.cells.filter(c=>c.status==="PASS").length,error:report.error,cleanupError:report.cleanupError,out}));
});
