"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Editor-Delete-Integrity-20261116-01\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const tasks = [], records = new Map();
global.window = { location: { search: "" }, localStorage: {
  getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k),
}, dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
setTimeout: fn => { tasks.push(fn); return tasks.length; }, clearTimeout() {},
requestAnimationFrame: fn => { tasks.push(fn); return tasks.length; },
requestIdleCallback: fn => { tasks.push(fn); return tasks.length; },
matchMedia: () => ({ matches: false }) };
global.localStorage = window.localStorage;
global.document = { addEventListener() {}, removeEventListener() {} };
global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const built = require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: 'export {useEditorStore} from "./editor/src/store/editorStore";' },
  bundle: true, platform: "node", format: "cjs", write: false,
  define: { "import.meta.env": "{}" }, nodePaths: [path.join(root, "editor/node_modules")],
});
const compiled = new Module(path.join(out, "entry.cjs"), module);
compiled.filename = path.join(out, "entry.cjs"); compiled.paths = Module._nodeModulePaths(root);
compiled._compile(built.outputFiles[0].text, compiled.filename);
const store = compiled.exports.useEditorStore, { fixture } = require("./lib/editor-ui-acceptance.cjs");
const report = { status: "RUNNING", scope: "ACTUAL_STORE_LARGE_ROUTE_IMPORT_CONTROLLED_CALLBACK_SCHEDULING",
  cases: [], models: 0, productStarts: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function drain() {
  let count = 0;
  while (tasks.length) { assert(++count < 100, "Bounded callback queue"); tasks.shift()(); }
}
function load(id = "a") {
  store.getState().importProject(fixture(id)); store.setState({ dirty: false });
}
function graph() {
  const s = store.getState();
  return structuredClone({ nodes: s.nodes.map(n => ({ id: n.id, data: n.data })), edges: s.edges });
}
function route(count = 100) {
  const f = fixture("external"), scene = f.nodes[1];
  f.nodes = [f.nodes[0]];
  f.edges = [];
  for (let i = 0; i < count; i++) {
    const n = structuredClone(scene); n.id = `incoming_${i}`;
    n.data.scene.scene_id = `incoming_scene_${i}`; n.data.scene.title = `导入 ${i}`;
    n.data.label = n.data.scene.title; n.position = { x: i * 300, y: 200 };
    f.nodes.push(n);
    if (i) f.edges.push({ id: `incoming_edge_${i}`, source: `incoming_${i - 1}`, target: n.id, sourceHandle: "default" });
  }
  return f;
}
async function test(name, fn) {
  tasks.length = 0; load();
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await fn(row); row.status = "PASS"; } catch (error) { row.status = "FAILED"; row.error = error.stack; }
  tasks.length = 0; save();
}
(async () => {
  await test("Return and success notice imply all 100 nodes and 99 links are committed", row => {
    const imported = store.getState().importProjectAsRoute(route());
    assert.equal(imported.nodes, 100); assert.equal(imported.edges, 99);
    assert.equal(store.getState().nodes.length, 102); assert.equal(store.getState().edges.length, 100);
    assert.equal(store.getState().nodes.filter(n => n.data.nodeKind === "start").length, 1);
    row.nodes = store.getState().nodes.length;
  });
  await test("Immediate portable save contains the entire route", () => {
    store.getState().importProjectAsRoute(route());
    const file = store.getState().exportProject({ projectId: "a", title: "QA", author: "QA", assetManifest: [] });
    assert.equal(file.nodes.length, 102); assert.equal(file.edges.length, 100);
    const ids = new Set(file.nodes.map(n => n.id));
    assert(file.edges.every(e => ids.has(e.source) && ids.has(e.target)));
  });
  await test("One undo removes the whole import and deferred work cannot resurrect it", () => {
    const before = graph(); store.getState().importProjectAsRoute(route());
    assert(store.getState().undoGraphChange()); drain(); assert.deepEqual(graph(), before);
  });
  await test("Redo after an immediate undo restores the complete import", () => {
    store.getState().importProjectAsRoute(route());
    assert(store.getState().undoGraphChange()); assert(store.getState().redoGraphChange()); drain();
    assert.equal(store.getState().nodes.length, 102); assert.equal(store.getState().edges.length, 100);
  });
  for (const transition of ["A→B", "A→B→A", "A reload", "reset"]) {
    await test(`${transition}: old import callbacks cannot append nodes or links`, () => {
      store.getState().importProjectAsRoute(route());
      if (transition === "reset") store.getState().resetGraph();
      else { if (transition.includes("B")) load("b"); if (transition !== "A→B") load("a"); }
      const before = graph(), history = store.getState().graphHistory;
      drain(); assert.deepEqual(graph(), before); assert.equal(store.getState().graphHistory, history);
      assert.equal(store.getState().dirty, false);
    });
  }
  await test("Undo followed by a new edit is not contaminated by late import batches", () => {
    store.getState().importProjectAsRoute(route());
    assert(store.getState().undoGraphChange());
    store.getState().updateNodeData("scene", { label: "用户新修改" }); const before = graph();
    drain(); assert.deepEqual(graph(), before); assert.equal(store.getState().graphHistory.future.length, 0);
  });
  await test("Existing route and entry remain exact and new route is disconnected", () => {
    const before = graph(); store.getState().importProjectAsRoute(route()); drain();
    const after = graph(), originalIds = new Set(before.nodes.map(n => n.id));
    assert.deepEqual(after.nodes.filter(n => originalIds.has(n.id)), before.nodes);
    assert.deepEqual(after.edges.filter(e => originalIds.has(e.source) || originalIds.has(e.target)), before.edges);
    assert.equal(store.getState().graphHistory.past.length, 1);
  });
  report.status = report.cases.length === 10 && report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; }).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    failed: report.cases.filter(c => c.status === "FAILED").map(c => c.name), out }));
  if (report.status !== "PASS") process.exitCode = 1;
});
