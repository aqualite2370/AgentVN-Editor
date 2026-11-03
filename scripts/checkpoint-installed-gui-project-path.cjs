"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = "F:/AgentVN/Checkpoints/Installed-GUI-Project-Path-20261026-01";
if (fs.existsSync(output)) throw new Error(`Checkpoint already exists: ${output}`);
fs.mkdirSync(output, { recursive: true });

const files = [
  "AGENTS.md",
  "plans/ACTIVE_TASKS.md",
  "editor/src/renpy/renpyGuiImportPlan.ts",
  "editor/src/utils/projectAssets.ts",
  "scripts/renpy-gui-import-apply-test.cjs",
  "scripts/renpy-gui-import-roundtrip-test.cjs",
  "scripts/installed-gui-current.cjs",
  "scripts/lib/installed-candidate-feature-session.cjs",
  "scripts/installed-layout-cache-session.ps1",
];

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const copies = files.map((relative) => {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) return { path: relative, exists: false };
  const target = path.join(output, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, exists: true, sha256: sha256(source) };
});

for (const [name, args] of [
  ["status.txt", ["status", "--short"]],
  ["tracked.patch", ["diff", "--binary", "HEAD"]],
  ["staged.patch", ["diff", "--cached", "--binary"]],
]) {
  fs.writeFileSync(path.join(output, name), execFileSync("git", args, {
    cwd: root,
    maxBuffer: 192 * 1024 * 1024,
  }), { flag: "wx" });
}

fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  createdAt: new Date().toISOString(),
  scope: "installed GUI import duplicate project_path defect before fix",
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  files: copies,
  note: "Recoverable checkpoint. No reset, cleanup, overwrite, commit, or product build.",
}, null, 2), { flag: "wx" });

console.log(JSON.stringify({ status: "PASS", output, files: copies.length }));
