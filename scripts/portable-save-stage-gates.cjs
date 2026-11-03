"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { spawn } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
assert(process.argv[2], "Pass the current completed portable-save UI report explicitly");
const uiFile = path.resolve(process.argv[2]), ui = JSON.parse(fs.readFileSync(uiFile));
assert.equal(ui.status, "PASS"); assert.equal(ui.cases.length, 24);
assert(ui.cases.every(row => row.status === "PASS")); assert.deepEqual(ui.errors, []);
const stamp = path.basename(path.dirname(uiFile));
const start = Date.parse(stamp.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z$/, "T$1:$2:$3.$4Z"));
assert(Number.isFinite(start));
const uiSources = [
  "GameCli_framework/src/engine/desktopSaveManager.ts", "GameCli_framework/src/store/runtimeStore.ts",
  "GameCli_framework/src/app/App.tsx", "GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
  "GameCli_framework/src/components/shell/SaveMigrationDialog.tsx",
  "GameCli_framework/src/components/shell/save-migration.css", "scripts/portable-save-ui-playwright.cjs",
];
for (const file of uiSources) assert(fs.statSync(path.join(root,file)).mtimeMs <= start,
  `UI source changed since that behavior run: ${file}; rerun UI evidence`);
const sources = [...uiSources, "GameCli_framework/src-tauri/src/lib.rs",
  "GameCli_framework/src-tauri/src/save_location.rs", "GameCli_framework/src-tauri/src/portable_save_migration.rs",
  "scripts/portable-save-identity-test.cjs"];
const out = path.join(root,"output/portable-save-gates",new Date().toISOString().replace(/[:.]/g,"-"));
fs.mkdirSync(out,{recursive:true});
const report = { status:"RUNNING", startedAt:new Date().toISOString(),
  scope:"Windows fixed-game portable saves, consent copy, no Editor/Runtime motion changes; not installed acceptance",
  uiEvidence:{path:uiFile,sha256:A.sha256(fs.readFileSync(uiFile)),cases:24,sourceModifiedBeforeRun:true},
  sourceBefore:sources.map(file=>({file,sha256:A.sha256(fs.readFileSync(path.join(root,file)))})),steps:[] };
const save=()=>fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));
const npm=path.join(path.dirname(process.execPath),"node_modules/npm/bin/npm-cli.js");
async function run(name,command,args,extra={}) {
  const step={name,command:[command,...args],status:"RUNNING",startedAt:new Date().toISOString(),log:path.join(out,`${name}.log`)};
  report.steps.push(step); save(); console.log(`START ${name}`);
  const log=fs.createWriteStream(step.log,{flags:"wx"}); let text="";
  try {
    const nativeEnv=command.endsWith("powershell.exe") ? {
      PSModulePath:[path.join(process.env.USERPROFILE,"Documents/WindowsPowerShell/Modules"),
        path.join(process.env.ProgramFiles,"WindowsPowerShell/Modules"),
        path.join(process.env.SystemRoot,"System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter),
    }:{};
    const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],env:{
      ...process.env,...nativeEnv,AGENTVN_TEST_PROJECT:path.join(root,"scripts/fixtures/dialog-presentation-isolated.vnproj"),
      AGENTVN_WORKSPACE_OUTPUT:path.join(out,name),...extra,
    }});
    step.pid=child.pid; save();
    for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{text+=chunk;log.write(chunk);});
    step.exitCode=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
    assert.equal(step.exitCode,0,`${name}\n${text.slice(-4000)}`);
    step.evidence=[...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(match=>match[1].trim());
    step.status="PASS";console.log(`PASS ${name}`);
  }catch(error){step.status="FAILED";step.error=String(error.stack||error);throw error;}
  finally{log.end();step.finishedAt=new Date().toISOString();save();}
}
const node=(name,file,args=[],env={})=>run(name,process.execPath,[`scripts/${file}.cjs`,...args],env);
(async()=>{
  await node("native-real-filesystem-and-existing-atomic-saves","portable-save-native-test",["--cargo","--all"]);
  await node("migration-consent-ownership","portable-save-runtime-test");
  await node("fixed-snapshot-versus-install-identity","portable-save-identity-test");
  await node("save-storage","quick-save-storage-test");
  await node("quick-save-policy","quick-save-policy-test");
  await node("quick-save-runtime","quick-save-runtime-test");
  await node("save-queue","runtime-save-queue-test");
  await node("terminal-save","runtime-terminal-save-test");
  await node("exit-save-contract","runtime-exit-flow-test");
  for(const [dpr,reduced] of [[1,false],[2,true]]) {
    const env={PROFILE_DPR:String(dpr),PROFILE_REDUCED:reduced?"1":""};
    await node(`exit-behavior-dpr${dpr}`,"runtime-exit-behavior-playwright",[],env);
    await node(`quick-save-ui-dpr${dpr}`,"renpy-quick-save-playwright",[],env);
  }
  await run("editor-typecheck",process.execPath,[npm,"--prefix",path.join(root,"editor"),"run","typecheck"]);
  await run("editor-build",process.execPath,[npm,"--prefix",path.join(root,"editor"),"run","build"]);
  await run("gamecli-build",process.execPath,[npm,"--prefix",path.join(root,"GameCli_framework"),"run","build"]);
  await node("editor-workspace-contract","editor-workspace-contract");
  const dev=path.join(root,"AgentVN Dev.exe"),before=fs.statSync(dev).mtimeMs;
  await run("full-dev-build","powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
    path.join(root,"scripts/build-dev-launcher.ps1")]);
  report.dev={path:dev,sha256:A.sha256(fs.readFileSync(dev)),
    compiledSha256:A.sha256(fs.readFileSync(path.join(root,"editor/src-tauri/target/debug/agentvn-editor.exe"))),
    overwritten:fs.statSync(dev).mtimeMs>before,modifiedAt:fs.statSync(dev).mtime.toISOString(),
    pending:fs.existsSync(path.join(root,"AgentVN Dev.pending.exe"))};
  assert(report.dev.overwritten && !report.dev.pending);assert.equal(report.dev.sha256,report.dev.compiledSha256);
  report.sourceAfter=report.sourceBefore.map(row=>({...row,
    unchanged:A.sha256(fs.readFileSync(path.join(root,row.file)))===row.sha256}));
  assert(report.sourceAfter.every(row=>row.unchanged));
  report.bundled=report.sourceBefore.filter(row=>row.file.startsWith("GameCli_framework/")).map(row=>{
    const file=path.join(root,"editor/src-tauri/bundle-workspace",row.file);
    return{source:row.file,bundled:file,sha256:A.sha256(fs.readFileSync(file)),expected:row.sha256};
  });
  assert(report.bundled.every(row=>row.sha256===row.expected));
  report.status="PORTABLE_SAVE_SOURCE_DEV_PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;})
  .finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(`Evidence: ${out}`);});
