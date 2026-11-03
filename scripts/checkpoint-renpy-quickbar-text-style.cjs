"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join("F:/AgentVN/Checkpoints/Renpy-Quickbar-Authoring", runId);
const files = [
  "AGENTS.md",
  "shared/cartridge/uiLayoutProfiles.ts",
  "GameCli_framework/src/components/player/renpy-quick-bar.css",
  "GameCli_framework/src/components/player/RenpyQuickBar.tsx",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "shared/cartridge/renpyQuickBar.ts",
  "scripts/renpy-quick-save-playwright.cjs",
  "scripts/runtime-layout-profiles-test.cjs",
  "scripts/lib/installed-player-authoring.cjs",
  "scripts/installed-layout-authoring-playwright.cjs",
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
  runId, scope: "Renpy Runtime quick-bar visual style before modification", entries,
}, null, 2), { flag: "wx" });
console.log(`Checkpoint: ${output}`);
