"use strict";
// Real adapter and graph progress functions; no store writes, HTTP or model.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const ts = require("../editor/node_modules/typescript");
require.extensions[".ts"] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true },
}).outputText, file);
const { createMockNovelProcessSnapshot } = require("../editor/src/novel-import/novelProcessJobAdapter.ts");
const { createEmptyNovelProcessingState } = require("../editor/src/novel-import/novelProcessing.ts");
const at = "2026-10-20T00:00:00.000Z", jobId = "phase_job";
const chapters = [0, 1].map(i => ({ chapter_id: `c${i}`, index: i, title: `Chapter ${i}`,
  start_offset: i * 100, end_offset: (i + 1) * 100, summary: "", confidence: 1 }));
const session = { session_id: "phase_session", created_at: at, chapters,
  planned_chapter_ids: ["c0", "c1"], scenes: [], chunks: [], adapted_scenes: [],
  validation_reports: [] };
const processing = createEmptyNovelProcessingState({
  activeJobId: jobId, chapterSnapshots: chapters, updatedAt: at,
  jobs: [{ jobId, bookId: "book", status: "completed", selectedChapterIds: ["c0", "c1"],
    totalChapters: 2, totalChunks: 2, completedChunks: 2, failedChunks: 0,
    maxConcurrency: 1, createdAt: at, finishedAt: at }],
  chunks: [0, 1].map(i => ({ chunkId: `k${i}`, bookId: "book", chapterId: `c${i}`,
    chapterIndex: i, chunkIndex: i, globalIndex: i, status: "completed" })),
});
const input = {
  projectId: "phase_project", projectTitle: "Phase test",
  session, processing, errors: [], warnings: [],
  inspectableResults: [], isProcessing: false,
};
const cached = createMockNovelProcessSnapshot(input);
assert.equal(cached.job.status, "completed");
for (const phase of cached.job.phaseProgress.filter(p => ["import_write", "validation"].includes(p.phase))) {
  assert.notEqual(phase.status, "completed", "Executor recovery cache has no graph-write/validation evidence");
  assert.equal(phase.percent, 0);
}
const { withNovelGraphPhaseProgress } = require("../editor/src/novel-import/novelProcessGraphProgress.ts");
const { adaptedSceneToNode } = require("../editor/src/novel-import/importToGraph.ts");
const taskNodes = [0, 1].map(i => ({ id: `n${i}`, data: { nodeKind: "scene",
  scene: { scene_id: `s${i}`, title: `Scene ${i}`, summary: "", chapter: i, tags: [],
    commands: [{ type: "narration", text: "Test" }] },
  editorMeta: { sourceProcessJobId: jobId, sourceProcessChapterIndex: i } } }));
assert.equal(taskNodes.length, 2);
const job = { ...cached.job, jobId, source: "api",
  phaseProgress: cached.job.phaseProgress.map(p => ({ ...p, status: "completed", percent: 100 })) };
const row = (nodes, key, patch = {}) => withNovelGraphPhaseProgress({ ...job, ...patch }, {
  nodes, taskKind: "executor", sessionId: session.session_id,
}).phaseProgress.find(p => p.phase === key);
const cases = [];
function test(name, fn) { fn(); cases.push(name); console.log(`PASS ${name}`); }
test("completed but unimported and old cached 100% are not proof", () => {
  assert.equal(row([], "import_write").percent, 0);
  assert.equal(row([], "validation").percent, 0);
});
test("partial import counts selected chapters, not only available successes", () => {
  assert.equal(row([taskNodes[0]], "import_write").percent, 50);
  assert.equal(row([taskNodes[0]], "validation").percent, 50);
  assert.notEqual(row([taskNodes[0]], "validation").status, "completed");
});
test("recovered append is fully written and actually validated", () => {
  for (const key of ["import_write", "validation"]) {
    assert.equal(row(taskNodes, key).percent, 100);
    assert.equal(row(taskNodes, key).status, "completed");
  }
});
test("cancellation and graph deletion revoke old completed claims", () => {
  for (const key of ["import_write", "validation"]) {
    assert.equal(row([], key, { status: "cancelled" }).status, "cancelled");
    assert.equal(row([taskNodes[1]], key).percent, 50);
  }
});
test("other projects/tasks and duplicate chapter copies never inflate progress", () => {
  const wrong = structuredClone(taskNodes[0]); wrong.data.editorMeta.sourceProcessJobId = "other_job";
  assert.equal(row([wrong], "import_write").percent, 0);
  assert.equal(row([taskNodes[0], taskNodes[0]], "import_write").percent, 50);
});
test("edited invalid command geometry blocks actual validation but not the write fact", () => {
  const invalid = structuredClone(taskNodes);
  invalid[0].data.scene.commands.push({ type: "sprite", character_id: "test", sprite_id: "test",
    visible: true, offset_x: 999999 });
  assert.equal(row(invalid, "import_write").status, "completed");
  const validation = row(invalid, "validation");
  assert.equal(validation.status, "blocked"); assert(validation.percent < 100);
  assert.match(validation.blockingReason, /偏移|offset/);
});
test("renamed duplicate scene IDs and broken targets block structural validation", () => {
  const duplicate = structuredClone(taskNodes);
  duplicate[1].data.scene.scene_id = duplicate[0].data.scene.scene_id;
  assert.equal(row(duplicate, "validation").status, "blocked");
  const broken = structuredClone(taskNodes);
  broken[0].data.scene.commands.push({ type: "jump", target_scene_id: "missing_target" });
  assert.equal(row(broken, "validation").status, "blocked");
});
test("unrelated invalid author scene does not fail this task", () => {
  const bad = structuredClone(taskNodes[0]); bad.id = "unrelated";
  bad.data.editorMeta.sourceProcessJobId = "other_job"; bad.data.scene.scene_id = "unrelated";
  bad.data.scene.commands = null;
  assert.equal(row([...taskNodes, bad], "validation").status, "completed");
  const duplicate = structuredClone(bad); duplicate.id = "another-unrelated";
  assert.equal(row([...taskNodes, bad, duplicate], "validation").status, "completed",
    "Duplicate IDs exclusively outside this task must not be blamed on this task");
});
test("actual backend null dialogue fields are blocked rather than fabricated as a pass", () => {
  const invalid = structuredClone(taskNodes);
  invalid[0].data.scene.commands[0].presentation_mode = null;
  invalid[0].data.scene.commands[0].clear_nvl_page_before = null;
  invalid[0].data.scene.commands[0].bubble_position = null;
  assert.equal(row(invalid, "import_write").status, "completed");
  const validation = row(invalid, "validation");
  assert.equal(validation.status, "blocked"); assert.equal(validation.percent, 50);
  assert.match(validation.blockingReason, /null|气泡|布尔/);
});
test("novel graph ingress converts unset optional fields without erasing explicit values", () => {
  const scene = structuredClone(taskNodes[0].data.scene);
  scene.commands = [
    { type: "narration", text: "Legacy/backend default", presentation_mode: null,
      clear_nvl_page_before: null, bubble_position: null, narration_style: null, dialog_style_mode: null },
    { type: "state_update", key: "test", operation: "set", value: null },
    { type: "narration", text: "Explicit", presentation_mode: "nvl", clear_nvl_page_before: false,
      bubble_position: { mode: "fixed", x: 50, y: 10 }, narration_style: "dialog", dialog_style_mode: "manual" },
  ];
  const original = structuredClone(scene);
  const node = adaptedSceneToNode({ scene_beat: scene, source_mapping: {}, warnings: [], needs_review: false },
    { sessionId: "phase_session", importLineId: "line", startPosition: { x: 0, y: 0 },
      columnGap: 300, rowGap: 200, columns: 4 }, 0);
  const commands = node.data.scene.commands;
  const defaultCommand = commands.find(c => c.text === "Legacy/backend default");
  for (const key of ["presentation_mode", "clear_nvl_page_before", "bubble_position", "narration_style", "dialog_style_mode"])
    assert(!Object.hasOwn(defaultCommand, key), `Unset ${key} must become absent, not invalid null`);
  assert.equal(commands.find(c => c.type === "state_update").value, null);
  assert.deepEqual(commands.find(c => c.text === "Explicit"), original.commands[2]);
  assert.deepEqual(scene, original, "Never mutate retained model/author source bytes");
  node.data.editorMeta.sourceProcessJobId = jobId; node.data.editorMeta.sourceProcessChapterIndex = 0;
  assert.equal(row([node], "validation").percent, 50);
  const invalid = structuredClone(original); invalid.commands[0].presentation_mode = "invalid_mode";
  const invalidNode = adaptedSceneToNode({ scene_beat: invalid, source_mapping: {}, warnings: [] },
    { sessionId: "phase_session", importLineId: "invalid_line", startPosition: { x: 0, y: 0 },
      columnGap: 300, rowGap: 200, columns: 4 }, 0);
  invalidNode.data.editorMeta.sourceProcessJobId = jobId;
  invalidNode.data.editorMeta.sourceProcessChapterIndex = 0;
  assert.equal(invalidNode.data.scene.commands.find(c => c.text === "Legacy/backend default").presentation_mode, "invalid_mode");
  assert.equal(row([invalidNode], "validation").status, "blocked", "Never normalize explicit invalid modes into a pass");
});
test("legacy unindexed nodes preserve only observed count, no claim without a scene", () => {
  const legacy = structuredClone(taskNodes);
  legacy.forEach(n => delete n.data.editorMeta.sourceProcessChapterIndex);
  assert.equal(row(legacy, "import_write").percent, 100);
  delete legacy[0].data.scene;
  assert.equal(row(legacy, "import_write").percent, 50);
});
test("local blueprint import uses session ownership and planned scene count", () => {
  const local = structuredClone(taskNodes);
  local.forEach(n => { delete n.data.editorMeta.sourceProcessJobId;
    n.data.editorMeta.importSessionId = session.session_id; });
  const x = withNovelGraphPhaseProgress({ ...job, totalChunks: 2 }, {
    nodes: local, taskKind: "blueprint", sessionId: session.session_id,
  });
  assert.equal(x.phaseProgress.find(p => p.phase === "validation").status, "completed");
  const defaultSnapshot = createMockNovelProcessSnapshot({ ...input, processing: undefined,
    importJob: { status: "completed", total: 2, generatedCount: 2, failedSceneIds: [],
      startedAt: at, completedAt: at } });
  assert.equal(defaultSnapshot.job.status, "completed");
  assert(defaultSnapshot.job.phaseProgress.filter(p => ["import_write", "validation"].includes(p.phase))
    .every(p => p.percent === 0), "Default blueprint snapshot also must not invent graph facts");
  const displayed = withNovelGraphPhaseProgress(defaultSnapshot.job, {
    nodes: local, taskKind: "blueprint", sessionId: session.session_id, plannedScenes: 2 });
  assert.equal(displayed.phaseProgress.find(p => p.phase === "validation").status, "completed");
});
test("pressure UI fixture remains a fixture rather than inventing real graph writes", () => {
  const fixture = { ...job, source: "ui_pressure_fixture" };
  assert.strictEqual(withNovelGraphPhaseProgress(fixture, { nodes: [], taskKind: "fixture",
    sessionId: session.session_id }), fixture);
});
test("paused blueprint failures do not count as successful generation", () => {
  const failedSnapshot = createMockNovelProcessSnapshot({ ...input, processing: undefined,
    errors: ["SceneBeat required fields missing"], importJob: { status: "paused", total: 1,
      generatedCount: 0, failedSceneIds: ["candidate_0"], startedAt: at } });
  assert.equal(failedSnapshot.job.completedChunks, 0);
  assert.equal(failedSnapshot.job.failedChunks, 1);
  assert.equal(failedSnapshot.job.progressPercent, 0, "0/1 generated cannot display 100%");
  assert.equal(failedSnapshot.job.status, "failed", "No generated scenes is a failure, not partial success");
  const partial = createMockNovelProcessSnapshot({ ...input, processing: undefined,
    errors: ["Second scene failed"], importJob: { status: "paused", total: 2,
      generatedCount: 1, failedSceneIds: ["candidate_1"], startedAt: at } });
  assert.equal(partial.job.progressPercent, 50);
  assert.equal(partial.job.status, "failed_partial");
});
assert(cases.length >= 11);
console.log(JSON.stringify({ status: "PASS", cases: cases.length, source: path.resolve(__filename) }));
