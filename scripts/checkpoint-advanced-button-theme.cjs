#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/advanced-button-theme-before-fix", runId);
const files = [
  "shared/cartridge/renpyGui.ts",
  "shared/cartridge/uiLayoutProfiles.ts",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "GameCli_framework/src/components/shell/renpy-title.css",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/components/player/RenpyQuickBar.tsx",
  "GameCli_framework/src/components/player/renpy-quick-bar.css",
  "editor/src/components/advanced/RuntimeLayoutTypeControls.tsx",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RenpyRuntimePreview.tsx",
  "editor/src/components/advanced/RenpyGuiImportWorkbench.tsx",
  "scripts/renpy-button-frame-playwright.cjs",
  "scripts/runtime-layout-profiles-playwright.cjs",
  "scripts/client-layout-editing-regression-playwright.cjs",
  "plans/renpy-layout-implementation-progress.md",
];

fs.mkdirSync(output, { recursive: true });
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const entries = files.map((relative) => {
  const source = path.join(root, relative);
  const target = path.join(output, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: sha256(source) };
});
const artifactFiles = [
  "AgentVN Dev.exe",
  "GameCli_framework/src-tauri/target/release/agentvn-player.exe",
  "releases/player-shell/AgentVN Player.exe",
  "editor/src-tauri/binaries/agentvn-player.exe",
];
const artifacts = artifactFiles.map((relative) => {
  const source = path.join(root, relative);
  const target = path.join(output, "artifacts", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, bytes: fs.statSync(source).size, sha256: sha256(source) };
});
const directoryArtifacts = [
  "editor/src-tauri/bundle-workspace",
  "editor/dist",
  "GameCli_framework/dist",
].map((relative) => {
  const source = path.join(root, relative);
  const target = path.join(output, "artifacts", relative);
  if (!fs.statSync(source).isDirectory()) throw new Error(`Expected artifact directory: ${source}`);
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(fs.statSync(absolute).size);
    }
  };
  visit(target);
  return {
    path: relative,
    fileCount: files.length,
    totalBytes: files.reduce((total, bytes) => total + bytes, 0),
  };
});
for (const [name, args] of [
  ["status.txt", ["status", "--short"]],
  ["tracked.patch", ["diff", "--binary", "HEAD"]],
]) {
  fs.writeFileSync(path.join(output, name), execFileSync("git", args, {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  }));
}
const manifest = {
  runId,
  scope: "advanced-button-theme-slice-and-full-tracked-user-diff",
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  files: entries,
  artifacts,
  directoryArtifacts,
  dev: { path: "AgentVN Dev.exe", sha256: sha256(path.join(root, "AgentVN Dev.exe")) },
  note: "Source copies, build artifact snapshots, and full tracked diff; no reset, commit, cleanup, or report overwrite.",
};
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(path.join(output, "manifest.json"));
