"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Novel-Entry-20261019-01";
const qa = "F:/AgentVN/QA/Novel-Entry-20261019-01";
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Require fresh checkpoint and isolated project roots");
fs.mkdirSync(checkpoint, { recursive: false });
fs.mkdirSync(qa, { recursive: false });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const entries = ["editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/styles/editor-topbar.css", "AGENTS.md", "plans/ACTIVE_TASKS.md"].map(relative => {
  const source = path.join(root, relative), target = path.join(checkpoint, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(target));
  return { relative, sha256: sha(source) };
});
const input = path.join(qa, "小说入口 隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture("novel-entry-regression-20261019-01"), null, 2), { flag: "wx" });
const manifest = { createdAt: new Date().toISOString(), entries, input,
  devSha256: sha(path.join(root, "AgentVN Dev.exe")),
  note: "Focused recoverable checkpoint before Editor changes; original broader dirty tree checkpoint retained." };
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify({ checkpoint, input, files: entries.length }));
