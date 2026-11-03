"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/e2-preview-motion-before", runId);
const files = ["plans/ACTIVE_TASKS.md", "plans/E2_PREVIEW_DEVICE_MOTION_ACCEPTANCE_20261010.md",
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RenpyRuntimePreview.tsx",
  "editor/src/components/advanced/RenpyPreviewStage.tsx",
  "editor/src/components/advanced/renpy-runtime-preview.css",
  "scripts/editor-renpy-preview-motion-playwright.cjs",
  "scripts/editor-e2-final-gates.cjs", "scripts/editor-workspace-native-motion-playwright.cjs"];
fs.mkdirSync(output, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const entries = files.map(file => {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) return { file, exists: false };
  const dest = path.join(output, "files", file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
  return { file, sha256: sha(source) };
});
for (const [name, args] of [["tracked.patch", ["diff", "--binary", "HEAD"]],
  ["staged.patch", ["diff", "--cached", "--binary"]]]) {
  fs.writeFileSync(path.join(output, name), execFileSync("git", args, {
    cwd: root, maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
}
fs.copyFileSync(path.join(root, "AgentVN Dev.exe"), path.join(output, "AgentVN Dev-before-preview-motion.exe"),
  fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ runId,
  scope: "Editor E2 device preview morph and shared title editor measurement; Runtime default retained", files: entries,
  dev: { sha256: sha(path.join(root, "AgentVN Dev.exe")) } }, null, 2));
console.log(output);
