"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/checkpoints/portable-player-saves", new Date().toISOString().replace(/[:.]/g, "-"));
const files = [
  "GameCli_framework/src-tauri/src/lib.rs",
  "GameCli_framework/src/engine/desktopSaveManager.ts",
  "GameCli_framework/src/store/runtimeStore.ts",
  "GameCli_framework/src/app/App.tsx",
  "GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
  "plans/ACTIVE_TASKS.md", "plans/INSTALLED_COMPLETION_LEDGER_20261016.md",
];
fs.mkdirSync(out, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const entries = files.map(file => {
  const source = path.join(root, file), dest = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
  return { file, sha256: sha(source) };
});
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({
  scope: "Approved Windows fixed-game EXE-side saves and consent-only copy migration; no motion changes",
  entries, artifacts: ["AgentVN Dev.exe", "editor/src-tauri/target/release/agentvn-editor.exe"]
    .map(file => ({ file, sha256: sha(path.join(root, file)), modifiedAt: fs.statSync(path.join(root, file)).mtime.toISOString() })),
}, null, 2), { flag: "wx" });
console.log(`Checkpoint: ${out}`);
