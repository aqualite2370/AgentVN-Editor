"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/renpy-save-grid-baseline-before-fix", runId);
const files = [
  "shared/cartridge/renpyGui.ts", "shared/cartridge/constants.ts",
  "shared/cartridge/runtimeCapabilities.ts",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "scripts/renpy-title-stage-gates.cjs", "scripts/renpy-layout-runtime-test.cjs",
  "scripts/runtime-layout-profiles-playwright.cjs", "scripts/renpy-save-grid-baseline-playwright.cjs",
  "plans/renpy-layout-implementation-progress.md", "plans/ui-motion-implementation-progress.md",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(output, { recursive: true });
const entries = files.map(relative => {
  const source = path.join(root, relative), target = path.join(output, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: sha(source) };
});
for (const [name, args] of [["status.txt", ["status", "--short"]], ["tracked.patch", ["diff", "--binary", "HEAD"]]]) {
  fs.writeFileSync(path.join(output, name), execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
}
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  runId, scope: "legacy-renpy-save-grid-preservation", files: entries,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dev: { path: "AgentVN Dev.exe", sha256: sha(path.join(root, "AgentVN Dev.exe")) },
  note: "No reset, index change, report overwrite, project cleanup or commit.",
}, null, 2));
console.log(path.join(output, "manifest.json"));
