"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("../editor/node_modules/typescript");
const sourcePath = path.resolve(__dirname, "../editor/src/utils/editorTransitionPresentation.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath, module);
loaded._compile(compiled, sourcePath);
const { readEditorMotionTokens, editorWorkspaceDuration, pruneHiddenLayoutSnapshot } = loaded.exports;
let calls = 0;
const values = { "--motion-scale": "1", "--ease-editor-crossfade": "cubic-bezier(0.23, 1, 0.32, 1)",
  "--ease-ui-in-out": "cubic-bezier(0.77,0,0.175,1)", "--ease-ui-out": "ease-out" };
global.document = { documentElement: {} };
global.window = { getComputedStyle(node) {
  assert.equal(node, document.documentElement);
  calls++;
  return { getPropertyValue: key => values[key] ?? "" };
} };
const before = readEditorMotionTokens();
assert.equal(calls, 1);
assert.equal(before.motionScale, 1);
assert.equal(before.crossfadeEasing, values["--ease-editor-crossfade"]);
values["--motion-scale"] = "2";
values["--ease-ui-in-out"] = "linear";
const after = readEditorMotionTokens();
assert.equal(after.motionScale, 2, "new operation must read changed root settings");
assert.equal(after.containerEasing, "linear");
assert.equal(before.motionScale, 1, "in-flight operation keeps its own snapshot");
assert.equal(calls, 2, "no global cache shared across operations");
values["--ease-editor-container"] = "cubic-bezier(0.32,0.72,0,1)";
assert.equal(readEditorMotionTokens().containerEasing, values["--ease-editor-container"],
  "Editor workbench curve must be independent from the retained global/home container curve");
assert.equal(values["--ease-ui-in-out"], "linear", "workbench token must not overwrite the home token");
values["--motion-editor-sibling"]="1200ms";
values["--motion-editor-sibling-reduced"]="750ms";
values["--ease-editor-sibling"]="cubic-bezier(0.2,0.8,0.2,1)";
const sibling=readEditorMotionTokens();
assert.equal(sibling.siblingDurationMs,1200);
assert.equal(sibling.reducedSiblingDurationMs,750);
assert.equal(sibling.siblingEasing,values["--ease-editor-sibling"]);
assert.equal(before.siblingDurationMs,1000,"in-flight sibling clocks retain their operation snapshot");
assert.equal(before.reducedSiblingDurationMs,700);
assert.equal(sibling.crossfadeEasing,before.crossfadeEasing,"sibling tuning must not rewrite other content clocks");
// CSS minifiers serialize times as seconds. Both forms must drive the same
// presentation clock, including reduced motion and per-operation settings.
values["--motion-editor-sibling"] = "1.2s";
values["--motion-editor-sibling-reduced"] = ".75s";
values["--editor-workspace-playback-rate"] = "1.5";
const compressed = readEditorMotionTokens();
assert.equal(compressed.siblingDurationMs, sibling.siblingDurationMs);
assert.equal(compressed.reducedSiblingDurationMs, sibling.reducedSiblingDurationMs);
assert.equal(editorWorkspaceDuration(compressed.siblingDurationMs, compressed), 800);
assert.equal(editorWorkspaceDuration(compressed.reducedSiblingDurationMs, compressed), 500);
values["--motion-editor-sibling"] = " 1s ";
values["--motion-editor-sibling-reduced"] = " .7s ";
const production = readEditorMotionTokens();
assert.equal(production.siblingDurationMs, 1000);
assert.equal(production.reducedSiblingDurationMs, 700);
for (const invalid of ["", "0ms", "0s", "-1s", "Infinityms", "NaNs", "garbage", "1000", "12msjunk"]) {
  values["--motion-editor-sibling"] = invalid;
  values["--motion-editor-sibling-reduced"] = invalid;
  const fallback = readEditorMotionTokens();
  assert.equal(fallback.siblingDurationMs, 1000, `safe ordinary default: ${invalid}`);
  assert.equal(fallback.reducedSiblingDurationMs, 700, `safe reduced default: ${invalid}`);
}
assert.equal(compressed.siblingDurationMs, 1200, "later token edits cannot rewrite an in-flight operation");
assert.equal(compressed.reducedSiblingDurationMs, 750);

function snapshot() {
  let removed = 0;
  const hidden = { querySelectorAll(selector) {
    assert.equal(selector, ".runtime-layout-header,.runtime-layout-sidebar,.runtime-layout-center");
    return [68, 134, 155].map(count => ({ querySelectorAll: () => Array(count - 1), remove: () => removed++ }));
  } };
  const ghost = { classList: { contains: value => value === "toolbar-popover-morph-ghost" },
    querySelectorAll(selector) {
      assert.equal(selector, '.advanced-tab-content.is-warm[data-tab="layout"][aria-hidden="true"]');
      return [hidden];
    } };
  return { ghost, removed: () => removed };
}
const fixture = snapshot();
assert.equal(pruneHiddenLayoutSnapshot(fixture.ghost, { width: 3840, height: 2160 }), 357);
assert.equal(fixture.removed(), 3, "keeps root, grid and inspector boundary");
for (const viewport of [{ width: 390, height: 844 }, { width: 915, height: 412 }]) {
  const narrow = snapshot();
  assert.equal(pruneHiddenLayoutSnapshot(narrow.ghost, viewport), 0);
  assert.equal(narrow.removed(), 0, "does not alter unvalidated narrow snapshot representation");
}
const live = snapshot();
live.ghost.classList.contains = () => false;
assert.equal(pruneHiddenLayoutSnapshot(live.ghost, { width: 3840, height: 2160 }), 0);
assert.equal(live.removed(), 0, "live authoring trees must never be pruned");
console.log("PASS operation-local motion tokens and snapshot-only hidden layout pruning");
