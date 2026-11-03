"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/renpy-menu-rail", runId);
const files = [
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RenpyRuntimePreview.tsx",
  "GameCli_framework/src/app/App.tsx",
  "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "shared/cartridge/renpyGui.ts",
  "shared/cartridge/uiSkin.ts",
  "scripts/runtime-layout-profiles-playwright.cjs",
  "plans/ACTIVE_TASKS.md",
  "AGENTS.md",
];
const sha = data => crypto.createHash("sha256").update(data).digest("hex");
fs.mkdirSync(output, { recursive: true });
const entries = files.map(file => {
  const source = path.join(root, file);
  const data = fs.readFileSync(source);
  const target = path.join(output, "files", file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data, { flag: "wx" });
  return { file, sha256: sha(data) };
});
const dev = path.join(root, "AgentVN Dev.exe");
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  runId,
  scope: "Ren'Py in-game menu navigation editor/runtime ownership before implementation",
  entries,
  devSha256: sha(fs.readFileSync(dev)),
  note: "Independent copies include tracked and untracked source. No user project, build artifact, or historical report was changed.",
}, null, 2), { flag: "wx" });
console.log(`Checkpoint: ${output}`);
