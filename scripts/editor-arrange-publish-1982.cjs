"use strict";
// Scoped source delivery through an alternate index. Never stage the dirty tree.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),
  crypto=require("node:crypto"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),base="F:/testavn/Editor-Arrange-Release-1982-20261116-01";
const parent="b65c2af268d1fd8dd7afcd87f6135b4adab8a27c",branch="codex/editor-autosave-recovery-20261116";
const output=path.join(base,"source-delivery-02.json");assert(!fs.existsSync(output));
const digest=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const env={...process.env,GIT_OPTIONAL_LOCKS:"0",GIT_TERMINAL_PROMPT:"0"};
const git=(args,options={})=>cp.execFileSync("git",["-c","core.autocrlf=false",...args],
  {cwd:root,env,encoding:"utf8",windowsHide:true,timeout:30000,maxBuffer:8*1024*1024,...options});
const index=path.resolve(root,git(["rev-parse","--git-path","index"]).trim());
const state=()=>({head:git(["rev-parse","HEAD"]).trim(),indexSha256:digest(fs.readFileSync(index))});
const files=[
  "editor/src/utils/autoArrangeGraph.ts","scripts/auto-arrange-compact-contract.cjs",
  "scripts/auto-arrange-stability-test.cjs","scripts/editor-arrange-stability-playwright.cjs",
  "scripts/editor-arrange-release-1982.cjs","scripts/editor-arrange-install-stage-1982.cjs",
  "scripts/editor-organize-installed-1982.cjs","scripts/editor-arrange-close-1982.ps1",
  "scripts/editor-arrange-retirement-audit-1982.cjs","scripts/editor-arrange-terminal-audit-1982.cjs",
  "scripts/editor-arrange-publish-1982.cjs",
  "editor/package.json","editor/package-lock.json","editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock","editor/src-tauri/tauri.conf.json"];
const report={status:"RUNNING",parent,branch,before:state(),files:[],scope:"ARRANGE_IDEMPOTENCE_EDITOR1982_VERSION_AND_QA_ONLY",
  productLaunches:0,builds:0,realIndexChanged:false};
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
try{
  const audit=JSON.parse(fs.readFileSync("F:/testavn/Windows-Isolated-1982-20261116-01/terminal-audit-01.json"));
  assert.equal(audit.status,"PASS");
  assert.equal(git(["remote","get-url","origin"]).trim(),"https://github.com/aqualite2370/AgentVN-Editor.git");
  assert(git(["ls-remote","--heads","origin",branch]).startsWith(parent+"\t"),"Remote changed; do not force");
  const alternate={...env,GIT_INDEX_FILE:path.join(base,"delivery-02.index")};
  assert(!fs.existsSync(alternate.GIT_INDEX_FILE));git(["read-tree",parent],{env:alternate});
  for(const relative of files){
    const bytes=fs.readFileSync(path.join(root,relative));
    const blob=git(["hash-object","-w","--stdin"],{input:bytes}).trim();
    git(["update-index","--add","--cacheinfo",`100644,${blob},${relative}`],{env:alternate});
    report.files.push({path:relative,sha256:digest(bytes)});
  }
  const tree=git(["write-tree"],{env:alternate}).trim();
  const changed=git(["diff-tree","--no-commit-id","--name-only","-r",parent,tree]).trim().split("\n").sort();
  assert.deepEqual(changed,[...files].sort());
  report.patch=git(["diff","--stat",parent,tree]);
  report.commit=git(["-c","commit.gpgsign=false","commit-tree",tree,"-p",parent],{input:
    "Keep repeated node arrangement stable and deliver editor 1.9.82\n\nUse the original arrange anchor rather than tree centering as a new origin. Verify repeated pointer/keyboard actions, history, native recovery files and same-default-profile restart. Retain existing Runtime 0.32 and prior failed QA evidence.\n"}).trim();
  save();report.push=git(["push","origin",`${report.commit}:refs/heads/${branch}`]);report.pushSucceeded=true;save();
  assert(git(["ls-remote","--heads","origin",branch]).startsWith(report.commit+"\t"));
  for(const file of report.files)assert.equal(digest(git(["show",`${report.commit}:${file.path}`],{encoding:null})),file.sha256);
  report.status="PASS_PUSH_RECEIPT_REMOTE_REF_AND_LOCAL_COMMIT_BYTES";
}catch(error){report.status="FAILED";report.error=error.stack;process.exitCode=1;}
finally{report.after=state();assert.deepEqual(report.after,report.before);report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify(report,null,2));}
