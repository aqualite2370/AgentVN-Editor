"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Host-Lifecycle-20261019-01";
const qa = "F:/AgentVN/QA/Host-Lifecycle-20261019-01";
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Fresh checkpoint required");
fs.mkdirSync(checkpoint); fs.mkdirSync(qa);
const files = ["editor/src-tauri/src/main.rs", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "AGENTS.md", "plans/ACTIVE_TASKS.md"];
const copied = files.map(relative => {
  const target = path.join(checkpoint, relative), source = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(target));
  return { relative, sha256: sha(source) };
});
const dev = path.join(root, "AgentVN Dev.exe");
fs.copyFileSync(dev, path.join(checkpoint, "AgentVN-Dev-before.exe"), fs.constants.COPYFILE_EXCL);
// Small isolated copy: do not modify or launch the frozen installed tree.
const frozen = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
const candidate = path.join(qa, "candidate");
fs.mkdirSync(candidate);
for (const name of ["agentvn-editor.exe", "creator-backend.exe"]) {
  fs.copyFileSync(path.join(frozen, name), path.join(candidate, name), fs.constants.COPYFILE_EXCL);
}
const manifest = { at: new Date().toISOString(), checkpoint, qa, files: copied,
  originalDevSha256: sha(dev), frozenExeSha256: sha(path.join(frozen, "agentvn-editor.exe")),
  candidate, scope: "G08 owned backend/frontend lifecycle only; no animation or model calls" };
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(JSON.stringify(manifest, null, 2));
