"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const out = "F:/AgentVN/Checkpoints/Installed-Runtime-Motion-1922-20261023-01";
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
if (fs.existsSync(out)) throw Error("Never overwrite a checkpoint");
fs.mkdirSync(out, { recursive: true });
const files = [
  "scripts/native-dev-preview-profile.ps1", "scripts/native-runtime-motion-playwright.cjs",
  "scripts/lib/native-runtime-motion-oracle.cjs", "scripts/lib/installed-runtime-motion-sampler.cjs",
  "scripts/installed-runtime-motion-current.cjs", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
];
const snapshots = files.map(name => {
  const source = path.join(root, name), copy = path.join(out, name);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  if (sha(source) !== sha(copy)) throw Error("Checkpoint bytes differ");
  return { source, copy, sha256: sha(copy) };
});
const products = [
  "D:/AgentVN/AgentVN Dev.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-editor.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/creator-backend.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-player.exe",
].map(file => ({ path: file, sha256: sha(file) }));
const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
});
fs.writeFileSync(path.join(out, "git-status.txt"), status, { flag: "wx" });
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
  status: "PASS", at: new Date().toISOString(), scope: "QA_SLICE_BEFORE_EDITS",
  snapshots, products, note: "Prior whole-workspace checkpoints and dirty implementation preserved; no reset/clean/product edit.",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, snapshots: snapshots.length }));
