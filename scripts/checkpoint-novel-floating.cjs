"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/novel-floating-before-fix", runId);
fs.mkdirSync(output, { recursive: true });
const files = [
  "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx",
  "editor/src/components/novel-import/NovelTaskCard.tsx",
  "editor/src/components/novel-import/useNovelTaskModalPriority.ts",
  "editor/src/components/novel-import/novel-task-floating.css",
  "editor/src/store/novelImportStore.ts", "editor/src/store/projectStore.ts",
  "editor/src/app/App.tsx", "editor/src/components/workspace/workspaceContracts.ts",
  "editor/src/novel-import/novelProcessJobAdapter.ts", "editor/src/api/backendClient.ts",
  "editor/src/styles/layout.css",
  "scripts/novel-task-floating-playwright.cjs", "scripts/editor-ui-motion-stage-gates.cjs",
  "scripts/novel-task-poll-error-playwright.cjs", "scripts/novel-task-job-switch-playwright.cjs",
  "scripts/novel-task-result-notice-playwright.cjs",
  "scripts/novel-task-local-ownership-playwright.cjs",
  "scripts/novel-task-card-visual-playwright.cjs",
  "scripts/advanced-tools-transition-regression-playwright.cjs",
  "scripts/lib/preview-cancellation-evidence.cjs",
  "scripts/preview-cancellation-evidence-test.cjs",
  "scripts/checkpoint-novel-floating.cjs",
  "scripts/novel-import-append-graph-contract-test.cjs",
  "scripts/novel-import-chapter-idempotence-playwright.cjs",
  "plans/ui-motion-implementation-progress.md",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const entries = files.map(relative => {
  const source = path.join(root, relative), target = path.join(output, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: sha(source) };
});
for (const [name, args] of [
  ["status.txt", ["status", "--short"]],
  ["tracked.patch", ["diff", "--binary", "HEAD"]],
]) fs.writeFileSync(path.join(output, name), execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
const manifest = { runId, scope: "second-slice-touched-files-and-full-tracked-diff",
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  files: entries, dev: { path: "AgentVN Dev.exe", sha256: sha(path.join(root, "AgentVN Dev.exe")) },
  note: "Existing files including untracked implementation files copied byte-for-byte; no reset, commit or cleanup." };
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(path.join(output, "manifest.json"));
