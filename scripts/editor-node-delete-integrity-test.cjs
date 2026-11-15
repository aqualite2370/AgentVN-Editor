"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Editor-Delete-Integrity-20261116-01\\") && !fs.existsSync(out),
  "Use a new scoped evidence directory");
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "ACTUAL_EDITOR_STORE_DELETE_HISTORY_EXPORT_IMPORT",
  cases: [], productStarts: 0, models: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const records = new Map();
global.window = { location: { search: "" }, localStorage: {
  getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k),
}, dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; }, clearTimeout,
matchMedia: () => ({ matches: false }) };
global.localStorage = window.localStorage;
global.document = { addEventListener() {}, removeEventListener() {} };
global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const built = require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export {useEditorStore} from "./editor/src/store/editorStore";
    export {createChoiceNode,createSceneNode} from "./editor/src/utils/nodeFactory";
  ` },
  bundle: true, platform: "node", format: "cjs", write: false,
  define: { "import.meta.env": "{}" }, nodePaths: [path.join(root, "editor/node_modules")],
});
const compiled = new Module(path.join(out, "entry.cjs"), module);
compiled.filename = path.join(out, "entry.cjs"); compiled.paths = Module._nodeModulePaths(root);
compiled._compile(built.outputFiles[0].text, compiled.filename);
const { useEditorStore: store, createChoiceNode, createSceneNode } = compiled.exports;
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
function load() {
  const f = fixture("qa_delete_integrity");
  const choice = createChoiceNode(), target = createSceneNode();
  choice.id = "branch"; target.id = "target"; target.data.scene.scene_id = "target_scene";
  choice.data.choice.choices[0].target_scene_id = "target_scene";
  choice.data.choice.choices[1].target_scene_id = "ui_acceptance";
  f.nodes[1].data.scene.commands.push({ type: "choice", choices: [
    { choice_id: "embedded_target", text: "前往目标", target_scene_id: "target_scene", conditions: [] },
    { choice_id: "embedded_keep", text: "保持", target_scene_id: "ui_acceptance", conditions: [] },
  ] });
  f.nodes.push(choice, target);
  f.edges.push(
    { id: "branch_target", source: "branch", sourceHandle: choice.data.choice.choices[0].choice_id, target: "target" },
    { id: "branch_keep", source: "branch", sourceHandle: choice.data.choice.choices[1].choice_id, target: "scene" },
    { id: "embedded_target", source: "scene", sourceHandle: "embedded_target", target: "target" },
    { id: "target_out", source: "target", sourceHandle: "default", target: "scene" },
  );
  store.getState().importProject(f);
  store.setState({ dirty: false, selectedNodeId: "target", selectedEdgeId: "branch_target" });
}
function graph() {
  const s = store.getState();
  return structuredClone({ nodes: s.nodes, edges: s.edges,
    selectedNodeId: s.selectedNodeId, selectedEdgeId: s.selectedEdgeId });
}
function assertRemoved() {
  const s = store.getState();
  assert(!s.nodes.some(n => n.id === "target"));
  assert(!s.edges.some(e => e.source === "target" || e.target === "target"), "No dangling edges");
  const branch = s.nodes.find(n => n.id === "branch").data.choice.choices;
  const embedded = s.nodes.find(n => n.id === "scene").data.scene.commands.find(c => c.type === "choice").choices;
  assert.equal(branch[0].target_scene_id, "", "Standalone choice target must clear");
  assert.equal(embedded[0].target_scene_id, "", "Embedded choice target must clear");
  assert.equal(branch[1].target_scene_id, "ui_acceptance", "Unrelated choice retained");
  assert.equal(embedded[1].target_scene_id, "ui_acceptance", "Unrelated embedded choice retained");
  assert.equal(s.selectedNodeId, undefined); assert.equal(s.selectedEdgeId, undefined);
}
async function test(name, fn) {
  load(); const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await fn(); row.status = "PASS"; } catch (error) { row.status = "FAILED"; row.error = error.stack; }
  save();
}
(async () => {
  await test("Inspector deletion of protected entry preserves graph, selection and history", () => {
    store.getState().selectNode("start"); const before = graph();
    const history = store.getState().graphHistory;
    store.getState().deleteNode("start");
    assert.deepEqual(graph(), before); assert.equal(store.getState().dirty, false);
    assert.equal(store.getState().graphHistory, history);
  });
  await test("Missing-node deletion does not create dirty state or undo record", () => {
    const before = graph(), history = store.getState().graphHistory;
    store.getState().deleteNode("missing");
    assert.deepEqual(graph(), before); assert.equal(store.getState().dirty, false);
    assert.equal(store.getState().graphHistory, history);
  });
  await test("Inspector deletion clears both choice forms and selected edge atomically", () => {
    store.getState().deleteNode("target"); assertRemoved();
    assert.equal(store.getState().graphHistory.past.length, 1);
  });
  await test("Inspector delete undo and redo restore exact nodes, links and targets", () => {
    const before = graph(); store.getState().deleteNode("target");
    assert(store.getState().undoGraphChange()); assert.deepEqual(graph(), before);
    assert(store.getState().redoGraphChange()); assertRemoved();
  });
  await test("Canvas remove protects entry without losing its outgoing link", () => {
    const before = graph(), history = store.getState().graphHistory;
    store.getState().onNodesChange([{ type: "remove", id: "start" }]);
    assert.deepEqual(graph(), before); assert.equal(store.getState().dirty, false);
    assert.equal(store.getState().graphHistory, history);
  });
  await test("Canvas remove cleans incident links even when no edge callback follows", () => {
    store.getState().onNodesChange([{ type: "remove", id: "target" }]); assertRemoved();
    assert.equal(store.getState().graphHistory.past.length, 1);
  });
  await test("Late duplicate remove callback does not append a second undo step", () => {
    store.getState().onNodesChange([{ type: "remove", id: "target" }]);
    const history = store.getState().graphHistory;
    store.getState().onEdgesChange([{ type: "remove", id: "branch_target" }, { type: "remove", id: "embedded_target" }]);
    assert.equal(store.getState().graphHistory, history);
    assert(store.getState().undoGraphChange());
    assert(store.getState().nodes.some(n => n.id === "target"));
    assert(store.getState().edges.some(e => e.id === "branch_target"));
  });
  await test("Delete remains consistent after portable project export and reopen", () => {
    store.getState().deleteNode("target");
    const exported = store.getState().exportProject({
      projectId: "qa_delete_integrity", title: "删除一致性", author: "QA", assetManifest: [],
    });
    store.getState().importProject(JSON.parse(JSON.stringify(exported)));
    const s = store.getState();
    assert(!s.edges.some(e => e.target === "target" || e.source === "target"));
    assert.equal(s.nodes.find(n => n.id === "branch").data.choice.choices[0].target_scene_id, "");
    assert.equal(s.nodes.find(n => n.id === "scene").data.scene.commands.find(c => c.type === "choice").choices[0].target_scene_id, "");
  });
  report.status = report.cases.length === 8 && report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; }).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    failed: report.cases.filter(c => c.status === "FAILED").map(c => c.name), out }));
  if (report.status !== "PASS") process.exitCode = 1;
});
