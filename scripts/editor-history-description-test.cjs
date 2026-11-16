"use strict";
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), assert = require("node:assert/strict");
const out = path.resolve(process.argv[2] || ""), root = path.resolve(__dirname, "..");
assert(process.argv[2] && out.startsWith("F:\\testavn\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const built = require("../editor/node_modules/esbuild").buildSync({
  entryPoints: [path.join(root, "editor/src/utils/graphHistoryDescription.ts")], bundle: true, platform: "node",
  format: "cjs", write: false, nodePaths: [path.join(root, "editor/node_modules")],
});
const compiled = new Module(path.join(out, "entry.cjs"), module);
compiled.filename = path.join(out, "entry.cjs"); compiled.paths = Module._nodeModulePaths(root);
compiled._compile(built.outputFiles[0].text, compiled.filename);
const { describeGraphChange: describe } = compiled.exports;
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const report = { status: "RUNNING", scope: "ACTUAL_SOURCE_PURE_HISTORY_DESCRIPTION_NOT_UI", cases: [] };
const base = fixture("qa_history_description");
base.memoryMode = "hybrid"; base.nodes[1].data.scene.title = base.nodes[1].data.label = "雨夜车站";
base.nodes[1].data.scene.commands = [100, 200, 300].map(duration_ms => ({ type: "wait", duration_ms }));
const next = action => { const copy = structuredClone(base); action(copy); return copy; };
function test(name, after, expected) {
  const row = { name, status: "RUNNING" }; report.cases.push(row);
  try { row.description = describe(base, after); assert.match(row.description, expected); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; }
}
test("one event edit uses scene name, index and command role", next(g => g.nodes[1].data.scene.commands[1].duration_ms = 450),
  /修改「雨夜车站」第 2 项事件（等待）/);
test("reorder distinguishes two identical command types by their content", next(g => g.nodes[1].data.scene.commands.reverse()), /重排「雨夜车站」的 3 项事件/);
test("append event", next(g => g.nodes[1].data.scene.commands.push({ type: "wait", duration_ms: 800 })), /新增「雨夜车站」的 1 项事件/);
test("delete event", next(g => g.nodes[1].data.scene.commands.splice(0, 1)), /删除「雨夜车站」的 1 项事件/);
test("several changed events", next(g => g.nodes[1].data.scene.commands.forEach(c => c.duration_ms++)), /修改「雨夜车站」的 3 项事件/);
test("duplicate node", next(g => { const node = structuredClone(g.nodes[1]); node.id = "copy"; g.nodes.push(node); }), /新增节点「雨夜车站」/);
test("deletion preserves connection information in description", next(g => { g.nodes.pop(); g.edges = []; }), /删除节点「雨夜车站」；删除 1 条连线/);
test("full route import is one complete operation", next(g => {
  for (let i = 0; i < 100; i++) { const node = structuredClone(g.nodes[1]); node.id = "route_" + i; g.nodes.push(node);
    g.edges.push({ id: "route_edge_" + i, source: i ? "route_" + (i - 1) : "scene", target: node.id }); }
}), /新增 100 个节点；新增 100 条连线/);
test("node title edit", next(g => g.nodes[1].data.scene.title = "归程"), /修改节点「雨夜车站」的名称/);
test("node settings", next(g => g.nodes[1].data.description = "new"), /修改节点「雨夜车站」的设置/);
test("arrange node positions", next(g => g.nodes.forEach(n => n.position.y += 200)), /调整 2 个节点的位置/);
test("retarget a connection", next(g => g.edges[0].target = "start"), /修改 1 条连线/);
test("memory mode", next(g => g.memoryMode = "none"), /切换记忆模式/);
test("transient selected/measured state is not described as content editing", next(g => { g.nodes[1].selected = true;
  g.nodes[1].measured = { width: 999, height: 500 }; g.edges[0].selected = true; }), /^修改工程图$/);
test("JSON key order does not fabricate an event edit", next(g => {
  g.nodes[1].data.scene.commands = g.nodes[1].data.scene.commands.map(c => ({ duration_ms: c.duration_ms, type: c.type }));
}), /^修改工程图$/);
test("long title is bounded and never replaced with internal ID", next(g => {
  g.nodes[1].data.scene.title = "长场景标题".repeat(100); g.nodes[1].data.scene.commands[0].duration_ms++;
}), /修改「(?:长场景标题){7}…」第 1 项事件/);
report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
if (report.status !== "PASS") process.exitCode = 1;
console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
  failures: report.cases.filter(c => c.status === "FAILED"), out }));
