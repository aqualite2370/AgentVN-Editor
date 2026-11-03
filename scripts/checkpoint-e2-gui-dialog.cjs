"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/e2-gui-dialog-before", runId);
const files = ["AGENTS.md", "plans/ACTIVE_TASKS.md",
  "editor/src/components/advanced/RenpyGuiImportWorkbench.tsx",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/useGuiImportDialog.ts",
  "editor/src/components/advanced/renpy-title-editor.css",
  "editor/src/components/common/RichSelect.tsx",
  "scripts/editor-e2-final-gates.cjs",
  "scripts/editor-gui-import-dialog-playwright.cjs"];
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
for (const [name, args] of [["status.txt", ["status", "--short"]],
  ["tracked.patch", ["diff", "--binary", "HEAD"]],
  ["staged.patch", ["diff", "--cached", "--binary"]]]) {
  fs.writeFileSync(path.join(output, name), execFileSync("git", args, { cwd: root, maxBuffer: 128 * 1024 * 1024 }));
}
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ runId,
  scope: "Editor E2 GUI import presentation only; no Runtime changes", files: entries,
  dev: { sha256: sha(path.join(root, "AgentVN Dev.exe")) },
  note: "Selected tracked/untracked files plus tracked/index patches; no reset, cleanup or commit." }, null, 2));
console.log(output);
