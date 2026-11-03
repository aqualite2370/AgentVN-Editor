"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const out = "F:/AgentVN/Checkpoints/Runtime-Opening-20261023-01";
if (fs.existsSync(out)) throw new Error("Preserve existing checkpoint");
const files = [
  "AGENTS.md", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "GameCli_framework/src/app/App.tsx", "GameCli_framework/src/app/App.css",
  "GameCli_framework/src/components/common/BootAnimation.tsx",
  "GameCli_framework/src/components/common/OpeningScreen.tsx",
  "GameCli_framework/src/styles/shell.css", "GameCli_framework/src/styles/variables.css",
  "scripts/runtime-opening-playwright.cjs", "scripts/checkpoint-runtime-opening.cjs",
];
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
fs.mkdirSync(out, { recursive: true });
const entries = files.map(file => {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) return { file, absent: true };
  const dest = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
  if (sha(source) !== sha(dest)) throw new Error("Checkpoint byte mismatch");
  return { file, sha256: sha(source) };
});
fs.writeFileSync(path.join(out, "tracked.patch"),
  execFileSync("git", ["-c", "core.safecrlf=false", "diff", "--binary", "HEAD"],
    { cwd: root, maxBuffer: 192 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }), { flag: "wx" });
const products = [
  path.join(root, "AgentVN Dev.exe"),
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-editor.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-player.exe",
].map(file => ({ file, sha256: sha(file), bytes: fs.statSync(file).size }));
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({
  at: new Date().toISOString(), layer: "Runtime opening presentation only", entries, products,
  historicalReportsPreserved: true,
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, files: entries.length }));
