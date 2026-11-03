"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/checkpoints/bubble-node-frame", new Date().toISOString().replace(/[:.]/g, "-"));
const files = ["GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/styles/player.css",
  "scripts/bubble-node-frame-playwright.cjs", "scripts/lib/installed-font-node-authoring.cjs",
  "scripts/installed-layout-authoring-playwright.cjs", "plans/ACTIVE_TASKS.md"];
fs.mkdirSync(out, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const entries = files.map(file => {
  const source = path.join(root, file), destination = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  return { file, sha256: sha(source) };
});
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({
  scope: "Default bubble reading budget before product edit; installed/source RED preserved",
  entries, artifacts: ["AgentVN Dev.exe", "editor/src-tauri/target/release/agentvn-editor.exe"]
    .map(file => ({ file, sha256: sha(path.join(root, file)), generatedAt: fs.statSync(path.join(root, file)).mtime.toISOString() })),
}, null, 2), { flag: "wx" });
console.log(`Checkpoint: ${out}`);
