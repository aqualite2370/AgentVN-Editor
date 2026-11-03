"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Assistant-Focus-20261019-01";
const qa = "F:/AgentVN/QA/Assistant-Focus-20261019-01";
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa));
fs.mkdirSync(checkpoint);
fs.mkdirSync(qa);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const entries = ["editor/src/components/assistant/AssistantCreationWorkbenchWindow.tsx",
  "editor/src/components/assistant/assistant-creation-workbench.css",
  "editor/src/components/editor/EditorToolbar.tsx", "AGENTS.md", "plans/ACTIVE_TASKS.md"].map(relative => {
  const target = path.join(checkpoint, "files", relative), source = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(target));
  return { relative, sha256: sha(source) };
});
const input = path.join(qa, "创造窗焦点 隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture("assistant-focus-20261019-01"), null, 2), { flag: "wx" });
fs.copyFileSync(path.join(root, "AgentVN Dev.exe"), path.join(checkpoint, "AgentVN-Dev-before.exe"),
  fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify({
  createdAt: new Date().toISOString(), entries, input,
  devSha256: sha(path.join(checkpoint, "AgentVN-Dev-before.exe")),
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ checkpoint, input }));
