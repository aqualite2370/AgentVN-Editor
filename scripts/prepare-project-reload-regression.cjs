"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Project-Reload-20261019-01";
const qa = "F:/AgentVN/QA/Project-Reload-20261019-01";
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Fresh directories required");
fs.mkdirSync(checkpoint); fs.mkdirSync(qa);
const files = [
  "editor/src/components/advanced/PreviewWindowControls.tsx",
  "editor/src/app/projectHydration.ts", "editor/src/store/editorStore.ts",
  "editor/src/store/projectStore.ts", "editor/src/api/backendClient.ts",
  "AGENTS.md", "plans/ACTIVE_TASKS.md",
];
const copied = files.map(relative => {
  const target = path.join(checkpoint, relative), source = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(target));
  return { relative, sha256: sha(source) };
});
fs.copyFileSync(path.join(root, "AgentVN Dev.exe"),
  path.join(checkpoint, "AgentVN-Dev-before.exe"), fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(checkpoint, "worktree.patch"),
  execFileSync("git", ["diff", "--binary"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }), { flag: "wx" });
fs.writeFileSync(path.join(checkpoint, "status.txt"),
  execFileSync("git", ["status", "--short"], { cwd: root }), { flag: "wx" });
const project = fixture("qa-project-reload-current");
project.title = "工程重载 隔离小工程";
project.nodes[1].id = "reload-current-scene";
project.nodes[1].data.scene.scene_id = "reload-current-scene";
project.nodes[1].data.label = "当前工程专属场景";
project.edges[0].target = project.nodes[1].id;
const input = path.join(qa, "工程重载 隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
const manifest = { at: new Date().toISOString(), checkpoint, qa, input, files: copied,
  originalDevSha256: sha(path.join(root, "AgentVN Dev.exe")),
  scope: "HOST-03 project-specific reload and stale ownership; no motion changes/model submissions" };
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify(manifest, null, 2));
