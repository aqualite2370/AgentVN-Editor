"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const name = process.argv[2];
if (!/^Runtime-Screen-Polish-\d{8}-\d{2}$/.test(name || "")) throw Error("Explicit checkpoint name required");
const out = path.join("F:/AgentVN/Checkpoints", name);
if (fs.existsSync(out)) throw Error("Checkpoint must not overwrite history");
const files = [
  "AGENTS.md", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
  "GameCli_framework/src/components/shell/SavePageTransition.tsx",
  "GameCli_framework/src/components/shell/AboutScreen.tsx",
  "GameCli_framework/src/components/shell/HelpScreen.tsx",
  "GameCli_framework/src/components/shell/HistoryScreen.tsx",
  "GameCli_framework/src/components/shell/GalleryScreen.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/ScreenBackButton.tsx",
  "GameCli_framework/src/components/player/StoryPlayer.tsx",
  "GameCli_framework/src/styles/shell.css", "GameCli_framework/src/styles/mobile.css",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/styles/variables.css", "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
  "GameCli_framework/src/app/runtimePageCrossfade.ts", "GameCli_framework/src/store/runtimeStore.ts",
  "scripts/checkpoint-runtime-screen-polish.cjs", "scripts/runtime-screen-polish-playwright.cjs",
  "scripts/runtime-screen-polish-stage-gates.cjs", "scripts/runtime-screen-polish-terminal-check.cjs",
  "scripts/renpy-quick-save-playwright.cjs", "scripts/renpy-menu-playwright.cjs",
  "scripts/renpy-help-playwright.cjs", "scripts/runtime-exit-behavior-playwright.cjs",
  "scripts/runtime-menu-motion-playwright.cjs", "scripts/runtime-agentvn-blackout-playwright.cjs",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(out, { recursive: true });
const entries = files.map(file => {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) return { file, absent: true };
  const dest = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
  if (sha(source) !== sha(dest)) throw Error("Checkpoint bytes differ");
  return { file, sha256: sha(source) };
});
fs.writeFileSync(path.join(out, "tracked.patch"),
  execFileSync("git", ["-c", "core.safecrlf=false", "diff", "--binary", "HEAD"],
    { cwd: root, maxBuffer: 192 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }), { flag: "wx" });
const artifacts = ["AgentVN Dev.exe", "releases/editor/AgentVN_Editor_v1.9.21_20261022_005853.exe"]
  .map(file => ({ file, sha256: sha(path.join(root, file)) }));
fs.writeFileSync(path.join(out, "manifest.json"),
  JSON.stringify({ at: new Date().toISOString(), entries, artifacts, layer: "Runtime", preservedHistory: true }, null, 2),
  { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, files: entries.length }));
