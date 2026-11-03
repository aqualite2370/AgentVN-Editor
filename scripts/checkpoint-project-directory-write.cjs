"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,".."),out="F:/AgentVN/Checkpoints/Project-Directory-Write-20261024-01";
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const sources=["AGENTS.md","plans/ACTIVE_TASKS.md","plans/FULL_REGRESSION_20261017.md",
 "editor/src-tauri/src/main.rs","editor/src/components/editor/EditorToolbar.tsx",
 "editor/src/utils/projectBundle.ts","scripts/project-save-native-error-playwright.cjs",
 "scripts/project-directory-installed-acl.ps1","scripts/lib/current-native-editor-session.cjs"];
const copies=sources.map(relative=>{
 const source=path.join(root,relative),copy=path.join(out,"files",relative);
 fs.mkdirSync(path.dirname(copy),{recursive:true});fs.copyFileSync(source,copy,fs.constants.COPYFILE_EXCL);
 assert.equal(sha(source),sha(copy));return {source,copy,sha256:sha(source)};
});
const artifacts=["D:/AgentVN/AgentVN Dev.exe",
 "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json",
 "F:/AgentVN/QA/Project-Directory-Installed-20261022-01/NATIVE-DIRECTORY-1922-20261022.md",
 "F:/AgentVN/QA/Android-Exit-20261024-01/device-18/runtime/report.json"].map(p=>({
 path:p,sha256:sha(p),bytes:fs.statSync(p).size,modifiedUtc:fs.statSync(p).mtime.toISOString()
}));
fs.writeFileSync(path.join(out,"working-tree.patch"),execFileSync("git",["diff","--binary"],{cwd:root,maxBuffer:64*1024*1024}),{flag:"wx"});
fs.writeFileSync(path.join(out,"working-tree-status.txt"),execFileSync("git",["status","--short"],{cwd:root}),{flag:"wx"});
fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify({at:new Date().toISOString(),copies,artifacts,
 scope:"PROJECT-DIRECTORY-WRITE-01; tracked worktree diff and untracked implementation copies; immutable historical evidence"},null,2),{flag:"wx"});
console.log(JSON.stringify({status:"PASS",out,copies:copies.length,artifacts:artifacts.length}));
