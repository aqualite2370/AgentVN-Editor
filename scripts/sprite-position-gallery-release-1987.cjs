"use strict";
// One fresh native Player delivers both verified Runtime fixes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const source = path.join(__dirname, "renpy-quick-placement-release.cjs");
const base = "F:/testavn/Sprite-Position-Gallery-Release-1987-20261117-01";
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
if (process.argv[2] === "--checkpoint-final") {
  const before = JSON.parse(fs.readFileSync(path.join(base, "checkpoint.json"), "utf8"));
  const sources = before.sources.map(s => {
    const retained = path.join(base, "final-source", path.relative(path.resolve(__dirname, ".."), s.path));
    fs.mkdirSync(path.dirname(retained), { recursive: true });
    fs.copyFileSync(s.path, retained, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(s.path), sha(retained));
    return { path: s.path, bytes: fs.statSync(s.path).size, sha256: sha(s.path), retained };
  });
  fs.writeFileSync(path.join(base, "final-source.json"), JSON.stringify({
    reason: "Preserve final test-harness fixture/settled-viewer corrections separately from original checkpoint", sources,
  }, null, 2), { flag: "wx" });
  console.log("Final source checkpoint saved; original evidence preserved.");
  return;
}
let text = fs.readFileSync(source, "utf8");
function replace(a, b) { assert.equal(text.split(a).length, 2, "Exact release seam: " + a); text = text.replace(a, b); }
text = text.replaceAll("Editor-Quick-Placement-Release-1981-20261116-01", "Sprite-Position-Gallery-Release-1987-20261117-01");
text = text.replaceAll("editor-quick-placement-1981", "sprite-position-gallery-1987");
replace('stage("package-editor-1981",', 'stage("package-editor-1987",');
replace('const version = "1.9.81", previous = "1.9.80";', 'const version = "1.9.87", previous = "1.9.86";');
replace('visit(path.join(root, "releases"));', 'visit(path.join(root, "releases"));\n    visit("D:/AgentVN/releases/editor");');
const begin = text.indexOf("const sources = ["), end = text.indexOf("const git = ", begin);
assert(begin >= 0 && end > begin);
const sources = [
  "GameCli_framework/src/engine/spriteStageLayout.ts",
  "GameCli_framework/src/components/player/SpriteLayer.tsx",
  "GameCli_framework/src/engine/savePreview.ts",
  "GameCli_framework/src/engine/galleryAnchorManager.ts",
  "GameCli_framework/src/store/runtimeStore.ts",
  "scripts/sprite-position-stability-test.cjs", "scripts/sprite-stage-layout-test.mjs",
  "scripts/sprite-position-stability-playwright.cjs", "scripts/gallery-preview-restart-playwright.cjs",
  "scripts/gallery-restart-persistence-test.cjs", "docs/ASSISTANT_USER_GUIDE.md",
  "editor/src/assistant/agentvnDocIndex.generated.ts",
];
text = text.slice(0, begin) + `const sources = ${JSON.stringify(sources)};\n` + text.slice(end);
replace('sources.filter(f => !f.startsWith("editor/"))',
  'sources.filter(f => f.startsWith("GameCli_framework/") || f.startsWith("shared/"))');
replace("F:/testavn/Editor-History-Release-1980-20261116-01/release/build.json",
  "F:/testavn/Sprite-Hide-Rollback-Release-1986-20261117-01/release/build.json");
replace('"Actual installed authoring/export/new Player consumption/old binary rejection still NOT_RUN"',
  '"Native Player position stability/external preview gallery restart/fixed cartridge consumption NOT_RUN"');
replace('"No new device/upgrade matrix; daily D and frozen 1.9.80 unchanged"',
  '"No Android/upgrade repeats; daily D and frozen1.9.86 unchanged; Runtime protocol remains0.32"');
if (process.argv[2] !== "--checkpoint") {
  replace('const checkpoint = read(path.join(base, "checkpoint.json"));',
    'const checkpoint = read(path.join(base, "checkpoint.json"));\n  checkpoint.sources = read(path.join(base, "final-source.json")).sources;');
}
const runner = new Module(source, module);
runner.filename = source; runner.paths = Module._nodeModulePaths(path.dirname(source));
runner._compile(text, source);
