"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Novel-Preflight-20261019-01";
const qa = "F:/AgentVN/QA/Novel-Preflight-20261019-01";
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Use new checkpoint and QA roots");
fs.mkdirSync(checkpoint);
fs.mkdirSync(qa);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const entries = ["editor/src/novel-import/novelProcessJobAdapter.ts",
  "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx",
  "editor/src/store/novelImportStore.ts", "plans/ACTIVE_TASKS.md"].map(relative => {
  const source = path.join(root, relative), target = path.join(checkpoint, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(target));
  return { relative, sha256: sha(source) };
});
const input = path.join(qa, "本地预检 隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture("novel-preflight-20261019-01"), null, 2), { flag: "wx" });
fs.copyFileSync(path.join(root, "AgentVN Dev.exe"), path.join(checkpoint, "AgentVN-Dev-before.exe"),
  fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify({
  createdAt: new Date().toISOString(), entries, input,
  devSha256: sha(path.join(checkpoint, "AgentVN-Dev-before.exe")),
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ checkpoint, input }));
