"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/renpy-dialog-quickbar", runId);
const files = [
  "GameCli_framework/src/components/player/DialogBox.tsx",
  "scripts/renpy-dialog-quickbar-overlap-playwright.cjs",
  "plans/ACTIVE_TASKS.md",
];
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

fs.mkdirSync(output, { recursive: true });
const entries = files.map((relative) => {
  const source = path.join(root, relative);
  const target = path.join(output, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: sha256(source) };
});
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
fs.writeFileSync(path.join(output, "status.txt"),
  execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }));
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  runId,
  scope: "GameCLI Runtime Ren'Py dialogue/quick-bar overlap",
  head,
  files: entries,
  artifacts: ["AgentVN Dev.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe"]
    .map((relative) => {
      const file = path.join(root, relative);
      return fs.existsSync(file)
        ? { path: relative, sha256: sha256(file), modifiedAt: fs.statSync(file).mtime.toISOString() }
        : { path: relative, exists: false };
    }),
}, null, 2));
console.log(output);
