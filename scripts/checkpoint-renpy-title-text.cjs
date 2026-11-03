"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = "F:/AgentVN/Checkpoints/Renpy-Title-Text-20261024-02";
assert(!fs.existsSync(out), "Preserve existing checkpoints");
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files = [
  "AGENTS.md", "plans/ACTIVE_TASKS.md", "shared/cartridge/uiSkin.ts",
  "shared/cartridge/renpyTitleControls.ts", "shared/cartridge/runtimeCapabilities.ts",
  "shared/cartridge/constants.ts", "editor/src/utils/runtimeLayoutRestore.ts",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/renpy-title-editor.css",
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "GameCli_framework/src/components/shell/MainMenu.tsx",
  "scripts/renpy-title-text-authoring-playwright.cjs",
];
fs.mkdirSync(out, { recursive: true });
const entries = files.map(file => {
  const source = path.join(root, file), copy = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(copy));
  return { path: source, copy, sha256: sha(copy) };
});
const products = [
  "D:/AgentVN/AgentVN Dev.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-editor.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-player.exe",
].map(file => ({ path: file, sha256: sha(file), bytes: fs.statSync(file).size }));
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({
  startedAt: new Date().toISOString(), scope: "TITLE_TEXT_AUTHORING_SUPPLEMENT",
  previous: "F:/AgentVN/Checkpoints/Renpy-Title-Text-20261024-01", entries, products,
  red: "F:/AgentVN/QA/Renpy-Title-Text-20261024-01/red-03/report.json",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, files: entries.length }));
