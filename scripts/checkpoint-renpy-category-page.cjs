"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/renpy-category-page", runId);
const files = [
  "editor/src/components/advanced/RenpyButtonRoleEditor.tsx",
  "GameCli_framework/src/components/shell/SettingsScreen.tsx",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/styles/renpy-button-roles.css",
  "shared/cartridge/renpyGui.ts",
  "plans/ACTIVE_TASKS.md",
];
const sha = data => crypto.createHash("sha256").update(data).digest("hex");
fs.mkdirSync(output, { recursive: true });
const entries = files.map(file => {
  const data = fs.readFileSync(path.join(root, file));
  const target = path.join(output, "files", file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data, { flag: "wx" });
  return { file, sha256: sha(data) };
});
for (const [name, args] of [
  ["status.txt", ["status", "--short"]],
  ["tracked.patch", ["diff", "--binary", "HEAD"]],
]) fs.writeFileSync(path.join(output, name), execFileSync("git", args, {
  cwd: root, maxBuffer: 64 * 1024 * 1024,
}), { flag: "wx" });
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  runId, scope: "E4 category page ownership and preferences Runtime binding before implementation",
  entries, devSha256: sha(fs.readFileSync(path.join(root, "AgentVN Dev.exe"))),
  reference: "output/checkpoints/renpy-native-navigation/2026-10-11T22-50-19-793Z/official-screens.rpy",
  note: "Independent copies, including untracked implementation. User data, index and historical evidence untouched.",
}, null, 2), { flag: "wx" });
console.log(`Checkpoint: ${output}`);
