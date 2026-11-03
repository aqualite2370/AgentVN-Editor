"use strict";
// Execute the production branch materializer body with a minimal store seam.
// Export/compiler/validator are real. This is not browser or installed evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync, transformSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert(attempt && /^[a-z]+-\d{2}$/.test(attempt));
const out = `F:/AgentVN/QA/Novel-Branch-Completion-20261103-01/${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync(path.join(root, "editor/src/store/novelImportStore.ts"), "utf8");
const start = source.indexOf("function materializeBranchSuggestions(");
const end = source.indexOf("\nexport function getNovelImportModelStatus", start);
assert(start >= 0 && end > start);
const body = transformSync(source.slice(start, end), { loader: "ts", target: "es2022" }).code;
const exportsModule = { exports: {} };
new Function("module", "exports", "require", buildSync({ stdin: { resolveDir: root, loader: "ts", contents:
  'export {exportScript,validateExportScript} from "./editor/src/utils/exportScript"; export {createEndNode} from "./editor/src/utils/nodeFactory";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(exportsModule, exportsModule.exports, require);
const { exportScript, validateExportScript, createEndNode } = exportsModule.exports;
const report = { status: "RUNNING", scope: "ACTUAL_BRANCH_FUNCTION_AND_EXPORT_COMPILER_WITH_STORE_SEAM",
  cases: [], modelRequests: 0, productStarts: 0, at: new Date().toISOString() };
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(out, "executed-production-function.js"), body, { flag: "wx" });
const base = { label: "", description: "", memoryMode: "hybrid",
  aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
  previewState: { currentCommandIndex: 0, isPlaying: false },
  editorMeta: { collapsedInspectorSections: [], source: "imported", importLineId: "qa-line" } };
function scene(id) {
  return { id, type: "sceneNode", position: { x: 300, y: 200 },
    data: { ...structuredClone(base), nodeKind: "scene", label: id,
      scene: { scene_id: id, title: id, summary: "", chapter: 1, tags: [],
        commands: [{ type: "narration", text: `原文${id}` }] } } };
}
function run(sources, withNext = false, initial) {
  let serial = 0, history = 0, state = initial ?? { dirty: false,
    nodes: [{ id: "start", type: "startNode", position: { x: 0, y: 200 },
      data: { ...structuredClone(base), nodeKind: "start" } }, ...sources],
    edges: [{ id: "entry", source: "start", target: sources[0].id, sourceHandle: "default" },
      ...(withNext ? [{ id: "original-next", source: sources[0].id, target: sources[1].id, sourceHandle: "default" }] : [])],
  };
  const store = { getState: () => ({ ...state, recordGraphHistory: () => history++,
    declutterNodesAround: () => {} }),
    setState: update => { state = { ...state, ...update(state) }; } };
  const materialize = new Function("useEditorStore", "nanoid", "createEndNode", body + "\nreturn materializeBranchSuggestions;")
    (store, () => `qa${++serial}`, createEndNode);
  const suggestion = id => ({ suggestion_id: `suggestion-${id}`, source_scene_id: id,
    choice_text: "可选假设", branch_summary: "需要作者审查的分支", confidence: .9, enabled_by_default: false });
  return { state: () => state, materialize, suggestion, history: () => history };
}
function check(name, fn) {
  const item = { name, status: "RUNNING" }; report.cases.push(item);
  try { item.detail = fn(); item.status = "PASS"; }
  catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); }
}
check("terminal-mainline-has-explicit-ending-instead-of-empty-target", () => {
  const t = run([scene("last")]);
  assert.equal(t.materialize({ importLineId: "qa-line", memoryMode: "hybrid",
    suggestions: [t.suggestion("last")] }), 1);
  const s = t.state(), choice = s.nodes.find(n => n.data.nodeKind === "choice");
  const edge = s.edges.find(e => e.source === choice.id && e.sourceHandle === "mainline");
  assert(edge, "Last-scene mainline needs a real target; it cannot loop back or vanish on export");
  const ending = s.nodes.find(n => n.id === edge.target);
  assert.equal(ending.data.nodeKind, "end");
  const script = exportScript(s.nodes, s.edges);
  const runtimeChoice = script.scenes.find(n => n.tags.includes("choice")).commands[0];
  assert.equal(runtimeChoice.choices.length, 2, "Export must retain original mainline and optional branch");
  const mainline = runtimeChoice.choices.find(c => c.choice_id === "mainline");
  assert(script.scenes.find(n => n.scene_id === mainline.target_scene_id)?.is_ending);
  const errors = validateExportScript(script, s).filter(e => e.severity !== "warning");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  fs.writeFileSync(path.join(out, "terminal-graph.json"), JSON.stringify(s, null, 2));
  fs.writeFileSync(path.join(out, "terminal-script.json"), JSON.stringify(script, null, 2));
  return { mainlineTarget: mainline.target_scene_id, choiceCount: runtimeChoice.choices.length };
});
check("explicit-ending-moves-termination-after-reachable-choice", () => {
  const last = scene("ended"); last.data.scene.is_ending = true;
  const t = run([last]);
  t.materialize({ importLineId: "qa-line", memoryMode: "hybrid", suggestions: [t.suggestion("ended")] });
  const s = t.state(), script = exportScript(s.nodes, s.edges);
  const source = script.scenes.find(n => n.scene_id === "ended");
  assert(!source.is_ending && source.next_scene_id, "An ending marker must not bypass the branch menu");
  const choice = script.scenes.find(n => n.scene_id === source.next_scene_id);
  assert.equal(choice.commands[0].choices.length, 2);
  const target = choice.commands[0].choices.find(c => c.choice_id === "mainline").target_scene_id;
  assert(script.scenes.find(n => n.scene_id === target)?.is_ending);
  assert.deepEqual(source.commands, last.data.scene.commands, "No generated story text replaces original prose");
  const errors = validateExportScript(script, s).filter(e => e.severity !== "warning");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  return { sourceReachesChoice: true, endingTarget: target };
});
check("ambiguous-and-explicit-story-control-flow-are-preserved", () => {
  const t = run([scene("fork"), scene("a"), scene("b")]);
  t.state().edges.push(
    { id: "fork-a", source: "fork", target: "a", sourceHandle: "default" },
    { id: "fork-b", source: "fork", target: "b", sourceHandle: "default" });
  const before = JSON.stringify(t.state());
  assert.equal(t.materialize({ importLineId: "qa-line", memoryMode: "hybrid",
    suggestions: [t.suggestion("fork")] }), 0);
  assert.equal(JSON.stringify(t.state()), before);
  const jump = scene("jump"); jump.data.scene.commands.push({ type: "jump", target_scene_id: "destination" });
  const j = run([jump, scene("destination")]), original = JSON.stringify(j.state());
  assert.equal(j.materialize({ importLineId: "qa-line", memoryMode: "hybrid",
    suggestions: [j.suggestion("jump")] }), 0);
  assert.equal(JSON.stringify(j.state()), original);
  return { ambiguousPreserved: true, controlFlowPreserved: true };
});
check("middle-mainline-preserves-real-next-scene-and-existing-identities", () => {
  const t = run([scene("first"), scene("second")], true), before = structuredClone(t.state());
  t.materialize({ importLineId: "qa-line", memoryMode: "hybrid", suggestions: [t.suggestion("first")] });
  const s = t.state(), script = exportScript(s.nodes, s.edges);
  assert.equal(s.nodes.filter(n => n.data.nodeKind === "end").length, 0);
  assert.deepEqual(s.nodes.slice(0, 3), before.nodes);
  assert.deepEqual(s.edges.find(e => e.id === "entry"), before.edges[0]);
  const choice = script.scenes.find(n => n.tags.includes("choice")).commands[0];
  assert.equal(choice.choices.find(c => c.choice_id === "mainline").target_scene_id, "second");
  const saved = JSON.stringify(s);
  assert.equal(t.materialize({ importLineId: "qa-line", memoryMode: "hybrid",
    suggestions: [t.suggestion("first")] }), 0);
  assert.equal(JSON.stringify(t.state()), saved, "Repeated materialization must be idempotent");
  return { existingNodesPreserved: 3, idempotent: true };
});
check("foreign-line-and-dangling-continuations-do-not-invent-completed-story", () => {
  const foreign = scene("foreign"); foreign.data.editorMeta.importLineId = "user-original";
  const t = run([foreign]), before = JSON.stringify(t.state());
  assert.equal(t.materialize({ importLineId: "qa-line", memoryMode: "hybrid",
    suggestions: [t.suggestion("foreign")] }), 0);
  assert.equal(JSON.stringify(t.state()), before, "A suggestion must not rewrite an unrelated author's line");
  const broken = run([scene("broken")]);
  broken.state().edges.push({ id: "dangling", source: "broken", target: "missing", sourceHandle: "default" });
  const original = JSON.stringify(broken.state());
  assert.equal(broken.materialize({ importLineId: "qa-line", memoryMode: "hybrid",
    suggestions: [broken.suggestion("broken")] }), 0);
  assert.equal(JSON.stringify(broken.state()), original, "A broken explicit link must not be silently replaced by an ending");
  return { foreignPreserved: true, danglingPreserved: true };
});
check("same-historical-paid-output-gains-mainline-without-regeneration-or-manual-repair", () => {
  const file = "F:/AgentVN/QA/Novel-Real-1935-20261031-04/run/session-01/report.json";
  const raw = fs.readFileSync(file), hash = require("node:crypto").createHash("sha256").update(raw).digest("hex");
  assert.equal(hash, "fbfc6178d503cc54530ebbca9b411c44f9762e9b4749a97cefa955ffafacc737");
  const prior = JSON.parse(raw), project = prior.restored.project, session = prior.restored.session;
  const source = project.nodes.find(n => n.data.editorMeta?.importSessionId === session.session_id);
  const importLineId = source.data.editorMeta.importLineId;
  const generatedIds = new Set(project.nodes.filter(n => n.data.editorMeta?.importLineId === importLineId &&
    /^branch_(?:source|suggestion):/.test(n.data.editorMeta?.debugNotes ?? "")).map(n => n.id));
  const before = { dirty: false, nodes: project.nodes.filter(n => !generatedIds.has(n.id)),
    edges: project.edges.filter(e => !generatedIds.has(e.source) && !generatedIds.has(e.target)) };
  const t = run([], false, structuredClone(before));
  assert.equal(t.materialize({ importLineId, memoryMode: "hybrid", suggestions: session.branch_suggestions }), 1);
  const s = t.state(), choice = s.nodes.find(n => n.data.nodeKind === "choice");
  assert.equal(choice.data.choice.choices.length, 5);
  const edge = s.edges.find(e => e.source === choice.id && e.sourceHandle === "mainline");
  assert.equal(s.nodes.find(n => n.id === edge.target).data.nodeKind, "end");
  for (const n of before.nodes) assert.deepEqual(s.nodes.find(item => item.id === n.id), n);
  for (const e of before.edges) assert.deepEqual(s.edges.find(item => item.id === e.id), e);
  const linked = [...s.edges, { id: "qa-author-entry", source: "scene", target: source.id, sourceHandle: "default" }];
  const script = exportScript(s.nodes, linked);
  assert.equal(script.scenes.find(n => n.scene_id === "choice_" + choice.id).commands[0].choices.length, 5);
  assert.equal(validateExportScript(script, { nodes: s.nodes, edges: linked }).filter(e => e.severity !== "warning").length, 0);
  fs.writeFileSync(path.join(out, "historical-replayed-graph.json"), JSON.stringify(s, null, 2));
  fs.writeFileSync(path.join(out, "historical-replayed-script.json"), JSON.stringify(script, null, 2));
  return { original: file, originalSHA256: hash, actualPriorSuggestions: 4, mainlineReachable: true,
    additionalModelRequests: 0, boundary: "REPLAYED_ACTUAL_OUTPUT_IN_SOURCE_FUNCTION_NOT_NEW_MODEL_OR_INSTALLED_UI" };
});
report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, cases: report.cases.map(c => [c.name, c.status]), out }));
if (report.status !== "PASS") process.exitCode = 1;
