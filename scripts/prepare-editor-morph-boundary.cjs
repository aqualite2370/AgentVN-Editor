"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Editor-Morph-Bounds-20261019-01";
const qa = "F:/AgentVN/QA/Editor-Morph-Bounds-20261019-01";
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Fresh slice directories required");
fs.mkdirSync(checkpoint); fs.mkdirSync(qa);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files = [
  "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/components/advanced/AdvancedToolsPanel.tsx",
  "editor/src/components/common/GlassSelectionGroup.tsx",
  "editor/src/utils/editorTransitionPresentation.ts",
  "editor/src/styles/editor-topbar.css", "editor/src/styles/editor-shell.css",
  "editor/src/styles/editor-tokens.css", "editor/src/styles/variables.css",
  "AGENTS.md", "plans/ACTIVE_TASKS.md",
];
const copied = files.map(relative => {
  const source = path.join(root, relative), target = path.join(checkpoint, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(target));
  return { relative, sha256: sha(source) };
});
const project = fixture("qa-editor-morph-bounds");
project.title = "容器边界 隔离小工程";
const input = path.join(qa, "容器边界 隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
const manifest = { at: new Date().toISOString(), checkpoint, qa, input, files: copied,
  dev: { path: path.join(root, "AgentVN Dev.exe"), sha256: sha(path.join(root, "AgentVN Dev.exe")) },
  scope: "G12 source-versus-frozen-install morph boundary verification; no product edits yet" };
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify(manifest, null, 2));
