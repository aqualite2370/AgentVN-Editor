"use strict";
// One candidate for preview gallery options and sound-effect stop/fade.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const source = path.join(__dirname, "renpy-quick-placement-release.cjs");
const followup = process.argv[2] === "--seal-followup";
if (followup) process.argv[2] = "--seal";
let text = fs.readFileSync(source, "utf8");
function replace(a, b) { assert.equal(text.split(a).length, 2, "Exact release seam: " + a); text = text.replace(a, b); }
text = text.replaceAll("Editor-Quick-Placement-Release-1981-20261116-01", "Preview-Sfx-Release-1989-20261117-01")
  .replaceAll("editor-quick-placement-1981", "preview-sfx-1989")
  .replaceAll('stage("package-editor-1981",', 'stage("package-editor-1989",')
  .replaceAll("0.32.0", "0.33.0").replaceAll("0\\.32\\.0", "0\\.33\\.0")
  .replaceAll("RUNTIME032", "RUNTIME033");
replace('const version = "1.9.81", previous = "1.9.80";', 'const version = "1.9.89", previous = "1.9.88";');
replace("F:/testavn/Editor-History-Release-1980-20261116-01/release/build.json",
  "F:/testavn/Gallery-Preview-Open-Release-1988-20261117-01/release/build.json");
replace('visit(path.join(root, "releases"));', 'visit(path.join(root, "releases"));\n    visit("D:/AgentVN/releases/editor");');
const begin = text.indexOf("const sources = ["), end = text.indexOf("const git = ", begin);
assert(begin >= 0 && end > begin);
const sources = [
  "shared/preview/livePreviewProtocol.ts",
  "shared/cartridge/types.ts", "shared/cartridge/constants.ts", "shared/cartridge/runtimeCapabilities.ts",
  "shared/cartridge/assetScanner.ts", "shared/cartridge/validators.ts",
  "editor/src/components/advanced/PreviewWindowControls.tsx", "editor/src/components/editor/PreviewPanel.tsx",
  "editor/src/components/command-editors/SfxCommandEditor.tsx", "editor/src/styles/editor-preview.css",
  "editor/src/preview/previewWindow.ts", "editor/src/types/commands.ts", "editor/src-tauri/src/main.rs",
  "editor/src/utils/editorAssetReferences.ts", "editor/src/utils/generationContext.ts",
  "editor/src/utils/commandTools.ts", "editor/src/utils/commandPreview.ts", "editor/src/utils/assetAudit.ts",
  "editor/src/novel-import/structureValidator.ts",
  "GameCli_framework/src/app/App.tsx", "GameCli_framework/src/app/launchConfig.ts",
  "GameCli_framework/src-tauri/src/lib.rs", "GameCli_framework/src/store/runtimeStore.ts",
  "GameCli_framework/src/engine/galleryAnchorManager.ts", "GameCli_framework/src/engine/StoryEngine.ts",
  "GameCli_framework/src/engine/validation.ts", "GameCli_framework/src/types/commands.ts",
  "GameCli_framework/src/types/settings.ts", "GameCli_framework/src/components/player/RuntimeAudio.tsx",
  "GameCli_framework/src/components/player/sfxAudioController.ts",
  "backend/app/models/commands.py", "backend/app/ai/structured_normalization.py",
  "backend/tests/test_sfx_stop_fade.py", "scripts/sfx-stop-fade-test.cjs", "scripts/sfx-stop-fade-playwright.cjs",
  "scripts/gallery-preview-options-test.cjs", "scripts/gallery-preview-options-playwright.cjs",
  "docs/ASSISTANT_USER_GUIDE.md", "editor/src/assistant/agentvnDocIndex.generated.ts",
];
text = text.slice(0, begin) + `const sources = ${JSON.stringify(sources)};\n` + text.slice(end);
replace('sources.filter(f => !f.startsWith("editor/"))',
  'sources.filter(f => f.startsWith("GameCli_framework/") || f.startsWith("shared/"))');
if (followup) {
  const base = "F:/testavn/Preview-Sfx-Release-1989-20261117-01";
  const payload = path.join(base, "release/payload/installer-resource-report.json");
  assert.equal(JSON.parse(fs.readFileSync(payload, "utf8")).status, "PASS");
  assert(!fs.existsSync(path.join(base, "release/build.json")));
  const failure = path.join(base, "seal-failed-01.json");
  assert(!fs.existsSync(failure));
  fs.writeFileSync(failure, JSON.stringify({
    status: "FAILED", stage: "seal-bundled-source-check",
    error: "QA expected backend Python sources inside bundle-workspace; backend is distributed as a PyInstaller executable.",
    payloadReport: { path: payload, sha256: require("./lib/file-sha256-bounded.cjs").hashFileSha256(payload) },
    recovery: "Reuse the same successful build and payload audit; check GameCLI/shared bundled sources and installed backend separately.",
    at: new Date().toISOString(), rebuilds: 0,
  }, null, 2), { flag: "wx" });
  replace('const out = path.join(base, "release"); assert(!fs.existsSync(out));',
    'const out = path.join(base, "release"); assert(fs.existsSync(out));');
  replace('fs.mkdirSync(installerDir, { recursive: true });', 'assert(fs.existsSync(installerDir));');
  replace('fs.copyFileSync(path.join(sourceDir, names[0]), installer, fs.constants.COPYFILE_EXCL);',
    'assert(fs.existsSync(installer));');
  const start = text.indexOf("  const audit = cp.spawnSync(");
  const finish = text.indexOf('  const bundle = ', start);
  assert(start > 0 && finish > start);
  text = text.slice(0, start) +
    '  const payloadReport = path.join(out, "payload/installer-resource-report.json");\n' +
    '  assert.equal(read(payloadReport).status, "PASS");\n' + text.slice(finish);
}
replace('"Actual installed authoring/export/new Player consumption/old binary rejection still NOT_RUN"',
  '"Native gallery option/stop-fade consumption/old binary rejection NOT_RUN"');
replace('"No new device/upgrade matrix; daily D and frozen 1.9.80 unchanged"',
  '"No Android/upgrade repeats; daily D and frozen1.9.88 unchanged; new Runtime0.33"');
const runner = new Module(source, module);
runner.filename = source; runner.paths = Module._nodeModulePaths(path.dirname(source)); runner._compile(text, source);
