"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/checkpoints/runtime-webview",
  new Date().toISOString().replace(/[:.]/g, "-"));
const files = [
  "GameCli_framework/src/main.tsx", "GameCli_framework/package.json",
  "GameCli_framework/package-lock.json", "GameCli_framework/vite.config.cjs",
  "scripts/android-webview-startup-playwright.cjs", "plans/ACTIVE_TASKS.md",
  "plans/INSTALLED_COMPLETION_LEDGER_20261016.md",
];
const frame = process.argv.includes("--frame");
if (frame) files.push(
  "GameCli_framework/src/utils/runtimeCompatibility.ts",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/styles/player.css",
  "scripts/runtime-legacy-webview-playwright.cjs",
  "scripts/runtime-webview-stage-gates.cjs",
);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(out, { recursive: true });
const entries = files.map(file => {
  const source = path.join(root, file), dest = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
  return { file, sha256: sha(source) };
});
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({
  scope: frame ? "Before verified old-engine zero-size frame fallback; API gate PASS and old-engine RED preserved"
    : "Before missing-runtime-API bootstrap fix; all old startup RED reports preserved",
  entries,
  artifacts: ["AgentVN Dev.exe"].map(file => ({
    file, sha256: sha(path.join(root, file)),
    modifiedAt: fs.statSync(path.join(root, file)).mtime.toISOString(),
  })),
}, null, 2), { flag: "wx" });
console.log(`Checkpoint: ${out}`);
