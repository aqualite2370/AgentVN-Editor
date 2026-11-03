"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const checkpointName = process.argv[2] || "Editor-Sibling-Motion-20261022-01";
if (!/^Editor-Sibling-Motion-\d{8}-\d{2}$/.test(checkpointName)) throw Error("Invalid checkpoint name");
const out = path.join("F:/AgentVN/Checkpoints", checkpointName);
if (fs.existsSync(out)) throw Error("Fresh checkpoint required");
fs.mkdirSync(out, { recursive: true });
const files = ["AGENTS.md", "plans/ACTIVE_TASKS.md",
  "editor/src/components/advanced/AdvancedToolsPanel.tsx", "editor/src/components/common/GlassSelectionGroup.tsx",
  "editor/src/components/editor/EditorToolbar.tsx", "editor/src/utils/editorTransitionPresentation.ts",
  "editor/src/styles/variables.css", "editor/src/styles/editor-topbar.css", "editor/src/styles/layout.css",
  "scripts/editor-selection-mask-motion-playwright.cjs", "scripts/editor-sibling-tabs-motion-playwright.cjs",
  "scripts/editor-sibling-navigation-safety-playwright.cjs", "scripts/lib/editor-sibling-motion-probe.cjs",
  "scripts/editor-sibling-motion-stage-gates.cjs", "scripts/editor-sibling-motion-terminal-check.cjs",
  "scripts/editor-browser-renderer-probe.cjs", "scripts/editor-transition-presentation-test.cjs",
  "scripts/editor-options-motion-playwright.cjs", "scripts/advanced-tools-transition-regression-playwright.cjs",
  "scripts/checkpoint-editor-sibling-motion.cjs"];
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const entries = files.map(p => {
  const from = path.join(root, p), to = path.join(out, "files", p);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  if (sha(from) !== sha(to)) throw Error("Checkpoint byte mismatch");
  return { path: p, sha256: sha(from) };
});
fs.writeFileSync(path.join(out, "tracked.patch"), execFileSync("git", ["diff", "--binary", "HEAD"],
  { cwd: root, maxBuffer: 192 * 1024 * 1024 }), { flag: "wx" });
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ at: new Date().toISOString(), entries,
  layer: "Editor", scope: "Sibling content crossfade and options-button hover only",
  dev: { path: path.join(root, "AgentVN Dev.exe"), sha256: sha(path.join(root, "AgentVN Dev.exe")) },
  oldCandidatesPreserved: true }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, files: entries.length }));
