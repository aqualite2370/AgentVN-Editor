"use strict";
// QA-only probe of actual installed Runtime paint styles. The previous author
// matrix supplies a clearly labelled fixture; this does not repeat authorship.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "installed-layout-pages-current.cjs");
const installation = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const authorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-50/report.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const author = read(authorFile), installed = read(installation);
assert.equal(author.status, "PASS"); assert.equal(installed.status, "PASS");
assert.equal(installed.metadataRestoration, "PASS"); assert.equal(installed.executable.version, "1.9.24");
assert.equal(sha(original), "9dc888ddf8288cb2413a32b510d904c2ea89617c4c09998de3a507467885d099");
for (const f of [installed.executable, ...installed.resources, ...installed.protectedFiles])
  assert.equal(sha(f.path), f.sha256, f.path);
const changes = [];
let source = fs.readFileSync(original, "utf8");
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
function colorMatches(sample) {
  const hex = sample.expected.toLowerCase();
  assert.match(hex, /^#[a-f\d]{6}$/);
  const rgb = [1, 3, 5].map(n => parseInt(hex.slice(n, n + 2), 16));
  return sample.layers.some(layer => {
    const values = layer.backgroundColor.match(/[\d.]+/g)?.map(Number);
    return layer.visible && layer.opacity > 0 && values?.length >= 3
      && values.slice(0, 3).every((n, i) => n === rgb[i])
      && (values.length === 3 || values[3] > 0);
  });
}
replace('let installationFile = "F:/AgentVN/QA/Editor-1.9.13-20261021-01/installation.json";',
  `let installationFile = ${JSON.stringify(installation)};`);
replace('p.nodes[0].data.openingAudio = [];', `p.nodes[0].data.openingAudio = [];
p.editor_settings.runtimeUILayoutProfiles = ${JSON.stringify(author.profiles)};
p.editor_settings.runtimeUILayout = p.editor_settings.runtimeUILayoutProfiles.profiles[p.editor_settings.runtimeUILayoutProfiles.activeType];`);
replace('const save = () => fs.writeFileSync', `report.fixturePreparation = ${JSON.stringify({
  kind: "CONTROLLED_COPY_OF_PREVIOUS_ACTUAL_AUTHOR_PROFILES_NOT_NEW_AUTHOR_OR_EXPORT",
  source: authorFile, sha256: sha(authorFile),
})};
report.scope = "INSTALLED_1924_ACTUAL_IFRAME_COMPUTED_STYLE_NOT_PIXEL_EXPORT_OR_ANDROID";
report.renderSamples = [];
const save = () => fs.writeFileSync`);
replace('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
  'fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
  'fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
  'fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
replace('  return { kind: "ACTUAL_INSTALLED_RUNTIME_IFRAME", geometry: await geometry(), runtime: await frame.evaluate(() => ({',
`  const expected = p.editor_settings.runtimeUILayoutProfiles.profiles[t].screens
    .find(s => s.screen_id === entry[0]).components.find(c => c.component_id === entry[2]).style.backgroundColor;
  const sample = await frame.evaluate(({ componentId, expected }) => {
    const roots = [...document.querySelectorAll("[data-ui-component-id]")]
      .filter(n => n.dataset.uiComponentId === componentId);
    const nodes = roots.flatMap(root => [root, ...root.querySelectorAll('[data-ui-opacity-layer="background"]')]);
    const describe = (node, pseudo) => {
      const style = getComputedStyle(node, pseudo), r = node.getBoundingClientRect();
      let opacity = Number(style.opacity);
      for (let p = pseudo ? node : node.parentElement; p; p = p.parentElement)
        opacity *= Number(getComputedStyle(p).opacity);
      return { className: node.className, material: node.dataset.uiOpacityLayer, pseudo,
        backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage,
        opacity, visible: r.width > 0 && r.height > 0 && style.display !== "none"
          && style.visibility === "visible" && (!pseudo || !["none", "normal"].includes(style.content)),
        rect: r.toJSON(), inline: node.getAttribute("style") };
    };
    return { componentId, expected, roots: roots.length,
      layers: nodes.flatMap(n => [describe(n), describe(n, "::before"), describe(n, "::after")]),
      allComponentIds: [...document.querySelectorAll("[data-ui-component-id]")].map(n => n.dataset.uiComponentId) };
  }, { componentId: entry[2], expected });
  sample.type = t; sample.page = entry[0]; sample.corresponds = module.qaColorMatches(sample);
  report.renderSamples.push(sample); save();
  await host.shot(t + "-paint-" + entry[0]);
  return { kind: "ACTUAL_INSTALLED_RUNTIME_IFRAME", controlStyle: sample, geometry: await geometry(), runtime: await frame.evaluate(() => ({`);
// Existing page checks, input geometry, profile restart and cleanup stay intact.
replace('  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); report.status = "PASS";',
`  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0);
  assert.equal(report.renderSamples.length, 9);
  report.renderFailures = report.renderSamples.filter(s => !s.corresponds);
  save();
  assert.equal(report.renderFailures.length, 0, JSON.stringify(report.renderFailures));
  report.status = "PASS";`);
new vm.Script(Module.wrap(source), { filename: original });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(original, "utf8");
  for (const change of changes) {
    assert.equal(replay.split(change.before).length - 1, 1); replay = replay.replace(change.before, change.after);
  }
  assert.equal(replay, source);
  const good = { expected: "#263746", layers: [{ backgroundColor: "rgb(38, 55, 70)", opacity: 1, visible: true }] };
  assert(colorMatches(good));
  for (const bad of [
    { ...good, layers: [] },
    { ...good, layers: [{ ...good.layers[0], visible: false }] },
    { ...good, layers: [{ ...good.layers[0], opacity: 0 }] },
    { ...good, layers: [{ ...good.layers[0], backgroundColor: "rgba(38, 55, 70, 0)" }] },
    { ...good, layers: [{ ...good.layers[0], backgroundColor: "rgb(39, 55, 70)" }] },
  ]) assert(!colorMatches(bad));
  console.log(JSON.stringify({ status: "PASS", transformations: changes.length, badSamplesRejected: 5,
    scope: "QA_ADAPTER_AND_STYLE_COMPARATOR_ONLY" }));
} else {
  assert.equal(process.argv[2], "survey"); assert.equal(process.argv[3], "51");
  assert(process.argv.includes("--codex-cache-view")); assert(!process.argv.includes("--matrix"));
  assert(!fs.existsSync("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-51"));
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes; worker.qaColorMatches = colorMatches;
  worker._compile(source, __filename);
}
