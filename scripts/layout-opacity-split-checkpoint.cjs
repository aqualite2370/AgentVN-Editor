"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Layout-Opacity-Split-20261020-01";
const qa = "F:/AgentVN/QA/Layout-Opacity-Split-20261020-01";
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Never overwrite an earlier checkpoint");
const files = ["AGENTS.md", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "shared/cartridge/uiSkin.ts", "shared/cartridge/runtimeCapabilities.ts", "shared/cartridge/constants.ts",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  ...["MainMenu", "RenpyTitleView", "SettingsScreen", "SaveLoadScreen", "HistoryScreen", "AboutScreen",
    "HelpScreen", "GalleryScreen"].map(n => `GameCli_framework/src/components/shell/${n}.tsx`),
  "GameCli_framework/src/styles/shell.css",
  "editor/src/components/advanced/RenpyTitleEditor.tsx", "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "scripts/layout-opacity-inheritance-test.cjs", "scripts/layout-opacity-source-playwright.cjs",
  ".gitignore", "scripts/push-agentvn-editor.ps1"];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(checkpoint, { recursive: true }); fs.mkdirSync(qa, { recursive: true });
const copies = files.map(file => {
  const target = path.join(checkpoint, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
  return { file, sha256: sha(target) };
});
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/agentvn-player.exe", "editor/src-tauri/binaries/creator-backend.exe"]
  .map(file => ({ file, sha256: sha(path.join(root, file)), bytes: fs.statSync(path.join(root, file)).size }));
const fixture = require("./lib/editor-ui-acceptance.cjs").fixture("layout-opacity-split-20261020-01");
fixture.title = "分层透明度 隔离小工程";
const input = path.join(qa, "分层透明度 隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture), { flag: "wx" });
fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify({
  at: new Date().toISOString(), files: copies, products, input,
  decision: "Separate background and content opacity; retain untouched legacy rendering",
  scope: "Targeted recoverable source copies including untracked implementation, plus product hashes; no cleanup/reset",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ checkpoint, qa, input }));
