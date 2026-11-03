"use strict";
// Preserve the first diagnostic and sample the title's actual separate
// material layer. No product changes or relaxed paint-color comparison.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "candidate-1924-rendered-style.cjs");
assert.equal(sha(previous), "35ce872a15a2667752f9c9b01b447567385c5bd913b68bc4006a7428250fe9d9");
let source = fs.readFileSync(previous, "utf8");
const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('    const nodes = roots.flatMap(root => [root, ...root.querySelectorAll(\'[data-ui-opacity-layer="background"]\')]);',
`    const nodes = roots.flatMap(root => [root, ...root.querySelectorAll('[data-ui-opacity-layer="background"]')]);
    // MainMenu deliberately separates the full-frame hero material from its
    // transparent heading. Match its exact renderer-owned material, never
    // arbitrary descendants or the whole document's colors.
    const titleMaterials = componentId === "title_hero"
      ? [...document.querySelectorAll(".renpy-title-view > .renpy-title-background > .main-menu-title-hero-background")] : [];
    if (componentId === "title_hero" && titleMaterials.length !== 1)
      throw Error("Expected one renderer-owned title hero material, got " + titleMaterials.length);
    nodes.push(...titleMaterials);`);
replace('  assert.equal(report.renderSamples.length, 9);', '  assert.equal(report.renderSamples.length, 9 * displayMatrix.length);');
replace('  sample.type = t; sample.page = entry[0]; sample.corresponds = module.qaColorMatches(sample);',
  '  sample.type = t; sample.page = entry[0]; sample.display = { ...report.paintDisplay }; sample.corresponds = module.qaColorMatches(sample);');
replace('  await host.shot(t + "-paint-" + entry[0]);',
  '  await host.shot(t + "-paint-" + entry[0] + "-" + report.paintDisplay.width + "-dpr" + report.paintDisplay.dpr + "-" + (report.paintDisplay.reduced ? "reduced" : "ordinary"));');
// These strings are in the business source, so add their substitutions before
// its syntax check rather than modifying the historical source file.
replace('new vm.Script(Module.wrap(source), { filename: original });',
  'replace("    await host.metrics(display);", "    await host.metrics(display); report.paintDisplay = { ...display };");\n' +
  'new vm.Script(Module.wrap(source), { filename: original });');
replace('assert.equal(process.argv[3], "51");', 'assert.equal(process.argv[3], "52");');
replace('assert(!process.argv.includes("--matrix"));', 'assert(process.argv.includes("--matrix"));');
replace('assert(!fs.existsSync("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-51"));',
  'assert(!fs.existsSync("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-52"));');
// The previous tool archives the fully transformed executed business. Keep
// the outer transformation recipe too so both layers can be replayed.
replace('worker.qaSource = source; worker.qaChanges = changes; worker.qaColorMatches = colorMatches;',
  'worker.qaSource = source; worker.qaChanges = [...module.qaOuterChanges, ...changes]; worker.qaColorMatches = colorMatches;');
new vm.Script(Module.wrap(source), { filename: __filename });
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker.qaOuterChanges = changes.map(c => ({ ...c, stage: "CURRENT_TITLE_MATERIAL_AND_FULL_DISPLAY_MATRIX" }));
worker._compile(source, __filename);
