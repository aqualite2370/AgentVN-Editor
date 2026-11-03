"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {spawn}=require("node:child_process");
const {fixture}=require("./lib/editor-ui-acceptance.cjs");
const {desktopViewports}=require("./lib/current-acceptance-viewports.cjs");
const {collectStageResourceEvidence}=require("./lib/stage-resource-evidence.cjs");
const root=path.resolve(__dirname,".."),runId=new Date().toISOString().replace(/[:.]/g,"-");
const out=path.join(root,"output/p1-assets-save-gates",runId);
fs.mkdirSync(out,{recursive:true});
const input=path.join(out,"isolated-small.vnproj");
fs.writeFileSync(input,JSON.stringify(fixture(`p1-gates-${runId}`)));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files=["backend/app/api/deps.py","backend/app/services/project_state_service.py",
  "editor/src/components/advanced/AssetLibraryPanel.tsx","editor/src/components/advanced/AdvancedToolsPanel.tsx",
  "editor/src/utils/projectBundle.ts","editor/src/store/editorPreferencesStore.ts",
  "editor/src/styles/layout.css","editor/src/components/editor/EditorToolbar.tsx"];
const report={runId,status:"RUNNING",scope:"P1 source/browser/Dev only; actual Release and Android still required",
  out,input,checks:[],sources:files.map(file=>({file,sha256:sha(path.join(root,file))}))};
const persist=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
async function execute(label,command,args,cwd=root){
  const item={label,command:[command,...args],cwd,startedAt:new Date().toISOString(),status:"RUNNING",
    log:path.join(out,`${String(report.checks.length+1).padStart(2,"0")}-${label}.log`),
    env:{AGENTVN_TEST_PROJECT:input,AGENTVN_WORKSPACE_OUTPUT:path.join(out,`${label}-workspace`),
      AGENTVN_WORKSPACE_VIEWPORTS:"design,qhd,uhd",ADVANCED_TOOLS_VIEWPORT:"1080p,1440p,4k"}};
  report.checks.push(item);persist();console.log(`START ${label}`);
  item.exitCode=await new Promise(resolve=>{
    const stream=fs.createWriteStream(item.log,{flags:"wx"});
    const child=spawn(command,args,{cwd,env:{...process.env,...item.env},windowsHide:true,stdio:["ignore","pipe","pipe"]});
    child.stdout.on("data",data=>stream.write(data));child.stderr.on("data",data=>stream.write(data));
    child.on("error",error=>{item.error=String(error);stream.write(String(error));});
    child.on("close",code=>stream.end(()=>resolve(code)));
  });
  item.finishedAt=new Date().toISOString();item.status=item.exitCode===0?"PASS":"FAILED";persist();
  console.log(`${item.status} ${label}`);assert.equal(item.exitCode,0,`Required P1 gate failed: ${label}; Dev prohibited`);
}
const test=name=>execute(name,process.execPath,[`scripts/${name}.cjs`]);
const npm=(prefix,task)=>execute(`${prefix}-${task}`,"cmd.exe",["/d","/s","/c",`npm --prefix D:\\AgentVN\\${prefix} run ${task}`]);
(async()=>{
  assert(process.argv[2],"Explicit full P1 browser report required; no historical report selection");
  const file=path.resolve(process.argv[2]),matrix=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(matrix.status,"PASS");assert.equal(matrix.cases.length,72);assert.equal(matrix.pageErrors.length,0);
  const keys=new Map();
  for(const c of matrix.cases){
    assert.equal(c.status,"PASS");assert(desktopViewports.some(([w,h])=>w===c.width&&h===c.height));
    assert([1,2].includes(c.dpr)&&typeof c.reduced==="boolean");
    const key=[c.width,c.height,c.dpr,c.reduced].join(":");keys.set(key,(keys.get(key)??0)+1);
  }
  assert.equal(keys.size,12);assert([...keys.values()].every(count=>count===6));
  report.browser={path:file,sha256:sha(file),cases:matrix.cases.length,owner:matrix.owner};
  await execute("backend-project-regression","python",["-m","pytest","tests/test_api.py","tests/test_project_state_service.py","-q"],path.join(root,"backend"));
  for(const name of ["project-export-directory-preferences-test","project-save-asset-payload-contract",
    "asset-library-preview-source-contract","editor-installed-version-resources-test",
    "android-diagnostics-bundled-workspace-test","package-build-result-dialog-contract"])await test(name);
  for(const name of ["project_export_directory_tests","standalone_package_upload_tests"])
    await execute(name,"cargo",["test","--manifest-path","editor/src-tauri/Cargo.toml",name,"--","--nocapture"]);
  await npm("editor","typecheck");await npm("editor","build");await npm("GameCli_framework","build");
  for(const name of ["advanced-tools-viewport-hit-playwright","project-save-native-error-playwright",
    "editor-workspace-contract","editor-workspace-playwright",
    "advanced-tools-transition-regression-playwright","runtime-exit-flow-test","runtime-save-queue-test"])await test(name);
  for(const source of report.sources)assert.equal(sha(path.join(root,source.file)),source.sha256,"Source changed during gates");
  if(process.argv.includes("--deliver-dev")){
    const dev=path.join(root,"AgentVN Dev.exe");
    const before={sha256:sha(dev),modifiedAt:fs.statSync(dev).mtime.toISOString()};
    fs.copyFileSync(dev,path.join(out,"AgentVN Dev-before.exe"),fs.constants.COPYFILE_EXCL);
    await execute("backend-sidecar-build","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
      "D:\\AgentVN\\scripts\\build-backend-sidecar.ps1"]);
    await test("p1-packaged-project-assets-test");
    await execute("dev-build","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
      "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    report.dev={path:dev,before,sha256:sha(dev),modifiedAt:fs.statSync(dev).mtime.toISOString(),
      compiledSha256:sha(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe")),
      pendingExists:fs.existsSync(path.join(root,"AgentVN Dev.pending.exe"))};
    assert.equal(report.dev.sha256,report.dev.compiledSha256);assert.equal(report.dev.pendingExists,false);
    assert.notEqual(report.dev.modifiedAt,before.modifiedAt,"Dev must actually be replaced");
    report.sidecar={path:path.join(root,"editor/src-tauri/binaries/creator-backend.exe"),
      sha256:sha(path.join(root,"editor/src-tauri/binaries/creator-backend.exe"))};
    report.resources=collectStageResourceEvidence(root,files);
    await test("editor-installed-version-resources-test");
  }
  assert(report.checks.length>=15&&report.checks.every(c=>c.status==="PASS"));
  report.status=process.argv.includes("--deliver-dev")?"P1_SOURCE_AND_DEV_PASS":"P1_SOURCE_PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;})
  .finally(()=>{persist();console.log(`Evidence: ${path.join(out,"report.json")}`);});
