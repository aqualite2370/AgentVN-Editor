"use strict";
// A fresh native Player is required: the checkpoint fix lives in StoryEngine.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const source = path.join(__dirname, "renpy-quick-placement-release.cjs");
const base = "F:/testavn/Sprite-Hide-Rollback-Release-1986-20261117-01";
if (process.argv[2] === "--checkpoint-revision" || process.argv[2] === "--checkpoint-final") {
  const final = process.argv[2] === "--checkpoint-final";
  const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
  const prior = JSON.parse(fs.readFileSync(path.join(base, "checkpoint.json"), "utf8"));
  const sources = prior.sources.map(s => {
    const relative = path.relative(path.resolve(__dirname, ".."), s.path);
    const retained = path.join(base, final ? "source-revision-final" : "source-revision", relative);
    fs.mkdirSync(path.dirname(retained), { recursive: true });
    fs.copyFileSync(s.path, retained, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(s.path), sha(retained));
    return { path: s.path, bytes: fs.statSync(s.path).size, sha256: sha(s.path), retained };
  });
  fs.writeFileSync(path.join(base, final ? "source-revision-final.json" : "source-revision.json"), JSON.stringify({ reason: "Include animation-event exit path before final delivery", sources }, null, 2), { flag: "wx" });
  console.log("Saved final source revision without replacing original checkpoint.");
  return;
}
let text = fs.readFileSync(source, "utf8");
function replace(a, b) { assert.equal(text.split(a).length, 2, "Exact release seam: " + a); text = text.replace(a, b); }
text = text.replaceAll("Editor-Quick-Placement-Release-1981-20261116-01", "Sprite-Hide-Rollback-Release-1986-20261117-01");
text = text.replaceAll("editor-quick-placement-1981", "sprite-hide-rollback-1986");
replace('stage("package-editor-1981",', 'stage("package-editor-1986",');
replace('const version = "1.9.81", previous = "1.9.80";', 'const version = "1.9.86", previous = "1.9.85";');
replace('visit(path.join(root, "releases"));', 'visit(path.join(root, "releases"));\n    visit("D:/AgentVN/releases/editor");');
const begin = text.indexOf("const sources = ["), end = text.indexOf("const git = ", begin);
assert(begin >= 0 && end > begin);
const sources = [
  "GameCli_framework/src/engine/StoryEngine.ts",
  "GameCli_framework/src/engine/spriteStageLayout.ts",
  "editor/src/components/advanced/AnimationEditorPanel.tsx",
  "scripts/sprite-hide-rollback-regression.cjs", "scripts/sprite-hide-rollback-playwright.cjs",
  "scripts/sprite-animation-defaults-playwright.cjs",
];
text = text.slice(0, begin) + `const sources = ${JSON.stringify(sources)};\n` + text.slice(end);
replace('sources.filter(f => !f.startsWith("editor/"))',
  'sources.filter(f => f.startsWith("GameCli_framework/") || f.startsWith("shared/"))');
replace("F:/testavn/Editor-History-Release-1980-20261116-01/release/build.json",
  "F:/testavn/Sprite-Animation-Release-1985-20261116-01/release/build.json");
replace('"Actual installed authoring/export/new Player consumption/old binary rejection still NOT_RUN"',
  '"New native Player hide/rollback/reentry consumption and installed confirmation still NOT_RUN"');
replace('"No new device/upgrade matrix; daily D and frozen 1.9.80 unchanged"',
  '"No Android/upgrade repeats; daily D and frozen1.9.85 unchanged; Runtime capability remains0.32"');
if (process.argv[2] === "--build-remaining") {
  const prior = JSON.parse(fs.readFileSync("F:/testavn/Sprite-Hide-Rollback-Release-1986-20261117-01/build-stages.json", "utf8"));
  assert.equal(prior.status, "FAILED"); assert(prior.stages.slice(0, 2).every(s => s.status === "PASS"));
  assert.equal(prior.stages[2].name, "dev-build");
  assert(fs.readFileSync(prior.stages[2].log.path, "utf8").includes("EPERM"));
  text = text.replaceAll("build-stages.json", "build-stages-02.json");
  text = text.replaceAll('path.join(base, "temp")', 'path.join(base, "temp-02")');
  text = text.replaceAll("dev-build", "dev-build-02");
  replace('await stage("typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix editor run typecheck"]);', "");
  replace('await stage("frontend-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix editor run build"]);', "");
  replace("assert.equal(stages.stages.length, 4);", "assert.equal(stages.stages.length, 2);");
  if (process.argv[2] === "--build-remaining") process.argv[2] = "--build";
}
else if (process.argv[2] === "--build-final" || process.argv[2] === "--seal") {
  assert(fs.existsSync(path.join(base, "build-interruption.json")));
  const revision = JSON.parse(fs.readFileSync(path.join(base, "source-revision-final.json"), "utf8"));
  assert.equal(revision.sources.length, sources.length);
  replace('const checkpoint = read(path.join(base, "checkpoint.json"));',
    'const checkpoint = read(path.join(base, "checkpoint.json"));\n  checkpoint.sources = read(path.join(base, "source-revision-final.json")).sources;');
  text = text.replaceAll("build-stages.json", "build-stages-03.json");
  text = text.replaceAll('path.join(base, "temp")', 'path.join(base, "temp-03")');
  text = text.replaceAll("dev-build", "dev-build-03").replaceAll("frontend-build", "frontend-build-03");
  text = text.replaceAll("package-editor-1986", "package-editor-1986-03");
  text = text.replaceAll("releases/sprite-hide-rollback-1986", "releases/sprite-hide-rollback-1986-final");
  replace('await stage("typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix editor run typecheck"]);', "");
  replace("assert.equal(stages.stages.length, 4);", "assert.equal(stages.stages.length, 3);");
  if (process.argv[2] === "--build-final") process.argv[2] = "--build";
}
const runner = new Module(source, module);
runner.filename = source; runner.paths = Module._nodeModulePaths(path.dirname(source));
runner._compile(text, source);
