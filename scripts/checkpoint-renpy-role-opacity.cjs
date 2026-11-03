"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/renpy-role-opacity", runId);
const files = [
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/styles/renpy-button-roles.css",
  "GameCli_framework/src/styles/player.css",
  "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "GameCli_framework/src/app/runtimePageCrossfade.ts",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/SettingsScreen.tsx",
  "GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
  "GameCli_framework/src/components/player/RenpyQuickBar.tsx",
  "GameCli_framework/src/components/player/ChoicePanel.tsx",
  "GameCli_framework/src/components/common/Modal.tsx",
  "scripts/runtime-layout-profiles-playwright.cjs",
  "scripts/renpy-role-snapshot-playwright.cjs",
  "scripts/renpy-role-opacity-playwright.cjs",
  "scripts/renpy-role-opacity-stage-gates.cjs",
  "plans/ACTIVE_TASKS.md",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(output, { recursive: true });
const entries = files.map(file => {
  const source = path.join(root, file), target = path.join(output, "files", file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { file, sha256: sha(source) };
});
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  runId, scope: "E4 role opacity consumption before product modification",
  entries, devSha256: sha(path.join(root, "AgentVN Dev.exe")),
  note: "Targeted independent copies include untracked implementations. No user data or historical artifacts modified.",
}, null, 2), { flag: "wx" });
console.log(`Checkpoint: ${output}`);
