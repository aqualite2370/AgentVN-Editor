"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = "F:/AgentVN/Checkpoints/Editor-Selection-Mask-20261019-01";
assertFresh();
function assertFresh() {
  if (fs.existsSync(output)) throw new Error(`Checkpoint already exists: ${output}`);
}
const files = [
  "AGENTS.md", "plans/ACTIVE_TASKS.md",
  "editor/src/components/common/GlassSelectionGroup.tsx",
  "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/components/advanced/AdvancedToolsPanel.tsx",
  "editor/src/utils/editorTransitionPresentation.ts",
  "editor/src/styles/variables.css", "editor/src/styles/editor-topbar.css",
  "editor/src/styles/editor-shell.css", "editor/src/styles/layout.css",
  "editor/src/app/App.css", "editor/src/app/App.tsx",
  "scripts/glass-selection-group-contract.cjs",
  "scripts/editor-options-motion-playwright.cjs",
  "scripts/editor-selection-mask-motion-playwright.cjs",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(output, { recursive: false });
const entries = files.map(file => {
  const source = path.join(root, file);
  const destination = path.join(output, "files", file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  const digest = sha(source);
  if (sha(destination) !== digest) throw new Error(`Checkpoint hash mismatch: ${file}`);
  return { file, sha256: digest };
});
fs.writeFileSync(path.join(output, "tracked.patch"), execFileSync("git", ["diff", "--binary", "HEAD"], {
  cwd: root, maxBuffer: 128 * 1024 * 1024,
}));
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  at: new Date().toISOString(), scope: "Editor selection mask and category-specific motion speed only",
  entries, dev: { path: path.join(root, "AgentVN Dev.exe"), sha256: sha(path.join(root, "AgentVN Dev.exe")) },
  candidate: { path: "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor",
    untouched: true }, binaryCopied: false,
}, null, 2));
console.log(JSON.stringify({ status: "PASS", output, files: entries.length }));
