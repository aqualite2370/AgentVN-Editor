"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/renpy-gui-import-before-fix", runId);
const files = [
  "shared/cartridge/renpyGui.ts",
  "shared/cartridge/constants.ts",
  "shared/cartridge/runtimeCapabilities.ts",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/components/shell/renpy-title.css",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/components/player/ChoicePanel.tsx",
  "GameCli_framework/src/styles/player.css",
  "docs/VERSION_COMPATIBILITY.md",
  "editor/src/renpy/renpyGuiImport.ts",
  "editor/src/renpy/renpyGuiImportPlan.ts",
  "editor/src-tauri/src/main.rs",
  "editor/src-tauri/src/renpy_gui_import.rs",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RenpyGuiImportWorkbench.tsx",
  "editor/src/components/advanced/renpy-title-editor.css",
  "editor/src/utils/projectAssets.ts",
  "editor/src/utils/projectBundle.ts",
  "editor/src/types/assets.ts",
  "editor/src/store/projectStore.ts",
  "scripts/renpy-layout-runtime-test.cjs",
  "scripts/renpy-gui-import-contract-test.cjs",
  "scripts/renpy-gui-archive-scan-test.cjs",
  "scripts/renpy-gui-import-apply-test.cjs",
  "scripts/renpy-gui-import-roundtrip-test.cjs",
  "scripts/renpy-button-frame-playwright.cjs",
  "scripts/runtime-layout-profiles-playwright.cjs",
  "scripts/checkpoint-renpy-gui-import.cjs",
  "plans/renpy-layout-implementation-progress.md",
  "plans/ui-motion-implementation-progress.md",
];
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(output, { recursive: true });
const entries = files.map((relative) => {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) return { path: relative, exists: false };
  const target = path.join(output, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, exists: true, sha256: sha(source) };
});
for (const [name, args] of [
  ["status.txt", ["status", "--short"]],
  ["tracked.patch", ["diff", "--binary", "HEAD"]],
  ["staged.patch", ["diff", "--cached", "--binary"]],
]) {
  fs.writeFileSync(path.join(output, name), execFileSync("git", args, {
    cwd: root, maxBuffer: 128 * 1024 * 1024,
  }));
}
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const devPath = path.join(root, "AgentVN Dev.exe");
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  runId,
  scope: "renpy-gui-static-import-tracer-slice",
  head,
  files: entries,
  dev: fs.existsSync(devPath) ? { path: "AgentVN Dev.exe", sha256: sha(devPath) } : null,
  note: "Preserves selected tracked and untracked files plus the full tracked/index patch. No reset, cleanup, overwrite, or commit.",
}, null, 2));
console.log(path.join(output, "manifest.json"));
