"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const vm = require("node:vm"), Module = require("node:module");
const { build, expectedPanelMaterial, assertPanelMaterial } = require("./candidate-1930-layout-author.cjs");
const original = fs.readFileSync(path.join(__dirname, "installed-layout-pages-current.cjs"), "utf8");
const result = build(original);
new vm.Script(Module.wrap(result.source));
let replay = original, rejected = 0;
for (const change of result.adaptations) {
  assert.equal(replay.split(change.before).length - 1, 1);
  replay = replay.replace(change.before, change.after);
  if (original.includes(change.before)) {
    assert.throws(() => build(original.replace(change.before, "")));
    assert.throws(() => build(original + "\n" + change.before)); rejected += 2;
  }
}
assert.equal(replay, result.source);
const mountRace = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-71/report.json", "utf8"))
  .pages.find(p => p.type === "renpy" && p.id === "title").navigationBefore;
assert.equal(mountRace.overrideCount, 0); assert.equal(mountRace.overrideVisible, true);
assert.equal(mountRace.source, "继承");
assert(result.source.includes('if (fontSource === "继承") await click(override);'));
const legacyMaterial = { backgroundColor: "#374970" };
const observed = { renderedBackground: "rgba(55, 73, 112, 0.78)", opacity: "1" };
assert.throws(() => assert.equal(observed.renderedBackground, "rgb(55, 73, 112)"));
assert.deepEqual(expectedPanelMaterial(legacyMaterial, "confirmation"),
  { color: [55, 73, 112, .78], opacity: 1 });
assertPanelMaterial(observed, legacyMaterial, "confirmation");
assertPanelMaterial({ renderedBackground: "rgb(55, 73, 112)", opacity: ".4" },
  { ...legacyMaterial, backgroundOpacity: .4 }, "confirmation");
assertPanelMaterial({ renderedBackground: "rgba(55, 73, 112, 0.4)", opacity: ".7" },
  { ...legacyMaterial, backgroundOpacity: .4, opacity: .7 }, "nvl");
for (const bad of [
  { ...observed, renderedBackground: "rgb(55, 73, 112)" },
  { ...observed, renderedBackground: "rgba(55, 73, 111, 0.78)" },
  { ...observed, renderedBackground: "rgba(55, 73, 112, 0)" },
  { ...observed, opacity: "0" },
]) assert.throws(() => assertPanelMaterial(bad, legacyMaterial, "confirmation"));
for (const assertion of [
  'const specialPages = [["confirmation"', 'data-preview-phase="ready"',
  'expectedPages * displayMatrix.length', 'types.reduce(', '? 11 : 12',
  'await host.stop("finally")', 'cache("Restore")', 'report.errors, []',
  'profiles.profiles[other], isolated', 'current.renderedBackground',
  'getByRole("combobox", { name: "对白布局模式"',
  'return previewSpecial(t, entry)', 'return authorSpecial(t, entry, i)',
]) assert(result.source.includes(assertion), assertion);
console.log(JSON.stringify({ status: "PASS", rejectedSourceDriftVariants: rejected,
  plannedCells: 12, plannedPages: 276, productLaunches: 0, modelRequests: 0 }));
