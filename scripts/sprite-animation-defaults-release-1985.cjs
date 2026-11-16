"use strict";
// One Editor-only delivery from the verified worktree. D's separate release is read-only.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const source = path.join(__dirname, "renpy-quick-placement-release.cjs");
let text = fs.readFileSync(source, "utf8");
function replace(a, b) { assert.equal(text.split(a).length, 2, "Exact release seam: " + a); text = text.replace(a, b); }
text = text.replaceAll("Editor-Quick-Placement-Release-1981-20261116-01", "Sprite-Animation-Release-1985-20261116-01");
text = text.replaceAll("editor-quick-placement-1981", "sprite-animation-1985");
replace('stage("package-editor-1981",', 'stage("package-editor-1985",');
replace('const version = "1.9.81", previous = "1.9.80";', 'const version = "1.9.85", previous = "1.9.84";');
replace('visit(path.join(root, "releases"));', 'visit(path.join(root, "releases"));\n    visit("D:/AgentVN/releases/editor");');
replace('assert.equal(read(path.join(root, versions[0])).version, previous);',
  'assert.equal(read(path.join(root, versions[0])).version, "1.9.83");');
const begin = text.indexOf("const sources = ["), end = text.indexOf("const git = ", begin);
assert(begin >= 0 && end > begin);
const sources = [
  "GameCli_framework/src/engine/spriteStageLayout.ts", "GameCli_framework/src/styles/player.css",
  "editor/src/utils/spriteAnimationDefaults.ts", "editor/src/types/project.ts", "editor/src/types/commands.ts",
  "editor/src/store/projectStore.ts", "editor/src/utils/commandTools.ts", "editor/src/utils/exportScript.ts",
  "editor/src/components/command-editors/SpriteCommandEditor.tsx",
  "editor/src/components/command-editors/FloatingCommandWorkbench.tsx",
  "editor/src/components/advanced/AnimationEditorPanel.tsx", "editor/src/components/advanced/AdvancedToolsPanel.tsx",
  "editor/src/styles/layout.css", "editor/src/components/common/hoverHelpCatalog.ts",
  "editor/src/assistant/agentvnDocIndex.generated.ts", "docs/ANIMATION_SYSTEM.md",
  "scripts/sprite-animation-defaults-test.cjs", "scripts/sprite-animation-defaults-playwright.cjs",
  "scripts/sprite-source-provenance-audit.cjs",
];
text = text.slice(0, begin) + `const sources = ${JSON.stringify(sources)};\n` + text.slice(end);
replace('sources.filter(f => !f.startsWith("editor/"))',
  'sources.filter(f => f.startsWith("GameCli_framework/") || f.startsWith("shared/"))');
replace("F:/testavn/Editor-History-Release-1980-20261116-01/release/build.json",
  "F:/testavn/Editor-Save-Guard-Release-1983-20261116-01/release/build.json");
replace('"-File", path.join(root, "scripts/build-dev-launcher.ps1")]);',
  '"-File", path.join(root, "scripts/build-dev-launcher.ps1"), "-SkipGameCliPlayer"]);');
replace("stages.nativePlayerBuilds = 1; save();", "stages.nativePlayerBuilds = 0; save();");
replace('assert.notEqual(sha(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")), checkpoint.frozen.player.sha256);',
  'assert.equal(sha(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")), checkpoint.frozen.player.sha256);');
replace('checkpoint: desc(path.join(base, "checkpoint.json")), nativePlayerBuilds: 1,',
  'checkpoint: desc(path.join(base, "checkpoint.json")), nativePlayerBuilds: 0,');
replace('"Actual installed authoring/export/new Player consumption/old binary rejection still NOT_RUN"',
  '"Installed global sprite entry/exit save/restart, normal UI export and native consumption still NOT_RUN"');
replace('"No new device/upgrade matrix; daily D and frozen 1.9.80 unchanged"',
  '"Verified corrected Runtime0.32 reused; no Android or upgrade repeats; D daily and separate1.9.84 untouched"');
const runner = new Module(source, module);
runner.filename = source; runner.paths = Module._nodeModulePaths(path.dirname(source));
runner._compile(text, source);
