"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/nvl-stage-before-fix", runId);
const files = [
  "GameCli_framework/src/components/player/DialogBox.tsx",
  "GameCli_framework/src/components/player/StoryPlayer.tsx",
  "GameCli_framework/src/engine/StoryEngine.ts",
  "GameCli_framework/src/styles/player.css",
  "GameCli_framework/src/types/save.ts",
  "GameCli_framework/src/types/settings.ts",
  "GameCli_framework/src/types/commands.ts",
  "shared/cartridge/types.ts",
  "shared/cartridge/constants.ts",
  "shared/cartridge/runtimeCapabilities.ts",
  "shared/cartridge/validators.ts",
  "shared/cartridge/uiSkin.ts",
  "shared/cartridge/renpyGui.ts",
  "editor/src/types/commands.ts",
  "editor/src/components/command-editors/DialogCommandEditor.tsx",
  "editor/src/components/command-editors/NarrationCommandEditor.tsx",
  "editor/src/components/common/hoverHelpCatalog.ts",
  "editor/src/utils/fieldTranslations.ts",
  "editor/src/styles/layout.css",
  "editor/src/renpy/renpyGuiImport.ts",
  "editor/src/renpy/renpyGuiImportPlan.ts",
  "scripts/nvl-page-playwright.cjs",
  "scripts/nvl-runtime-acceptance.cjs",
  "scripts/nvl-authoring-playwright.cjs",
  "plans/renpy-layout-implementation-progress.md",
];
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

fs.mkdirSync(output, { recursive: true });
const entries = files.map((relative) => {
  const source = path.join(root, relative);
  const target = path.join(output, "files", relative);
  if (!fs.statSync(source).isFile()) throw new Error(`Checkpoint source is not a file: ${relative}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: hash(source) };
});
const devPath = path.join(root, "AgentVN Dev.exe");
const manifest = {
  runId,
  scope: "renpy-nvl-stage-preservation",
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  dev: fs.existsSync(devPath) ? { path: "AgentVN Dev.exe", sha256: hash(devPath) } : null,
  files: entries,
  note: "Recoverable copies of the current NVL implementation before stage-level redesign. No reset, cleanup, index change, build, or report overwrite.",
};
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
fs.writeFileSync(path.join(output, "status.txt"), execFileSync("git", ["status", "--short"], { cwd: root }), { flag: "wx" });
console.log(path.join(output, "manifest.json"));
