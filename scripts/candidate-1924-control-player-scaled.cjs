"use strict";
// Preserve the failed unscaled CSS-pixel assumption; use the installed renderer
// contract (1280x720 author coordinates) for this new, separate receipt.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "candidate-1924-control-player.cjs");
assert.equal(sha(previous), "c19c7a64aa79fea167656b5fca2aa04fa0acfc1188c6b59ce6600742e64ceb88");
const install = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installed-editor";
const rendererFiles = ["src/uiSkin/PresentedControl.tsx", "src/components/shell/RenpyTitleView.tsx"];
for (const f of rendererFiles) assert.equal(sha(path.join(install, "GameCli_framework", f)),
  sha(path.join(__dirname, "../GameCli_framework", f)));
let source = fs.readFileSync(previous, "utf8"); const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('assert.equal(process.argv[2], "01");', 'assert.equal(process.argv[2], "02");');
replace('control-code-installed-1924-01";', 'control-code-installed-1924-02";');
replace('assert.equal(actual.radius, "6px");',
  'assert.equal(actual.radius, `${6 * Math.min(viewport.width / 1280, viewport.height / 720)}px`);');
// Save raw observations before assertions, so a future failure has its exact
// rendered state even when the awaited probe never returns to its caller.
replace('  assert.equal(actual.tag, "BUTTON");',
  '  (report.rawControlSamples ??= []).push({ id, viewport, actual }); save();\n  assert.equal(actual.tag, "BUTTON");');
replace('report.tool = desc(__filename); save();',
  'report.tool = desc(__filename); report.rendererSources = module.qaRendererFiles.map(desc); save();');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  for (const width of [1920, 2560, 3840]) {
    const scaled = `${6 * Math.min(width / 1280, (width * 9 / 16) / 720)}px`;
    assert.notEqual(scaled, "6px");
    assert.equal(scaled, ({ 1920: "9px", 2560: "12px", 3840: "18px" })[width]);
  }
  assert(source.includes('assert.equal(actual.color, expectedColor)'));
  assert(source.includes('assert.equal(actual.images[0].sha256, source.cartridge.image.sha256)'));
  console.log(JSON.stringify({ status: "PASS", changes: changes.length, scope: "QA_RENDERER_SCALE_AND_ORIGINAL_ASSERTIONS" }));
} else {
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaRendererFiles = rendererFiles.map(f => path.join(install, "GameCli_framework", f));
  worker._compile(source, __filename);
}
