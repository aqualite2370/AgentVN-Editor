"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/runtime-menu-motion-before-fix", runId);
const files = [
  "GameCli_framework/src/app/App.tsx",
  "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
  "GameCli_framework/src/store/runtimeStore.ts",
  "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/HelpScreen.tsx",
  "GameCli_framework/src/components/shell/SettingsScreen.tsx",
  "GameCli_framework/src/components/common/Modal.tsx",
  "GameCli_framework/src/components/player/PlaybackControls.tsx",
  "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/styles/variables.css",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "scripts/runtime-screen-transition-playwright.cjs",
  "scripts/runtime-screen-transition-contract.cjs",
  "scripts/runtime-menu-motion-playwright.cjs",
  "scripts/checkpoint-runtime-menu-motion.cjs",
  "plans/ui-motion-implementation-progress.md",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(output, { recursive: true });
const entries = files.map(relative => {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) return { path: relative, absent: true };
  const target = path.join(output, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: sha(source) };
});
for (const [name, args] of [
  ["status.txt", ["status", "--short"]],
  ["tracked.patch", ["diff", "--binary", "HEAD"]],
]) fs.writeFileSync(path.join(output, name), execFileSync("git", args, {
  cwd: root, maxBuffer: 96 * 1024 * 1024,
}));
const manifest = {
  runId, scope: "runtime-menu-motion-touched-files-and-full-tracked-diff",
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  files: entries,
  artifacts: ["AgentVN Dev.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe"]
    .filter(file => fs.existsSync(path.join(root, file)))
    .map(file => ({ path: file, sha256: sha(path.join(root, file)),
      modifiedAt: fs.statSync(path.join(root, file)).mtime.toISOString() })),
  note: "Copied existing tracked and untracked slice files without resetting, committing, or cleaning user data.",
};
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(path.join(output, "manifest.json"));
