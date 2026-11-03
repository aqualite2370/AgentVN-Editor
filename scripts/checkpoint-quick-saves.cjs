"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/quick-saves-before-fix", runId);
const files = [
  "GameCli_framework/src/types/save.ts",
  "GameCli_framework/src/engine/desktopSaveManager.ts",
  "GameCli_framework/src/engine/validation.ts",
  "GameCli_framework/src/store/runtimeStore.ts",
  "GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
  "GameCli_framework/src/components/player/PlaybackControls.tsx",
  "GameCli_framework/src-tauri/src/lib.rs",
  "GameCli_framework/docs/SAVE_SYSTEM.md",
  "plans/renpy-layout-implementation-progress.md",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(output, { recursive: true });
const entries = files.map(file => {
  const source = path.join(root, file), target = path.join(output, "files", file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { file, sha256: sha(source) };
});
for (const [name, args] of [
  ["status.txt", ["status", "--short"]], ["tracked.patch", ["diff", "--binary", "HEAD"]],
  ["staged.patch", ["diff", "--cached", "--binary"]],
]) fs.writeFileSync(path.join(output, name), execFileSync("git", args,
  { cwd: root, maxBuffer: 128 * 1024 * 1024 }));
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  runId, files: entries,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dev: { path: "AgentVN Dev.exe", sha256: sha(path.join(root, "AgentVN Dev.exe")) },
  note: "Selected tracked/untracked sources and tracked/index patch preserved without reset/cleanup/commit.",
}, null, 2));
console.log(path.join(output, "manifest.json"));
