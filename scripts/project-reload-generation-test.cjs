"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const built = esbuild.buildSync({
  stdin: { contents: 'export { useEditorStore } from "./editor/src/store/editorStore";',
    resolveDir: root, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false,
});
const subject = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(require, subject, subject.exports);
const store = subject.exports.useEditorStore;
const a = fixture("reload-generation-a"), b = fixture("reload-generation-b");
const initial = store.getState().projectLoadGeneration;
const load = (file, expected) => {
  store.getState().importProject(file);
  assert.equal(store.getState().projectLoadGeneration, expected);
};
load(a, initial + 1);
load(a, initial + 2); // Same ID is a new loaded session, not the old request owner.
load(b, initial + 3);
load(a, initial + 4); // A -> B -> A must not revive an earlier owner.
const generation = store.getState().projectLoadGeneration;
store.getState().updateNodeData(a.nodes[1].id, { label: "真实草稿编辑" });
assert.equal(store.getState().projectLoadGeneration, generation, "Edits are not new project sessions");
const portable = store.getState().exportProject({
  projectId: a.project_id, title: a.title, author: a.author, assetManifest: [],
});
assert(!Object.hasOwn(portable, "projectLoadGeneration"), "Local ownership must not enter .vnproj");
assert(!Object.hasOwn(store.getState().exportScript(), "projectLoadGeneration"),
  "Local ownership must not enter player scripts");
store.getState().resetGraph();
assert.equal(store.getState().projectLoadGeneration, generation + 1);
console.log("PASS project reload generation: import, same-id, A-B-A, edit, portable/script exclusion, reset");
