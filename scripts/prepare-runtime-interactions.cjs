"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Runtime-Interactions-20261019-01";
const checkpoint = "F:/AgentVN/Checkpoints/Runtime-Interactions-20261019-01";
assert(!fs.existsSync(qa) && !fs.existsSync(checkpoint));
fs.mkdirSync(qa); fs.mkdirSync(checkpoint);
const files = [
  "GameCli_framework/src/components/common/Modal.tsx",
  "GameCli_framework/src/app/App.tsx",
  "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
  "GameCli_framework/src/store/runtimeStore.ts",
  "GameCli_framework/src/components/player/PlaybackControls.tsx",
  "GameCli_framework/src/styles/quick-menu-contract.css",
  "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/styles/variables.css",
  "GameCli_framework/src/utils/runtimeSystemBack.ts",
  "AGENTS.md", "plans/ACTIVE_TASKS.md",
];
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const saved = files.map(file => {
  const source = path.join(root, file), dest = path.join(checkpoint, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(dest));
  return { file, sha256: sha(source) };
});
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify({
  at: new Date().toISOString(), qa, checkpoint, files: saved,
  dev: { path: path.join(root, "AgentVN Dev.exe"), sha256: sha(path.join(root, "AgentVN Dev.exe")) },
  scope: "G13 Runtime modal/back/menu ownership; preserve Editor and frozen1.9.9",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ qa, checkpoint, files: saved.length }));
