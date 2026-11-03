"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/checkpoints/runtime-r2", new Date().toISOString().replace(/[:.]/g, "-"));
const files = ["shared/cartridge/quickMenuMetrics.ts", "shared/cartridge/quickMenuDefaults.ts",
  "shared/cartridge/uiSkin.ts", "shared/cartridge/dialogText.ts",
  "GameCli_framework/src/components/player/PlaybackControls.tsx", "GameCli_framework/src/components/player/DialogBox.tsx",
  "GameCli_framework/src/styles/quick-menu-contract.css", "GameCli_framework/src/uiSkin/runtimeViewport.ts",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx", "editor/src/styles/quick-menu-preview.css",
  "scripts/quick-menu-metrics-contract.cjs", "scripts/android-apk-runtime-qa.cjs",
  "scripts/start-android-acceptance.ps1", "plans/ACTIVE_TASKS.md"];
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
fs.mkdirSync(output, { recursive: true });
const entries = files.map(file => {
  const src = path.join(root, file), dst = path.join(output, "files", file);
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  return { file, sha256: sha(src) };
});
fs.writeFileSync(path.join(output, "tracked.patch"), execFileSync("git", ["diff", "--binary", "HEAD"], {
  cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 96 * 1024 * 1024 }));
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ files: entries,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  artifacts: ["AgentVN Dev.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe"]
    .map(file => ({ file, sha256: sha(path.join(root, file)), modifiedAt: fs.statSync(path.join(root, file)).mtime.toISOString() })) }, null, 2));
console.log(output);
