"use strict";
// Publish the two verified sprite batches without touching the user's HEAD/index.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),
  crypto=require("node:crypto"),assert=require("node:assert/strict");
const {scan}=require("./git-content-inventory.cjs");
const root=path.resolve(__dirname,".."),base="F:/testavn/Sprite-Hide-Rollback-Release-1986-20261117-01";
const parent="fac4c6602251e106fdbdd4fccd9ee943e6454500",branch="codex/editor-autosave-recovery-20261116";
const output=path.join(base,"source-delivery.json"),review=path.join(base,"source-delivery-review.json");
const hash=v=>crypto.createHash("sha256").update(v).digest("hex");
const env={...process.env,GIT_OPTIONAL_LOCKS:"0",GIT_TERMINAL_PROMPT:"0"};
function git(args,options={}){return cp.execFileSync("git",["-c","core.autocrlf=false",...args],{
  cwd:root,env,encoding:"utf8",windowsHide:true,timeout:45000,maxBuffer:16*1024*1024,...options});}
const index=path.resolve(root,git(["rev-parse","--git-path","index"]).trim());
const state=()=>({head:git(["rev-parse","HEAD"]).trim(),indexSha256:hash(fs.readFileSync(index))});
const files=[
  "GameCli_framework/src/engine/StoryEngine.ts","GameCli_framework/src/engine/spriteStageLayout.ts",
  "GameCli_framework/src/styles/player.css",
  "editor/src/utils/spriteAnimationDefaults.ts","editor/src/types/project.ts","editor/src/types/commands.ts",
  "editor/src/store/projectStore.ts","editor/src/utils/commandTools.ts","editor/src/utils/exportScript.ts",
  "editor/src/components/command-editors/SpriteCommandEditor.tsx",
  "editor/src/components/command-editors/FloatingCommandWorkbench.tsx",
  "editor/src/components/advanced/AnimationEditorPanel.tsx","editor/src/components/advanced/AdvancedToolsPanel.tsx",
  "editor/src/styles/layout.css","editor/src/components/common/hoverHelpCatalog.ts",
  "editor/src/assistant/agentvnDocIndex.generated.ts","docs/ANIMATION_SYSTEM.md",
  "scripts/sprite-animation-defaults-test.cjs","scripts/sprite-animation-defaults-playwright.cjs",
  "scripts/sprite-source-provenance-audit.cjs",
  "scripts/sprite-animation-defaults-release-1985.cjs","scripts/sprite-animation-install-stage-1985.cjs",
  "scripts/sprite-animation-installed-1985.cjs","scripts/sprite-animation-runtime-1985.cjs",
  "scripts/sprite-animation-audit-1985.cjs","scripts/sprite-animation-cleanup-1985.ps1",
  "scripts/sprite-animation-cleanup-followup-1985.ps1","scripts/sprite-animation-temp-acl-audit-1985.ps1",
  "scripts/sprite-hide-rollback-regression.cjs","scripts/sprite-hide-rollback-playwright.cjs",
  "scripts/sprite-hide-rollback-release-1986.cjs","scripts/sprite-hide-rollback-install-stage-1986.cjs",
  "scripts/sprite-hide-rollback-installed-1986.cjs","scripts/sprite-hide-rollback-native-1986.cjs",
  "scripts/sprite-hide-rollback-audit-1986.cjs","scripts/sprite-hide-rollback-cleanup-1986.ps1",
  "scripts/sprite-hide-rollback-cleanup-followup-1986.ps1","scripts/sprite-hide-rollback-publish-1986.cjs",
  "editor/package.json","editor/package-lock.json","editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock","editor/src-tauri/tauri.conf.json",
];
const describe=()=>files.map(relative=>{
  const bytes=fs.readFileSync(path.join(root,relative));assert(!bytes.includes(0),relative);
  assert.deepEqual(scan(bytes.toString("utf8")),[],"Credential review required: "+relative);
  return {path:relative,sha256:hash(bytes),bytes:bytes.length};
});
if(process.argv[2]!=="--push"){
  assert(!fs.existsSync(review));
  fs.writeFileSync(review,JSON.stringify({status:"PREPARED_ONLY_NOT_PUSHED",before:state(),parent,branch,
    files:describe(),ignoredLocalOnly:["AGENTS.md","plans","output","binaries","installers","databases","credentials"],
    heuristicSecretFindings:0},null,2),{flag:"wx"});
  console.log(JSON.stringify({status:"PREPARED_ONLY_NOT_PUSHED",review,files:files.length}));return;
}
assert(!fs.existsSync(output));const prepared=JSON.parse(fs.readFileSync(review,"utf8"));
const r={status:"RUNNING",parent,branch,before:state(),files:describe(),builds:0,productLaunches:0};
const save=()=>fs.writeFileSync(output,JSON.stringify(r,null,2));
try{
  assert.deepEqual(r.files,prepared.files);assert.deepEqual(r.before,prepared.before);
  assert.equal(JSON.parse(fs.readFileSync("F:/testavn/Windows-Isolated-1986-20261117-03/functional-audit.json")).status,"PASS");
  assert.equal(JSON.parse(fs.readFileSync("F:/testavn/Windows-Isolated-1986-20261117-03/artifact-cleanup-02.json")).status,"PASS");
  assert.equal(git(["remote","get-url","origin"]).trim(),"https://github.com/aqualite2370/AgentVN-Editor.git");
  assert(git(["ls-remote","--heads","origin",branch]).startsWith(parent+"\t"),"Remote changed; never force");
  const alternate={...env,GIT_INDEX_FILE:path.join(base,"source-delivery.index")};
  assert(!fs.existsSync(alternate.GIT_INDEX_FILE));git(["read-tree",parent],{env:alternate});
  for(const f of r.files){
    const blob=git(["hash-object","-w","--stdin"],{input:fs.readFileSync(path.join(root,f.path))}).trim();
    git(["update-index","--add","--cacheinfo",`100644,${blob},${f.path}`],{env:alternate});
  }
  r.tree=git(["write-tree"],{env:alternate}).trim();
  const changed=git(["diff-tree","--no-commit-id","--name-only","-r",parent,r.tree]).trim().split("\n").filter(Boolean);
  assert(changed.length>0);assert(changed.every(f=>files.includes(f)));
  r.changed=changed;r.stat=git(["diff","--ignore-space-at-eol","--stat",parent,r.tree]);
  r.commit=git(["-c","commit.gpgsign=false","commit-tree",r.tree,"-p",parent],{input:
    "Preserve hidden sprites across rollback and deliver editor 1.9.86\n\nSeparate logical sprite exits from transient fades and guard superseded callbacks. Add independent global entry/exit defaults with explicit authoring scope. Verify engine, real-art browser matrix, installed editor/native player and retired QA artifacts. Keep Runtime protocol 0.32.\n"}).trim();
  save();
  r.push=git(["push","origin",`${r.commit}:refs/heads/${branch}`]);r.pushSucceeded=true;save();
  assert(git(["ls-remote","--heads","origin",branch]).startsWith(r.commit+"\t"));r.remoteRefVerified=true;
  for(const f of r.files)assert.equal(hash(git(["show",`${r.commit}:${f.path}`],{encoding:null})),f.sha256);
  r.status="PASS_PUSH_REMOTE_REF_AND_LOCAL_COMMIT_BYTES";
}catch(e){r.status="FAILED";r.error=e.stack;process.exitCode=1;}
finally{r.after=state();r.headIndexPreserved=JSON.stringify(r.after)===JSON.stringify(r.before);
  assert(r.headIndexPreserved);r.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:r.status,commit:r.commit,pushSucceeded:r.pushSucceeded,
    remoteRefVerified:r.remoteRefVerified,files:r.files.length,headIndexPreserved:r.headIndexPreserved,error:r.error}));}
